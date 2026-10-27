// The Coach chat's app functions: what Gemini may call, the data each read
// function returns, and the Confirm / Cancel card for each action. Pure (no
// Angular, no I/O) so it can be tested; CoachService runs them.
import { CoachToolDeclaration, InterviewLanguage, InterviewLevel, SavedWord, ScheduledInterview, SessionRecord } from './interviewmate-api';
import { pickInterviewerName } from './prompt';
import { buildReport, normalizeScores, overallScore, RANGE_OPTIONS, ReportRange } from './report';
import { bucketSchedule, interviewTitle } from './schedule';
import { InterviewConfig, SetupDraft } from './session-state.service';

/** Pages the coach can open, by the name it uses. */
export const COACH_PAGES: Record<string, { route: string; label: string }> = {
  dashboard: { route: '/', label: 'Dashboard' },
  new_interview: { route: '/setup', label: 'New Interview' },
  interview: { route: '/interview', label: 'Interview' },
  feedback: { route: '/summary', label: 'Feedback' },
  reports: { route: '/reports', label: 'Reports' },
  vocabulary: { route: '/vocabulary', label: 'Vocabulary' },
  coach: { route: '/coach', label: 'Coach' },
  settings: { route: '/settings', label: 'Settings' },
};

export type CoachPeriod = '1d' | '3d' | '7d' | '30d' | '90d' | 'all';
const PERIODS: CoachPeriod[] = ['1d', '3d', '7d', '30d', '90d', 'all'];
const LEVELS: InterviewLevel[] = ['intern', 'junior', 'senior'];
const LANGUAGES: InterviewLanguage[] = ['English', 'Urdu'];
const DURATIONS = [10, 15, 20, 30];

const interviewFields = {
  level: { type: 'string', enum: LEVELS, description: 'Interview level.' },
  role: { type: 'string', description: 'Target role, e.g. "Angular Developer". Optional.' },
  duration_min: { type: 'integer', description: 'Length in minutes: 10, 15, 20 or 30 (default 15).' },
  language: { type: 'string', enum: LANGUAGES, description: 'Interview language (default English).' },
  focus: { type: 'string', description: 'Topics to concentrate on, e.g. "SQL indexing, STAR answers". Optional.' },
  answer_mode: { type: 'string', enum: ['auto', 'manual'], description: 'auto: the interviewer replies after a pause; manual: after "Done answering".' },
};

