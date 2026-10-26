// InterviewMate — scheduled interviews (JSON file in userData).
// Each entry keeps the interview setup (level, CV summary, language, ...) so it
// can start in one click at the scheduled time. Soonest first, max 50.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_ITEMS = 50;
const MAX_CONFIG_CHARS = 60_000;
const EARLY_MS = 10 * 60_000; // "starts in 10 minutes" reminder
const DUE_WINDOW_MS = 15 * 60_000; // a "starts now" reminder is still useful this long after the time

function clean(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Scheduled interview must be an object.');
  const at = Date.parse(input.at);
  if (typeof input.at !== 'string' || Number.isNaN(at)) throw new Error('Scheduled interview needs a valid date and time.');
  if (!input.config || typeof input.config !== 'object' || Array.isArray(input.config)) throw new Error('Scheduled interview needs its interview setup.');
  if (JSON.stringify(input.config).length > MAX_CONFIG_CHARS) throw new Error('The interview setup is too large to schedule.');
  if (input.title !== undefined && typeof input.title !== 'string') throw new Error('title must be a string.');
  if (input.id !== undefined && (typeof input.id !== 'string' || !input.id || input.id.length > 200)) throw new Error('A valid id is required.');
  return { id: input.id, at: new Date(at).toISOString(), title: String(input.title || 'Mock interview').slice(0, 200), config: input.config };
}

function createScheduleStore({ filePath } = {}) {
  if (!filePath) throw new Error('schedule store: filePath is required');
  let items = null;

  function load() {
    if (items) return items;
    items = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.items)) items = parsed.items;
    } catch { /* missing or corrupt -> empty */ }
    return items;
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  const sorted = () => [...load()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return {
    list() { return sorted(); },

    /** Add, or update by id. Changing the time re-arms its reminders. */
    save(input) {
      const entry = clean(input);
      const list = load();
      const old = entry.id ? list.find((i) => i.id === entry.id) : null;
      if (entry.id && !old) throw new Error('That scheduled interview no longer exists.');
      if (!old && list.length >= MAX_ITEMS) throw new Error(`You can schedule at most ${MAX_ITEMS} interviews.`);
      const sameTime = old && old.at === entry.at;
      const saved = {
        ...entry,
        id: old ? old.id : `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: old ? old.createdAt : new Date().toISOString(),
        remindedEarly: sameTime ? !!old.remindedEarly : false,
        remindedDue: sameTime ? !!old.remindedDue : false,
      };
      items = [...list.filter((i) => i !== old), saved];
      persist();
      return saved;
    },

    remove(id) {
      const list = load();
      const next = list.filter((i) => i.id !== id);
      if (next.length === list.length) return false;
      items = next;
      persist();
      return true;
    },

    clear() {
      items = [];
      persist();
    },

    /**
     * Reminders due at `now` (ms). Each fires once: 'early' 10 minutes before,
     * 'due' at the time (skipped silently if the app was closed long past it).
     */
    takeReminders(now) {
      const out = [];
      let changed = false;
      for (const item of load()) {
        const at = Date.parse(item.at);
        if (!item.remindedEarly && now >= at - EARLY_MS) {
          item.remindedEarly = true;
          changed = true;
          if (now < at) out.push({ kind: 'early', item });
        }
        if (!item.remindedDue && now >= at) {
          item.remindedDue = true;
          changed = true;
          if (now < at + DUE_WINDOW_MS) out.push({ kind: 'due', item });
        }
      }
      if (changed) persist();
      return out;
    },
  };
}

module.exports = { createScheduleStore, MAX_ITEMS, EARLY_MS, DUE_WINDOW_MS };
