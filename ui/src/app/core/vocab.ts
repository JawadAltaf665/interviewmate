// Pure helpers for the Vocabulary tab (no Angular, no I/O) so they are easy to test.
import { SavedWord, VocabSpeed, VocabWord } from './interviewmate-api';

export const SPEED_RATE: Record<VocabSpeed, number> = { slow: 0.75, medium: 1, fast: 1.25 };

export interface Sentence {
  text: string;
  /** Character offsets of the sentence in the paragraph. */
  start: number;
  end: number;
}

export interface Part {
  text: string;
  /** Set when this part is one of the paragraph's key words. */
  word?: VocabWord;
}

/** Split a paragraph into sentences, keeping every character (spaces included). */
export function splitSentences(paragraph: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?]+(?:[.!?]+["')\]]*)?\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paragraph))) {
    if (!m[0]) break;
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cut a sentence into plain text and key-word parts (whole words, any case, longest phrase first). */
export function markWords(text: string, words: VocabWord[]): Part[] {
  const list = [...words].filter((w) => w.word.trim()).sort((a, b) => b.word.length - a.word.length);
  if (!list.length) return [{ text }];
  const re = new RegExp(`\\b(${list.map((w) => escapeRe(w.word.trim())).join('|')})\\b`, 'gi');
  const parts: Part[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const hit = m[0].toLowerCase();
    parts.push({ text: m[0], word: list.find((w) => w.word.trim().toLowerCase() === hit) });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * Which sentence is being read. Gemini audio has no word timings, so the
 * position is estimated from how far through the clip playback is, weighted
 * by sentence length (pauses make this approximate, never exact).
 */
export function sentenceAtFraction(sentences: Sentence[], fraction: number): number {
  if (!sentences.length) return -1;
  const total = sentences[sentences.length - 1].end;
  const pos = Math.max(0, Math.min(1, fraction)) * total;
  const i = sentences.findIndex((s) => pos < s.end);
  return i === -1 ? sentences.length - 1 : i;
}

/** Sentence that contains a character offset (exact, from the offline voice's word events). */
export function sentenceAtChar(sentences: Sentence[], charIndex: number): number {
  return sentences.findIndex((s) => charIndex >= s.start && charIndex < s.end);
}

/** Up to `n` saved words to practise in the next paragraph: mostly recent, shuffled. */
export function pickPracticeWords(saved: SavedWord[], n = 5, random = Math.random): string[] {
  const pool = saved.slice(0, 20).map((w) => w.word);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** Tidy a mouse selection: single line, trimmed, edge punctuation removed, capped. */
export function cleanSelection(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.!?]+$/gu, '').slice(0, 600);
}

/** Error text for the UI, without Electron's "Error invoking remote method ..." prefix. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
  return msg.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') || 'unknown error';
}
