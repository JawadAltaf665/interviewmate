'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCredentialStore } = require('./credential-store.cjs');

// Fake safeStorage pair (same contract: encrypt -> Buffer, decrypt(Buffer) -> string).
// Encodes twice into base64 so the raw key never appears in the file.
const fakeCrypto = {
  encryptionAvailable: true,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').toString('base64'), 'utf8'),
  decryptString: (buf) => Buffer.from(buf.toString('utf8'), 'base64').toString('utf8'),
};

function tempStore(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-creds-'));
  const filePath = path.join(dir, 'credentials.json');
  return { store: createCredentialStore({ filePath, ...fakeCrypto, ...extra }), filePath };
}

const RAW_KEY = 'AIzaSyFAKE-KEY-1234567890abcdef';

test('add + list returns metadata WITHOUT any secret', () => {
  const { store } = tempStore();
  const meta = store.add({ name: 'My project', projectLabel: 'proj-1', apiKey: RAW_KEY });
  assert.equal(meta.name, 'My project');
  assert.equal(meta.projectLabel, 'proj-1');
  assert.equal(meta.lastStatus, 'untested');
  const listed = store.list();
  assert.equal(listed.length, 1);
  assert.ok(!('secretEnc' in listed[0]));
  assert.ok(!JSON.stringify(listed).includes(RAW_KEY));
});

test('raw key never appears in the persisted file; getSecret round-trips', () => {
  const { store, filePath } = tempStore();
  const meta = store.add({ name: 'P', apiKey: RAW_KEY });
  const fileText = fs.readFileSync(filePath, 'utf8');
  assert.ok(!fileText.includes(RAW_KEY), 'file must not contain the raw key');
  assert.equal(store.getSecret(meta.id), RAW_KEY);
});

test('persists across instances', () => {
  const { store, filePath } = tempStore();
  store.add({ name: 'Persisted', apiKey: RAW_KEY });
  const again = createCredentialStore({ filePath, ...fakeCrypto });
  assert.equal(again.list().length, 1);
  assert.equal(again.getSecret(again.list()[0].id), RAW_KEY);
});

test('validation: name length, key length, whitespace in key', () => {
  const { store } = tempStore();
  assert.throws(() => store.add({ name: '', apiKey: RAW_KEY }), /name/i);
  assert.throws(() => store.add({ name: 'x'.repeat(61), apiKey: RAW_KEY }), /name/i);
  assert.throws(() => store.add({ name: 'ok', apiKey: 'short' }), /10/);
  assert.throws(() => store.add({ name: 'ok', apiKey: 'has space in key 12345' }), /whitespace/i);
  assert.throws(() => store.add({ name: 'ok', apiKey: 'x'.repeat(301) }), /300/);
});

test('refuses to store when encryption is unavailable', () => {
  const { store } = tempStore({ encryptionAvailable: false });
  assert.throws(() => store.add({ name: 'P', apiKey: RAW_KEY }), /Secure storage/i);
});

test('setDisabled, setStatus, remove, clear', () => {
  const { store } = tempStore();
  const a = store.add({ name: 'A', apiKey: RAW_KEY });
  const b = store.add({ name: 'B', apiKey: RAW_KEY + '2' });
  store.setDisabled(a.id, true);
  assert.equal(store.list().find((x) => x.id === a.id).disabled, true);
  store.setStatus(a.id, 'quota', 'quota');
  const meta = store.list().find((x) => x.id === a.id);
  assert.equal(meta.lastStatus, 'quota');
  assert.equal(meta.lastErrorKind, 'quota');
  assert.equal(store.remove(b.id), true);
  assert.equal(store.remove('nope'), false);
  assert.equal(store.list().length, 1);
  store.clear();
  assert.equal(store.list().length, 0);
});

test('getSecret for unknown id throws', () => {
  const { store } = tempStore();
  assert.throws(() => store.getSecret('missing'), /not found/i);
});
