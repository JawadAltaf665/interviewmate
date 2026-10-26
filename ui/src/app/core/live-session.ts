import { ActivityHandling, EndSensitivity, GoogleGenAI, Modality, LiveServerMessage, RealtimeInputConfig, Session } from '@google/genai';
import { BridgeService } from './bridge.service';
import { TranscriptEntry } from './interviewmate-api';
import { buildLocalQuestions, buildSystemInstruction, firstName } from './prompt';
import { InterviewConfig } from './session-state.service';

// Session engines for the interview room.
//
// LiveSession: Gemini Live API via an ephemeral token minted by the Electron
// main process (the long-lived API key never enters the renderer). Mic audio
// is streamed as PCM16; model audio (PCM16, 24kHz) is played back through a
// Web Audio queue. Avatar state is derived from real playback + turn events.
//
// SimulationSession: fully local — local questions, speechSynthesis for the
// interviewer's voice, SpeechRecognition for answers when available, with a
// text-answer fallback. Never presented as Gemini.

export type AvatarState = 'idle' | 'speaking' | 'listening' | 'thinking' | 'connecting' | 'error';

export interface EngineCallbacks {
  onState(state: AvatarState, status?: string): void;
  onTranscript(entries: TranscriptEntry[]): void;
  onQuestion(text: string): void;
  onNotice(message: string): void;
  onError(message: string): void;
  /** Session ended without the user pressing End (completion or fatal error). */
  onEnded(): void;
  /** Simulation only: whether answers are taken by voice or by typing. */
  onAnswerMode?(mode: 'voice' | 'text'): void;
  /** True while the candidate's turn is open (enables "Done answering" / Space / Enter). */
  onAnswering?(open: boolean): void;
}

export const LIVE_MODEL = 'gemini-3.8-live';

/** Close reasons Google uses when a key's Live quota or rate limit is hit. */
const QUOTA_CLOSE = /quota|resource.?exhausted|exceeded|rate.?limit|429/i;
const ALL_KEYS_QUOTA_MESSAGE =
  'Free quota reached on all your saved API keys. Your transcript so far is kept. ' +
  'Add a key from a different Google project in Settings, or try again after the daily reset (midnight Pacific time).';

function transcriptionConfig(language: string): { languageCodes?: string[] } {
  return language === 'Urdu' ? { languageCodes: ['ur-PK', 'en-US'] } : {};
}

/**
 * When the candidate's answer is over.
 * auto: Gemini's voice detection, tuned to tolerate thinking pauses. Its Live
 *   default (END_SENSITIVITY_HIGH, short silence) cut answers off mid-thought.
 * manual: detection off; the turn ends only when the candidate presses "Done".
 */
export function realtimeInputConfig(config: Pick<InterviewConfig, 'answerMode' | 'pauseSec'>): RealtimeInputConfig {
  if (config.answerMode === 'manual') {
    return { automaticActivityDetection: { disabled: true }, activityHandling: ActivityHandling.NO_INTERRUPTION };
  }
  return {
    automaticActivityDetection: {
      endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
      silenceDurationMs: Math.round((config.pauseSec || 2.5) * 1000),
    },
  };
}

function floatToPcm16Base64(input: Float32Array): string {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToPcm16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2));
}

export class LiveSession {
  analyser: AnalyserNode | null = null;

  private session: Session | null = null;
  private micStream: MediaStream | null = null;
  private micCtx: AudioContext | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private playCtx: AudioContext | null = null;
  private nextPlayTime = 0;
  private activeSources = 0;
  private entries: TranscriptEntry[] = [];
  private inputPartial = '';
  private outputPartial = '';
  private resumptionHandle: string | undefined;
  private reconnectAttempts = 0;
  private credentialId: string | undefined;
  private credentialName = '';
  private userEnded = false;
  private destroyed = false;
  // The candidate's turn is open (manual mode: between activityStart and activityEnd).
  private answering = false;
  private modelTurnDone = false;
  // Auto mode "send now": mic muted after audioStreamEnd until the interviewer replies.
  private micPaused = false;
  private resumeMicTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_RECONNECTS = 3;

  constructor(
    private readonly bridge: BridgeService,
    private readonly config: InterviewConfig,
    private readonly cb: EngineCallbacks,
  ) {}

  async start(): Promise<void> {
    this.cb.onState('connecting', 'Connecting…');
    try {
      await this.connect(await this.mint(), undefined);
      await this.startMic();
      this.cb.onState('listening', 'Listening — the interviewer will start shortly');
    } catch (err) {
      this.cb.onState('error', 'Connection failed');
      const message = err instanceof Error ? err.message : String(err);
      this.cb.onError(/quota/i.test(message) ? ALL_KEYS_QUOTA_MESSAGE : `Could not start the live interview: ${message}`);
      this.cb.onEnded();
    }
  }

