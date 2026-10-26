import { Injectable, signal } from '@angular/core';
import {
  AddCredentialInput,
  AppSettings,
  CredentialMeta,
  InterviewLanguage,
  InterviewMateBridge,
  ReportSummary,
  SavedWord,
  ScheduledInterview,
  SessionRecord,
  SpokenAudio,
  VocabParagraph,
  VocabWord,
} from './interviewmate-api';
import { normalizeFeedback } from './report';

// Wraps window.interviewMate. In a plain browser (ng serve without Electron)
// the bridge is undefined, so a dev fallback is used: credentials are empty,
// settings have defaults, gemini methods throw a clear "desktop only" error,
// and sessions live in localStorage (dev only — the real app stores them via
// Electron, and only when the user explicitly saves).
const DEV_SESSIONS_KEY = 'interviewmate.dev.sessions';
const DEV_WORDS_KEY = 'interviewmate.dev.words';
const DEV_SCHEDULE_KEY = 'interviewmate.dev.schedule';
const DESKTOP_ONLY =
  'Desktop only: this needs the InterviewMate desktop app (Electron) and a saved Gemini credential. In this browser dev preview it is unavailable — use Simulation mode instead.';

@Injectable({ providedIn: 'root' })
export class BridgeService {
  readonly isDesktop = signal<boolean>(typeof window !== 'undefined' && !!window.interviewMate);
  private devSettings: AppSettings = { freeTierOnly: true, coachingIntervalSec: 25, allowPaidUsage: false, textModel: 'gemini-3.8-flash' };

  private get bridge(): InterviewMateBridge | undefined {
    return typeof window !== 'undefined' ? window.interviewMate : undefined;
  }

  async getAppInfo() {
    if (this.bridge) return this.bridge.getAppInfo();
    return {
      name: 'InterviewMate (dev preview)',
      version: '0.0.0-dev',
      platform: 'browser',
      electron: '',
      chrome: '',
      safeStorageAvailable: false,
    };
  }

  // --- credentials -------------------------------------------------------
  async listCredentials(): Promise<CredentialMeta[]> {
    if (this.bridge) return this.bridge.credentials.list();
    return [];
  }

  async addCredential(input: AddCredentialInput): Promise<CredentialMeta[]> {
    if (this.bridge) return this.bridge.credentials.add(input);
    throw new Error(DESKTOP_ONLY);
  }

  async testCredential(id: string) {
    if (this.bridge) return this.bridge.credentials.test(id);
    throw new Error(DESKTOP_ONLY);
  }

  async removeCredential(id: string): Promise<CredentialMeta[]> {
    if (this.bridge) return this.bridge.credentials.remove(id);
    return [];
  }

  async setCredentialDisabled(id: string, disabled: boolean): Promise<CredentialMeta[]> {
    if (this.bridge) return this.bridge.credentials.setDisabled(id, disabled);
    return [];
  }

  // --- settings ----------------------------------------------------------
  async getSettings(): Promise<AppSettings> {
    if (this.bridge) return this.bridge.settings.get();
    return { ...this.devSettings };
  }

