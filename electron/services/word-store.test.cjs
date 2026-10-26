'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWordStore } = require('./word-store.cjs');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'im-words-')), 'words.json');
}

test('word store: saves newest first, updates the same word, persists, removes', () => {
  const file = tmpFile();
  const store = createWordStore({ filePath: file });
  const a = store.save({ word: 'concise', meaning: 'short and clear' });
  store.save({ word: 'resilient', meaning: 'recovers quickly' });
  const again = store.save({ word: 'Concise', meaning: 'brief', urdu: 'مختصر' });
  assert.equal(again.id, a.id);
  assert.deepEqual(store.list().map((w) => w.word), ['Concise', 'resilient']);

  const reopened = createWordStore({ filePath: file });
  assert.equal(reopened.list()[0].urdu, 'مختصر');
  assert.equal(reopened.remove(a.id), true);
  assert.equal(reopened.remove('nope'), false);
  assert.deepEqual(reopened.list().map((w) => w.word), ['resilient']);
  reopened.clear();
  assert.equal(createWordStore({ filePath: file }).list().length, 0);
});

test('word store: rejects bad input and trims long fields', () => {
  const store = createWordStore({ filePath: tmpFile() });
  assert.throws(() => store.save({ word: '  ' }), /needs some text/);
  assert.throws(() => store.save({ word: 'x', meaning: 5 }), /must be a string/);
  assert.throws(() => store.save(['x']), /must be an object/);
  assert.equal(store.save({ word: 'w', meaning: 'm'.repeat(1000) }).meaning.length, 400);
});
