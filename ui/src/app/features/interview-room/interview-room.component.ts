import { Component, ElementRef, HostListener, inject, input, OnDestroy, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BridgeService } from '../../core/bridge.service';
import { SessionRecord } from '../../core/interviewmate-api';
import { AvatarState, LiveSession, SimulationSession } from '../../core/live-session';
import { InterviewConfig, SessionStateService } from '../../core/session-state.service';
import { AvatarComponent } from '../../shared/avatar/avatar.component';
import { BgPickerComponent } from '../../shared/bg-picker/bg-picker.component';
import { VirtualBackgroundService } from './virtual-background.service';

@Component({
  selector: 'app-interview-room',
  standalone: true,
  imports: [FormsModule, AvatarComponent, BgPickerComponent],
  templateUrl: './interview-room.component.html',
  styleUrl: './interview-room.component.scss',
})
export class InterviewRoomComponent implements OnInit, OnDestroy {
  /** False while another tab is shown: the interview keeps running, hidden. */
  readonly visible = input(true);
  private readonly router = inject(Router);
  private readonly state = inject(SessionStateService);
  private readonly bridge = inject(BridgeService);
  protected readonly vbg = inject(VirtualBackgroundService);

  readonly config = signal<InterviewConfig | null>(null);
  readonly started = signal(false);
  readonly avatarState = signal<AvatarState>('idle');
  readonly statusText = signal('Ready when you are.');
  readonly currentQuestion = signal('');
  readonly transcript = signal<SessionRecord['transcript']>([]);
  readonly notices = signal<string[]>([]);
  readonly fatalError = signal('');
  readonly elapsedSec = signal(0);
  readonly micLevel = signal(0);
  readonly coachingOn = signal(false);
  readonly coachingNotes = signal<string[]>([]);
  readonly answerMode = signal<'voice' | 'text'>('text');
  readonly textAnswer = signal('');
  /** The candidate's turn is open: Done / Space / Enter sends the answer now. */
  readonly answering = signal(false);
  readonly camOn = signal(false);
  /** Camera card scrolled out of view -> floating picture-in-picture preview. */
  readonly pip = signal(false);
  private pipObserver: IntersectionObserver | null = null;
  readonly pipPos = signal<{ x: number; y: number } | null>(null);
  private pipDrag: { dx: number; dy: number } | null = null;

  @ViewChild('webcam') private webcam?: ElementRef<HTMLVideoElement>;
  @ViewChild('bgCanvas') private bgCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('camSlot') private camSlot?: ElementRef<HTMLElement>;

  private engine: LiveSession | SimulationSession | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private coachingId: ReturnType<typeof setInterval> | null = null;
  private meterId: number | null = null;
  private meterStream: MediaStream | null = null;
  private meterCtx: AudioContext | null = null;
  private camStream: MediaStream | null = null;
  private ending = false;
  private destroyed = false;

  ngOnInit(): void {
    const cfg = this.state.config();
    if (!cfg) {
      this.state.closeRoom();
      return;
    }
    this.config.set(cfg);
    if (cfg.mode === 2 && cfg.coachingConsent) this.coachingOn.set(true);
  }

  async ngOnDestroy(): Promise<void> {
    this.destroyed = true;
    this.state.live.set(false);
    await this.cleanupMediaAndEngine();
  }

  /** Close the room before the interview has begun (back to the Interview tab). */
  leave(): void {
    if (!this.started()) this.state.closeRoom();
  }

  get durationSec(): number {
    return (this.config()?.durationMin ?? 15) * 60;
  }

