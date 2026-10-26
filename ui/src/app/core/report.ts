import { Feedback, FeedbackScore, SessionRecord } from './interviewmate-api';

// Combined progress report over saved interviews. Everything here is computed
// locally from what the user chose to save; the optional AI summary is a
// separate Gemini call that only sees the digest built below.

export type ReportRange = '1d' | '3d' | '7d' | '30d' | '90d' | 'custom';

export const RANGE_OPTIONS: { id: ReportRange; label: string; days: number }[] = [
  { id: '1d', label: '1 day', days: 1 },
  { id: '3d', label: '3 days', days: 3 },
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '3 months', days: 90 },
  { id: 'custom', label: 'Custom', days: 0 },
];

const SCORE_LABELS: Record<string, string> = {
  relevance: 'Relevance',
  clarity: 'Clarity',
  technical: 'Technical depth',
};

/**
 * Gemini returns scores as {relevance:{score,explanation},...}; the UI works
 * with a labelled list. Accepts either shape (older saved sessions keep the
 * object form on disk).
 */
export function normalizeScores(scores: unknown): FeedbackScore[] {
  if (Array.isArray(scores)) return scores as FeedbackScore[];
  if (!scores || typeof scores !== 'object') return [];
  return Object.entries(scores as Record<string, { score?: unknown; explanation?: unknown }>).map(([key, v]) => ({
    label: SCORE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1),
    score: Number(v?.score) || 0,
    explanation: typeof v?.explanation === 'string' ? v.explanation : '',
  }));
}

export function normalizeFeedback<T extends Feedback | undefined | null>(feedback: T): T {
  return feedback ? { ...feedback, scores: normalizeScores(feedback.scores) } : feedback;
}

export function overallScore(feedback: Feedback | null | undefined): number | null {
  const scores = normalizeScores(feedback?.scores);
  return scores.length ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length) : null;
}

/** Rolling window ending now, or a custom [from, to] of local calendar days (inclusive). */
export function rangeBounds(range: ReportRange, now: Date, customFrom?: string, customTo?: string): { from: Date; to: Date } {
  if (range === 'custom') {
    // Swap the days (not the timestamps) when picked in reverse, so both stay whole days.
    const [a, b] = customFrom && customTo && customFrom > customTo ? [customTo, customFrom] : [customFrom, customTo];
    return {
      from: a ? new Date(`${a}T00:00:00`) : new Date(0),
      to: b ? new Date(`${b}T23:59:59.999`) : now,
    };
  }
  const days = RANGE_OPTIONS.find((r) => r.id === range)?.days ?? 7;
  return { from: new Date(now.getTime() - days * 86_400_000), to: now };
}

export interface ReportPoint { id: string; date: string; title: string; score: number }
export interface ReportCategory { label: string; avg: number; count: number }
export interface ReportItem { text: string; date: string }

export interface ReportData {
  from: Date;
  to: Date;
  sessions: SessionRecord[]; // oldest first
  totalSec: number;
  scoredCount: number;
  avgOverall: number | null;
  bestOverall: number | null;
  /** Last scored interview minus the first one in the range. */
  change: number | null;
  trend: ReportPoint[];
  categories: ReportCategory[];
  strengths: ReportItem[]; // newest first, de-duplicated
  improvements: ReportItem[];
}

function collect(sessions: SessionRecord[], pick: (f: Feedback) => string[]): ReportItem[] {
  const seen = new Set<string>();
  const out: ReportItem[] = [];
  for (const s of [...sessions].reverse()) {
    for (const text of (s.feedback ? pick(s.feedback) : [])) {
      const key = text.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ text: text.trim(), date: s.date });
    }
  }
  return out;
}

export function buildReport(all: SessionRecord[], from: Date, to: Date): ReportData {
  const sessions = all
    .filter((s) => { const t = Date.parse(s.date); return t >= from.getTime() && t <= to.getTime(); })
    .sort((a, b) => a.date.localeCompare(b.date));
  const trend: ReportPoint[] = [];
  const cats = new Map<string, { sum: number; count: number }>();
  for (const s of sessions) {
    const score = overallScore(s.feedback);
    if (score === null) continue;
    trend.push({ id: s.id, date: s.date, title: s.title || 'Mock interview', score });
    for (const c of normalizeScores(s.feedback?.scores)) {
      const entry = cats.get(c.label) ?? { sum: 0, count: 0 };
      entry.sum += c.score;
      entry.count++;
      cats.set(c.label, entry);
    }
  }
  const scores = trend.map((p) => p.score);
  return {
    from, to, sessions, trend,
    totalSec: sessions.reduce((sum, s) => sum + (s.durationSec || 0), 0),
    scoredCount: trend.length,
    avgOverall: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    bestOverall: scores.length ? Math.max(...scores) : null,
    change: scores.length >= 2 ? scores[scores.length - 1] - scores[0] : null,
    categories: [...cats.entries()].map(([label, v]) => ({ label, avg: Math.round(v.sum / v.count), count: v.count })),
    strengths: collect(sessions, (f) => f.strengths ?? []),
    improvements: collect(sessions, (f) => f.improvements ?? []),
  };
}

/** Compact text of the saved feedback for the AI summary (no transcripts). */
export function reportDigest(report: ReportData): string {
  return report.sessions
    .filter((s) => s.feedback)
    .map((s) => {
      const f = s.feedback!;
      const scores = normalizeScores(f.scores).map((c) => `${c.label} ${c.score}`).join(', ');
      return [
        `Interview ${s.date.slice(0, 10)} (${s.level}${s.role ? `, ${s.role}` : ''}) — ${scores || 'no scores'}`,
        `Summary: ${f.summary}`,
        `Strengths: ${(f.strengths ?? []).join(' | ')}`,
        `Improve: ${(f.improvements ?? []).join(' | ')}`,
      ].join('\n');
    })
    .join('\n\n')
    .slice(0, 30000);
}
