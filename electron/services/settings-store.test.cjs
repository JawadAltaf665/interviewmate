'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSettingsStore, DEFAULTS } = require('./settings-store.cjs');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-settings-'));
  const filePath = path.join(dir, 'settings.json');
  return { store: createSettingsStore({ filePath }), filePath };
}

test('defaults: freeTierOnly true, interval 25', () => {
  const { store } = tempStore();
  assert.deepEqual(store.get(), { freeTierOnly: true, coachingIntervalSec: 25, allowPaidUsage: false, textModel: 'gemini-3.8-flash', theme: 'dark', vocab: DEFAULTS.vocab });
  assert.equal(DEFAULTS.freeTierOnly, true);
});

test('interval is clamped to 15..120', () => {
  const { store } = tempStore();
  assert.equal(store.set({ coachingIntervalSec: 5 }).coachingIntervalSec, 15);
  assert.equal(store.set({ coachingIntervalSec: 999 }).coachingIntervalSec, 120);
  assert.equal(store.set({ coachingIntervalSec: 30 }).coachingIntervalSec, 30);
});

test('non-boolean freeTierOnly is ignored; settings persist across instances', () => {
  const { store, filePath } = tempStore();
  store.set({ freeTierOnly: 'yes' });
  assert.equal(store.get().freeTierOnly, true);
  store.set({ freeTierOnly: false, coachingIntervalSec: 45 });
  const again = createSettingsStore({ filePath });
  assert.deepEqual(again.get(), { freeTierOnly: false, coachingIntervalSec: 45, allowPaidUsage: false, textModel: 'gemini-3.8-flash', theme: 'dark', vocab: DEFAULTS.vocab });
});

test('clear resets to defaults', () => {
  const { store } = tempStore();
  store.set({ freeTierOnly: false, coachingIntervalSec: 90 });
  store.clear();
  assert.deepEqual(store.get(), { freeTierOnly: true, coachingIntervalSec: 25, allowPaidUsage: false, textModel: 'gemini-3.8-flash', theme: 'dark', vocab: DEFAULTS.vocab });
});

test('paid option: off by default, paid model forced back to Flash unless opted in', () => {
  const { store } = tempStore();
  assert.equal(store.get().allowPaidUsage, false);
  assert.equal(store.set({ textModel: 'gemini-3.1-pro-preview' }).textModel, 'gemini-3.8-flash');
  assert.equal(store.set({ allowPaidUsage: true, textModel: 'gemini-3.1-pro-preview' }).textModel, 'gemini-3.1-pro-preview');
  assert.equal(store.set({ allowPaidUsage: false }).textModel, 'gemini-3.8-flash');
  assert.equal(store.set({ allowPaidUsage: true, textModel: 'gemini-nope' }).textModel, 'gemini-3.8-flash');
});

test('theme: only light/dark accepted, persists across instances', () => {
  const { store, filePath } = tempStore();
  assert.equal(store.set({ theme: 'purple' }).theme, 'dark');
  assert.equal(store.set({ theme: 'light' }).theme, 'light');
  assert.equal(store.set({ coachingIntervalSec: 30 }).theme, 'light'); // other saves keep it
  assert.equal(createSettingsStore({ filePath }).get().theme, 'light');
});

test('settings: vocabulary choices are allowlisted and persisted', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'im-settings-vocab-')), 'settings.json');
  const store = createSettingsStore({ filePath: file });
  assert.equal(store.get().vocab.voice, 'Kore');
  store.set({ vocab: { speed: 'slow', voice: 'offline', topic: 'hacker', urdu: true, level: 7 } });
  const v = createSettingsStore({ filePath: file }).get().vocab;
  assert.equal(v.speed, 'slow');
  assert.equal(v.voice, 'offline');
  assert.equal(v.topic, 'interview'); // unknown topic ignored
  assert.equal(v.level, 'medium');
  assert.equal(v.urdu, true);
});
