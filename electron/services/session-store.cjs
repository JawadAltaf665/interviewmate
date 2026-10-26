// InterviewMate — local session history store (JSON file in userData).
// Only sessions the user chose to save land here. Newest first, max 100.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_SESSIONS = 100;

function sessionDate(s) {
  const raw = s.date || s.startedAt || s.createdAt || s.timestamp;
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(t) ? null : t;
}

function createSessionStore({ filePath } = {}) {
  if (!filePath) throw new Error('session store: filePath is required');
  let sessions = null;

  function load() {
    if (sessions) return sessions;
    sessions = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.sessions)) sessions = parsed.sessions;
      else if (Array.isArray(parsed)) sessions = parsed;
    } catch { /* missing or corrupt -> empty */ }
    return sessions;
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, sessions }, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  function sorted() {
    return [...load()].sort((a, b) => (sessionDate(b) || 0) - (sessionDate(a) || 0));
  }

  return {
    save(session) {
      if (!session || typeof session !== 'object' || Array.isArray(session)) {
        throw new Error('Session must be an object.');
      }
      if (typeof session.id !== 'string' || !session.id.trim() || session.id.length > 200) {
        throw new Error('Session needs a non-empty id.');
      }
      if (sessionDate(session) === null) {
        throw new Error('Session needs a valid date (date / startedAt / createdAt).');
      }
      const list = load();
      const idx = list.findIndex((s) => s.id === session.id);
      if (idx >= 0) list[idx] = session; else list.push(session);
      // Cap: keep the newest MAX_SESSIONS, drop the oldest.
      sessions = sorted().slice(0, MAX_SESSIONS);
      persist();
      return session;
    },

    list() { return sorted(); },

    remove(id) {
      const list = load();
      const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) return false;
      list.splice(idx, 1);
      persist();
      return true;
    },

    clear() {
      sessions = [];
      persist();
    },
  };
}

module.exports = { createSessionStore, MAX_SESSIONS };
