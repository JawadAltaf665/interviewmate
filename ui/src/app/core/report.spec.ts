import { SessionRecord } from './interviewmate-api';
import { buildReport, normalizeScores, overallScore, rangeBounds, reportDigest } from './report';

const fb = (rel: number, cla: number, tech: number, strengths: string[] = [], improvements: string[] = []) => ({
  summary: 's', strengths, improvements, practiceQuestions: [],
  // Gemini's stored (object) shape
  scores: { relevance: { score: rel, explanation: '' }, clarity: { score: cla, explanation: '' }, technical: { score: tech, explanation: '' } },
}) as never;

const session = (id: string, date: string, feedback?: unknown, durationSec = 600): SessionRecord => ({
  id, date, level: 'junior', mode: 1, role: '', durationSec, transcript: [], coachingNotes: [], feedback: feedback as never,
});

describe('report', () => {
  const now = new Date('2026-10-26T12:00:00');
  const all = [
    session('a', '2026-10-01T10:00:00', fb(60, 60, 60, ['Clear'], ['Use STAR'])),
    session('b', '2026-10-24T10:00:00', fb(70, 80, 60, ['Clear'], ['More depth'])),
    session('c', '2026-10-26T09:00:00', fb(90, 90, 90, ['Confident'])),
    session('d', '2026-10-25T09:00:00'), // saved before feedback was stored
  ];

  it('normalizes Gemini object scores into labelled entries', () => {
    expect(normalizeScores({ relevance: { score: 90, explanation: 'x' } })).toEqual([{ label: 'Relevance', score: 90, explanation: 'x' }]);
    expect(overallScore(fb(60, 80, 100))).toBe(80);
    expect(overallScore(undefined)).toBeNull();
  });

  it('filters by rolling window and computes averages, change and categories', () => {
    const { from, to } = rangeBounds('3d', now);
    const r = buildReport(all, from, to);
    expect(r.sessions.map((s) => s.id)).toEqual(['b', 'd', 'c']);
    expect(r.scoredCount).toBe(2);
    expect(r.avgOverall).toBe(80); // 70 and 90
    expect(r.change).toBe(20);
    expect(r.totalSec).toBe(1800);
    expect(r.categories.find((c) => c.label === 'Clarity')?.avg).toBe(85);
    expect(r.strengths.map((s) => s.text)).toEqual(['Confident', 'Clear']); // newest first, de-duplicated
  });

  it('custom range is inclusive of whole days and tolerates reversed dates', () => {
    const { from, to } = rangeBounds('custom', now, '2026-10-24', '2026-10-01');
    expect(buildReport(all, from, to).sessions.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('digest contains feedback but never transcripts', () => {
    const { from, to } = rangeBounds('90d', now);
    const digest = reportDigest(buildReport(all, from, to));
    expect(digest).toContain('Use STAR');
    expect(digest).toContain('Clarity 80');
    expect(digest.split('Interview ').length - 1).toBe(3);
  });
});