  async setSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
    if (this.bridge) return this.bridge.settings.set(partial);
    this.devSettings = { ...this.devSettings, ...partial };
    return { ...this.devSettings };
  }

  // --- gemini ------------------------------------------------------------
  async mintLiveToken(model: string) {
    if (this.bridge) return this.bridge.gemini.mintLiveToken({ model });
    throw new Error(DESKTOP_ONLY);
  }

  async reportLiveQuota(credentialId: string) {
    if (this.bridge) return this.bridge.gemini.reportLiveQuota({ credentialId });
    throw new Error(DESKTOP_ONLY);
  }

  async analyzeFrame(jpegBase64: string) {
    if (this.bridge) return this.bridge.gemini.analyzeFrame({ jpegBase64 });
    throw new Error(DESKTOP_ONLY);
  }

  async generateFeedback(input: {
    transcript: SessionRecord['transcript'];
    level: SessionRecord['level'];
    cvSummary: string | null;
    language?: InterviewLanguage;
  }) {
    if (this.bridge) {
      const result = await this.bridge.gemini.generateFeedback(input);
      return { ...result, feedback: normalizeFeedback(result.feedback) };
    }
    throw new Error(DESKTOP_ONLY);
  }

  async summarizeReport(digest: string): Promise<ReportSummary> {
    if (this.bridge) return this.bridge.gemini.summarizeReport({ digest });
    throw new Error(DESKTOP_ONLY);
  }

  /** Desktop: save the current page as a PDF (save dialog). Browser preview: print dialog. */
  async exportPdf(fileName: string): Promise<{ saved: boolean; path?: string }> {
    if (this.bridge) return this.bridge.reports.exportPdf({ fileName });
    window.print();
    return { saved: false };
  }

  async showExportedFile(): Promise<void> {
    if (this.bridge) await this.bridge.reports.showExportedFile();
  }

  // --- scheduled interviews ----------------------------------------------------
  async listSchedule(): Promise<ScheduledInterview[]> {
    if (this.bridge) return this.bridge.schedule.list();
    try {
      const list = JSON.parse(localStorage.getItem(DEV_SCHEDULE_KEY) ?? '[]') as ScheduledInterview[];
      return list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    } catch {
      return [];
    }
  }

  async saveSchedule(item: { id?: string; at: string; title: string; config: Record<string, unknown> }): Promise<ScheduledInterview[]> {
    if (this.bridge) return this.bridge.schedule.save(item);
    const list = await this.listSchedule();
    const old = list.find((i) => i.id === item.id);
    const saved: ScheduledInterview = { ...item, id: old?.id ?? `sch_${Date.now()}`, createdAt: old?.createdAt ?? new Date().toISOString() };
    localStorage.setItem(DEV_SCHEDULE_KEY, JSON.stringify([...list.filter((i) => i !== old), saved]));
    return this.listSchedule();
  }

  async removeSchedule(id: string): Promise<ScheduledInterview[]> {
    if (this.bridge) return this.bridge.schedule.remove(id);
    localStorage.setItem(DEV_SCHEDULE_KEY, JSON.stringify((await this.listSchedule()).filter((i) => i.id !== id)));
    return this.listSchedule();
  }

  /** Reminder events from the desktop app (none in the browser preview). */
  onScheduleReminder(cb: (e: { kind: 'early' | 'due'; id: string }) => void): () => void {
    return this.bridge?.schedule?.onReminder(cb) ?? (() => undefined);
  }

  onScheduleOpen(cb: (e: { id: string }) => void): () => void {
    return this.bridge?.schedule?.onOpen(cb) ?? (() => undefined);
  }

  // --- vocabulary ----------------------------------------------------------
  async vocabParagraph(input: Parameters<InterviewMateBridge['vocab']['paragraph']>[0]): Promise<VocabParagraph> {
    if (this.bridge) return this.bridge.vocab.paragraph(input);
    throw new Error(DESKTOP_ONLY);
  }

  async explainText(input: { text: string; context?: string; urdu: boolean }): Promise<VocabWord> {
    if (this.bridge) return this.bridge.vocab.explain(input);
    throw new Error(DESKTOP_ONLY);
  }

  async speak(text: string, voice: Parameters<InterviewMateBridge['vocab']['speak']>[0]['voice']): Promise<SpokenAudio> {
    if (this.bridge) return this.bridge.vocab.speak({ text, voice });
    throw new Error(DESKTOP_ONLY);
  }

  async listWords(): Promise<SavedWord[]> {
    if (this.bridge) return this.bridge.words.list();
    try {
      return JSON.parse(localStorage.getItem(DEV_WORDS_KEY) ?? '[]') as SavedWord[];
    } catch {
      return [];
    }
  }

  async saveWord(word: VocabWord): Promise<SavedWord[]> {
    if (this.bridge) return this.bridge.words.save(word);
    const others = (await this.listWords()).filter((w) => w.word.toLowerCase() !== word.word.toLowerCase());
    const list = [{ ...word, id: `w_${Date.now()}`, savedAt: new Date().toISOString() }, ...others];
    localStorage.setItem(DEV_WORDS_KEY, JSON.stringify(list));
    return list;
  }

  async removeWord(id: string): Promise<SavedWord[]> {
    if (this.bridge) return this.bridge.words.remove(id);
    const list = (await this.listWords()).filter((w) => w.id !== id);
    localStorage.setItem(DEV_WORDS_KEY, JSON.stringify(list));
    return list;
  }

  async translateTranscript(transcript: SessionRecord['transcript'], targetLanguage: InterviewLanguage) {
    if (this.bridge) return this.bridge.gemini.translateTranscript({ transcript, targetLanguage });
    throw new Error(DESKTOP_ONLY);
  }

  // --- sessions ----------------------------------------------------------
  async listSessions(): Promise<SessionRecord[]> {
    // Gemini feedback is stored with object-shaped scores; normalize on the way in.
    const normalize = (list: SessionRecord[]) => list.map((s) => ({ ...s, feedback: normalizeFeedback(s.feedback) }));
    if (this.bridge) return normalize(await this.bridge.sessions.list());
    try {
      return normalize(JSON.parse(localStorage.getItem(DEV_SESSIONS_KEY) ?? '[]') as SessionRecord[]);
    } catch {
      return [];
    }
  }

  async saveSession(session: SessionRecord): Promise<SessionRecord[]> {
    if (this.bridge) return this.bridge.sessions.save(session);
    const list = [session, ...(await this.listSessions()).filter((s) => s.id !== session.id)];
    localStorage.setItem(DEV_SESSIONS_KEY, JSON.stringify(list));
    return list;
  }

  async removeSession(id: string): Promise<SessionRecord[]> {
    if (this.bridge) return this.bridge.sessions.remove(id);
    const list = (await this.listSessions()).filter((s) => s.id !== id);
    localStorage.setItem(DEV_SESSIONS_KEY, JSON.stringify(list));
    return list;
  }

  async clearAllData(): Promise<void> {
    if (this.bridge) return this.bridge.clearAllData();
    localStorage.removeItem(DEV_SESSIONS_KEY);
    localStorage.removeItem(DEV_WORDS_KEY);
    localStorage.removeItem(DEV_SCHEDULE_KEY);
  }
}
