'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createGeminiClient, assertFreeModel, parseFeedbackJson, FREE_MODELS } = require('./gemini.cjs');

const FIXED_NOW = 1_700_000_000_000;
const noSleep = async () => {};

function res(status, obj) {
  const raw = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => raw,
    json: async () => JSON.parse(raw),
  };
}
function textRes(text) {
  return res(200, { candidates: [{ content: { parts: [{ text }] } }] });
}
const FEEDBACK_JSON = JSON.stringify({
  summary: 'Solid basics.', strengths: ['Clear structure'], improvements: ['More depth'],
  practiceQuestions: ['Explain your Angular project'],
  scores: {
    relevance: { score: 80, explanation: 'On topic' },
    clarity: { score: 75, explanation: 'Mostly clear' },
    technical: { score: 70, explanation: 'Adequate' },
  },
});
const creds = (...list) => () => list.map(([id, name, secret]) => ({ id, name, secret }));
const QUOTA_BODY = { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for quota metric' } };
const AUTH_BODY = { error: { status: 'UNAUTHENTICATED', message: 'API key not valid' } };

function client(fetchImpl, credentials, extra = {}) {
  return createGeminiClient({
    getCredentialsInOrder: credentials, fetchImpl, sleepImpl: noSleep, now: () => FIXED_NOW, ...extra,
  });
}

test('free model allowlist: accepts listed, rejects unknown/paid models', () => {
  assert.equal(assertFreeModel('live', 'gemini-3.8-live'), 'gemini-3.8-live');
  assert.equal(assertFreeModel('text', 'gemini-3.8-flash'), 'gemini-3.8-flash');
  assert.throws(() => assertFreeModel('live', 'gemini-unknown-paid'), /free-tier allowlist/);
  assert.throws(() => assertFreeModel('text', 'gemini-3.8-live'), /free-tier allowlist/);
  assert.deepEqual([...FREE_MODELS.live], ['gemini-3.8-live', 'gemini-3.1-flash-live-preview']);
});

test('mintLiveToken rejects a non-free model before any network call', async () => {
  let calls = 0;
  const g = client(async () => { calls++; return res(200, {}); }, creds(['c1', 'One', 'key-one-123456']));
  await assert.rejects(() => g.mintLiveToken({ model: 'gemini-unknown-paid' }), /allowlist/);
  assert.equal(calls, 0);
});

test('mintLiveToken request shape: uses=1, no SDK-only fields, expiry windows', async () => {
  let captured = null;
  const g = client(async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body), key: opts.headers['x-goog-api-key'] };
    return res(200, { name: 'auth_tokens/token-abc' });
  }, creds(['c1', 'One', 'key-one-123456']));

  const out = await g.mintLiveToken({});
  assert.equal(out.token, 'auth_tokens/token-abc');
  assert.equal(out.model, 'gemini-3.8-live');
  assert.match(captured.url, /\/v1beta\/auth_tokens$/);
  assert.equal(captured.key, 'key-one-123456'); // key in header, never in URL
  assert.ok(!captured.url.includes('key-one'));
  assert.equal(captured.body.uses, 1);
  // The REST API rejects `liveConnectConstraints` ("Cannot find field").
  assert.deepEqual(Object.keys(captured.body).sort(), ['expireTime', 'newSessionExpireTime', 'uses']);
  assert.equal(captured.body.expireTime, new Date(FIXED_NOW + 30 * 60 * 1000).toISOString());
  assert.equal(captured.body.newSessionExpireTime, new Date(FIXED_NOW + 60 * 1000).toISOString());
  assert.equal(out.expireTime, captured.body.expireTime);
});

test('failover: quota on credential 1 -> succeeds on credential 2', async () => {
  const seen = [];
  const g = client(async (_url, opts) => {
    const key = opts.headers['x-goog-api-key'];
    seen.push(key);
    if (key === 'key-one-123456') return res(429, QUOTA_BODY);
    return textRes(FEEDBACK_JSON);
  }, creds(['c1', 'One', 'key-one-123456'], ['c2', 'Two', 'key-two-123456']));

  const out = await g.generateFeedback({ transcript: 'user: hello', level: 'Junior', cvSummary: 'Angular' });
  assert.equal(out.source, 'gemini');
  assert.equal(out.credentialName, 'Two');
  assert.equal(out.feedback.summary, 'Solid basics.');
  assert.deepEqual(seen, ['key-one-123456', 'key-two-123456']); // quota: no retry on cred 1
});

test('transient 500 is retried on the same credential with backoff, then succeeds', async () => {
  const sleeps = [];
  let calls = 0;
  const g = client(
    async () => { calls++; return calls === 1 ? res(500, { error: { message: 'Internal' } }) : textRes(FEEDBACK_JSON); },
    creds(['c1', 'One', 'key-one-123456']),
    { sleepImpl: async (ms) => { sleeps.push(ms); } });
  const out = await g.generateFeedback({ transcript: 'user: hi', level: 'Intern' });
  assert.equal(out.feedback.summary, 'Solid basics.');
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [500]);
});