export const COACH_TOOLS: CoachToolDeclaration[] = [
  {
    name: 'list_interviews',
    description: 'List the user\'s saved mock interviews, newest first, with scores (0-100) and the main feedback points. Use this before giving advice about their progress.',
    parameters: { type: 'object', properties: {
      period: { type: 'string', enum: PERIODS, description: 'Time window ending now (default all).' },
      limit: { type: 'integer', description: 'Max interviews to return (default 20, max 50).' },
    } },
  },
  {
    name: 'get_interview',
    description: 'Full saved feedback for one interview: summary, all scores with explanations, strengths, improvements, practice questions, and optionally the transcript. Ask for the transcript only when you need the user\'s actual answers.',
    parameters: { type: 'object', properties: {
      id: { type: 'string', description: 'Interview id from list_interviews.' },
      include_transcript: { type: 'boolean' },
    }, required: ['id'] },
  },
  {
    name: 'get_progress_report',
    description: 'The same numbers as the Reports tab for a period: interview count, practice time, average and best score, change from first to last, average per skill area, and strengths / areas to improve with how often each came up.',
    parameters: { type: 'object', properties: { period: { type: 'string', enum: PERIODS } }, required: ['period'] },
  },
  {
    name: 'list_scheduled',
    description: 'The user\'s scheduled mock interviews (due now, upcoming, missed) with ids and times.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_saved_words',
    description: 'Words the user saved in the Vocabulary tab, newest first.',
    parameters: { type: 'object', properties: { limit: { type: 'integer', description: 'Default 30, max 100.' } } },
  },
  {
    name: 'get_app_status',
    description: 'Current app state: page the user is on, whether an interview is running, number of active API keys (never the keys), theme, text model, and app version.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'open_page',
    description: 'Open a page of the app for the user (they confirm first). Optionally open one saved interview on the Feedback page, or a report period on Reports.',
    parameters: { type: 'object', properties: {
      page: { type: 'string', enum: Object.keys(COACH_PAGES) },
      interview_id: { type: 'string', description: 'With page=feedback: the saved interview to open.' },
      report_period: { type: 'string', enum: PERIODS.filter((p) => p !== 'all'), description: 'With page=reports.' },
    }, required: ['page'] },
  },
  {
    name: 'prepare_interview',
    description: 'Fill in the New Interview page with these settings and open it (the user confirms, then presses Start themselves). Use for "let\'s practise now".',
    parameters: { type: 'object', properties: interviewFields, required: ['level'] },
  },
  {
    name: 'schedule_interview',
    description: 'Schedule a mock interview at a local date and time (the user confirms). It uses general questions (no CV); the user can attach a CV on the New Interview page instead.',
    parameters: { type: 'object', properties: {
      at: { type: 'string', description: 'Local date and time "YYYY-MM-DDTHH:mm", in the future.' },
      ...interviewFields,
    }, required: ['at', 'level'] },
  },
  {
    name: 'reschedule_interview',
    description: 'Move a scheduled interview to a new local date and time (the user confirms).',
    parameters: { type: 'object', properties: {
      id: { type: 'string', description: 'Id from list_scheduled.' },
      at: { type: 'string', description: 'New local date and time "YYYY-MM-DDTHH:mm".' },
    }, required: ['id', 'at'] },
  },
  {
    name: 'remove_scheduled_interview',
    description: 'Remove a scheduled interview (the user confirms).',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'save_words',
    description: 'Save vocabulary words to the user\'s My words list (the user confirms).',
    parameters: { type: 'object', properties: {
      words: { type: 'array', description: 'Up to 10 words.', items: { type: 'object', properties: {
        word: { type: 'string' }, meaning: { type: 'string', description: 'Simple English, max 15 words.' },
        part_of_speech: { type: 'string' }, example: { type: 'string' },
      }, required: ['word', 'meaning'] } },
    }, required: ['words'] },
  },
  {
    name: 'open_vocabulary_practice',
    description: 'Open the Vocabulary tab with a new practice paragraph that uses these words (the user confirms).',
    parameters: { type: 'object', properties: {
      words: { type: 'array', items: { type: 'string' }, description: '1 to 6 words or short phrases.' },
    }, required: ['words'] },
  },
  {
    name: 'export_report_pdf',
    description: 'Open Reports for a period and save it as a PDF; Windows asks the user where to save it (the user confirms first).',
    parameters: { type: 'object', properties: { period: { type: 'string', enum: PERIODS.filter((p) => p !== 'all') } }, required: ['period'] },
  },
];

export const READ_TOOLS = new Set(['list_interviews', 'get_interview', 'get_progress_report', 'list_scheduled', 'list_saved_words', 'get_app_status']);
export const ACTION_TOOLS = new Set(COACH_TOOLS.map((t) => t.name).filter((n) => !READ_TOOLS.has(n)));

type Args = Record<string, unknown>;

// ------------------------------------------------------------------ formatting
const pad = (n: number) => String(n).padStart(2, '0');

/** "Sun 25 Oct 2026, 7:34 PM" in local time. */
export function localStamp(d: Date): string {
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '');
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

/** "2026-10-25T19:34" in local time. */
export function localIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function periodFrom(period: CoachPeriod, now: Date): Date {
  if (period === 'all') return new Date(0);
  const days = RANGE_OPTIONS.find((r) => r.id === period)?.days ?? 30;
  return new Date(now.getTime() - days * 86_400_000);
}

function asPeriod(v: unknown, fallback: CoachPeriod): CoachPeriod {
  return PERIODS.includes(v as CoachPeriod) ? (v as CoachPeriod) : fallback;
}

