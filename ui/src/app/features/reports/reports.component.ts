import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BridgeService } from '../../core/bridge.service';
import { ReportSummary, SessionRecord } from '../../core/interviewmate-api';
import {
  buildReport, overallScore, RANGE_OPTIONS, rangeBounds, ReportPoint, ReportRange, reportDigest,
} from '../../core/report';

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Trend chart geometry (SVG viewBox units).
const W = 640;
const H = 220;
const PAD = { left: 38, right: 16, top: 14, bottom: 32 };

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
  templateUrl: './reports.component.html',
  styleUrl: './reports.component.scss',
})
export class ReportsComponent implements OnInit {
  private readonly bridge = inject(BridgeService);

  readonly ranges = RANGE_OPTIONS;
  readonly range = signal<ReportRange>('7d');
  readonly customFrom = signal(isoDay(new Date(Date.now() - 30 * 86_400_000)));
  readonly customTo = signal(isoDay(new Date()));
  readonly all = signal<SessionRecord[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly generatedAt = signal(new Date());

  readonly report = computed(() => {
    const { from, to } = rangeBounds(this.range(), this.generatedAt(), this.customFrom(), this.customTo());
    return buildReport(this.all(), from, to);
  });
  readonly rangeLabel = computed(() => this.ranges.find((r) => r.id === this.range())?.label ?? '');

  // Optional Gemini summary of the period (cleared whenever the period changes).
  readonly summary = signal<ReportSummary | null>(null);
  readonly summarizing = signal(false);
  readonly summaryError = signal('');

  readonly exporting = signal(false);
  readonly exportNote = signal('');
  readonly exportedPath = signal('');

  readonly hover = signal<(ReportPoint & { x: number; y: number }) | null>(null);
  readonly W = W;
  readonly H = H;
  readonly PAD = PAD;

  /** Points of the overall-score trend, evenly spaced in interview order. */
  readonly chart = computed(() => {
    const trend = this.report().trend;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const pts = trend.map((p, i) => ({
      ...p,
      x: PAD.left + (trend.length === 1 ? innerW / 2 : (innerW * i) / (trend.length - 1)),
      y: PAD.top + innerH * (1 - p.score / 100),
    }));
    return {
      pts,
      path: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
      grid: [0, 50, 100].map((v) => ({ v, y: PAD.top + innerH * (1 - v / 100) })),
    };
  });

  async ngOnInit(): Promise<void> {
    try {
      this.all.set(await this.bridge.listSessions());
    } catch {
      this.loadError.set('Could not load your saved interviews.');
    } finally {
      this.loading.set(false);
    }
  }

  setRange(range: ReportRange): void {
    this.range.set(range);
    this.periodChanged();
  }

  periodChanged(): void {
    this.generatedAt.set(new Date());
    this.summary.set(null);
    this.summaryError.set('');
    this.exportNote.set('');
  }

  async summarize(): Promise<void> {
    this.summarizing.set(true);
    this.summaryError.set('');
    try {
      this.summary.set(await this.bridge.summarizeReport(reportDigest(this.report())));
    } catch (err) {
      this.summaryError.set(`Could not create the AI summary (${err instanceof Error ? err.message : 'unknown error'}). The rest of the report is computed locally and is still complete.`);
    } finally {
      this.summarizing.set(false);
    }
  }

  async exportPdf(): Promise<void> {
    const r = this.report();
    this.exporting.set(true);
    this.exportNote.set('');
    try {
      const result = await this.bridge.exportPdf(`InterviewMate report ${isoDay(r.from)} to ${isoDay(r.to)}.pdf`);
      if (result.saved && result.path) {
        this.exportedPath.set(result.path);
        this.exportNote.set(`Saved: ${result.path}`);
      }
    } catch (err) {
      this.exportNote.set(`Could not save the PDF (${err instanceof Error ? err.message : 'unknown error'}).`);
    } finally {
      this.exporting.set(false);
    }
  }

  showFile(): void {
    void this.bridge.showExportedFile();
  }

  score(s: SessionRecord): number | null {
    return overallScore(s.feedback);
  }

  duration(sec: number): string {
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  }
}
