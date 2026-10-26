// InterviewMate — Gemini / HTTP error classification.
//
// Google returns errors in a few shapes, e.g.:
//   { "error": { "code": 429, "message": "...", "status": "RESOURCE_EXHAUSTED" } }
// This module turns (HTTP status, body) into one small, predictable kind so the
// rest of the app can decide: retry, fail over to another credential, or stop.
// Kinds: auth, permission, quota, rate_limit, billing, server, network,
//        unavailable_model, unknown
'use strict';

/** Pull a human message and a Google status string out of any body shape. */
function parseBody(body) {
  let obj = body;
  if (typeof body === 'string') {
    try { obj = JSON.parse(body); } catch { return { message: body.slice(0, 300), googleStatus: '' }; }
  }
  if (!obj || typeof obj !== 'object') return { message: '', googleStatus: '' };
  const err = obj.error && typeof obj.error === 'object' ? obj.error : obj;
  return {
    message: String(err.message || obj.message || '').slice(0, 300),
    googleStatus: String(err.status || '').toUpperCase(),
  };
}

/**
 * classifyError(status, bodyTextOrObj)
 * status: HTTP status number (0 / null / undefined means the request never
 *         completed — a network failure).
 * Returns { kind, status, message }.
 */
function classifyError(status, body) {
  const code = Number(status) || 0;
  const { message, googleStatus } = parseBody(body);
  const text = `${message} ${googleStatus}`.toLowerCase();
  let kind;

  if (code === 0) {
    kind = 'network';
  } else if (code !== 429 && text.includes('billing') && (text.includes('not enabled') || text.includes('account') || text.includes('payment') || text.includes('plan'))) {
    kind = 'billing';
  } else if (code === 401 || text.includes('api key not valid') || text.includes('invalid api key') || text.includes('unauthenticated') || googleStatus === 'UNAUTHENTICATED') {
    kind = 'auth';
  } else if (code === 429) {
    // Google uses RESOURCE_EXHAUSTED for quota exhaustion; a plain burst of
    // requests is a rate limit instead. Both stop this credential for now,
    // but they are reported differently to the user.
    kind = (text.includes('quota') || text.includes('resource_exhausted') || text.includes('free tier'))
      ? 'quota'
      : 'rate_limit';
  } else if (code === 404 || text.includes('not found') && text.includes('model')) {
    kind = 'unavailable_model';
  } else if (code === 403 || googleStatus === 'PERMISSION_DENIED' || text.includes('permission')) {
    // A 403 about billing reads as a billing problem, not a key problem.
    kind = text.includes('billing') ? 'billing' : 'permission';
  } else if (code === 402) {
    kind = 'billing';
  } else if (code >= 500) {
    kind = 'server';
  } else if (code === 408 || code === 425) {
    kind = 'rate_limit';
  } else {
    kind = 'unknown';
  }
  return { kind, status: code, message: message || defaultMessage(kind, code) };
}

function defaultMessage(kind, status) {
  const byKind = {
    auth: 'The API key was rejected. Check the key and try again.',
    permission: 'This Google project does not have permission for that request.',
    quota: 'Free quota for this project is exhausted. Try again after the quota resets.',
    rate_limit: 'Too many requests right now. Wait a moment and try again.',
    billing: 'This project has a billing problem. InterviewMate never enables billing automatically.',
    server: 'Google returned a server error. Try again in a moment.',
    network: 'No connection to Google. Check your internet connection.',
    unavailable_model: 'That model is not available for this project.',
    unknown: `Unexpected error (HTTP ${status || 'no response'}).`,
  };
  return byKind[kind] || byKind.unknown;
}

/**
 * isTransient(kindOrStatus) — true when retrying the SAME request shortly
 * could succeed: server errors, network drops, and burst rate limits.
 * Quota/auth/permission/billing are NOT transient: retrying the same
 * credential would fail the same way (quota moves to the next credential).
 * Accepts a kind string, an HTTP status number, or a {kind}/{status} object.
 */
function isTransient(input) {
  if (input && typeof input === 'object') {
    if (typeof input.kind === 'string') return isTransient(input.kind);
    if (typeof input.status === 'number') return isTransient(input.status);
    return false;
  }
  if (typeof input === 'number') {
    return input === 408 || input === 425 || input === 429 || input >= 500;
  }
  return input === 'server' || input === 'network' || input === 'rate_limit';
}

module.exports = { classifyError, isTransient, parseBody, defaultMessage };
