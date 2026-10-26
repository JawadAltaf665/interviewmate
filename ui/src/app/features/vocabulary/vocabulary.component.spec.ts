import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { VocabularyComponent } from './vocabulary.component';

describe('VocabularyComponent', () => {
  it('underlines key words and opens their meaning card', async () => {
    localStorage.clear();
    const fixture = TestBed.createComponent(VocabularyComponent);
    const cmp = fixture.componentInstance;
    cmp.paragraph.set({
      title: 'A clear answer',
      paragraph: 'Sara gave a concise answer. She described a meaningful project.',
      words: [{ word: 'concise', partOfSpeech: 'adjective', meaning: 'short and clear', example: 'Keep it concise.', sayIt: 'kun-SICE', urdu: '' }],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.sentence').length).toBe(2);
    expect(el.querySelector('.reader')!.textContent!.replace(/\s+/g, ' ').trim())
      .toBe('Sara gave a concise answer. She described a meaningful project.');
    const kw = el.querySelector<HTMLElement>('.kw')!;
    expect(kw.textContent).toBe('concise');

    kw.click();
    fixture.detectChanges();
    expect(el.querySelector('.word-card h2')!.textContent).toBe('concise');
    expect(el.querySelector('.say-it')!.textContent).toBe('kun-SICE');

    (el.querySelector('.word-card .btn.small') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(cmp.saved().map((w) => w.word)).toEqual(['concise']);
    expect(el.querySelector('.kw')!.classList).toContain('saved');
  });
});
