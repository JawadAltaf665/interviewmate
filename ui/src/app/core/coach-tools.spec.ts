import { describe, expect, it } from 'vitest';
import { ScheduledInterview, SessionRecord } from './interviewmate-api';
import {
  ACTION_TOOLS, COACH_TOOLS, configFromDraft, describeAction, interviewDetail, interviewList, parseLocalDateTime, practiceWords,
  progressReport, READ_TOOLS, wordsToSave,
} from './coach-tools';

const now = new Date(2026, 9, 27, 12, 0);
const fb = (score: number, improvements: string[]) => ({
  summary: 'ok', strengths: ['Clear'], improvements, practiceQuestions: ['Q?'],
  scores: { relevance: { score, explanation: 'r' }, clarity: { score, explanation: 'c' }, technical: { score, explanation: 't' } },
}) as never;
const session = (id: string, daysAgo: number, feedback?: unknown): SessionRecord => ({
  id, date: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), level: 'junior', mode: 1, role: 'Angular dev',
  durationSec: 900, transcript: [{ speaker: 'interviewer', text: 'Tell me about yourself.' } as never, { speaker: 'user', text: 'I build apps.' } as never],
  coachingNotes: [], feedback: feedback as never,
});
const sessions = [session('a', 20, fb(60, ['Use STAR'])), session('b', 2, fb(80, ['use star', 'More numbers'])), session('c', 1)];
const sched: ScheduledInterview[] = [{ id: 's1', at: new Date(now.getTime() + 86_400_000).toISOString(), title: 'Junior interview', config: {}, createdAt: '' } as never];
const ctx = { now, sessions, schedule: sched };

describe('coach tools', () => {
  it('splits every function into a read or an action, with no dangerous ones', () => {
    for (const t of COACH_TOOLS) expect(READ_TOOLS.has(t.name) !== ACTION_TOOLS.has(t.name)).toBe(true);
    const names = COACH_TOOLS.map((t) => t.name).join(' ');
    expect(names).not.toMatch(/key|credential|clear|delete_interview|paid|setting|mic|camera/);
  });

  it('declares only text choices (Gemini rejects number enums)', () => {
    const enums: unknown[] = [];
    const walk = (v: unknown): void => {
      if (!v || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      if (Array.isArray(o['enum'])) enums.push(...o['enum'], o['type']);
      Object.values(o).forEach(walk);
    };
    COACH_TOOLS.forEach((t) => walk(t.parameters));
    expect(enums.length).toBeGreaterThan(0);
    expect(enums.every((e) => typeof e === 'string' && e !== 'integer' && e !== 'number')).toBe(true);
  });

  it('lists interviews newest first within the period', () => {
    const r = interviewList(sessions, { period: '7d' }, now);
    expect(r.total).toBe(2);
    expect(r.interviews.map((i) => i.id)).toEqual(['c', 'b']);
    expect(r.interviews[1].overall).toBe(80);
    expect(r.interviews[0].feedback).toBe('none');
  });

  it('includes the transcript only when asked', () => {
    expect(interviewDetail(sessions[1], {})['transcript']).toBeUndefined();
    expect(interviewDetail(sessions[1], { include_transcript: true })['transcript']).toEqual(['Interviewer: Tell me about yourself.', 'Candidate: I build apps.']);
    expect(interviewDetail(undefined, {})).toHaveProperty('error');
  });

  it('counts recurring improvements across the period', () => {
    const r = progressReport(sessions, { period: '30d' }, now);
    expect(r.interviews).toBe(3);
    expect(r.recurring_improvements[0]).toMatchObject({ times: 2 });
    expect(r.recurring_improvements[0].text.toLowerCase()).toBe('use star');
  });

  it('parses local times and rejects past, far-future and impossible ones', () => {
    const d = parseLocalDateTime('2026-10-28T19:00', now);
    expect(d instanceof Date && d.getHours()).toBe(19);
    expect(parseLocalDateTime('2026-10-26T19:00', now)).toContain('already passed');
    expect(parseLocalDateTime('2028-01-01T10:00', now)).toContain('next year');
    expect(parseLocalDateTime('2026-02-30T10:00', now)).toContain('does not exist');
    expect(parseLocalDateTime('tomorrow', now)).toContain('YYYY-MM-DDTHH:mm');
  });

  it('describes actions for the confirm card and rejects bad arguments', () => {
    expect(describeAction('schedule_interview', { level: 'senior', at: '2026-10-28T19:00', focus: 'STAR' }, ctx))
      .toMatchObject({ title: 'Schedule interview', confirmLabel: 'Schedule' });
    expect(describeAction('schedule_interview', { level: 'boss', at: '2026-10-28T19:00' }, ctx)).toHaveProperty('error');
    expect(describeAction('reschedule_interview', { id: 'nope', at: '2026-10-28T19:00' }, ctx)).toHaveProperty('error');
    expect(describeAction('remove_scheduled_interview', { id: 's1' }, ctx)).toMatchObject({ confirmLabel: 'Remove' });
    expect(describeAction('open_page', { page: 'feedback', interview_id: 'zzz' }, ctx)).toHaveProperty('error');
    expect(describeAction('open_page', { page: 'settings' }, ctx)).toMatchObject({ title: 'Open Settings' });
    expect(describeAction('open_page', { page: 'api_keys' }, ctx)).toHaveProperty('error');
    expect(describeAction('export_report_pdf', { period: 'custom' }, ctx)).toHaveProperty('error');
    expect(describeAction('delete_everything', {}, ctx)).toHaveProperty('error');
  });

  it('builds a complete general-mode setup for a scheduled interview', () => {
    const c = configFromDraft({ level: 'intern', focus: 'SQL' }, () => 0);
    expect(c).toMatchObject({ level: 'intern', mode: 1, cvSummary: null, simulation: false, coachingConsent: false, focus: 'SQL', durationMin: 15 });
  });

  it('checks words to save and practise', () => {
    expect(wordsToSave({ words: [] })).toEqual(expect.any(String));
    expect(wordsToSave({ words: [{ word: 'concise', meaning: 'short and clear' }] })).toHaveLength(1);
    expect(practiceWords({ words: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(typeof practiceWords({ words: [] })).toBe('string');
  });
});
