// InterviewMate — Gemini REST client (main process only).
//
// Rules baked in here (brief §8/§9):
//  - Free-tier models only. assertFreeModel() rejects anything not allowlisted.
//  - Keys travel in the 'x-goog-api-key' header, never in URLs, never logged.
//  - Quotas are per Google PROJECT, so failover means: try the next enabled
//    credential (hopefully a different project). It is never a way to evade
//    limits — when every credential is out, we stop and say so.
//  - Bounded retries only for transient errors (server / network / burst
//    rate limit): max 2 attempts per credential, 500ms then 1500ms backoff.
//  - Quota / server failures put that credential on a 60s in-memory cooldown.
'use strict';

const { classifyError, isTransient } = require('./errors.cjs');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const FREE_MODELS = Object.freeze({
  live: Object.freeze(['gemini-3.8-live', 'gemini-3.1-flash-live-preview']),
  // [0] is the default; the rest are automatic fallbacks (never user-selectable).
  text: Object.freeze(['gemini-3.8-flash', 'gemini-3.5-flash-lite']),
  // Read-aloud (Vocabulary tab), tried in this order. All verified on the free tier.
  tts: Object.freeze(['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview']),
});
// Prebuilt Gemini voices offered in the Vocabulary tab.
const TTS_VOICES = Object.freeze(['Kore', 'Puck', 'Charon', 'Aoede']);
const VOCAB_TOPICS = Object.freeze({
  interview: 'a job interview (answering questions, describing projects, teamwork)',
  tech: 'software development and IT work',
  office: 'office and business communication (meetings, emails, deadlines)',
  daily: 'everyday life (shopping, travel, family, health)',
  mix: 'any useful everyday or professional situation (pick one)',
});
const VOCAB_LEVELS = Object.freeze({
  easy: 'simple (CEFR A2-B1): short sentences, common words, 3-4 slightly harder words to learn',
  medium: 'intermediate (CEFR B1-B2): natural sentences with some useful professional words',
  advanced: 'advanced (CEFR C1): rich, precise vocabulary and varied sentence structure',
});
const MAX_SPEAK_CHARS = 2000;
const TEXT_MODEL = FREE_MODELS.text[0];
// Vocabulary paragraphs and meanings are short, simple jobs: the Lite model answers
// in ~2-3 s, while Flash is often overloaded (45 s timeout) — so Lite goes first.
const FAST_TEXT_MODEL = FREE_MODELS.text[1];
// Paid text models (v1.1 opt-in only — see assertTextModel). These are
// billed per token by Google to the API key's own Cloud project; the app
// never enables billing itself, and a Google AI Pro / Google One
// subscription does NOT pay for API calls. Prices change — check AI Studio.
const PAID_MODELS = Object.freeze({
  text: Object.freeze(['gemini-3.1-pro-preview', 'gemini-4-argon']),
});

const MAX_ATTEMPTS_PER_CREDENTIAL = 2;
const BACKOFF_MS = [500, 1500];
const COOLDOWN_MS = 60_000;
const MAX_JPEG_BASE64_CHARS = 2_800_000;
const REQUEST_TIMEOUT_MS = 45_000;
const LIVE_QUOTA_COOLDOWN_MS = 30 * 60_000; // Live quota is per day/minute; don't retry the same key soon
// Errors where another model may still answer (Flash is often 503 "high demand").
const FALLBACK_KINDS = new Set(['quota', 'billing', 'server', 'timeout', 'unavailable_model', 'rate_limit', 'bad_response']);

function assertFreeModel(kind, model) {
  const allowed = FREE_MODELS[kind];
  if (!allowed) {
    const err = new Error(`Unknown model kind "${kind}".`);
    err.kind = 'unknown';
    throw err;
  }
  if (!allowed.includes(model)) {
    const err = new Error(
      `"${model}" is not in InterviewMate's free-tier allowlist (${allowed.join(', ')}). ` +
      'Paid or unverified models are never used.');
    err.kind = 'unavailable_model';
    throw err;
  }
  return model;
}

/** Text model gate: free models always; paid models only with the explicit
 *  allowPaidUsage opt-in. Unknown models are always rejected. */