  timeLabel(): string {
    const remaining = Math.max(0, this.durationSec - this.elapsedSec());
    return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} remaining`;
  }

  async begin(): Promise<void> {
    const cfg = this.config();
    if (!cfg || this.started()) return;
    this.started.set(true);
    this.state.live.set(true);
    await this.startCameraPreview();
    if (this.camStream && this.webcam && this.bgCanvas) {
      await this.vbg.attach(this.webcam.nativeElement, this.bgCanvas.nativeElement);
    }
    this.watchCameraSlot();
    await this.startMeter();
    this.startTimer();

    const callbacks = {
      onState: (s: AvatarState, status?: string) => {
        this.avatarState.set(s);
        if (status) this.statusText.set(status);
      },
      onTranscript: (entries: SessionRecord['transcript']) => this.transcript.set([...entries]),
      onQuestion: (q: string) => this.currentQuestion.set(q),
      onNotice: (m: string) => this.pushNotice(m),
      onError: (m: string) => {
        this.fatalError.set(m);
        this.avatarState.set('error');
      },
      onEnded: () => {
        if (!this.ending && !this.destroyed) void this.endInterview();
      },
      onAnswerMode: (mode: 'voice' | 'text') => this.answerMode.set(mode),
      onAnswering: (open: boolean) => this.answering.set(open),
    };

    if (cfg.simulation) {
      if (cfg.mode === 2) {
        this.coachingOn.set(false);
        this.pushNotice('Webcam coaching needs the live Gemini connection and is not available in Simulation mode. No frames are being sent.');
      }
      this.engine = new SimulationSession(cfg, callbacks);
      this.engine.start();
    } else {
      this.engine = new LiveSession(this.bridge, cfg, callbacks);
      await this.engine.start();
      if (cfg.mode === 2 && cfg.coachingConsent) this.startCoaching();
    }
  }

  // --- picture-in-picture camera --------------------------------------------
  private watchCameraSlot(): void {
    const slot = this.camSlot?.nativeElement;
    if (!slot || typeof IntersectionObserver === 'undefined') return;
    this.pipObserver = new IntersectionObserver(
      ([entry]) => this.pip.set(this.camOn() && entry.intersectionRatio < 0.35),
      { threshold: [0, 0.35, 1] },
    );
    this.pipObserver.observe(slot);
  }

  scrollToCamera(): void {
    this.camSlot?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Drag the floating camera anywhere on screen; the spot is kept for the
  // next time it floats. Scrolling back to the panel still docks it.
  startPipDrag(event: PointerEvent): void {
    if (!this.pip() || (event.target as HTMLElement).closest('button')) return;
    const frame = event.currentTarget as HTMLElement;
    const rect = frame.getBoundingClientRect();
    this.pipDrag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    frame.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  movePipDrag(event: PointerEvent): void {
    if (!this.pipDrag) return;
    const frame = event.currentTarget as HTMLElement;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
    this.pipPos.set({
      x: clamp(event.clientX - this.pipDrag.dx, 8, window.innerWidth - frame.offsetWidth - 8),
      y: clamp(event.clientY - this.pipDrag.dy, 48, window.innerHeight - frame.offsetHeight - 8), // 48: below the title bar
    });
  }

  endPipDrag(): void {
    this.pipDrag = null;
  }

  // --- camera preview + coaching -------------------------------------------
  private async startCameraPreview(): Promise<void> {
    try {
      this.camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (this.webcam?.nativeElement) this.webcam.nativeElement.srcObject = this.camStream;
      this.camOn.set(true);
    } catch {
      this.pushNotice('Camera preview unavailable (permission denied or no camera). The voice interview continues; webcam coaching is paused.');
      this.coachingOn.set(false);
    }
  }

  private startCoaching(): void {
    void (async () => {
      let intervalSec = 25;
      try {
        intervalSec = (await this.bridge.getSettings()).coachingIntervalSec || 25;
      } catch { /* keep default */ }
      if (this.destroyed || this.ending) return;
      this.coachingId = setInterval(() => void this.captureFrame(), intervalSec * 1000);
    })();
  }

  private async captureFrame(): Promise<void> {
    if (!this.coachingOn() || this.ending || this.destroyed) return;
    // When a virtual background is active, coach on the presented (processed)
    // frame; otherwise use the raw camera frame.
    const rawProcessed = this.vbg.active() ? this.bgCanvas?.nativeElement : undefined;
    const processed = rawProcessed && rawProcessed.width > 0 ? rawProcessed : undefined;
    const video = this.webcam?.nativeElement;
    if (!processed && (!video || !video.videoWidth)) return;
    try {
      const canvas = document.createElement('canvas');
      const width = 640;
      const srcW = processed?.width || video!.videoWidth;
      const srcH = processed?.height || video!.videoHeight;
      canvas.width = width;
      canvas.height = Math.round((srcH / srcW) * width);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(processed ?? video!, 0, 0, canvas.width, canvas.height);
      const jpegBase64 = canvas.toDataURL('image/jpeg', 0.7).replace(/^data:image\/jpeg;base64,/, '');
      const result = await this.bridge.analyzeFrame(jpegBase64);
      this.coachingNotes.update((notes) => [...notes, result.feedback]);
    } catch (err) {
      // Non-blocking: the voice interview continues.
      this.pushNotice(`Webcam coaching check failed (${err instanceof Error ? err.message : 'unknown error'}). The interview continues.`);
    }
  }

  toggleCoaching(): void {
    this.coachingOn.update((on) => !on);
    this.pushNotice(this.coachingOn() ? 'Camera analysis resumed.' : 'Camera analysis paused. No frames are being sent.');
  }

  // --- mic meter ---------------------------------------------------------------
  private async startMeter(): Promise<void> {
    try {
      // The live engine has its own capture; this lightweight stream only drives the level meter.
      this.meterStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.meterCtx = new AudioContext();
      const analyser = this.meterCtx.createAnalyser();
      analyser.fftSize = 256;
      this.meterCtx.createMediaStreamSource(this.meterStream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (this.destroyed) return;
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        this.micLevel.set(Math.min(1, avg / 128));
        this.meterId = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      this.pushNotice('Microphone level meter unavailable (permission denied or no microphone).');
    }
  }

  // --- timer / ending -------------------------------------------------------------
  private startTimer(): void {
    this.timerId = setInterval(() => {
      this.elapsedSec.update((s) => s + 1);
      this.state.remainingLabel.set(this.timeLabel().replace(' remaining', ' left'));
      if (this.elapsedSec() >= this.durationSec) void this.endInterview();
    }, 1000);
  }

  finishAnswer(): void {
    if (this.engine instanceof LiveSession) this.engine.finishAnswer();
  }

  /** Space or Enter = "Done answering", unless typing or a button/field has focus. */
  @HostListener('document:keydown.space', ['$event'])
  @HostListener('document:keydown.enter', ['$event'])
  onDoneKey(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!this.visible() || !this.answering() || target?.closest('input, textarea, select, button, [contenteditable]')) return;
    event.preventDefault();
    this.finishAnswer();
  }

  submitTextAnswer(): void {
    const engine = this.engine;
    if (engine instanceof SimulationSession) {
      engine.submitAnswer(this.textAnswer());
      this.textAnswer.set('');
    }
  }

  async endInterview(): Promise<void> {
    if (this.ending) return;
    this.ending = true;
    const cfg = this.config();
    const transcript = this.engine ? this.engine.snapshotTranscript() : this.transcript();
    await this.cleanupMediaAndEngine();
    if (!cfg || this.destroyed) {
      this.state.closeRoom();
      return;
    }
    const record: SessionRecord = {
      id: `session-${Date.now()}`,
      date: new Date().toISOString(),
      title: `${cfg.level.charAt(0).toUpperCase() + cfg.level.slice(1)} interview${cfg.role ? ` — ${cfg.role}` : ''}`,
      level: cfg.level,
      mode: cfg.mode,
      role: cfg.role,
      durationSec: this.elapsedSec(),
      transcript,
      coachingNotes: [...this.coachingNotes()],
      language: cfg.language,
      transcriptLanguage: cfg.transcriptLanguage,
      interviewerName: cfg.interviewerName,
    };
    this.state.lastSession.set(record);
    this.state.closeRoom(); // unmounts this room
    void this.router.navigate(['/summary']);
  }

  private async cleanupMediaAndEngine(): Promise<void> {
    await this.vbg.detach().catch(() => undefined);
    this.pipObserver?.disconnect();
    this.pip.set(false);
    this.camOn.set(false);
    if (this.timerId) clearInterval(this.timerId);
    if (this.coachingId) clearInterval(this.coachingId);
    this.timerId = null;
    this.coachingId = null;
    if (this.meterId) cancelAnimationFrame(this.meterId);
    this.meterStream?.getTracks().forEach((t) => t.stop());
    this.camStream?.getTracks().forEach((t) => t.stop());
    await this.meterCtx?.close().catch(() => undefined);
    await this.engine?.stop().catch(() => undefined);
    this.engine = null;
  }

  private pushNotice(message: string): void {
    this.notices.update((list) => [...list.slice(-4), message]);
  }
}
