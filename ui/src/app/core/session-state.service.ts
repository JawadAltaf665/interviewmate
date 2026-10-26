import { Injectable, signal } from '@angular/core';
import { InterviewLanguage, InterviewLevel, InterviewMode, SessionRecord } from './interviewmate-api';

// In-memory hand-off between Setup -> Interview Room -> Summary.
// Nothing here is persisted; a session is only saved when the user clicks
// "Save session" on the summary page (brief: user-approved saving only).

export interface InterviewConfig {
  level: InterviewLevel;
  mode: InterviewMode;
  role: string;
  durationMin: number;
  language: InterviewLanguage;
  /** Language the transcript (and feedback) is shown in after the interview. */
  transcriptLanguage: InterviewLanguage;
  /** Confirmed CV summary text, or null for general mode. */
  cvSummary: string | null;
  cvFileName: string | null;
  /** Free-text skills for general mode (no CV). */
  generalSkills: string;
  /** Simulation mode: local questions + speechSynthesis, never Gemini. */
  simulation: boolean;
  /** Explicit opt-in for Mode 2 webcam coaching. */
  coachingConsent: boolean;
  /** From the CV (editable on Setup); '' = the interviewer greets generally. */
  candidateName: string;
  /** Persona picked once per interview so reconnects keep the same name. */
  interviewerName: string;
  /** auto: the interviewer replies after a pause of pauseSec; manual: after "Done answering". */
  answerMode: 'auto' | 'manual';
  pauseSec: number;
}

@Injectable({ providedIn: 'root' })
export class SessionStateService {
  readonly config = signal<InterviewConfig | null>(null);
  readonly lastSession = signal<SessionRecord | null>(null);
  /**
   * The interview room is open (set up, not yet ended). The room lives in the
   * app shell, not in a route, so switching tabs keeps a running interview alive.
   */
  readonly roomOpen = signal(false);
  /** Begin was pressed and the interview has not ended. */
  readonly live = signal(false);
  /** "12:31 left", for the banner shown on other tabs during a live interview. */
  readonly remainingLabel = signal('');

  /** Hand a config to the interview room (from Setup or a scheduled interview). */
  openRoom(config: InterviewConfig): void {
    this.config.set(config);
    this.roomOpen.set(true);
  }

  closeRoom(): void {
    this.roomOpen.set(false);
    this.live.set(false);
    this.remainingLabel.set('');
  }
}
