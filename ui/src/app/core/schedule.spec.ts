import { describe, expect, it } from 'vitest';
import { ScheduledInterview } from './interviewmate-api';
import { bucketSchedule, defaultScheduleTime, interviewTitle, relativeTime, toLocalInput } from './schedule';

const MIN = 60_000;
const NOW = Date.parse('2026-10-27T12:00:00Z');
const item = (id: string, offsetMin: number): ScheduledInterview =>
  ({ id, at: new Date(NOW + offsetMin * MIN).toISOString(), title: id, config: {}, createdAt: '' });

describe('schedule helpers', () => {
  it('splits interviews into due (10 min before to 1 h after), upcoming and missed', () => {
    const b = bucketSchedule([item('later', 120), item('soon', 5), item('justNow', -30), item('old', -90), item('older', -600), item('next', 11)], NOW);
    expect(b.due.map((i) => i.id)).toEqual(['justNow', 'soon']);
    expect(b.upcoming.map((i) => i.id)).toEqual(['next', 'later']);
    expect(b.missed.map((i) => i.id)).toEqual(['old', 'older']);
  });

  it('describes the time left in plain words', () => {
    expect(relativeTime(NOW + 4 * MIN, NOW)).toBe('in 4 min');
    expect(relativeTime(NOW + 65 * MIN, NOW)).toBe('in 1 h 5 min');
    expect(relativeTime(NOW + (2 * 1440 + 180) * MIN, NOW)).toBe('in 2 days 3 h');
    expect(relativeTime(NOW + 20_000, NOW)).toBe('now');
    expect(relativeTime(NOW - 25 * MIN, NOW)).toBe('25 min ago');
  });

  it('formats titles, datetime-local values and a sensible default time', () => {
    expect(interviewTitle({ level: 'senior', role: 'Backend' })).toBe('Senior interview — Backend');
    expect(interviewTitle({ level: 'intern', role: '' })).toBe('Intern interview');
    expect(toLocalInput(new Date(2026, 9, 7, 9, 5))).toBe('2026-10-07T09:05');
    expect(toLocalInput(defaultScheduleTime(new Date(2026, 9, 7, 9, 5)))).toBe('2026-10-07T09:30');
    expect(toLocalInput(defaultScheduleTime(new Date(2026, 9, 7, 9, 20)))).toBe('2026-10-07T10:00');
  });
});
