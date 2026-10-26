import { Component, ElementRef, inject, OnDestroy, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { cvSummaryText, extractName, summarizeCv } from '../../core/cv';
import { pickInterviewerName } from '../../core/prompt';
import { InterviewLanguage, InterviewLevel, InterviewMode } from '../../core/interviewmate-api';
import { defaultScheduleTime, toLocalInput } from '../../core/schedule';
import { ScheduleService } from '../../core/schedule.service';
import { InterviewConfig, SessionStateService } from '../../core/session-state.service';
import { BgPickerComponent } from '../../shared/bg-picker/bg-picker.component';
import { VirtualBackgroundService } from '../interview-room/virtual-background.service';

const MAX_CV_BYTES = 5 * 1024 * 1024;

interface LevelOption { value: InterviewLevel; title: string; desc: string }
interface ModeOption { value: InterviewMode; title: string; desc: string }

@Component({
  selector: 'app-interview-setup',
  standalone: true,
  imports: [FormsModule, RouterLink, BgPickerComponent],
  templateUrl: './interview-setup.component.html',
  styleUrl: './interview-setup.component.scss',
})
export class InterviewSetupComponent implements OnDestroy {
  private readonly router = inject(Router);
  protected readonly state = inject(SessionStateService);
  private readonly schedule = inject(ScheduleService);
  protected readonly vbg = inject(VirtualBackgroundService);

  /** Start now, or schedule for an exact date and time ("?when=later" preselects it). */
  readonly when = signal<'now' | 'later'>(inject(ActivatedRoute).snapshot.queryParamMap.get('when') === 'later' ? 'later' : 'now');
  readonly scheduleAt = signal(toLocalInput(defaultScheduleTime(new Date())));
  readonly minScheduleAt = toLocalInput(new Date());
  readonly scheduling = signal(false);

  readonly levels: LevelOption[] = [
    { value: 'intern', title: 'Intern', desc: 'Fundamental concepts and learning potential. Simple, clearly scoped questions, friendly tone, extra thinking time.' },
    { value: 'junior', title: 'Junior', desc: 'Entry-level professional questions: practical application, basic debugging, project decisions, moderate follow-ups.' },
    { value: 'senior', title: 'Senior', desc: 'Deeper reasoning and trade-offs: architecture, scalability, performance, security, design decisions, challenging follow-ups.' },
  ];
  readonly modes: ModeOption[] = [
    { value: 1, title: 'Mode 1 — Voice Interview + Webcam Preview', desc: 'Spoken interview with your webcam preview visible only to you. No webcam images are sent to the AI in this mode.' },
    { value: 2, title: 'Mode 2 — Voice Interview + Periodic Webcam Coaching', desc: 'Everything in Mode 1, plus: with your explicit consent, a still frame is captured every interval (Settings, default 25s) and sent to Google for presentation feedback on framing, lighting, and gaze direction.' },
  ];

  readonly level = signal<InterviewLevel>('junior');
  readonly mode = signal<InterviewMode>(1);
  readonly role = signal('');
  readonly candidateName = signal('');
  readonly answerMode = signal<'auto' | 'manual'>('auto');
  readonly pauseSec = signal(2.5);
  readonly durationMin = signal(15);
  readonly language = signal<InterviewLanguage>('English');
  readonly transcriptLanguage = signal<InterviewLanguage>('English');
  readonly coachingConsent = signal(false);
  readonly simulation = signal(false);

  // CV state
  readonly cvFileName = signal<string | null>(null);
  readonly cvBusy = signal(false);
  readonly cvError = signal('');
  readonly summaryText = signal('');
  readonly summarySkills = signal<string[]>([]);
  readonly summaryProjects = signal<string[]>([]);
  readonly pasteText = signal('');
  readonly generalSkills = signal('');

  // media test state
  readonly micStatus = signal('');
  readonly camStatus = signal('');
  readonly camOn = signal(false);
  @ViewChild('camPreview') private camPreview?: ElementRef<HTMLVideoElement>;
  @ViewChild('camCanvas') private camCanvas?: ElementRef<HTMLCanvasElement>;
  private testStream: MediaStream | null = null;
  /** This page attached the shared background effect (never detach the live interview's). */
  private vbgAttached = false;

  readonly formError = signal('');

  ngOnDestroy(): void {
    this.stopTestTracks();
  }

  // --- CV -----------------------------------------------------------------
  async onCvFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.cvError.set('');
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.endsWith('.docx')) {
      this.cvError.set('Only PDF or DOCX files are supported.');
      return;
    }
    if (file.size > MAX_CV_BYTES) {
      this.cvError.set(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The limit is 5 MB.`);
      return;
    }
    this.cvBusy.set(true);
    try {
      const text = lower.endsWith('.pdf') ? await this.extractPdfText(file) : await this.extractDocxText(file);
      if (!text.trim()) throw new Error('No readable text was found in the file. If it is a scanned image PDF, paste the text instead.');
      this.applyExtractedText(text, file.name);
    } catch (err) {
      this.cvError.set(`CV text extraction failed: ${err instanceof Error ? err.message : String(err)} You can paste your CV text below instead.`);
      this.cvFileName.set(null);
    } finally {
      this.cvBusy.set(false);
    }
  }

  private async extractPdfText(file: File): Promise<string> {
    const pdfjs = await import('pdfjs-dist');
    try {
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    } catch {
      // Worker URL import unsupported in this build: pdf.js will fall back to
      // its main-thread ("fake worker") mode; if that fails too, the catch in
      // onCvFile offers the paste fallback.
    }
    const data = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return pages.join('\n');
  }

  private async extractDocxText(file: File): Promise<string> {
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  usePastedText(): void {
    const text = this.pasteText();
    if (!text.trim()) {
      this.cvError.set('Paste your CV text first.');
      return;
    }
    this.cvError.set('');
    this.applyExtractedText(text, 'Pasted CV text');
  }

  private applyExtractedText(text: string, fileName: string): void {
    const summary = summarizeCv(text);
    this.cvFileName.set(fileName);
    this.summarySkills.set(summary.skills);
    this.summaryProjects.set(summary.projects);
    this.summaryText.set(cvSummaryText(summary));
    const name = extractName(text);
    if (name && !this.candidateName().trim()) this.candidateName.set(name); // never overwrite a typed name
    if (!summary.skills.length && !summary.projects.length) {
      this.cvError.set('Text was extracted, but no known skills or projects were detected. You can edit the summary below manually — the interviewer will only use what is written there.');
    }
  }

  removeCv(): void {
    this.cvFileName.set(null);
    this.summaryText.set('');
    this.summarySkills.set([]);
    this.summaryProjects.set([]);
    this.cvError.set('');
  }

  // --- media tests ----------------------------------------------------------
  async testMic(): Promise<void> {
    this.micStatus.set('Requesting microphone…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      this.micStatus.set('Microphone works.');
    } catch {
      this.micStatus.set('Microphone unavailable: permission denied or no microphone found. Check your browser/OS permission settings.');
    }
  }

  async testCamera(): Promise<void> {
    if (this.state.live()) {
      this.camStatus.set('Your camera is in use by the interview that is running. End it first to test the camera here.');
      return;
    }
    this.stopTestTracks();
    this.camStatus.set('Requesting camera…');
    try {
      this.testStream = await navigator.mediaDevices.getUserMedia({ video: true });
      this.camStatus.set('Camera works. This is only a local preview — nothing is sent anywhere.');
      this.camOn.set(true);
      setTimeout(() => {
        if (this.camPreview?.nativeElement && this.camCanvas?.nativeElement && this.testStream) {
          this.camPreview.nativeElement.srcObject = this.testStream;
          // Preview the chosen background now; the same choice carries into the interview.
          this.vbgAttached = true;
          void this.vbg.attach(this.camPreview.nativeElement, this.camCanvas.nativeElement);
        }
      });
    } catch {
      this.camStatus.set('Camera unavailable: permission denied or no camera found. Interviews can still run in Mode 1 without a camera preview.');
    }
  }

  stopTestTracks(): void {
    if (this.vbgAttached) void this.vbg.detach();
    this.vbgAttached = false;
    this.camOn.set(false);
    this.testStream?.getTracks().forEach((t) => t.stop());
    this.testStream = null;
    if (this.camPreview?.nativeElement) this.camPreview.nativeElement.srcObject = null;
  }

  // --- start ------------------------------------------------------------------
  start(): void {
    if (this.when() === 'later') {
      void this.scheduleLater();
      return;
    }
    const config = this.buildConfig();
    if (!config) return;
    if (this.state.roomOpen()) {
      this.formError.set('An interview is already open on the Interview tab. End it (or press "Not now") before starting another.');
      return;
    }
    this.stopTestTracks();
    this.state.openRoom(config);
    void this.router.navigate(['/interview']);
  }

  async scheduleLater(): Promise<void> {
    const config = this.buildConfig();
    if (!config) return;
    const at = new Date(this.scheduleAt());
    if (Number.isNaN(at.getTime())) {
      this.formError.set('Pick the date and time for the interview.');
      return;
    }
    if (at.getTime() < Date.now() - 60_000) {
      this.formError.set('That time has already passed. Pick a time in the future, or choose "Start now".');
      return;
    }
    this.scheduling.set(true);
    try {
      await this.schedule.schedule(at, config);
      this.stopTestTracks();
      void this.router.navigate(['/interview']);
    } catch (err) {
      this.formError.set(`Could not schedule the interview (${err instanceof Error ? err.message : 'unknown error'}).`);
    } finally {
      this.scheduling.set(false);
    }
  }

  /** The interview setup from this form, or null (with formError set) when it is incomplete. */
  private buildConfig(): InterviewConfig | null {
    this.formError.set('');
    if (this.mode() === 2 && !this.coachingConsent()) {
      this.formError.set('Mode 2 sends still webcam frames to Google for analysis. Tick the consent box to use it, or choose Mode 1.');
      return null;
    }
    const hasCv = !!this.cvFileName() && !!this.summaryText().trim();
    if (this.cvFileName() && !this.summaryText().trim()) {
      this.formError.set('Your CV summary is empty. Restore it or remove the CV — the interviewer can only ask about what is in the summary.');
      return null;
    }
    return {
      level: this.level(),
      mode: this.mode(),
      role: this.role().trim(),
      durationMin: this.durationMin(),
      language: this.language(),
      transcriptLanguage: this.transcriptLanguage(),
      cvSummary: hasCv ? this.summaryText().trim() : null,
      cvFileName: this.cvFileName(),
      generalSkills: this.generalSkills().trim(),
      simulation: this.simulation(),
      coachingConsent: this.mode() === 2 && this.coachingConsent(),
      candidateName: this.candidateName().trim(),
      interviewerName: pickInterviewerName(this.language()),
      answerMode: this.answerMode(),
      pauseSec: this.pauseSec(),
    };
  }
}
