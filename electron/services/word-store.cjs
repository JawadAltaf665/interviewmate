// InterviewMate — saved vocabulary words (JSON file in userData).
// Words (or whole sentences) the user starred in the Vocabulary tab. Newest first, max 500,
// one entry per word (saving the same word again updates it).
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_WORDS = 500;
const FIELDS = { word: 600, partOfSpeech: 40, meaning: 400, example: 400, sayIt: 80, urdu: 400 };

function clean(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Word must be an object.');
  const out = {};
  for (const [key, max] of Object.entries(FIELDS)) {
    const v = input[key];
    if (v !== undefined && v !== null && typeof v !== 'string') throw new Error(`${key} must be a string.`);
    out[key] = String(v || '').trim().slice(0, max);
  }
  if (!out.word) throw new Error('Word needs some text.');
  return out;
}

function createWordStore({ filePath, now } = {}) {
  if (!filePath) throw new Error('word store: filePath is required');
  const nowIso = () => new Date(now ? now() : Date.now()).toISOString();
  let words = null;

  function load() {
    if (words) return words;
    words = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.words)) words = parsed.words;
    } catch { /* missing or corrupt -> empty */ }
    return words;
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, words }, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  return {
    list() { return [...load()]; },

    save(input) {
      const entry = clean(input);
      const key = entry.word.toLowerCase();
      const list = load();
      const old = list.find((w) => w.word.toLowerCase() === key);
      const saved = { id: old ? old.id : `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, ...entry, savedAt: nowIso() };
      words = [saved, ...list.filter((w) => w !== old)].slice(0, MAX_WORDS);
      persist();
      return saved;
    },

    remove(id) {
      const list = load();
      const next = list.filter((w) => w.id !== id);
      if (next.length === list.length) return false;
      words = next;
      persist();
      return true;
    },

    clear() {
      words = [];
      persist();
    },
  };
}

module.exports = { createWordStore, MAX_WORDS };
