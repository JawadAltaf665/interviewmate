// InterviewMate — Electron bridge API contract.
//
// The Electron preload (implemented outside ui/) exposes exactly this shape on
// `window.interviewMate`. The Angular app must NEVER touch ipcRenderer, Node,
// or the filesystem directly; everything goes through BridgeService, which
// wraps this contract and provides an in-memory dev fallback when the app is
// opened in a plain browser (window.interviewMate === undefined).

export type InterviewLevel = 'intern' | 'junior' | 'senior';
export type InterviewLanguage = 'English' | 'Urdu';
export type InterviewMode = 1 | 2;

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  electron: string;
  chrome: string;
  safeStorageAvailable: boolean;
}

export type CredentialStatus = 'untested' | 'ok' | 'error' | 'quota'; // main process also reports 'quota'

export interface CredentialMeta {
  id: string;
  name: string;
  projectLabel: string;
  disabled: boolean;
  createdAt: string;
  lastStatus: CredentialStatus;
  lastErrorKind: string | null;
}

export interface AddCredentialInput {
  name: string;
  projectLabel: string;
  apiKey: string;
}

export interface CredentialTestResult {
  ok: boolean;
  /** Error classification when ok is false: auth | quota | rate-limit | billing | permission | server | network | unknown */
  kind?: string;
  message: string;
  modelsCount?: number;
}

export interface AppSettings {
  freeTierOnly: boolean;
  coachingIntervalSec: number;
  allowPaidUsage: boolean;
  textModel: string;
  /** Vocabulary tab choices (v1.9+). */
  vocab?: VocabPrefs;
}

export type VocabTopic = 'interview' | 'tech' | 'office' | 'daily' | 'mix';
export type VocabLevel = 'easy' | 'medium' | 'advanced';
export type VocabLength = 'short' | 'medium';
export type VocabSpeed = 'slow' | 'medium' | 'fast';
/** Gemini voices, or 'offline' for the voice built into Windows. */
export type VocabVoice = 'Kore' | 'Puck' | 'Charon' | 'Aoede' | 'offline';

export interface VocabPrefs {
  topic: VocabTopic;
  level: VocabLevel;
  length: VocabLength;
  voice: VocabVoice;
  speed: VocabSpeed;
  urdu: boolean;
  useSaved: boolean;
}

export interface VocabWord {
  word: string;
  partOfSpeech: string;
  meaning: string;
  example: string;
  /** Syllable guide, stressed syllable in capitals (e.g. "kun-SICE"). */
  sayIt: string;
  /** Meaning in Urdu script; empty unless asked for. */
  urdu: string;
}

export interface SavedWord extends VocabWord {
  id: string;
  savedAt: string;
}

export interface VocabParagraph {
  title: string;
  paragraph: string;
  words: VocabWord[];
  model?: string;
}

export interface SpokenAudio {
  audioBase64: string;
  mimeType: string;
  model: string;
  voice: string;
}

export interface LiveToken {
  token: string;
  model: string;
  expireTime: string;
  /** Which saved key minted this token (metadata only, never the secret). */
  credentialId?: string;
  credentialName?: string;
}

export interface FrameAnalysis {
  feedback: string;
  credentialName: string;
}

export interface FeedbackScore {
  label: string;
  /** 0–100 */
  score: number;
  explanation: string;
}

export interface Feedback {
  summary: string;
  strengths: string[];
  improvements: string[];
  practiceQuestions: string[];
  scores: FeedbackScore[];
}

/** Gemini's combined coaching summary across the interviews in a report. */
export interface ReportSummary {
  overview: string;
  strengths: string[];
  focusAreas: string[];
  nextSteps: string[];
  model?: string;
}

export interface GeneratedFeedback {
  source: 'gemini';
  feedback: Feedback;
  credentialName: string;
  /** Model that actually answered. */
  model?: string;
  /** The selected model was out of quota or overloaded, so a fallback model answered. */
  fellBack?: boolean;
}

export interface TranscriptEntry {
  speaker: 'interviewer' | 'user';
  text: string;
}