  private async connect(token: string, handle: string | undefined): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1beta' } });
    this.session = await ai.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: buildSystemInstruction({
          level: this.config.level,
          mode: this.config.mode,
          role: this.config.role,
          cvSummary: this.config.cvSummary,
          language: this.config.language,
          candidateName: this.config.candidateName,
          interviewerName: this.config.interviewerName,
          durationMin: this.config.durationMin,
        }),
        // Language hints: Urdu interviews are often code-switched with English.
        inputAudioTranscription: transcriptionConfig(this.config.language),
        outputAudioTranscription: transcriptionConfig(this.config.language),
        sessionResumption: handle ? { handle } : {},
        realtimeInputConfig: realtimeInputConfig(this.config),
      },
      callbacks: {
        onopen: () => {
          if (!this.destroyed) this.cb.onNotice('Connected to Gemini Live.');
        },
        onmessage: (msg) => this.handleMessage(msg),
        onerror: (e) => {
          if (!this.destroyed) this.cb.onNotice(`Live connection error: ${e.message ?? 'unknown error'}`);
        },
        onclose: (e) => void this.handleClose(e?.reason ?? ''),
      },
    });
    if (!handle) {
      // Live models wait for user input; without this the interviewer stays silent.
      this.session?.sendClientContent({
        // Only "start talking": the system instruction owns the greeting / small talk / interview flow.
        turns: [{ role: 'user', parts: [{ text: '(The candidate has just joined the call. Begin with step 1 of your opening.)' }] }],
        turnComplete: true,
      });
    } else if (this.answering) {
      // Reconnected mid-answer: reopen the candidate's turn on the new connection.
      this.session?.sendRealtimeInput({ activityStart: {} });
    }
  }

  private get manual(): boolean {
    return this.config.answerMode === 'manual';
  }

  /** Open the candidate's turn once the interviewer has finished speaking. */
  private maybeOpenAnswer(): void {
    if (this.answering || !this.modelTurnDone || this.activeSources > 0 || this.destroyed) return;
    this.modelTurnDone = false;
    this.answering = true;
    if (this.manual) {
      try { this.session?.sendRealtimeInput({ activityStart: {} }); } catch { /* reconnecting; reopened in connect() */ }
    }
    this.cb.onAnswering?.(true);
    this.cb.onState('listening', this.manual
      ? 'Your turn — press Done answering (Space / Enter) when you have finished'
      : 'Your turn — take your time, or press Space / Enter to send now');
  }

  /** The candidate pressed "Done answering" / Space / Enter: the interviewer replies now. */
  finishAnswer(): void {
    if (!this.answering || this.destroyed) return;
    this.answering = false;
    if (this.manual) {
      try { this.session?.sendRealtimeInput({ activityEnd: {} }); } catch { /* connection dropped */ }
    } else {
      // Auto detection does not accept activityEnd; "microphone off" (audioStreamEnd)
      // makes Gemini close the turn now instead of waiting for the pause.
      this.micPaused = true;
      try { this.session?.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* connection dropped */ }
      // Nothing came back (e.g. nothing was said yet): reopen the mic so the interview never stalls.
      this.resumeMicTimer = setTimeout(() => this.resumeMic(true), 6000);
    }
    this.cb.onAnswering?.(false);
    this.cb.onState('thinking', 'Interviewer is thinking…');
  }

  private resumeMic(reopenTurn: boolean): void {
    if (this.resumeMicTimer) clearTimeout(this.resumeMicTimer);
    this.resumeMicTimer = null;
    if (!this.micPaused) return;
    this.micPaused = false; // the next audio chunk reopens the stream
    if (reopenTurn && this.activeSources === 0 && !this.destroyed) {
      this.modelTurnDone = true;
      this.maybeOpenAnswer();
    }
  }

  /** Mint a single-use token; remembers which saved key it came from. */
  private async mint(): Promise<string> {
    const minted = await this.bridge.mintLiveToken(LIVE_MODEL);
    this.credentialId = minted.credentialId;
    this.credentialName = minted.credentialName ?? '';
    return minted.token;
  }

  private handleMessage(msg: LiveServerMessage): void {
    if (this.destroyed) return;
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      this.resumptionHandle = msg.sessionResumptionUpdate.newHandle;
    }
    if (msg.goAway) {
      this.cb.onNotice('The server will end this connection soon — reconnecting automatically to continue your interview.');
    }
    const content = msg.serverContent;
    if (!content) return;

    if (content.interrupted) {
      this.flushPlayback();
      this.modelTurnDone = true; // barge-in: the candidate's turn opens once playback stops
    }
    const inText = content.inputTranscription?.text;
    if (inText) this.inputPartial += inText;
    const outText = content.outputTranscription?.text;
    if (outText) {
      this.outputPartial += outText;
      this.cb.onQuestion(this.outputPartial.trim());
    }
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) this.enqueueAudio(part.inlineData.data);
      else if (part.text && !outText) {
        this.outputPartial += part.text;
        this.cb.onQuestion(this.outputPartial.trim());
      }
    }
    if (content.turnComplete) {
      const userText = this.inputPartial.trim();
      const modelText = this.outputPartial.trim();
      if (userText) this.entries = [...this.entries, { speaker: 'user', text: userText }];
      if (modelText) this.entries = [...this.entries, { speaker: 'interviewer', text: modelText }];
      this.inputPartial = '';
      this.outputPartial = '';
      this.cb.onTranscript(this.entries);
      this.modelTurnDone = true;
      this.maybeOpenAnswer();
    }
  }

  private async handleClose(reason = ''): Promise<void> {
    if (this.destroyed || this.userEnded) return;
    this.session = null;
    if (QUOTA_CLOSE.test(reason) && this.credentialId) {
      // This key is out of Live quota: park it so the next mint uses the next key.
      await this.bridge.reportLiveQuota(this.credentialId).catch(() => undefined);
      this.cb.onNotice(`API key "${this.credentialName || 'current key'}" reached its quota — switching to your next key…`);
    }
    if (this.reconnectAttempts >= LiveSession.MAX_RECONNECTS) {
      this.cb.onState('error', 'Connection lost');
      this.cb.onError('The live connection closed and automatic reconnect attempts were exhausted. Your transcript so far is kept.');
      this.cb.onEnded();
      return;
    }
    this.reconnectAttempts++;
    this.cb.onState('connecting', `Reconnecting (attempt ${this.reconnectAttempts})…`);
    try {
      const token = await this.mint();
      await this.connect(token, this.resumptionHandle);
      this.cb.onNotice(this.resumptionHandle ? 'Reconnected. Session resumed.' : 'Reconnected.');
      if (this.activeSources === 0) this.cb.onState('listening', 'Listening — your turn to answer');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/quota/i.test(message)) {
        // Every saved key is out of quota: stop with a clear message instead of retrying.
        this.cb.onState('error', 'Quota reached');
        this.cb.onError(ALL_KEYS_QUOTA_MESSAGE);
        this.cb.onEnded();
        return;
      }
      // The new session's onclose (or this failure) drives the next attempt via handleClose again.
      void this.handleClose();
    }
  }

  private async startMic(): Promise<void> {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      throw new Error('Microphone access was denied or no microphone is available. Allow microphone permission and try again.');
    }
    const ctx = new AudioContext({ sampleRate: 16000 });
    this.micCtx = ctx;
    const source = ctx.createMediaStreamSource(this.micStream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    this.micProcessor = processor;
    processor.onaudioprocess = (event) => {
      if (!this.session || this.destroyed) return;
      if ((this.manual && !this.answering) || this.micPaused) return; // only the open answer turn is sent
      const data = event.inputBuffer.getChannelData(0);
      try {
        this.session.sendRealtimeInput({
          audio: { data: floatToPcm16Base64(data), mimeType: `audio/pcm;rate=${Math.round(ctx.sampleRate)}` },
        });
      } catch {
        /* session may be mid-reconnect; drop the chunk */
      }
    };
    source.connect(processor);
    processor.connect(ctx.destination);
  }

  private ensurePlayCtx(): AudioContext {
    if (!this.playCtx) {
      this.playCtx = new AudioContext({ sampleRate: 24000 });
      this.nextPlayTime = 0;
    }
    return this.playCtx;
  }

  private enqueueAudio(base64: string): void {
    const ctx = this.ensurePlayCtx();
    const pcm = base64ToPcm16(base64);
    if (!pcm.length) return;
    const buffer = ctx.createBuffer(1, pcm.length, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;
    const sourceNode = ctx.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextPlayTime);
    sourceNode.start(startAt);
    this.nextPlayTime = startAt + buffer.duration;
    this.activeSources++;
    this.resumeMic(false); // the interviewer is replying: the mic can listen again (barge-in)
    if (this.answering && !this.manual) {
      // Auto detection ended the answer on its own.
      this.answering = false;
      this.cb.onAnswering?.(false);
    }
    this.cb.onState('speaking', 'Interviewer is speaking');
    sourceNode.onended = () => {
      this.activeSources = Math.max(0, this.activeSources - 1);
      if (this.activeSources === 0 && !this.destroyed && !this.userEnded) {
        this.maybeOpenAnswer();
      }
    };
  }

  private flushPlayback(): void {
    // Barge-in: we cannot un-schedule already-started sources individually
    // here, so reset the queue clock; buffered sources are short chunks.
    if (this.playCtx) this.nextPlayTime = this.playCtx.currentTime;
  }

  /** Partial transcript entries including the in-progress turn (used on End). */
  snapshotTranscript(): TranscriptEntry[] {
    const extra: TranscriptEntry[] = [];
    if (this.inputPartial.trim()) extra.push({ speaker: 'user', text: this.inputPartial.trim() });
    if (this.outputPartial.trim()) extra.push({ speaker: 'interviewer', text: this.outputPartial.trim() });
    return [...this.entries, ...extra];
  }

  async stop(): Promise<void> {
    if (this.resumeMicTimer) clearTimeout(this.resumeMicTimer);
    this.userEnded = true;
    this.destroyed = true;
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
    this.micProcessor?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    await this.micCtx?.close().catch(() => undefined);
    await this.playCtx?.close().catch(() => undefined);
  }
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export class SimulationSession {
  private readonly questions: string[];
  private index = 0;
  private entries: TranscriptEntry[] = [];
  private recognition: SpeechRecognitionLike | null = null;
  private stopped = false;
  private awaitingAnswer = false;

  constructor(
    private readonly config: InterviewConfig,
    private readonly cb: EngineCallbacks,
  ) {
    const grounded = config.cvSummary ?? (config.generalSkills.trim() ? `Skills: ${config.generalSkills}` : null);
    const name = firstName(config.candidateName);
    const me = config.interviewerName || 'Alex';
    this.questions = [
      `Hey ${name || 'there'}, ${me} here. Thanks for joining — how are you doing today?`,
      ...buildLocalQuestions(grounded, config.role, config.level),
    ];
  }

  start(): void {
    this.cb.onNotice('Simulation mode: local questions and your device\'s speech features. This is not Gemini.');
    this.askNext();
  }

  private askNext(): void {
    if (this.stopped) return;
    if (this.index >= this.questions.length) {
      this.cb.onState('idle', 'Simulation complete');
      this.cb.onEnded();
      return;
    }
    const question = this.questions[this.index];
    this.entries = [...this.entries, { speaker: 'interviewer', text: question }];
    this.cb.onTranscript(this.entries);
    this.cb.onQuestion(question);
    this.cb.onState('speaking', 'Interviewer is speaking (device voice)');
    this.speak(question, () => {
      if (this.stopped) return;
      this.awaitingAnswer = true;
      this.cb.onState('listening', 'Listening — answer out loud or type below');
      this.startRecognition();
    });
  }

  private speak(text: string, done: () => void): void {
    if (!('speechSynthesis' in window)) { done(); return; }
    let finished = false;
    const finish = () => { if (!finished) { finished = true; done(); } };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    // Safety net if the speech engine never fires an event.
    setTimeout(finish, Math.min(15000, 1200 + text.length * 90));
  }

  private startRecognition(): void {
    const Ctor = (window as unknown as Record<string, unknown>)['SpeechRecognition'] ??
      (window as unknown as Record<string, unknown>)['webkitSpeechRecognition'];
    if (typeof Ctor !== 'function') {
      this.cb.onAnswerMode?.('text');
      return;
    }
    this.cb.onAnswerMode?.('voice');
    try {
      const recognition = new (Ctor as new () => SpeechRecognitionLike)();
      this.recognition = recognition;
      recognition.lang = this.config.language === 'Urdu' ? 'ur-PK' : 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const result = event.results[event.results.length - 1];
        if (result?.isFinal) this.submitAnswer(result[0]?.transcript ?? '');
      };
      recognition.onerror = () => {
        this.cb.onNotice('Speech recognition failed or was denied — type your answer instead.');
        this.cb.onAnswerMode?.('text');
      };
      recognition.start();
    } catch {
      this.cb.onAnswerMode?.('text');
    }
  }

  submitAnswer(text: string): void {
    const answer = text.trim();
    if (this.stopped || !this.awaitingAnswer || !answer) return;
    this.awaitingAnswer = false;
    try { this.recognition?.stop(); } catch { /* not running */ }
    this.entries = [...this.entries, { speaker: 'user', text: answer }];
    this.cb.onTranscript(this.entries);
    this.cb.onState('thinking', 'Thinking…');
    this.index++;
    setTimeout(() => this.askNext(), 700);
  }

  snapshotTranscript(): TranscriptEntry[] {
    return [...this.entries];
  }

  async stop(): Promise<void> {
    this.stopped = true;
    try { this.recognition?.stop(); } catch { /* not running */ }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}
