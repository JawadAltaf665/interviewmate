import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BridgeService } from '../../core/bridge.service';
import { SessionRecord } from '../../core/interviewmate-api';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly bridge = inject(BridgeService);
  readonly sessions = signal<SessionRecord[]>([]);
  readonly loadError = signal('');
  readonly total = signal(0);
  readonly totalMinutes = signal(0);
  readonly bars = [30, 55, 80, 45, 95, 70, 40, 85, 60, 100, 50, 75, 35, 65, 90, 45, 70, 30];

  async ngOnInit(): Promise<void> {
    try {
      const list = await this.bridge.listSessions();
      this.sessions.set([...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5));
      this.total.set(list.length);
      this.totalMinutes.set(Math.round(list.reduce((sum, s) => sum + (s.durationSec || 0), 0) / 60));
    } catch {
      this.loadError.set('Could not load recent sessions.');
    }
  }

  levelLabel(level: string): string {
    return level.charAt(0).toUpperCase() + level.slice(1);
  }

  durationLabel(sec: number): string {
    if (!sec) return '—';
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }

  sessionTitle(s: SessionRecord): string {
    return s.title || `${this.levelLabel(s.level)} interview${s.role ? ` — ${s.role}` : ''}`;
  }
}