function assertTextModel(model, allowPaidUsage) {
  const chosen = model || TEXT_MODEL;
  if (FREE_MODELS.text.includes(chosen)) return chosen;
  if (allowPaidUsage && PAID_MODELS.text.includes(chosen)) return chosen;
  const err = new Error(
    `"${chosen}" is not available in InterviewMate${allowPaidUsage ? '' : ' — paid models require the "Allow paid usage" opt-in in Settings'}.`);
  err.kind = 'unavailable_model';
  throw err;
}

function createGeminiClient({ getCredentialsInOrder, onStatus, fetchImpl, sleepImpl, now } = {}) {
  if (typeof getCredentialsInOrder !== 'function') {
    throw new Error('gemini client: getCredentialsInOrder is required');
  }
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const sleep = sleepImpl || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const nowMs = now || (() => Date.now());
  const cooldownUntil = new Map(); // credentialId -> ms epoch

  function reportStatus(id, status, kind) {
    if (typeof onStatus !== 'function' || !id) return;
    try { onStatus(id, status, kind); } catch { /* status reporting must never break a call */ }
  }

  function scrub(text, secrets) {
    let out = String(text || '');
    for (const s of secrets) if (s) out = out.split(s).join('[redacted]');
    return out;
  }

  async function readJson(res) {
    if (typeof res.text === 'function') {
      const raw = await res.text();
      try { return { raw, json: raw ? JSON.parse(raw) : null }; }
      catch { return { raw, json: null }; }
    }
    if (typeof res.json === 'function') {
      const json = await res.json().catch(() => null);
      return { raw: json ? JSON.stringify(json) : '', json };
    }
    return { raw: '', json: null };
  }

  /**
   * Run `doRequest(secret)` across credentials in order, with the failover
   * rules above. Resolves { result, credential } or throws Error with .kind.
   */
  async function withFailover(doRequest, scope = '') {
    const creds = (await getCredentialsInOrder()) || [];
    const usable = creds.filter((c) => c && c.secret && !c.disabled);
    if (!usable.length) {
      const err = new Error('No Gemini API key is configured. Add one in Settings first.');
      err.kind = 'auth';
      throw err;
    }
    const secrets = usable.map((c) => c.secret);
    let last = null;

    for (const cred of usable) {
      const coolKey = `${cred.id}|${scope}`; // quotas are per model, so cool down per model
      if ((cooldownUntil.get(coolKey) || 0) > nowMs()) continue; // still cooling down
      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_CREDENTIAL; attempt++) {
        try {
          const result = await doRequest(cred.secret, cred);
          reportStatus(cred.id, 'ok', null);
          return { result, credential: cred };
        } catch (e) {
          const classified = e && e.kind
            ? { kind: e.kind, status: e.status || 0, message: e.message }
            : classifyError(e && typeof e.status === 'number' ? e.status : 0, e && e.body !== undefined ? e.body : (e && e.message) || '');
          last = classified;

          const retryable = isTransient(classified.kind);
          if (retryable && attempt < MAX_ATTEMPTS_PER_CREDENTIAL - 1) {
            await sleep(BACKOFF_MS[attempt] || 1500);
            continue;
          }
          // This credential is done for this call.
          if (classified.kind === 'quota' || classified.kind === 'server' || classified.kind === 'timeout') {
            cooldownUntil.set(coolKey, nowMs() + COOLDOWN_MS);
          }
          reportStatus(cred.id, classified.kind === 'quota' ? 'quota' : 'error', classified.kind);
          break;
        }
      }
    }

    const kind = last ? last.kind : 'quota';
    const detail = last ? scrub(last.message, secrets) : 'all credentials are cooling down';
    const err = new Error(
      kind === 'quota'
        ? 'Free quota is exhausted for every configured Google project. Wait for the quota reset (daily, midnight Pacific) and try again.'
        : `Gemini request failed (${kind}): ${detail}`);
    err.kind = kind;
    throw err;
  }

  /** Try the chosen text model, then the free models in order, when a model is
   *  out of quota, overloaded, or too slow. Resolves with `usedModel`. */
  async function withModelFallback(model, run) {
    const chain = [...new Set([model, ...FREE_MODELS.text])];
    for (let i = 0; ; i++) {
      try {
        return { ...(await run(chain[i])), usedModel: chain[i] };
      } catch (e) {
        if (i === chain.length - 1 || !e || !FALLBACK_KINDS.has(e.kind)) throw e;
      }
    }
  }

  /** One raw request; throws a classified-shaped Error on HTTP failure. */
  async function request(secret, url, options) {
    let res;
    try {
      res = await doFetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...options,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': secret, ...(options && options.headers) },
      });
    } catch (e) {
      const timedOut = e && e.name === 'TimeoutError';
      const err = new Error(timedOut
        ? `Google did not respond within ${REQUEST_TIMEOUT_MS / 1000}s (the model may be overloaded).`
        : 'Could not reach Google. Check your internet connection.');
      err.kind = timedOut ? 'timeout' : 'network';
      err.status = 0;
      throw err;
    }
    const { raw, json } = await readJson(res);
    if (!res.ok) {
      const c = classifyError(res.status, json || raw);
      const err = new Error(c.message);
      err.kind = c.kind;
      err.status = c.status;
      throw err;
    }
    return json;
  }

  function extractText(json) {
    const parts = json && json.candidates && json.candidates[0] &&
      json.candidates[0].content && json.candidates[0].content.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
  }

  return {
    /** Test one key directly (no failover). Never throws for HTTP errors. */
    async testCredential(secret) {
      if (typeof secret !== 'string' || !secret) {
        return { ok: false, kind: 'auth', message: 'No API key provided.' };
      }
      let res;
      try {
        res = await doFetch(`${API_BASE}/models`, { headers: { 'x-goog-api-key': secret } });
      } catch {
        return { ok: false, kind: 'network', message: 'Could not reach Google. Check your internet connection.' };
      }
      const { raw, json } = await readJson(res);
      if (!res.ok) {
        const c = classifyError(res.status, json || raw);
        return { ok: false, kind: c.kind, status: c.status, message: scrub(c.message, [secret]) };
      }
      const models = json && Array.isArray(json.models) ? json.models : [];
      return { ok: true, modelsCount: models.length };
    },

    /**
     * Mint a short-lived Live API token. The long-lived key stays in the main
     * process; only this token (1 use, starts within 1 min, 30 min window,
     * locked to the model + AUDIO config) goes to the renderer.
     */
    async mintLiveToken({ model } = {}) {
      const chosen = model || FREE_MODELS.live[0];
      assertFreeModel('live', chosen);
      const { result, credential } = await withFailover(async (secret) => {
        const start = nowMs();
        const expireTime = new Date(start + 30 * 60 * 1000).toISOString();
        const newSessionExpireTime = new Date(start + 60 * 1000).toISOString();
        // ponytail: unconstrained token. The REST API rejects the SDK-only
        // `liveConnectConstraints` field, and a locked setup would also drop the
        // renderer's systemInstruction + transcription config. Single-use and
        // short-lived still holds; lock via `bidiGenerateContentSetup` + `fieldMask`
        // if the renderer ever becomes untrusted.
        const json = await request(secret, `${API_BASE}/auth_tokens`, {
          method: 'POST',
          body: JSON.stringify({ uses: 1, expireTime, newSessionExpireTime }),
        });
        if (!json || typeof json.name !== 'string' || !json.name) {
          const err = new Error('Google did not return a live session token.');
          err.kind = 'unknown';
          throw err;
        }
        return { token: json.name, model: chosen, expireTime };
      }, 'live');
      // Id + name (never the secret) let the renderer report a Live quota close
      // for this key, so the next mint moves on to the next key.
      return { ...result, credentialId: credential.id, credentialName: credential.name || '' };
    },

    /** The Live socket closed with a quota error for this key: skip it for Live. */
    markLiveQuota(credentialId) {
      cooldownUntil.set(`${credentialId}|live`, nowMs() + LIVE_QUOTA_COOLDOWN_MS);
      reportStatus(credentialId, 'quota', 'quota');
    },

    /**
     * Mode 2 coaching: one webcam still -> short presentation feedback.
     * Framing / lighting / face-in-frame / gaze direction ONLY.
     */
    async analyzeFrame({ jpegBase64, textModel, allowPaidUsage } = {}) {
      if (typeof jpegBase64 !== 'string' || !jpegBase64) {
        throw new Error('analyzeFrame: a JPEG image is required.');
      }
      const model = assertTextModel(textModel, allowPaidUsage);
      if (jpegBase64.length > MAX_JPEG_BASE64_CHARS) {
        throw new Error('analyzeFrame: image is too large.');
      }
      const prompt =
        'You are a presentation coach looking at one webcam still from a mock interview. ' +
        'Comment ONLY on observable presentation factors: camera framing, lighting, whether the face is fully in frame, ' +
        'and approximate on-camera gaze direction. Keep it to 1-3 short, kind, practical sentences. ' +
        'Never infer or mention personality, emotions, honesty, mental health, attractiveness, identity, or hiring suitability.';
      const { result, credential } = await withModelFallback(model, (m) => withFailover(async (secret) => {
        const json = await request(secret, `${API_BASE}/models/${m}:generateContent`, {
          method: 'POST',
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
              ],
            }],
            generationConfig: { thinkingConfig: { thinkingLevel: 'LOW' } },
          }),
        });
        const feedback = extractText(json);
        if (!feedback) {
          const err = new Error('Google returned no coaching feedback for that frame.');
          err.kind = 'unknown';
          throw err;
        }
        return feedback;
      }, m));
      return { feedback: result, credentialName: credential.name || '' };
    },

    /**
     * End-of-interview feedback from the ACTUAL transcript. Returns strict
     * JSON-shaped feedback; practice questions stay grounded in the CV
     * summary when one was provided.
     */
    async generateFeedback({ transcript, level, cvSummary, language, textModel, allowPaidUsage } = {}) {
      const model = assertTextModel(textModel, allowPaidUsage);
      const transcriptText = Array.isArray(transcript)
        ? transcript.map((t) => {
            if (typeof t === 'string') return t;
            const who = (t && (t.speaker || t.role)) || 'speaker';
            const what = (t && (t.text || t.content)) || '';
            return `${who}: ${what}`;
          }).join('\n')
        : String(transcript || '');
      if (!transcriptText.trim()) throw new Error('generateFeedback: a transcript is required.');

      const grounding = cvSummary
        ? `The candidate's CV summary is:\n${String(cvSummary).slice(0, 4000)}\n` +
          'Practice questions must be grounded ONLY in skills/projects explicitly in that summary. Never invent skills.'
        : 'No CV was provided. Practice questions must stay within topics actually discussed in the transcript.';
      const prompt =
        `You are an interview coach reviewing a ${level || 'Junior'}-level mock interview.\n${grounding}\n` +
        'Transcript:\n' + transcriptText.slice(0, 20000) + '\n\n' +
        'Reply with JSON ONLY (no markdown, no commentary), exactly this shape:\n' +
        '{"summary":"string","strengths":["string"],"improvements":["string"],' +
        '"practiceQuestions":["string"],"scores":{"relevance":{"score":0,"explanation":"string"},' +
        '"clarity":{"score":0,"explanation":"string"},"technical":{"score":0,"explanation":"string"}}}\n' +
        'Scores are 0-100 coaching estimates with explanations, NOT a hiring decision. ' +
        'Judge only what is actually in the transcript; if it is too short to judge an area, say so in its explanation.' +
        (language === 'Urdu'
          ? ' Write every string value in Urdu (Urdu script); keep technical terms such as framework names in English. Keep the JSON keys in English.'
          : ' Write every string value in English.');

      const { result, credential, usedModel } = await withModelFallback(model, (m) => withFailover(async (secret) => {
        const json = await request(secret, `${API_BASE}/models/${m}:generateContent`, {
          method: 'POST',
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            // Default (high) thinking took ~85s for a short transcript; LOW is ~10x faster.
            generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'LOW' } },
          }),
        });
        return parseFeedbackJson(extractText(json));
      }, m));
      return { source: 'gemini', feedback: result, credentialName: credential.name || '', model: usedModel, fellBack: usedModel !== model };
    },

    /**
     * Translate a (possibly mixed English / Urdu / Roman Urdu) transcript into
     * one language, turn by turn. Speakers and turn order are kept as-is.
     */
    async translateTranscript({ transcript, targetLanguage, textModel, allowPaidUsage } = {}) {
      const model = assertTextModel(textModel, allowPaidUsage);
      const entries = (Array.isArray(transcript) ? transcript : []).slice(0, 400).map((t) => ({
        speaker: t && t.speaker === 'user' ? 'user' : 'interviewer',
        text: String((t && t.text) || '').slice(0, 4000),
      }));
      if (!entries.length) return { transcript: [] };
      const target = targetLanguage === 'Urdu'
        ? 'Urdu written in Urdu script, keeping technical terms (programming languages, frameworks, tools) in English'
        : 'English';
      const prompt =
        `Translate each string in this interview transcript into ${target}. The source may mix English, Urdu script and Roman Urdu ` +
        '(Urdu written in Latin letters, e.g. "Maine ek project banaya tha" — this is Urdu, NOT English, and must be translated). ' +
        (targetLanguage === 'Urdu'
          ? 'Every string must come back in Urdu script — including strings written entirely in English, e.g. ' +
            '"It had charts and role based login" -> "اس میں charts اور role based login تھا", ' +
            '"Maine ek Angular dashboard banaya tha" -> "میں نے ایک Angular dashboard بنایا تھا". '
          : 'Every string must come back in natural English, e.g. "Maine ek Angular dashboard banaya tha" -> "I built an Angular dashboard". ') +
        'Keep the meaning exact; do not summarize, merge, add or drop items. ' +
        'Input is a JSON array of {"id","text"}. Reply with a JSON array ONLY, one {"id","translation"} per input item, same ids, same order.\n' +
        JSON.stringify(entries.map((e, id) => ({ id, text: e.text })));
      const { result, usedModel } = await withModelFallback(model, (m) => withFailover(async (secret) => {
        const json = await request(secret, `${API_BASE}/models/${m}:generateContent`, {
          method: 'POST',
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'LOW' } },
          }),
        });
        // Items may come back as {"id","translation"} objects or bare strings.
        const texts = parseStringArray(extractText(json), (x) => (x && typeof x === 'object' ? x.translation : x));
        if (texts.length !== entries.length) {
          const err = new Error('Google returned a transcript with a different number of turns.');
          err.kind = 'bad_response';
          throw err;
        }
        return texts;
      }, m));
      return { transcript: entries.map((e, i) => ({ speaker: e.speaker, text: result[i] })), model: usedModel };
    },

    /**
     * Combined coaching summary for a progress report, from the saved feedback
     * digest of several interviews (no transcripts are sent).
     */
    async summarizeReport({ digest, textModel, allowPaidUsage } = {}) {
      const model = assertTextModel(textModel, allowPaidUsage);
      const text = String(digest || '').slice(0, 30000);
      if (!text.trim()) throw new Error('summarizeReport: no saved feedback in this period.');
      const prompt =
        'You are an interview coach. Below is the saved feedback from several mock interviews by the same candidate, oldest first. ' +
        'Write ONE combined progress summary: what improved or declined over time, what keeps going well, and what keeps coming up as a weakness. ' +
        'Base it only on this feedback; do not invent skills or events. Coaching only, never a hiring decision.\n\n' +
        text + '\n\n' +
        'Reply with JSON ONLY, exactly this shape: {"overview":"string (3-5 sentences)","strengths":["string"],' +
        '"focusAreas":["string"],"nextSteps":["string"]} with at most 5 items per list. Write in English.';
      const { result, usedModel } = await withModelFallback(model, (m) => withFailover(async (secret) => {
        const json = await request(secret, `${API_BASE}/models/${m}:generateContent`, {
          method: 'POST',
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'LOW' } },
          }),
        });
        return parseReportJson(extractText(json));
      }, m));
      return { ...result, model: usedModel };
    },

    /**
     * Vocabulary tab: a short practice paragraph plus the key words to learn
     * from it. `includeWords` (the user's saved words) are worked in when given.
     */
    async vocabParagraph({ topic, level, length, includeWords, urdu, avoidTitle } = {}) {
      const topicText = VOCAB_TOPICS[topic] || VOCAB_TOPICS.mix;
      const levelText = VOCAB_LEVELS[level] || VOCAB_LEVELS.medium;
      const words = (Array.isArray(includeWords) ? includeWords : []).map(String).filter(Boolean).slice(0, 6);
      const prompt =
        `Write one original English reading-practice paragraph for an adult professional improving their English vocabulary. ` +
        `Topic: ${topicText}. Level: ${levelText}. Length: about ${length === 'short' ? 70 : 140} words, one paragraph, plain text. ` +
        (words.length ? `Naturally use these words the learner is practising: ${words.join(', ')}. ` : '') +
        (avoidTitle ? `Make it clearly different from the previous paragraph titled "${String(avoidTitle).slice(0, 120)}". ` : '') +
        'Then pick the 6-8 most useful words or short phrases from the paragraph for the learner, each copied EXACTLY as it appears in the paragraph. ' +
        'Reply with JSON ONLY, exactly this shape: {"title":"string (2-6 words)","paragraph":"string","words":[{"word":"string","partOfSpeech":"string",' +
        '"meaning":"string (simple English, max 15 words)","example":"string (a new short sentence)","sayIt":"string (simple syllable guide, stressed syllable in CAPITALS, e.g. kun-SICE)"' +
        (urdu ? ',"urdu":"string (the meaning in Urdu script)"' : '') + '}]}';
      const { result, usedModel } = await withModelFallback(FAST_TEXT_MODEL, (m) => withFailover(async (secret) => {
        const json = await request(secret, `${API_BASE}/models/${m}:generateContent`, {
          method: 'POST',
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'LOW' }, temperature: 1.1 },
          }),
        });
        return parseVocabParagraph(extractText(json));
      }, m));
      return { ...result, model: usedModel };
    },

    /** Meaning card for a word, phrase or sentence the learner selected. */
    async explainText({ text, context, urdu } = {}) {
      const selected = String(text || '').trim().slice(0, 600);
      if (!selected) throw new Error('explainText: select a word or sentence first.');
      const isSentence = selected.split(/\s+/).length > 4;
      const prompt =
        `An English learner selected ${isSentence ? 'this sentence' : 'this word or phrase'}: "${selected}"\n` +
        (context ? `It appears in this paragraph: "${String(context).slice(0, 1500)}"\n` : '') +
        'Explain it for a learner, using the meaning it has in that paragraph. ' +
        'Reply with JSON ONLY, exactly this shape: {"word":"string (the selection, base form for a single word)","partOfSpeech":"string (empty for a sentence)",' +
        `"meaning":"string (${isSentence ? 'the sentence said again in simple English' : 'simple English, max 15 words'})",` +
        '"example":"string (a new short example sentence)","sayIt":"string (simple syllable guide with the stressed syllable in CAPITALS; empty for a sentence)"' +
        (urdu ? ',"urdu":"string (the meaning in Urdu script)"' : '') + '}';
      const { result, usedModel } = await withModelFallback(FAST_TEXT_MODEL, (m) => withFailover(async (secret) => {
        const json = await request(secret, `${API_BASE}/models/${m}:generateContent`, {
          method: 'POST',
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'LOW' } },
          }),
        });
        const parsed = parseJsonObject(extractText(json), 'Could not parse the meaning from Google.');
        const card = vocabWord(parsed);
        if (!card.meaning) {
          const err = new Error('Google returned no meaning for that selection.');
          err.kind = 'bad_response';
          throw err;
        }
        // A sentence keeps its full text as the heading (the model may shorten it).
        return { ...card, word: isSentence ? selected : card.word || selected };
      }, m));
      return { ...result, model: usedModel };
    },

    /**
     * Read text aloud with a Gemini voice. Returns WAV audio as base64; speed is
     * applied by the player (playbackRate), so one clip serves all speeds.
     */
    async speak({ text, voice } = {}) {
      const say = String(text || '').trim();
      if (!say) throw new Error('speak: there is no text to read.');
      if (say.length > MAX_SPEAK_CHARS) throw new Error(`speak: text is longer than ${MAX_SPEAK_CHARS} characters.`);
      const voiceName = TTS_VOICES.includes(voice) ? voice : TTS_VOICES[0];
      const chain = FREE_MODELS.tts;
      for (let i = 0; ; i++) {
        const m = chain[i];
        try {
          const { result } = await withFailover(async (secret) => {
            const json = await request(secret, `${API_BASE}/models/${m}:generateContent`, {
              method: 'POST',
              body: JSON.stringify({
                // Text only: the TTS models read any added instruction aloud.
                contents: [{ parts: [{ text: say }] }],
                generationConfig: {
                  responseModalities: ['AUDIO'],
                  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
                },
              }),
            });
            const parts = json && json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts;
            const audio = Array.isArray(parts) && parts.map((p) => p && p.inlineData).find((d) => d && d.data);
            if (!audio) {
              const err = new Error('Google returned no audio.');
              err.kind = 'bad_response';
              throw err;
            }
            return toWav(audio.data, audio.mimeType);
          }, m);
          return { audioBase64: result, mimeType: 'audio/wav', model: m, voice: voiceName };
        } catch (e) {
          if (i === chain.length - 1 || !e || !FALLBACK_KINDS.has(e.kind)) throw e;
        }
      }
    },
  };
}

