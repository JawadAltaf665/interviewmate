import { describe, expect, it } from 'vitest';
import { SavedWord, VocabWord } from './interviewmate-api';
import {
  cleanSelection, errorText, markWords, pickPracticeWords, sentenceAtChar, sentenceAtFraction, splitSentences,
} from './vocab';

const word = (w: string): VocabWord => ({ word: w, partOfSpeech: '', meaning: 'm', example: '', sayIt: '', urdu: '' });

describe('vocabulary helpers', () => {
  const para = 'Sara gave a concise answer. Was it clear? Yes! She described a meaningful project';

  it('splits sentences without losing any character', () => {
    const s = splitSentences(para);
    expect(s.map((x) => x.text.trim())).toEqual(['Sara gave a concise answer.', 'Was it clear?', 'Yes!', 'She described a meaningful project']);
    expect(s.map((x) => x.text).join('')).toBe(para);
    expect(s[1].start).toBe(para.indexOf('Was'));
  });

  it('marks key words as whole words, any case, longest phrase first', () => {
    const parts = markWords('A Concise, clear answer about concise-ness and clear goals.', [word('concise'), word('clear goals')]);
    expect(parts.filter((p) => p.word).map((p) => p.text)).toEqual(['Concise', 'concise', 'clear goals']);
    expect(parts.map((p) => p.text).join('')).toBe('A Concise, clear answer about concise-ness and clear goals.');
    expect(markWords('no words', [])).toEqual([{ text: 'no words' }]);
  });

  it('finds the sentence being read from playback progress or a character offset', () => {
    const s = splitSentences(para);
    expect(sentenceAtFraction(s, 0)).toBe(0);
    expect(sentenceAtFraction(s, 0.4)).toBe(1);
    expect(sentenceAtFraction(s, 1)).toBe(3);
    expect(sentenceAtFraction([], 0.5)).toBe(-1);
    expect(sentenceAtChar(s, para.indexOf('Yes'))).toBe(2);
    expect(sentenceAtChar(s, -1)).toBe(-1);
  });

  it('picks up to n saved words from the 20 most recent', () => {
    const saved = Array.from({ length: 30 }, (_, i) => ({ ...word(`w${i}`), id: `${i}`, savedAt: '' }) as SavedWord);
    const picked = pickPracticeWords(saved, 5, () => 0.5);
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
    expect(picked.every((w) => Number(w.slice(1)) < 20)).toBe(true);
  });

  it('cleans selections and error messages', () => {
    expect(cleanSelection('  “concise,”  ')).toBe('concise');
    expect(cleanSelection('a clear\n answer.')).toBe('a clear answer.');
    expect(errorText(new Error("Error invoking remote method 'vocab:speak': Error: Free quota is exhausted"))).toBe('Free quota is exhausted');
  });
});
