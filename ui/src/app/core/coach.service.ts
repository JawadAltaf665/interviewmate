import { computed, inject, Injectable, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { BridgeService } from './bridge.service';
import { chatTitle, coachSystemPrompt, encodeWav, bytesToBase64, runCoachLoop, speakableText, trimHistory, userContent } from './coach';
import {
  ACTION_TOOLS, asReportRange, COACH_PAGES, COACH_TOOLS, configFromDraft, describeAction, interviewDetail, interviewList,
  localStamp, parseLocalDateTime, practiceWords, progressReport, READ_TOOLS, scheduleList, setupDraftFrom, stepLabel, wordList, wordsToSave,
} from './coach-tools';
import { ChatMessage, ChatSummary, CoachAction, CoachContent, SessionRecord, VocabSpeed, VocabVoice } from './interviewmate-api';
import { normalizeScores, RANGE_OPTIONS, ReportRange } from './report';
import { interviewTitle } from './schedule';
import { ScheduleService } from './schedule.service';
import { SessionStateService } from './session-state.service';
import { SpeechService } from './speech.service';
import { errorText } from './vocab';

const MAX_RECORDING_MS = 60_000;
type Args = Record<string, unknown>;

/** Reports page hand-off for "save the report as a PDF" (the page must be showing to print it). */
export interface ReportExportRequest {
  range: ReportRange;
  resolve(result: { saved: boolean; path?: string; error?: string }): void;
}

/**
 * The Coach chat: the open conversation, its history, and the app functions
 * the model may call. Reads run straight away; every action waits for the
 * user to press Confirm on its card.
 */
@Injectable({ providedIn: 'root' })
export class CoachService {
  private readonly bridge = inject(BridgeService);
  private readonly router = inject(Router);
  private readonly state = inject(SessionStateService);
  private readonly schedule = inject(ScheduleService);
  readonly speech = inject(SpeechService);

  readonly panelOpen = signal(false);
  readonly chats = signal<ChatSummary[]>([]);
  readonly chatId = signal<string | null>(null);
  readonly title = signal('New chat');
  readonly messages = signal<ChatMessage[]>([]);
  readonly busy = signal(false);
  /** Text in the message box (voice input adds to it). */
  readonly draft = signal('');
  /** The action card waiting for Confirm / Cancel. */
  readonly pending = signal<{ msgId: string; index: number } | null>(null);
  readonly recording = signal(false);
  readonly transcribing = signal(false);
  readonly voiceNote = signal('');
  readonly reportExport = signal<ReportExportRequest | null>(null);
  /** Label of the page the user is on, for the model's context. */
  readonly page = signal('Dashboard');
  readonly speakingId = computed(() => {
    const id = this.speech.playingId();
    return id?.startsWith('coach-') && this.speech.state() !== 'idle' ? id.slice(6) : null;
  });

  private contents: CoachContent[] = [];
  private createdAt: string | undefined;
  private decide: ((ok: boolean) => void) | null = null;
  private recorder: MediaRecorder | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    const label = (url: string) =>
      Object.values(COACH_PAGES).find((p) => p.route === url.split(/[?#]/)[0])?.label ?? 'Dashboard';
    this.page.set(label(this.router.url));
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => this.page.set(label(e.urlAfterRedirects)));
  }

  // --------------------------------------------------------------- panel / chats
  open(): void {
    this.panelOpen.set(true);
    void this.refreshChats();
  }

  close(): void {
    this.panelOpen.set(false);
  }

  async refreshChats(): Promise<void> {
    try {
      this.chats.set(await this.bridge.listChats());
    } catch {
      /* keep the last list */
    }
  }

  newChat(): void {
    if (this.busy()) return;
    this.speech.stop();
    this.chatId.set(null);
    this.title.set('New chat');
    this.messages.set([]);
    this.contents = [];
    this.createdAt = undefined;
  }

  async loadChat(id: string): Promise<void> {
    if (this.busy() || id === this.chatId()) return;
    const chat = await this.bridge.getChat(id);
    if (!chat) return;
    this.speech.stop();
    this.chatId.set(chat.id ?? id);
    this.title.set(chat.title);
    this.messages.set(chat.messages ?? []);
    this.contents = chat.contents ?? [];
    this.createdAt = chat.createdAt;
  }

  async deleteChat(id: string): Promise<void> {
    if (this.busy() && id === this.chatId()) return;
    this.chats.set(await this.bridge.removeChat(id));
    if (id === this.chatId()) this.newChat();
  }

  // ------------------------------------------------------------------- messages
  /** Send a message. `context` is shown to the model only (e.g. which interview it came from). */
  async send(text: string, context: string[] = []): Promise<void> {
    const typed = text.trim();
    if (!typed || this.busy()) return;
    this.busy.set(true);
    this.draft.set('');
    const now = new Date().toISOString();
    const replyId = this.newId();
    this.messages.update((m) => [...m,
      { id: this.newId(), role: 'user', text: typed, at: now },
      { id: replyId, role: 'coach', text: '', at: now, steps: [], actions: [] },
    ]);
    if (this.title() === 'New chat') this.title.set(chatTitle(typed));
    try {
      const result = await runCoachLoop(trimHistory(this.contents), userContent(typed, [`The user is on the ${this.page()} page.`, ...context]), {
        call: (contents, pinModel) =>
          this.bridge.coachTurn({ system: coachSystemPrompt({ now: new Date(), page: this.page() }), contents, tools: COACH_TOOLS, pinModel }),
        runTool: (name, args) => this.runTool(name, args, replyId),
      });
      this.contents = result.contents;
      this.patch(replyId, { text: result.text || 'Done.' });
    } catch (err) {
      // The conversation history stays as it was, so the user can simply ask again.
      this.patch(replyId, { role: 'error', text: `Coach couldn't answer: ${errorText(err)}` });
    } finally {
      this.busy.set(false);
      await this.persist();
    }
  }

  /** "Discuss with Coach" on a Feedback item: a new chat about that interview. */
  discussInterview(s: SessionRecord, saved: boolean): void {
    if (this.busy()) { this.open(); return; }
    this.newChat();
    this.open();
    const title = s.title || interviewTitle({ level: s.level, role: s.role });
    const when = localStamp(new Date(s.date)).split(',')[0];
    const f = s.feedback;
    const context = saved
      ? [`They pressed "Discuss with Coach" on the saved interview with id ${s.id}; read it with get_interview.`]
      : [`They pressed "Discuss with Coach" on an interview that is not saved, so the functions cannot read it. Its feedback: ${JSON.stringify(f ? {
          summary: f.summary, scores: normalizeScores(f.scores).map((c) => `${c.label} ${c.score}`), strengths: f.strengths, improvements: f.improvements,
        } : 'none').slice(0, 4000)}`];
    void this.send(`Let's discuss my interview "${title}" from ${when}. What went well, and what should I improve first?`, context);
  }

  /** "Discuss with Coach" on Reports: a new chat about that period. */
  discussReport(range: ReportRange): void {
    if (this.busy()) { this.open(); return; }
    this.newChat();
    this.open();
    const label = RANGE_OPTIONS.find((r) => r.id === range)?.label ?? '30 days';
    const period = range === 'custom' ? 'all' : range;
    void this.send(`Let's discuss my progress over the last ${range === 'custom' ? 'period I picked' : label}. How am I doing, and what should I focus on?`,
      [`They pressed "Discuss with Coach" on the Reports page; use get_progress_report with period ${period}.`]);
  }

  /** Confirm or cancel the waiting action card. */
  answer(ok: boolean): void {
    const decide = this.decide;
    this.decide = null;
    this.pending.set(null);
    decide?.(ok);
  }

  // ------------------------------------------------------------------ the tools
  private async runTool(name: string, args: Args, msgId: string): Promise<Record<string, unknown>> {
    const now = new Date();
    if (READ_TOOLS.has(name)) {
      const result = await this.read(name, args, now);
      this.patch(msgId, (m) => ({ steps: [...(m.steps ?? []), stepLabel(name, result)] }));
      return result;
    }
    if (!ACTION_TOOLS.has(name)) return { error: `Unknown function ${name}.` };

    const sessions = await this.bridge.listSessions();
    await this.schedule.refresh();
    const plan = describeAction(name, args, { now, sessions, schedule: this.schedule.items() });
    if ('error' in plan) return { ok: false, error: plan.error };

    const card: CoachAction = { name, ...plan, status: 'pending' };
    let index = 0;
    this.patch(msgId, (m) => {
      index = (m.actions ?? []).length;
      return { actions: [...(m.actions ?? []), card] };
    });
    const ok = await new Promise<boolean>((resolve) => {
      this.decide = resolve;
      this.pending.set({ msgId, index });
    });
    const setCard = (status: CoachAction['status'], note?: string) =>
      this.patch(msgId, (m) => ({ actions: (m.actions ?? []).map((a, i) => (i === index ? { ...a, status, ...(note ? { note } : {}) } : a)) }));
    if (!ok) {
      setCard('cancelled');
      return { ok: false, cancelled: true, message: 'The user cancelled this action.' };
    }
    try {
      const result = await this.act(name, args, now);
      setCard('done', typeof result['note'] === 'string' ? result['note'] : undefined);
      return { ok: true, ...result };
    } catch (err) {
      setCard('failed', errorText(err));
      return { ok: false, error: errorText(err) };
    }
  }

  private async read(name: string, args: Args, now: Date): Promise<Record<string, unknown>> {
    switch (name) {
      case 'list_interviews': return interviewList(await this.bridge.listSessions(), args, now);
      case 'get_interview': return interviewDetail((await this.bridge.listSessions()).find((s) => s.id === args['id']), args);
      case 'get_progress_report': return progressReport(await this.bridge.listSessions(), args, now);
      case 'list_scheduled':
        await this.schedule.refresh();
        return scheduleList(this.schedule.items(), now);
      case 'list_saved_words': return wordList(await this.bridge.listWords(), args);
      default: {
        const [settings, keys, info] = await Promise.all([
          this.bridge.getSettings(), this.bridge.listCredentials().catch(() => []), this.bridge.getAppInfo().catch(() => null),
        ]);
        return {
          page: this.page(), interview_running: this.state.live(), interview_room_open: this.state.roomOpen(),
          active_api_keys: keys.filter((k) => !k.disabled).length, text_model: settings.textModel,
          theme: document.documentElement.dataset['theme'] ?? 'dark', version: info?.version ?? '',
        };
      }
    }
  }

  /** Runs a confirmed action. Arguments were already checked by describeAction. */
  private async act(name: string, args: Args, now: Date): Promise<Record<string, unknown>> {
    switch (name) {
      case 'open_page': {
        const page = COACH_PAGES[String(args['page'])];
        const queryParams: Record<string, string> = {};
        if (args['page'] === 'feedback' && typeof args['interview_id'] === 'string') queryParams['open'] = args['interview_id'];
        if (args['page'] === 'reports' && args['report_period']) queryParams['range'] = asReportRange(args['report_period']);
        await this.router.navigate([page.route], { queryParams });
        return { opened: page.label };
      }
      case 'prepare_interview': {
        if (this.state.roomOpen()) throw new Error('An interview is already open on the Interview tab. Finish it first.');
        const draft = setupDraftFrom(args);
        if (typeof draft === 'string') throw new Error(draft);
        this.state.setupDraft.set(draft);
        await this.router.navigate(['/setup']);
        return { opened: 'New Interview', note: 'Filled in. Check it and press Start.' };
      }
      case 'schedule_interview': {
        const draft = setupDraftFrom(args);
        const at = parseLocalDateTime(args['at'], now);
        if (typeof draft === 'string') throw new Error(draft);
        if (typeof at === 'string') throw new Error(at);
        await this.schedule.schedule(at, configFromDraft(draft));
        return { scheduled_for: localStamp(at), note: 'Scheduled. Reminders come 10 minutes before and on time.' };
      }
      case 'reschedule_interview':
      case 'remove_scheduled_interview': {
        const item = this.schedule.items().find((i) => i.id === args['id']);
        if (!item) throw new Error('That scheduled interview no longer exists.');
        if (name === 'remove_scheduled_interview') {
          await this.schedule.remove(item);
          return { removed: item.title };
        }
        const at = parseLocalDateTime(args['at'], now);
        if (typeof at === 'string') throw new Error(at);
        await this.schedule.reschedule(item, at);
        return { moved_to: localStamp(at) };
      }
      case 'save_words': {
        const words = wordsToSave(args);
        if (typeof words === 'string') throw new Error(words);
        for (const w of words) await this.bridge.saveWord({ ...w, sayIt: '', urdu: '' });
        return { saved: words.map((w) => w.word), note: 'Saved to My words.' };
      }
      case 'open_vocabulary_practice': {
        const words = practiceWords(args);
        if (typeof words === 'string') throw new Error(words);
        await this.router.navigate(['/vocabulary'], { queryParams: { practice: words.join('|'), t: Date.now() } });
        return { opened: 'Vocabulary', words };
      }
      case 'export_report_pdf': {
        const range = asReportRange(args['period']);
        await this.router.navigate(['/reports'], { queryParams: { range } });
        const result = await new Promise<{ saved: boolean; path?: string; error?: string }>((resolve) => this.reportExport.set({ range, resolve }));
        if (result.error) throw new Error(result.error);
        if (!result.saved) return { saved: false, note: 'Not saved (the save dialog was closed).' };
        return { saved: true, path: result.path, note: `Saved: ${result.path}` };
      }
      default:
        throw new Error(`Unknown action ${name}.`);
    }
  }

  // ------------------------------------------------------------- voice in / out
  async speak(msg: ChatMessage): Promise<void> {
    if (this.speakingId() === msg.id) {
      this.speech.stop();
      return;
    }
    const prefs = (await this.bridge.getSettings().catch(() => null))?.vocab;
    const voice: VocabVoice = prefs?.voice ?? 'Kore';
    const speed: VocabSpeed = prefs?.speed ?? 'medium';
    void this.speech.play(speakableText(msg.text), { id: `coach-${msg.id}`, voice, speed });
  }

  async toggleRecording(): Promise<void> {
    if (this.recorder) {
      this.recorder.stop();
      return;
    }
    this.voiceNote.set('');
    if (this.state.live()) {
      this.voiceNote.set('Your microphone is in use by the running interview.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.voiceNote.set('Microphone unavailable: permission denied or no microphone found.');
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (this.stopTimer) clearTimeout(this.stopTimer);
      this.recorder = null;
      this.recording.set(false);
      void this.transcribe(new Blob(chunks, { type: recorder.mimeType }));
    };
    this.recorder = recorder;
    recorder.start();
    this.recording.set(true);
    this.stopTimer = setTimeout(() => recorder.state === 'recording' && recorder.stop(), MAX_RECORDING_MS);
  }

  private async transcribe(blob: Blob): Promise<void> {
    if (!blob.size) return;
    this.transcribing.set(true);
    try {
      // Gemini takes WAV, not the browser's WebM: decode, mix to 16 kHz mono, re-encode.
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      void ctx.close();
      const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16_000)), 16_000);
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.connect(offline.destination);
      src.start();
      const mono = (await offline.startRendering()).getChannelData(0);
      const { text } = await this.bridge.transcribe(bytesToBase64(encodeWav(mono, 16_000)));
      if (text.trim()) this.draft.update((d) => (d.trim() ? `${d.trim()} ${text.trim()}` : text.trim()));
      else this.voiceNote.set('No speech was heard. Try again a little closer to the microphone.');
    } catch (err) {
      this.voiceNote.set(`Could not turn your voice into text (${errorText(err)}).`);
    } finally {
      this.transcribing.set(false);
    }
  }

  // -------------------------------------------------------------------- helpers
  private patch(id: string, change: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)): void {
    this.messages.update((list) => list.map((m) => (m.id === id ? { ...m, ...(typeof change === 'function' ? change(m) : change) } : m)));
  }

  private newId(): string {
    return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  private async persist(): Promise<void> {
    try {
      const saved = await this.bridge.saveChat({
        ...(this.chatId() ? { id: this.chatId()! } : {}),
        title: this.title(), createdAt: this.createdAt, messages: this.messages(), contents: trimHistory(this.contents),
      });
      this.chatId.set(saved.id ?? null);
      this.createdAt = saved.createdAt;
      await this.refreshChats();
    } catch {
      /* the chat still works; it just isn't saved */
    }
  }
}