function clampInt(v: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function scoreMap(s: SessionRecord): Record<string, number> {
  return Object.fromEntries(normalizeScores(s.feedback?.scores).map((c) => [c.label, c.score]));
}

// ------------------------------------------------------------------ read tools
export function interviewList(sessions: SessionRecord[], args: Args, now: Date) {
  const period = asPeriod(args['period'], 'all');
  const from = periodFrom(period, now).getTime();
  const list = sessions
    .filter((s) => Date.parse(s.date) >= from)
    .sort((a, b) => b.date.localeCompare(a.date));
  const limit = clampInt(args['limit'], 20, 50);
  return {
    period,
    total: list.length,
    interviews: list.slice(0, limit).map((s) => ({
      id: s.id,
      date: localStamp(new Date(s.date)),
      title: s.title || interviewTitle({ level: s.level, role: s.role }),
      level: s.level,
      role: s.role || '',
      minutes: Math.round((s.durationSec || 0) / 60),
      overall: overallScore(s.feedback),
      scores: scoreMap(s),
      strengths: (s.feedback?.strengths ?? []).slice(0, 3),
      improvements: (s.feedback?.improvements ?? []).slice(0, 4),
      feedback: s.feedback ? s.feedbackSource ?? 'gemini' : 'none',
    })),
  };
}

export function interviewDetail(session: SessionRecord | undefined, args: Args) {
  if (!session) return { error: 'No saved interview has that id. Call list_interviews to get ids.' };
  const f = session.feedback;
  const out: Record<string, unknown> = {
    id: session.id,
    date: localStamp(new Date(session.date)),
    title: session.title || interviewTitle({ level: session.level, role: session.role }),
    level: session.level,
    role: session.role || '',
    language: session.language ?? 'English',
    minutes: Math.round((session.durationSec || 0) / 60),
    overall: overallScore(f),
    feedback: f
      ? {
          source: session.feedbackSource ?? 'gemini',
          summary: f.summary,
          scores: normalizeScores(f.scores).map((c) => ({ area: c.label, score: c.score, why: c.explanation })),
          strengths: f.strengths ?? [],
          improvements: f.improvements ?? [],
          practice_questions: f.practiceQuestions ?? [],
        }
      : null,
    coaching_notes: (session.coachingNotes ?? []).slice(0, 10),
  };
  if (args['include_transcript'] === true) {
    // The user's own words, in order; long interviews are cut to keep requests small.
    let budget = 14_000;
    const lines: string[] = [];
    for (const t of session.transcript ?? []) {
      const line = `${t.speaker === 'user' ? 'Candidate' : 'Interviewer'}: ${t.text}`;
      if (budget - line.length < 0) { lines.push('[transcript cut here]'); break; }
      budget -= line.length;
      lines.push(line);
    }
    out['transcript'] = lines;
  }
  return out;
}

function recurring(sessions: SessionRecord[], pick: (s: SessionRecord) => string[]) {
  const counts = new Map<string, { text: string; times: number; last: string }>();
  for (const s of sessions) {
    for (const text of pick(s)) {
      const key = text.trim().toLowerCase();
      if (!key) continue;
      const e = counts.get(key) ?? { text: text.trim(), times: 0, last: s.date };
      e.times++;
      if (s.date > e.last) e.last = s.date;
      counts.set(key, e);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.times - a.times || b.last.localeCompare(a.last))
    .slice(0, 12)
    .map((e) => ({ text: e.text, times: e.times, last: localStamp(new Date(e.last)).split(',')[0] }));
}

export function progressReport(sessions: SessionRecord[], args: Args, now: Date) {
  const period = asPeriod(args['period'], '30d');
  const r = buildReport(sessions, periodFrom(period, now), now);
  return {
    period,
    from: localStamp(r.from).split(',')[0],
    interviews: r.sessions.length,
    scored: r.scoredCount,
    practice_minutes: Math.round(r.totalSec / 60),
    average: r.avgOverall,
    best: r.bestOverall,
    change_first_to_last: r.change,
    by_area: r.categories.map((c) => ({ area: c.label, average: c.avg, interviews: c.count })),
    trend: r.trend.map((p) => ({ date: localStamp(new Date(p.date)).split(',')[0], title: p.title, score: p.score })),
    recurring_improvements: recurring(r.sessions, (s) => s.feedback?.improvements ?? []),
    recurring_strengths: recurring(r.sessions, (s) => s.feedback?.strengths ?? []),
  };
}

export function scheduleList(items: ScheduledInterview[], now: Date) {
  const b = bucketSchedule(items, now.getTime());
  const row = (i: ScheduledInterview) => ({ id: i.id, title: i.title, at: localStamp(new Date(i.at)), at_local: localIso(new Date(i.at)) });
  return { due_now: b.due.map(row), upcoming: b.upcoming.map(row), missed: b.missed.map(row) };
}

export function wordList(words: SavedWord[], args: Args) {
  const limit = clampInt(args['limit'], 30, 100);
  return {
    total: words.length,
    words: words.slice(0, limit).map((w) => ({ word: w.word, meaning: w.meaning, part_of_speech: w.partOfSpeech })),
  };
}

/** Short label for the step chips under a reply ("Read 7 interviews"). */
export function stepLabel(name: string, result: Record<string, unknown>): string {
  const n = (k: string) => (typeof result[k] === 'number' ? (result[k] as number) : 0);
  switch (name) {
    case 'list_interviews': return `Read ${n('total')} interview${n('total') === 1 ? '' : 's'}`;
    case 'get_interview': return result['transcript'] ? 'Read an interview transcript' : 'Read interview feedback';
    case 'get_progress_report': return `Built ${String(result['period'] ?? '')} report`.replace('all report', 'full report');
    case 'list_scheduled': return 'Checked your schedule';
    case 'list_saved_words': return `Read ${n('total')} saved word${n('total') === 1 ? '' : 's'}`;
    case 'get_app_status': return 'Checked the app';
    default: return name.replace(/_/g, ' ');
  }
}

// --------------------------------------------------------------- action tools
/** "2026-10-28T19:00" (local) -> Date, or an error the coach can fix. */
export function parseLocalDateTime(v: unknown, now: Date): Date | string {
  const s = str(v, 40);
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s);
  if (!m) return 'Use the local date and time format YYYY-MM-DDTHH:mm.';
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (Number.isNaN(d.getTime()) || d.getMonth() !== +m[2] - 1) return 'That date does not exist.';
  if (d.getTime() < now.getTime() - 60_000) return 'That time has already passed. Pick a future time.';
  if (d.getTime() > now.getTime() + 366 * 86_400_000) return 'Pick a time within the next year.';
  return d;
}

export function setupDraftFrom(args: Args): SetupDraft | string {
  const level = args['level'];
  if (!LEVELS.includes(level as InterviewLevel)) return `level must be one of: ${LEVELS.join(', ')}.`;
  const draft: SetupDraft = { level: level as InterviewLevel };
  const role = str(args['role'], 100);
  if (role) draft.role = role;
  if (DURATIONS.includes(Number(args['duration_min']))) draft.durationMin = Number(args['duration_min']);
  if (LANGUAGES.includes(args['language'] as InterviewLanguage)) draft.language = args['language'] as InterviewLanguage;
  const focus = str(args['focus'], 300);
  if (focus) draft.focus = focus;
  if (args['answer_mode'] === 'auto' || args['answer_mode'] === 'manual') draft.answerMode = args['answer_mode'];
  return draft;
}

/** A complete interview setup for a scheduled interview (general questions, no CV). */
export function configFromDraft(d: SetupDraft, random = Math.random): InterviewConfig {
  const language = d.language ?? 'English';
  return {
    level: d.level ?? 'junior', mode: 1, role: d.role ?? '', durationMin: d.durationMin ?? 15,
    language, transcriptLanguage: language, cvSummary: null, cvFileName: null, generalSkills: '',
    simulation: false, coachingConsent: false, candidateName: '', interviewerName: pickInterviewerName(language, random),
    answerMode: d.answerMode ?? 'auto', pauseSec: 2.5, ...(d.focus ? { focus: d.focus } : {}),
  };
}

function draftLines(d: SetupDraft): string[] {
  const level = d.level ? d.level.charAt(0).toUpperCase() + d.level.slice(1) : 'Junior';
  const lines = [[level, d.role, `${d.durationMin ?? 15} min`, d.language ?? 'English'].filter(Boolean).join(' · ')];
  if (d.focus) lines.push(`Focus: ${d.focus}`);
  if (d.answerMode === 'manual') lines.push('You press "Done answering" to end each answer');
  return lines;
}

export interface ActionContext {
  now: Date;
  sessions: SessionRecord[];
  schedule: ScheduledInterview[];
}

export interface ActionPlan {
  title: string;
  lines: string[];
  confirmLabel: string;
}

/** The Confirm / Cancel card for an action, or an error message for the coach when its arguments are wrong. */
export function describeAction(name: string, args: Args, ctx: ActionContext): ActionPlan | { error: string } {
  switch (name) {
    case 'open_page': {
      const page = COACH_PAGES[String(args['page'])];
      if (!page) return { error: `page must be one of: ${Object.keys(COACH_PAGES).join(', ')}.` };
      const lines: string[] = [];
      const id = str(args['interview_id'], 200);
      if (id) {
        const s = ctx.sessions.find((x) => x.id === id);
        if (!s) return { error: 'No saved interview has that interview_id.' };
        lines.push(`${s.title || interviewTitle(s)} · ${localStamp(new Date(s.date)).split(',')[0]}`);
      }
      const period = RANGE_OPTIONS.find((r) => r.id === args['report_period']);
      if (period && args['page'] === 'reports') lines.push(`Period: last ${period.label}`);
      return { title: `Open ${page.label}`, lines, confirmLabel: 'Open' };
    }
    case 'prepare_interview': {
      const d = setupDraftFrom(args);
      if (typeof d === 'string') return { error: d };
      return { title: 'Set up interview', lines: [...draftLines(d), 'Opens New Interview; you press Start'], confirmLabel: 'Set it up' };
    }
    case 'schedule_interview': {
      const d = setupDraftFrom(args);
      if (typeof d === 'string') return { error: d };
      const at = parseLocalDateTime(args['at'], ctx.now);
      if (typeof at === 'string') return { error: at };
      return { title: 'Schedule interview', lines: [localStamp(at), ...draftLines(d), 'General questions (no CV)'], confirmLabel: 'Schedule' };
    }
    case 'reschedule_interview': {
      const item = ctx.schedule.find((i) => i.id === args['id']);
      if (!item) return { error: 'No scheduled interview has that id. Call list_scheduled.' };
      const at = parseLocalDateTime(args['at'], ctx.now);
      if (typeof at === 'string') return { error: at };
      return { title: 'Change interview time', lines: [item.title, `${localStamp(new Date(item.at))} → ${localStamp(at)}`], confirmLabel: 'Change time' };
    }
    case 'remove_scheduled_interview': {
      const item = ctx.schedule.find((i) => i.id === args['id']);
      if (!item) return { error: 'No scheduled interview has that id. Call list_scheduled.' };
      return { title: 'Remove scheduled interview', lines: [item.title, localStamp(new Date(item.at))], confirmLabel: 'Remove' };
    }
    case 'save_words': {
      const words = wordsToSave(args);
      if (typeof words === 'string') return { error: words };
      return { title: `Save ${words.length} word${words.length > 1 ? 's' : ''}`, lines: words.map((w) => `${w.word} — ${w.meaning}`), confirmLabel: 'Save' };
    }
    case 'open_vocabulary_practice': {
      const words = practiceWords(args);
      if (typeof words === 'string') return { error: words };
      return { title: 'Practise words in Vocabulary', lines: [words.join(', '), 'Writes a new paragraph with these words'], confirmLabel: 'Open' };
    }
    case 'export_report_pdf': {
      const period = RANGE_OPTIONS.find((r) => r.id === args['period'] && r.id !== 'custom');
      if (!period) return { error: 'period must be one of: 1d, 3d, 7d, 30d, 90d.' };
      return { title: 'Save report as PDF', lines: [`Last ${period.label}`, 'Windows asks where to save it'], confirmLabel: 'Save PDF' };
    }
    default:
      return { error: `Unknown function ${name}.` };
  }
}

export function wordsToSave(args: Args): { word: string; meaning: string; partOfSpeech: string; example: string }[] | string {
  const list = Array.isArray(args['words']) ? args['words'] : [];
  const words = list
    .map((w) => (w && typeof w === 'object' ? (w as Args) : {}))
    .map((w) => ({ word: str(w['word'], 80), meaning: str(w['meaning'], 400), partOfSpeech: str(w['part_of_speech'], 40), example: str(w['example'], 400) }))
    .filter((w) => w.word && w.meaning);
  if (!words.length) return 'Give at least one word with its meaning.';
  return words.slice(0, 10);
}

export function practiceWords(args: Args): string[] | string {
  const list = (Array.isArray(args['words']) ? args['words'] : []).map((w) => str(w, 80)).filter(Boolean);
  if (!list.length) return 'Give 1 to 6 words.';
  return [...new Set(list)].slice(0, 6);
}

export function asReportRange(v: unknown): ReportRange {
  return RANGE_OPTIONS.some((r) => r.id === v && r.id !== 'custom') ? (v as ReportRange) : '30d';
}
