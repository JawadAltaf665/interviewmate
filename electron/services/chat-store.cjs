// InterviewMate — Coach chat conversations (JSON file in userData).
// Each chat keeps what the page shows (`messages`) and the Gemini history it
// continues from (`contents`). Newest first, max 50 chats; the oldest drop off.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_CHATS = 50;
const MAX_CHAT_CHARS = 600_000;
const MAX_ITEMS = 400;

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function objectList(v, label) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_ITEMS || !v.every(isObject)) throw new Error(`${label} must be a list of objects.`);
  return v;
}

function clean(input, nowIso) {
  if (!isObject(input)) throw new Error('Chat must be an object.');
  if (input.id !== undefined && (typeof input.id !== 'string' || !input.id || input.id.length > 100)) throw new Error('Chat id is invalid.');
  const chat = {
    id: input.id || `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: String(input.title || 'New chat').trim().slice(0, 120) || 'New chat',
    createdAt: typeof input.createdAt === 'string' ? input.createdAt.slice(0, 40) : nowIso,
    updatedAt: nowIso,
    messages: objectList(input.messages, 'messages'),
    contents: objectList(input.contents, 'contents'),
  };
  if (JSON.stringify(chat).length > MAX_CHAT_CHARS) throw new Error('This chat is too long to save. Start a new chat.');
  return chat;
}

function createChatStore({ filePath, now } = {}) {
  if (!filePath) throw new Error('chat store: filePath is required');
  const nowIso = () => new Date(now ? now() : Date.now()).toISOString();
  let chats = null;

  function load() {
    if (chats) return chats;
    chats = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.chats)) chats = parsed.chats.filter(isObject);
    } catch { /* missing or corrupt -> empty */ }
    return chats;
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, chats }, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  return {
    /** Summaries only (newest first); the page loads a chat when it is opened. */
    list() {
      return load().map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, count: (c.messages || []).length }));
    },

    get(id) {
      const chat = load().find((c) => c.id === id);
      return chat ? JSON.parse(JSON.stringify(chat)) : null;
    },

    save(input) {
      if (!isObject(input)) throw new Error('Chat must be an object.');
      const old = typeof input.id === 'string' ? load().find((c) => c.id === input.id) : null;
      const chat = clean({ ...input, createdAt: old ? old.createdAt : input.createdAt }, nowIso());
      chats = [chat, ...load().filter((c) => c.id !== chat.id)].slice(0, MAX_CHATS);
      persist();
      return chat;
    },

    remove(id) {
      const list = load();
      const next = list.filter((c) => c.id !== id);
      if (next.length === list.length) return false;
      chats = next;
      persist();
      return true;
    },

    clear() {
      chats = [];
      persist();
    },
  };
}

module.exports = { createChatStore, MAX_CHATS };
