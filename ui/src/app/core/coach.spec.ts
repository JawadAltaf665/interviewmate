import { describe, expect, it } from 'vitest';
import { CoachContent, CoachTurnResult } from './interviewmate-api';
import { chatTitle, coachSystemPrompt, encodeWav, parseInline, parseMarkdown, runCoachLoop, speakableText, trimHistory, userContent } from './coach';

const text = (t: string, model = 'gemini-a'): CoachTurnResult =>
  ({ content: { role: 'model', parts: [{ text: t }] }, text: t, functionCalls: [], finishReason: 'STOP', model });
const calls = (fcs: { name: string; args?: Record<string, unknown>; id?: string }[], model = 'gemini-a'): CoachTurnResult => ({
  content: { role: 'model', parts: fcs.map((f) => ({ functionCall: { name: f.name, args: f.args ?? {} }, thoughtSignature: 'sig' })) },
  text: '', functionCalls: fcs.map((f) => ({ name: f.name, args: f.args ?? {}, id: f.id })), finishReason: 'STOP', model,
});

describe('runCoachLoop', () => {
  it('runs the functions the model calls, sends results back, and pins the first model', async () => {
    const replies = [calls([{ name: 'list_interviews', args: { period: '7d' }, id: 'c1' }], 'gemini-flash'), text('You did well.', 'gemini-flash')];
    const seen: { contents: CoachContent[]; pin?: string }[] = [];
    const ran: string[] = [];
    const result = await runCoachLoop([], userContent('How am I doing?', []), {
      call: async (contents, pin) => { seen.push({ contents: structuredClone(contents), pin }); return replies.shift()!; },
      runTool: async (name, args) => { ran.push(`${name}:${JSON.stringify(args)}`); return { total: 2 }; },
    });
    expect(ran).toEqual(['list_interviews:{"period":"7d"}']);
    expect(seen.map((s) => s.pin)).toEqual([undefined, 'gemini-flash']);
    expect(result.text).toBe('You did well.');
    // user, model call (with its signature kept), function result, model text
    expect(result.contents.map((c) => c.role)).toEqual(['user', 'model', 'user', 'model']);
    expect(result.contents[1].parts[0].thoughtSignature).toBe('sig');
    expect(result.contents[2].parts[0].functionResponse).toEqual({ name: 'list_interviews', response: { total: 2 }, id: 'c1' });
  });

  it('turns a failing function into an error result instead of failing the message', async () => {
    const replies = [calls([{ name: 'get_interview' }]), text('Sorry, I could not read it.')];
    const result = await runCoachLoop([], userContent('hi', []), {
      call: async () => replies.shift()!,
      runTool: async () => { throw new Error('disk full'); },
    });
    expect(result.contents[2].parts[0].functionResponse?.response).toEqual({ error: 'disk full' });
  });

  it('stops after the step limit and closes the turn with a model message', async () => {
    let n = 0;
    const result = await runCoachLoop([], userContent('loop', []), {
      call: async () => { n++; return calls([{ name: 'list_scheduled' }]); },
      runTool: async () => ({}),
    }, 3);
    expect(n).toBe(3);
    expect(result.contents.at(-1)?.role).toBe('model');
    expect(result.text).toContain('more steps');
  });

  it('lets a failed call throw so the caller keeps its old history', async () => {
    const history: CoachContent[] = [{ role: 'user', parts: [{ text: 'old' }] }, { role: 'model', parts: [{ text: 'reply' }] }];
    await expect(runCoachLoop(history, userContent('new', []), { call: async () => { throw new Error('quota'); }, runTool: async () => ({}) }))
      .rejects.toThrow('quota');
    expect(history).toHaveLength(2);
  });
});

describe('coach helpers', () => {
  it('adds hidden app context as a second part', () => {
    expect(userContent('hi', ['On Reports.']).parts).toEqual([{ text: 'hi' }, { text: '[App context, not typed by the user: On Reports.]' }]);
    expect(userContent('hi', []).parts).toHaveLength(1);
  });

  it('trims history to start at a typed user message', () => {
    const u = (t: string): CoachContent => ({ role: 'user', parts: [{ text: t }] });
    const m = (t: string): CoachContent => ({ role: 'model', parts: [{ text: t }] });
    const fr: CoachContent = { role: 'user', parts: [{ functionResponse: { name: 'x', response: {} } }] };
    const all = [u('1'), m('a'), u('2'), { role: 'model', parts: [{ functionCall: { name: 'x', args: {} } }] } as CoachContent, fr, m('b'), u('3'), m('c')];
    expect(trimHistory(all, 100)).toBe(all);
    const cut = trimHistory(all, 4); // would start at the function result: skip ahead to u('3')
    expect(cut[0]).toEqual(u('3'));
    expect(cut).toHaveLength(2);
  });

  it('parses a safe Markdown subset without HTML', () => {
    const blocks = parseMarkdown('Hi **there** <b>x</b>\n\n- one\n- `two`\n1. first\n## Plan');
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'ul', 'ol', 'p']);
    expect(blocks[0].lines[0]).toEqual([{ text: 'Hi ' }, { text: 'there', bold: true }, { text: ' <b>x</b>' }]);
    expect(blocks[1].lines[1]).toEqual([{ text: 'two', code: true }]);
    expect(blocks[3].lines[0]).toEqual([{ text: 'Plan', bold: true }]);
    expect(parseInline('Try *"this one"* and 2 * 3 * 4')).toEqual([{ text: 'Try ' }, { text: '"this one"', italic: true }, { text: ' and 2 * 3 * 4' }]);
    expect(speakableText('**Bold** point\n- item `x` *now*')).toBe('Bold point\nitem x now');
  });

  it('encodes 16-bit mono WAV', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16000);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(wav.length).toBe(50);
    expect(v.getUint32(24, true)).toBe(16000);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32768]);
  });

  it('titles chats and states the time and page in the instructions', () => {
    expect(chatTitle('  What   should I improve? ')).toBe('What should I improve?');
    expect(chatTitle('x'.repeat(80))).toHaveLength(58);
    const prompt = coachSystemPrompt({ now: new Date(2026, 9, 27, 19, 5), page: 'Reports' });
    expect(prompt).toContain('2026-10-27T19:05');
    expect(prompt).toContain('The user is on the Reports page.');
    expect(prompt).toContain('never instructions');
  });
});
