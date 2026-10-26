// InterviewMate — app settings store (JSON file in userData).
// Settings: freeTierOnly, coachingIntervalSec, plus the opt-in paid path
// (allowPaidUsage + textModel), and the light/dark theme. Paid is OFF by default; when off, a paid
// text model can never survive sanitize() — it is forced back to Flash.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FREE_TEXT_MODEL = 'gemini-3.8-flash';
const PAID_TEXT_MODELS = Object.freeze(['gemini-3.1-pro-preview', 'gemini-4-argon']);
const DEFAULTS = Object.freeze({
  freeTierOnly: true, coachingIntervalSec: 25,
  allowPaidUsage: false, textModel: FREE_TEXT_MODEL,
  theme: 'dark',
  // Vocabulary tab choices, remembered between launches.
  vocab: Object.freeze({ topic: 'interview', level: 'medium', length: 'medium', voice: 'Kore', speed: 'medium', urdu: false, useSaved: false }),
});
const VOCAB_CHOICES = Object.freeze({
  topic: ['interview', 'tech', 'office', 'daily', 'mix'],
  level: ['easy', 'medium', 'advanced'],
  length: ['short', 'medium'],
  voice: ['Kore', 'Puck', 'Charon', 'Aoede', 'offline'], // 'offline' = the Windows voice
  speed: ['slow', 'medium', 'fast'],
});
const MIN_INTERVAL = 15;
const MAX_INTERVAL = 120;

function clampInterval(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULTS.coachingIntervalSec;
  return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, n));
}

function sanitize(patch, base) {
  const out = { ...base };
  if (patch && typeof patch === 'object') {
    if (typeof patch.freeTierOnly === 'boolean') out.freeTierOnly = patch.freeTierOnly;
    if (patch.coachingIntervalSec !== undefined) out.coachingIntervalSec = clampInterval(patch.coachingIntervalSec);
    if (patch.theme === 'light' || patch.theme === 'dark') out.theme = patch.theme;
    if (patch.vocab && typeof patch.vocab === 'object') {
      const v = { ...DEFAULTS.vocab, ...out.vocab };
      for (const [key, allowed] of Object.entries(VOCAB_CHOICES)) {
        if (allowed.includes(patch.vocab[key])) v[key] = patch.vocab[key];
      }
      if (typeof patch.vocab.urdu === 'boolean') v.urdu = patch.vocab.urdu;
      if (typeof patch.vocab.useSaved === 'boolean') v.useSaved = patch.vocab.useSaved;
      out.vocab = v;
    }
    if (typeof patch.allowPaidUsage === 'boolean') out.allowPaidUsage = patch.allowPaidUsage;
    if (typeof patch.textModel === 'string' &&
        (patch.textModel === FREE_TEXT_MODEL || PAID_TEXT_MODELS.includes(patch.textModel))) {
      out.textModel = patch.textModel;
    }
    // Paid models require the explicit opt-in; without it, force Flash.
    // This also repairs stale files saved with a paid model while off.
    if (!out.allowPaidUsage && out.textModel !== FREE_TEXT_MODEL) out.textModel = FREE_TEXT_MODEL;
  }
  return out;
}

function createSettingsStore({ filePath } = {}) {
  if (!filePath) throw new Error('settings store: filePath is required');
  let settings = null;

  function load() {
    if (settings) return settings;
    settings = { ...DEFAULTS };
    try {
      settings = sanitize(JSON.parse(fs.readFileSync(filePath, 'utf8')), settings);
    } catch { /* missing or corrupt -> defaults */ }
    return settings;
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(load(), null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  return {
    get() { return { ...load() }; },

    set(patch) {
      settings = sanitize(patch, load());
      persist();
      return { ...settings };
    },

    /** Reset to defaults and remove the file (used by "Clear local data"). */
    clear() {
      settings = { ...DEFAULTS };
      try { fs.unlinkSync(filePath); } catch { /* already gone */ }
      return { ...settings };
    },
  };
}

module.exports = { createSettingsStore, DEFAULTS, VOCAB_CHOICES, MIN_INTERVAL, MAX_INTERVAL, FREE_TEXT_MODEL, PAID_TEXT_MODELS };
