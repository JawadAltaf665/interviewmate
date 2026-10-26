// InterviewMate — secure credential store (main process only).
//
// Secrets are encrypted with an injected encrypt/decrypt pair — in the app
// that is Electron safeStorage (OS-backed). Tests inject a fake pair with the
// same contract:
//   encryptString(plainText)  -> Buffer   (like safeStorage.encryptString)
//   decryptString(buffer)     -> string   (like safeStorage.decryptString)
//
// The encrypted bytes are base64-encoded into `secretEnc` in a JSON file.
// list() NEVER returns secrets. Secrets are never logged anywhere.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createCredentialStore({ filePath, encryptString, decryptString, encryptionAvailable } = {}) {
  if (!filePath) throw new Error('credential store: filePath is required');
  let entries = null; // lazy-loaded

  function load() {
    if (entries) return entries;
    entries = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.entries)) entries = parsed.entries;
    } catch { /* missing or corrupt file -> start empty */ }
    return entries;
  }

  function persist() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2), 'utf8');
    fs.renameSync(tmp, filePath); // atomic replace
  }

  function toMeta(e) {
    return {
      id: e.id, name: e.name, projectLabel: e.projectLabel || '',
      disabled: !!e.disabled, createdAt: e.createdAt,
      lastStatus: e.lastStatus || 'untested', lastErrorKind: e.lastErrorKind || null,
    };
  }

  function find(id) {
    const e = load().find((x) => x.id === id);
    if (!e) throw new Error('Credential not found.');
    return e;
  }

  return {
    /** Metadata for every credential — safe to send to the renderer. */
    list() { return load().map(toMeta); },

    add({ name, projectLabel, apiKey } = {}) {
      if (encryptionAvailable === false || typeof encryptString !== 'function') {
        throw new Error('Secure storage is not available on this system, so API keys cannot be stored safely.');
      }
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (cleanName.length < 1 || cleanName.length > 60) {
        throw new Error('Credential name must be 1–60 characters.');
      }
      if (projectLabel !== undefined && projectLabel !== null) {
        if (typeof projectLabel !== 'string' || projectLabel.length > 100) {
          throw new Error('Project label must be a string of at most 100 characters.');
        }
      }
      if (typeof apiKey !== 'string' || apiKey.length < 10 || apiKey.length > 300) {
        throw new Error('API key must be 10–300 characters.');
      }
      if (/\s/.test(apiKey)) throw new Error('API key must not contain whitespace.');

      const enc = encryptString(apiKey);
      const secretEnc = Buffer.isBuffer(enc) ? enc.toString('base64') : String(enc);
      const entry = {
        id: crypto.randomUUID(),
        name: cleanName,
        projectLabel: (projectLabel || '').trim(),
        disabled: false,
        createdAt: new Date().toISOString(),
        lastStatus: 'untested',
        lastErrorKind: null,
        secretEnc,
      };
      load().push(entry);
      persist();
      return toMeta(entry);
    },

    /** Main-process internal use only. Never expose over IPC. */
    getSecret(id) {
      if (typeof decryptString !== 'function') throw new Error('Secure storage is not available.');
      const e = find(id);
      return decryptString(Buffer.from(e.secretEnc, 'base64'));
    },

    remove(id) {
      const list = load();
      const idx = list.findIndex((x) => x.id === id);
      if (idx === -1) return false;
      list.splice(idx, 1);
      persist();
      return true;
    },

    setDisabled(id, disabled) {
      const e = find(id);
      e.disabled = !!disabled;
      persist();
      return toMeta(e);
    },

    setStatus(id, status, kind) {
      const e = find(id);
      e.lastStatus = String(status || 'unknown');
      e.lastErrorKind = kind || null;
      persist();
      return toMeta(e);
    },

    clear() {
      entries = [];
      persist();
    },
  };
}

module.exports = { createCredentialStore };
