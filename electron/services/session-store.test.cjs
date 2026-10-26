'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSessionStore, MAX_SESSIONS } = require('./session-store.cjs');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-sessions-'));
  return createSessionStore({ filePath: path.join(dir, 'sessions.json') });
}
const day = (n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();

test('list is newest first', () => {
  const store = tempStore();
  store.save({ id: 'a', date: day(1), level: 'Intern' });
  store.save({ id: 'b', date: day(3), level: 'Senior' });
  store.save({ id: 'c', date: day(2), level: 'Junior' });
  assert.deepEqual(store.list().map((s) => s.id), ['b', 'c', 'a']);
});

test('caps at 100 sessions, dropping the oldest', () => {
  const store = tempStore();
  for (let i = 0; i < MAX_SESSIONS + 5; i++) store.save({ id: 's' + i, date: day(i) });
  const list = store.list();
  assert.equal(list.length, MAX_SESSIONS);
  assert.equal(list[0].id, 's' + (MAX_SESSIONS + 4));
  assert.ok(!list.some((s) => s.id === 's0'));
  assert.ok(!list.some((s) => s.id === 's4'));
  assert.ok(list.some((s) => s.id === 's5'));
});

test('saving the same id replaces it', () => {
  const store = tempStore();
  store.save({ id: 'a', date: day(1), note: 'v1' });
  store.save({ id: 'a', date: day(1), note: 'v2' });
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].note, 'v2');
});

test('validation: id and a valid date are required', () => {
  const store = tempStore();
  assert.throws(() => store.save({ date: day(1) }), /id/i);
  assert.throws(() => store.save({ id: '', date: day(1) }), /id/i);
  assert.throws(() => store.save({ id: 'x' }), /date/i);
  assert.throws(() => store.save({ id: 'x', date: 'not a date' }), /date/i);
  assert.throws(() => store.save('nope'), /object/i);
});

test('remove and clear', () => {
  const store = tempStore();
  store.save({ id: 'a', date: day(1) });
  assert.equal(store.remove('a'), true);
  assert.equal(store.remove('a'), false);
  store.save({ id: 'b', date: day(2) });
  store.clear();
  assert.deepEqual(store.list(), []);
});
