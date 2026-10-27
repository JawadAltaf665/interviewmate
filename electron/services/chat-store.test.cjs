'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createChatStore, MAX_CHATS } = require('./chat-store.cjs');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'im-chats-')), 'chats.json');
}

test('chat store: saves newest first, updates in place, persists, removes', () => {
  const file = tmpFile();
  let t = 0;
  const store = createChatStore({ filePath: file, now: () => 1_700_000_000_000 + (t += 1000) });
  const a = store.save({ title: 'What should I improve?', messages: [{ role: 'user', text: 'hi' }], contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
  const b = store.save({ title: 'Plan', messages: [] });
  assert.deepEqual(store.list().map((c) => c.id), [b.id, a.id]);

  const updated = store.save({ ...a, title: 'Renamed', messages: [...a.messages, { role: 'coach', text: 'hello' }] });
  assert.equal(updated.createdAt, a.createdAt, 'createdAt is kept');
  assert.notEqual(updated.updatedAt, a.updatedAt);
  assert.deepEqual(store.list().map((c) => [c.id, c.count]), [[a.id, 2], [b.id, 0]]);

  const reopened = createChatStore({ filePath: file });
  assert.equal(reopened.get(a.id).title, 'Renamed');
  assert.equal(reopened.get(a.id).contents[0].parts[0].text, 'hi');
  assert.equal(reopened.get('nope'), null);
  assert.equal(reopened.remove(b.id), true);
  assert.equal(reopened.remove(b.id), false);
  reopened.clear();
  assert.equal(createChatStore({ filePath: file }).list().length, 0);
});

test('chat store: validates input, caps size and count', () => {
  const store = createChatStore({ filePath: tmpFile() });
  assert.throws(() => store.save(['x']), /must be an object/);
  assert.throws(() => store.save({ messages: 'x' }), /list of objects/);
  assert.throws(() => store.save({ contents: [1] }), /list of objects/);
  assert.throws(() => store.save({ id: 5 }), /id is invalid/);
  assert.throws(() => store.save({ messages: [{ text: 'x'.repeat(700_000) }] }), /too long/);
  assert.equal(store.save({ title: '  ' }).title, 'New chat');
  assert.equal(store.save({ title: 't'.repeat(300) }).title.length, 120);
  for (let i = 0; i < MAX_CHATS + 5; i++) store.save({ title: `c${i}` });
  assert.equal(store.list().length, MAX_CHATS);
  assert.equal(store.list()[0].title, `c${MAX_CHATS + 4}`);
});
