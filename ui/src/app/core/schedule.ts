// Pure helpers for scheduled interviews (no Angular, no I/O).
import { ScheduledInterview } from './interviewmate-api';
import { InterviewConfig } from './session-state.service';

const MIN = 60_000;
/** "Starts now" from 10 minutes before until an hour after the time. */
export const DUE_BEFORE_MS = 10 * MIN;
export const DUE_AFTER_MS = 60 * MIN;

export interface ScheduleBuckets {
  due: ScheduledInterview[];
  upcoming: ScheduledInterview[];
  missed: ScheduledInterview[];
}

export function bucketSchedule(items: ScheduledInterview[], now: number): ScheduleBuckets {
  const out: ScheduleBuckets = { due: [], upcoming: [], missed: [] };
  for (const item of [...items].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const at = Date.parse(item.at);
    if (now < at - DUE_BEFORE_MS) out.upcoming.push(item);
    else if (now < at + DUE_AFTER_MS) out.due.push(item);
    else out.missed.unshift(item); // most recently missed first
  }
  return out;
}

/** "in 2 days 3 h", "in 1 h 5 min", "in 4 min", "now", "25 min ago". */
export function relativeTime(at: number, now: number): string {
  const diff = at - now;
  const mins = Math.round(Math.abs(diff) / MIN);
  if (mins < 1) return 'now';
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rest = mins % 60;
  const text = days ? `${days} day${days > 1 ? 's' : ''}${hours ? ` ${hours} h` : ''}` : hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

export function interviewTitle(cfg: Pick<InterviewConfig, 'level' | 'role'>): string {
  return `${cfg.level.charAt(0).toUpperCase() + cfg.level.slice(1)} interview${cfg.role ? ` — ${cfg.role}` : ''}`;
}

/** Date -> value for <input type="datetime-local"> in local time ("2026-10-27T15:30"). */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The next whole half hour at least 15 minutes away: a sensible default time. */
export function defaultScheduleTime(now: Date): Date {
  const d = new Date(now.getTime() + 15 * MIN);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() <= 30 ? 30 : 60);
  return d;
}