test('all credentials failing auth -> throws kind auth, no secrets in message', async () => {
  const g = client(async () => res(401, AUTH_BODY),
    creds(['c1', 'One', 'key-one-123456'], ['c2', 'Two', 'key-two-123456']));
  await assert.rejects(
    () => g.generateFeedback({ transcript: 'user: hi', level: 'Junior' }),
    (err) => {
      assert.equal(err.kind, 'auth');
      assert.ok(!err.message.includes('key-one') && !err.message.includes('key-two'));
      return true;
    });
});

test('no credentials -> throws kind auth with a helpful message', async () => {
  const g = client(async () => res(200, {}), creds());
  await assert.rejects(() => g.generateFeedback({ transcript: 'x' }), (err) => err.kind === 'auth' && /Settings/.test(err.message));
});

test('testCredential: ok with model count; 401 -> ok:false kind auth', async () => {
  const okClient = client(async (_u, opts) => {
    assert.equal(opts.headers['x-goog-api-key'], 'key-one-123456');
    return res(200, { models: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] });
  }, creds());
  assert.deepEqual(await okClient.testCredential('key-one-123456'), { ok: true, modelsCount: 3 });

  const badClient = client(async () => res(401, AUTH_BODY), creds());
  const bad = await badClient.testCredential('key-one-123456');
  assert.equal(bad.ok, false);
  assert.equal(bad.kind, 'auth');
});

test('feedback JSON parsing tolerates code fences and surrounding prose', () => {
  const parsed = parseFeedbackJson('Here you go:\n```json\n' + FEEDBACK_JSON + '\n```\nDone.');
  assert.equal(parsed.summary, 'Solid basics.');
  assert.deepEqual(parsed.practiceQuestions, ['Explain your Angular project']);
  assert.equal(parsed.scores.clarity.score, 75);
  assert.throws(() => parseFeedbackJson('not json at all'), /parse/i);
});

test('generateFeedback sends a JSON-only, CV-grounded prompt', async () => {
  let body = null;
  const g = client(async (_u, opts) => { body = JSON.parse(opts.body); return textRes('```json\n' + FEEDBACK_JSON + '```'); },
    creds(['c1', 'One', 'key-one-123456']));
  const out = await g.generateFeedback({
    transcript: [{ speaker: 'user', text: 'I built a dashboard' }],
    level: 'Senior', cvSummary: 'Angular, TypeScript',
  });
  const prompt = body.contents[0].parts[0].text;
  assert.match(prompt, /JSON ONLY/);
  assert.match(prompt, /ONLY in skills\/projects explicitly in that summary/);
  assert.match(prompt, /user: I built a dashboard/);
  assert.equal(out.feedback.scores.technical.score, 70);
});

test('analyzeFrame: vision payload, restricted prompt, oversize rejected', async () => {
  let body = null;
  const g = client(async (_u, opts) => { body = JSON.parse(opts.body); return textRes('Framing is good; add more light.'); },
    creds(['c1', 'One', 'key-one-123456']));
  const out = await g.analyzeFrame({ jpegBase64: 'aGVsbG8=' });
  assert.equal(out.feedback, 'Framing is good; add more light.');
  assert.equal(out.credentialName, 'One');
  const parts = body.contents[0].parts;
  assert.equal(parts[1].inlineData.mimeType, 'image/jpeg');
  assert.equal(parts[1].inlineData.data, 'aGVsbG8=');
  assert.match(parts[0].text, /framing/);
  assert.match(parts[0].text, /Never infer/);
  assert.match(parts[0].text, /personality, emotions, honesty/);

  await assert.rejects(() => g.analyzeFrame({ jpegBase64: 'x'.repeat(2_800_001) }), /too large/i);
  await assert.rejects(() => g.analyzeFrame({}), /required/i);
});

test('onStatus is reported for success and quota', async () => {
  const events = [];
  const g = client(
    async (_u, opts) => (opts.headers['x-goog-api-key'] === 'key-one-123456' ? res(429, QUOTA_BODY) : textRes(FEEDBACK_JSON)),
    creds(['c1', 'One', 'key-one-123456'], ['c2', 'Two', 'key-two-123456']),
    { onStatus: (id, status, kind) => events.push([id, status, kind]) });
  await g.generateFeedback({ transcript: 'user: hi' });
  assert.deepEqual(events, [['c1', 'quota', 'quota'], ['c2', 'ok', null]]);
});

