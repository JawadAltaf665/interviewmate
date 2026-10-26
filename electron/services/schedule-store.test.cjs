'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createScheduleStore } = require('./schedule-store.cjs');

const MIN = 60_000;
const NOW = Date.parse('2026-10-27T12:00:00Z');
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'im-schedule-')), 'schedule.json');
const cfg = { level: 'junior', durationMin: 15, cvSummary: 'Angular, .NET' };

test('schedule store: saves soonest first, persists the setup, updates and removes', () => {
  const file = tmpFile();
  const store = createScheduleStore({ filePath: file });
  const late = store.save({ at: new Date(NOW + 120 * MIN).toISOString(), title: 'Senior interview', config: cfg });
  const soon = store.save({ at: new Date(NOW + 30 * MIN).toISOString(), title: 'Junior interview', config: cfg });
  assert.deepEqual(store.list().map((i) => i.id), [soon.id, late.id]);

  const reopened = createScheduleStore({ filePath: file });
  assert.equal(reopened.list()[0].config.cvSummary, 'Angular, .NET');
  const moved = reopened.save({ id: soon.id, at: new Date(NOW + 300 * MIN).toISOString(), title: soon.title, config: cfg });
  assert.equal(moved.id, soon.id);
  assert.deepEqual(reopened.list().map((i) => i.id), [late.id, soon.id]);
  assert.equal(reopened.remove(late.id), true);
  assert.equal(reopened.remove('missing'), false);
  assert.equal(reopened.list().length, 1);
});

test('schedule store: rejects bad input', () => {
  const store = createScheduleStore({ filePath: tmpFile() });
  assert.throws(() => store.save({ at: 'tomorrow-ish', config: cfg }), /valid date/);
  assert.throws(() => store.save({ at: new Date(NOW).toISOString() }), /interview setup/);
  assert.throws(() => store.save({ at: new Date(NOW).toISOString(), config: { big: 'x'.repeat(70_000) } }), /too large/);
  assert.throws(() => store.save({ id: 'nope', at: new Date(NOW).toISOString(), config: cfg }), /no longer exists/);
});

test('schedule store: each reminder fires once; long-missed ones stay silent; moving the time re-arms', () => {
  const store = createScheduleStore({ filePath: tmpFile() });
  const a = store.save({ at: new Date(NOW + 60 * MIN).toISOString(), title: 'A', config: cfg });
  store.save({ at: new Date(NOW - 120 * MIN).toISOString(), title: 'Old', config: cfg });

  assert.deepEqual(store.takeReminders(NOW), []); // A is an hour away; "Old" was missed long ago: no noise
  assert.deepEqual(store.takeReminders(NOW + 51 * MIN).map((r) => [r.kind, r.item.title]), [['early', 'A']]);
  assert.deepEqual(store.takeReminders(NOW + 52 * MIN), []);
  assert.deepEqual(store.takeReminders(NOW + 60 * MIN).map((r) => [r.kind, r.item.title]), [['due', 'A']]);
  assert.deepEqual(store.takeReminders(NOW + 61 * MIN), []);

  store.save({ id: a.id, at: new Date(NOW + 200 * MIN).toISOString(), title: 'A', config: cfg });
  assert.deepEqual(store.takeReminders(NOW + 200 * MIN).map((r) => r.kind), ['due']); // re-armed; "early" is already past
});