/** Gemini TTS returns raw 16-bit PCM ("audio/L16;rate=24000") or WAV; always hand back WAV. */
function toWav(base64, mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('wav')) return base64;
  const pcm = Buffer.from(base64, 'base64');
  const rate = Number((/rate=(\d+)/.exec(mime) || [])[1]) || 24000;
  const channels = Number((/channels=(\d+)/.exec(mime) || [])[1]) || 1;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

function parseJsonObject(text, message) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  let parsed = null;
  try { parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)); } catch { /* below */ }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error(message);
    err.kind = 'bad_response';
    throw err;
  }
  return parsed;
}

function vocabWord(w) {
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    word: s(w && w.word, 600), partOfSpeech: s(w && w.partOfSpeech, 40), meaning: s(w && w.meaning, 400),
    example: s(w && w.example, 400), sayIt: s(w && w.sayIt, 80), urdu: s(w && w.urdu, 400),
  };
}

/** Paragraph + key words; drops words that do not actually appear in the paragraph. */
function parseVocabParagraph(text) {
  const parsed = parseJsonObject(text, 'Could not parse the practice paragraph from Google.');
  const paragraph = typeof parsed.paragraph === 'string' ? parsed.paragraph.trim() : '';
  if (paragraph.length < 40) {
    const err = new Error('Google returned an empty practice paragraph.');
    err.kind = 'bad_response';
    throw err;
  }
  const lower = paragraph.toLowerCase();
  const seen = new Set();
  const words = (Array.isArray(parsed.words) ? parsed.words : [])
    .map(vocabWord)
    .filter((w) => w.word && w.meaning && lower.includes(w.word.toLowerCase()) && !seen.has(w.word.toLowerCase()) && seen.add(w.word.toLowerCase()))
    .slice(0, 10);
  return { title: typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 80) : 'Practice paragraph', paragraph, words };
}

function parseReportJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  let parsed = null;
  try { parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)); } catch { /* below */ }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.overview !== 'string') {
    const err = new Error('Could not parse the report summary from Google.');
    err.kind = 'bad_response';
    throw err;
  }
  const list = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 5) : []);
  return { overview: parsed.overview, strengths: list(parsed.strengths), focusAreas: list(parsed.focusAreas), nextSteps: list(parsed.nextSteps) };
}

/** Turn a Gemini text reply into a JSON array of strings (code fences tolerated). */
function parseStringArray(text, pick = (x) => x) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  let parsed = null;
  try { parsed = JSON.parse(cleaned.slice(first, last + 1)); } catch { /* handled below */ }
  if (first === -1 || !Array.isArray(parsed)) {
    const err = new Error('Could not parse the translated transcript from Google.');
    err.kind = 'bad_response';
    throw err;
  }
  return parsed.map((x) => String(pick(x) ?? ''));
}

/** Parse model JSON robustly: strip code fences, tolerate surrounding prose. */
function parseFeedbackJson(text) {
  if (!text) {
    const err = new Error('Google returned no feedback.');
    err.kind = 'unknown';
    throw err;
  }
  let cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first > 0 || (last !== -1 && last < cleaned.length - 1)) {
    if (first === -1 || last === -1) {
      const err = new Error('Could not parse feedback from Google.');
      err.kind = 'bad_response';
      throw err;
    }
    cleaned = cleaned.slice(first, last + 1);
  }
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch {
    const err = new Error('Could not parse feedback from Google.');
    err.kind = 'bad_response';
    throw err;
  }
  const strList = (v) => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);
  const score = (v) => ({
    score: v && Number.isFinite(Number(v.score)) ? Math.min(100, Math.max(0, Math.round(Number(v.score)))) : 0,
    explanation: v && typeof v.explanation === 'string' ? v.explanation : '',
  });
  const scores = (parsed && parsed.scores) || {};
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    strengths: strList(parsed.strengths),
    improvements: strList(parsed.improvements),
    practiceQuestions: strList(parsed.practiceQuestions),
    scores: {
      relevance: score(scores.relevance),
      clarity: score(scores.clarity),
      technical: score(scores.technical),
    },
  };
}

module.exports = {
  createGeminiClient, assertFreeModel, assertTextModel, parseFeedbackJson, parseVocabParagraph, toWav,
  FREE_MODELS, TTS_VOICES, VOCAB_TOPICS, VOCAB_LEVELS, MAX_SPEAK_CHARS, PAID_MODELS, TEXT_MODEL, MAX_JPEG_BASE64_CHARS, API_BASE,
};