test('paid text models: gated by allowPaidUsage, never from a forged call', async () => {
  const { assertTextModel } = require('./gemini.cjs');
  assert.equal(assertTextModel('gemini-3.8-flash', false), 'gemini-3.8-flash');
  assert.throws(() => assertTextModel('gemini-3.1-pro-preview', false), /opt-in/);
  assert.equal(assertTextModel('gemini-3.1-pro-preview', true), 'gemini-3.1-pro-preview');
  assert.throws(() => assertTextModel('gemini-nope', true), /not available/);
  // generateFeedback actually calls the paid model URL only when opted in.
  let seenUrl = '';
  const g = client(async (url) => { seenUrl = url; return textRes(FEEDBACK_JSON); },
    creds(['c1', 'One', 'key-one-123456']));
  await assert.rejects(() => g.generateFeedback({ transcript: 'user: hi', textModel: 'gemini-3.1-pro-preview', allowPaidUsage: false }), /opt-in/);
  await g.generateFeedback({ transcript: 'user: hi', textModel: 'gemini-3.1-pro-preview', allowPaidUsage: true });
  assert.match(seenUrl, /models\/gemini-3\.1-pro-preview:generateContent$/);
});

test('paid text model out of quota -> falls back once to the free model', async () => {
  const urls = [];
  const g = client(async (url) => {
    urls.push(url);
    return url.includes('gemini-3.1-pro-preview') ? res(429, QUOTA_BODY) : textRes(FEEDBACK_JSON);
  }, creds(['c1', 'One', 'key-one-123456']));
  const out = await g.generateFeedback({ transcript: 'user: hi', textModel: 'gemini-3.1-pro-preview', allowPaidUsage: true });
  assert.equal(out.fellBack, true);
  assert.equal(out.model, 'gemini-3.8-flash');
  assert.match(urls.at(-1), /gemini-3\.8-flash:generateContent$/);
});

test('free Flash overloaded (503) -> falls back to Flash-Lite', async () => {
  const g = client(async (url) => (url.includes('gemini-3.8-flash')
    ? res(503, { error: { code: 503, message: 'This model is currently experiencing high demand.' } })
    : textRes(FEEDBACK_JSON)), creds(['c1', 'One', 'key-one-123456']));
  const out = await g.generateFeedback({ transcript: 'user: hi' });
  assert.equal(out.model, 'gemini-3.5-flash-lite');
  assert.equal(out.fellBack, true);
});

test('translateTranscript keeps speakers/order and asks for Urdu script', async () => {
  let prompt = '';
  const g = client(async (_u, opts) => {
    prompt = JSON.parse(opts.body).contents[0].parts[0].text;
    return textRes('["سلام", "میں Angular developer ہوں"]');
  }, creds(['c1', 'One', 'key-one-123456']));
  const out = await g.translateTranscript({
    transcript: [{ speaker: 'interviewer', text: 'Hello' }, { speaker: 'user', text: 'main Angular developer hoon' }],
    targetLanguage: 'Urdu',
  });
  assert.match(prompt, /Urdu script/);
  assert.deepEqual(out.transcript.map((t) => t.speaker), ['interviewer', 'user']);
  assert.equal(out.transcript[1].text, 'میں Angular developer ہوں');
});

test('translateTranscript rejects a reply with a different turn count', async () => {
  const g = client(async () => textRes('["only one"]'), creds(['c1', 'One', 'key-one-123456']));
  await assert.rejects(() => g.translateTranscript({
    transcript: [{ speaker: 'user', text: 'a' }, { speaker: 'user', text: 'b' }], targetLanguage: 'English',
  }), /different number of turns/);
});

test('Live quota on key 1 -> next mint uses key 2 -> all out gives a quota error', async () => {
  const keys = [];
  const g = client(async (_u, opts) => { keys.push(opts.headers['x-goog-api-key']); return res(200, { name: 'auth_tokens/t' }); },
    creds(['c1', 'One', 'key-one-123456'], ['c2', 'Two', 'key-two-123456']));
  const first = await g.mintLiveToken({});
  assert.equal(first.credentialId, 'c1');
  g.markLiveQuota('c1');
  const second = await g.mintLiveToken({});
  assert.equal(second.credentialId, 'c2');
  assert.equal(second.credentialName, 'Two');
  g.markLiveQuota('c2');
  await assert.rejects(() => g.mintLiveToken({}), /quota/i);
  assert.ok(!keys.includes(undefined));
});

