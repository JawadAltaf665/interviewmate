'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classifyError, isTransient } = require('./errors.cjs');

test('401 -> auth', () => {
  const c = classifyError(401, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'UNAUTHENTICATED' } });
  assert.equal(c.kind, 'auth');
  assert.equal(c.status, 401);
});

test('403 -> permission, 403 with billing text -> billing', () => {
  assert.equal(classifyError(403, { error: { message: 'Permission denied on resource project.' } }).kind, 'permission');
  assert.equal(classifyError(403, 'Cloud billing account is not enabled for this project').kind, 'billing');
});

test('429 with quota text -> quota, plain 429 -> rate_limit', () => {
  assert.equal(classifyError(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for quota metric' } }).kind, 'quota');
  assert.equal(classifyError(429, { error: { message: 'Too many requests' } }).kind, 'rate_limit');
  // Google's real 429 text mentions "plan and billing" — still a quota error.
  assert.equal(classifyError(429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.' } }).kind, 'quota');
});

test('500/503 -> server, 0/null -> network, 404 -> unavailable_model', () => {
  assert.equal(classifyError(500, 'Internal error').kind, 'server');
  assert.equal(classifyError(503, '').kind, 'server');
  assert.equal(classifyError(0, '').kind, 'network');
  assert.equal(classifyError(null, '').kind, 'network');
  assert.equal(classifyError(404, { error: { message: 'Model gemini-x is not found' } }).kind, 'unavailable_model');
});

test('accepts a JSON string body', () => {
  const c = classifyError(401, JSON.stringify({ error: { message: 'API key not valid' } }));
  assert.equal(c.kind, 'auth');
  assert.match(c.message, /API key not valid/);
});

test('isTransient: server/network/rate only (not quota/auth)', () => {
  assert.equal(isTransient('server'), true);
  assert.equal(isTransient('network'), true);
  assert.equal(isTransient('rate_limit'), true);
  assert.equal(isTransient('quota'), false);
  assert.equal(isTransient('auth'), false);
  assert.equal(isTransient('permission'), false);
  assert.equal(isTransient(500), true);
  assert.equal(isTransient(429), true);
  assert.equal(isTransient(401), false);
  assert.equal(isTransient({ kind: 'server' }), true);
});