export interface SessionRecord {
  id: string;
  /** ISO date string */
  date: string;
  title?: string;
  level: InterviewLevel;
  mode: InterviewMode;
  role: string;
  durationSec: number;
  transcript: TranscriptEntry[];
  coachingNotes: string[];
  // Stored with the session when saved (v1.4+), so history needs no new AI call.
  language?: InterviewLanguage;
  transcriptLanguage?: InterviewLanguage;
  interviewerName?: string;
  feedback?: Feedback;
  feedbackSource?: 'gemini' | 'local';
  translations?: Partial<Record<InterviewLanguage, TranscriptEntry[]>>;
}

/** An interview set up ahead of time (Setup → "Schedule for later"). */
export interface ScheduledInterview {
  id: string;
  /** ISO date-time it is scheduled for. */
  at: string;
  title: string;
  /** The interview setup (InterviewConfig) to start it with. */
  config: Record<string, unknown>;
  createdAt: string;
  remindedEarly?: boolean;
  remindedDue?: boolean;
}

export interface InterviewMateBridge {
  getAppInfo(): Promise<AppInfo>;
  /** Theme saved in the desktop settings file, for the first paint. */
  initialTheme?: 'light' | 'dark';
  setTheme?(theme: 'light' | 'dark'): Promise<void>;
  credentials: {
    list(): Promise<CredentialMeta[]>;
    add(input: AddCredentialInput): Promise<CredentialMeta[]>;
    test(id: string): Promise<CredentialTestResult>;
    remove(id: string): Promise<CredentialMeta[]>;
    setDisabled(id: string, disabled: boolean): Promise<CredentialMeta[]>;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(partial: Partial<AppSettings>): Promise<AppSettings>;
  };
  gemini: {
    mintLiveToken(input: { model: string }): Promise<LiveToken>;
    reportLiveQuota(input: { credentialId: string }): Promise<{ ok: boolean }>;
    analyzeFrame(input: { jpegBase64: string }): Promise<FrameAnalysis>;
    generateFeedback(input: {
      transcript: TranscriptEntry[];
      level: InterviewLevel;
      cvSummary: string | null;
      language?: InterviewLanguage;
    }): Promise<GeneratedFeedback>;
    translateTranscript(input: {
      transcript: TranscriptEntry[];
      targetLanguage: InterviewLanguage;
    }): Promise<{ transcript: TranscriptEntry[]; model?: string }>;
    summarizeReport(input: { digest: string }): Promise<ReportSummary>;
  };
  vocab: {
    paragraph(input: {
      topic: VocabTopic; level: VocabLevel; length: VocabLength; urdu: boolean;
      includeWords?: string[]; avoidTitle?: string;
    }): Promise<VocabParagraph>;
    explain(input: { text: string; context?: string; urdu: boolean }): Promise<VocabWord & { model?: string }>;
    speak(input: { text: string; voice: Exclude<VocabVoice, 'offline'> }): Promise<SpokenAudio>;
  };
  schedule: {
    list(): Promise<ScheduledInterview[]>;
    save(item: { id?: string; at: string; title: string; config: Record<string, unknown> }): Promise<ScheduledInterview[]>;
    remove(id: string): Promise<ScheduledInterview[]>;
    onReminder(cb: (e: { kind: 'early' | 'due'; id: string }) => void): () => void;
    onOpen(cb: (e: { id: string }) => void): () => void;
  };
  words: {
    list(): Promise<SavedWord[]>;
    save(word: VocabWord): Promise<SavedWord[]>;
    remove(id: string): Promise<SavedWord[]>;
  };
  reports: {
    exportPdf(input: { fileName: string }): Promise<{ saved: boolean; path?: string }>;
    showExportedFile(): Promise<void>;
  };
  sessions: {
    save(session: SessionRecord): Promise<SessionRecord[]>;
    list(): Promise<SessionRecord[]>;
    remove(id: string): Promise<SessionRecord[]>;
  };
  clearAllData(): Promise<void>;
}

declare global {
  interface Window {
    interviewMate?: InterviewMateBridge;
  }
}