test('summarizeReport: parses the combined summary and caps lists at 5', async () => {
  const reply = { overview: 'Improving.', strengths: ['a', 'b', 'c', 'd', 'e', 'f'], focusAreas: ['depth'], nextSteps: ['practice'] };
  const client = createGeminiClient({
    getCredentialsInOrder: async () => [{ id: 'k1', name: 'Key 1', secret: 'AIza-test' }],
    fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }), { status: 200 }),
  });
  const out = await client.summarizeReport({ digest: 'Interview 2026-10-26 ...', textModel: 'gemini-3.8-flash' });
  assert.equal(out.overview, 'Improving.');
  assert.equal(out.strengths.length, 5);
  assert.deepEqual(out.focusAreas, ['depth']);
  await assert.rejects(client.summarizeReport({ digest: '  ', textModel: 'gemini-3.8-flash' }), /no saved feedback/);
});

test('vocabParagraph: keeps only key words that appear in the paragraph', async () => {
  const { parseVocabParagraph } = require('./gemini.cjs');
  const reply = {
    title: 'A clear answer',
    paragraph: 'During the interview, Sara gave a concise answer and described one meaningful project in detail.',
    words: [
      { word: 'concise', partOfSpeech: 'adjective', meaning: 'short and clear', example: 'Keep it concise.', sayIt: 'kun-SICE' },
      { word: 'Concise', partOfSpeech: 'adjective', meaning: 'duplicate', example: '', sayIt: '' },
      { word: 'ubiquitous', partOfSpeech: 'adjective', meaning: 'not in the text', example: '', sayIt: '' },
      { word: 'meaningful', partOfSpeech: 'adjective', meaning: '', example: '', sayIt: '' },
    ],
  };
  const out = parseVocabParagraph('```json\n' + JSON.stringify(reply) + '\n```');
  assert.equal(out.title, 'A clear answer');
  assert.deepEqual(out.words.map((w) => w.word), ['concise']);
  assert.equal(out.words[0].urdu, '');
  assert.throws(() => parseVocabParagraph('{"paragraph":"too short"}'), /empty practice paragraph/);
});

test('vocabParagraph: sends saved words and the Urdu field only when asked', async () => {
  const bodies = [];
  const reply = { title: 'T', paragraph: 'A resilient team shipped the feature on time despite many changes.', words: [{ word: 'resilient', meaning: 'recovers quickly', urdu: 'لچکدار' }] };
  const c = client(async (_url, opts) => { bodies.push(JSON.parse(opts.body)); return textRes(JSON.stringify(reply)); }, creds(['k1', 'K', 'AIza-1']));
  const out = await c.vocabParagraph({ topic: 'tech', level: 'easy', includeWords: ['resilient'], urdu: true, textModel: 'gemini-3.8-flash' });
  const prompt = bodies[0].contents[0].parts[0].text;
  assert.match(prompt, /resilient/);
  assert.match(prompt, /"urdu"/);
  assert.equal(out.words[0].urdu, 'لچکدار');
  await c.vocabParagraph({ textModel: 'gemini-3.8-flash' });
  assert.doesNotMatch(bodies[1].contents[0].parts[0].text, /"urdu"/);
});

test('speak: wraps raw PCM in a WAV header and falls back to the next TTS model on quota', async () => {
  const { toWav } = require('./gemini.cjs');
  const pcm = Buffer.alloc(480).toString('base64');
  const wav = Buffer.from(toWav(pcm, 'audio/L16;codec=pcm;rate=24000'), 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), 480);
  assert.equal(toWav('UklGRg==', 'audio/wav'), 'UklGRg=='); // already WAV: untouched

  const urls = [];
  const c = client(async (url, opts) => {
    urls.push(url);
    if (url.includes(FREE_MODELS.tts[0])) return res(429, QUOTA_BODY);
    const body = JSON.parse(opts.body);
    assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
    return res(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: pcm } }] } }] });
  }, creds(['k1', 'K', 'AIza-1']));
  const out = await c.speak({ text: 'concise', voice: 'Puck' });
  assert.equal(out.model, FREE_MODELS.tts[1]);
  assert.equal(out.mimeType, 'audio/wav');
  assert.equal(Buffer.from(out.audioBase64, 'base64').toString('ascii', 0, 4), 'RIFF');
  await assert.rejects(c.speak({ text: ' ' }), /no text/);
  await assert.rejects(c.speak({ text: 'x'.repeat(2001) }), /longer than/);
});

test('explainText: returns a meaning card for the selection', async () => {
  const c = client(async () => textRes(JSON.stringify({ word: 'pragmatic', partOfSpeech: 'adjective', meaning: 'practical and sensible', example: 'A pragmatic plan.', sayIt: 'prag-MAT-ik' })), creds(['k1', 'K', 'AIza-1']));
  const out = await c.explainText({ text: 'pragmatic', context: 'A pragmatic solution.', textModel: 'gemini-3.8-flash' });
  assert.equal(out.meaning, 'practical and sensible');
  assert.equal(out.sayIt, 'prag-MAT-ik');
  await assert.rejects(c.explainText({ text: '', textModel: 'gemini-3.8-flash' }), /select a word/);
});
