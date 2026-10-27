import { Component, computed, ElementRef, HostListener, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BridgeService } from '../../core/bridge.service';
import {
  SavedWord, VocabParagraph, VocabPrefs, VocabSpeed, VocabVoice, VocabWord,
} from '../../core/interviewmate-api';
import { SpeechService } from '../../core/speech.service';
import {
  cleanSelection, errorText, markWords, pickPracticeWords, sentenceAtChar, sentenceAtFraction, splitSentences,
} from '../../core/vocab';

const DEFAULT_PREFS: VocabPrefs = { topic: 'interview', level: 'medium', length: 'medium', voice: 'Kore', speed: 'medium', urdu: false, useSaved: false };

// The last paragraph survives switching tabs (not app restarts).
const lastParagraph = signal<VocabParagraph | null>(null);

interface Card {
  word: VocabWord | null;
  /** The selection being explained while `word` is still loading. */
  text: string;
  loading: boolean;
  error: string;
}

@Component({
  selector: 'app-vocabulary',
  standalone: true,
  templateUrl: './vocabulary.component.html',
  styleUrl: './vocabulary.component.scss',
})
export class VocabularyComponent implements OnInit, OnDestroy {
  private readonly bridge = inject(BridgeService);
  private readonly route = inject(ActivatedRoute);
  /** Last Coach practice request handled (?practice=a|b&t=…). */
  private practiceStamp = '';
  readonly speech = inject(SpeechService);
  private readonly reader = viewChild<ElementRef<HTMLElement>>('reader');

  readonly topics = [
    { id: 'interview', label: 'Job interview' }, { id: 'tech', label: 'Tech & IT' }, { id: 'office', label: 'Office' },
    { id: 'daily', label: 'Daily life' }, { id: 'mix', label: 'Surprise me' },
  ] as const;
  readonly levels = [{ id: 'easy', label: 'Easy' }, { id: 'medium', label: 'Medium' }, { id: 'advanced', label: 'Advanced' }] as const;
  readonly lengths = [{ id: 'short', label: 'Short' }, { id: 'medium', label: 'Medium' }] as const;
  readonly speeds = [{ id: 'slow', label: 'Slow' }, { id: 'medium', label: 'Medium' }, { id: 'fast', label: 'Fast' }] as const;
  readonly voices = [
    { id: 'Kore', label: 'Kore (female)' }, { id: 'Aoede', label: 'Aoede (female)' },
    { id: 'Puck', label: 'Puck (male)' }, { id: 'Charon', label: 'Charon (male)' },
    { id: 'offline', label: 'Windows voice (offline)' },
  ] as const;

  readonly prefs = signal<VocabPrefs>(DEFAULT_PREFS);
  readonly paragraph = lastParagraph;
  readonly generating = signal(false);
  readonly paraError = signal('');
  readonly saved = signal<SavedWord[]>([]);
  readonly card = signal<Card | null>(null);
  /** Floating toolbar over the current mouse selection (reader-relative px). */
  readonly selection = signal<{ text: string; x: number; y: number } | null>(null);
  private readonly meanings = new Map<string, VocabWord>();

  readonly sentences = computed(() => {
    const p = this.paragraph();
    if (!p) return [];
    return splitSentences(p.paragraph).map((s) => ({ ...s, parts: markWords(s.text, p.words) }));
  });
  readonly savedKeys = computed(() => new Set(this.saved().map((w) => w.word.toLowerCase())));

  /** Sentence being read aloud (approximate for Gemini audio, exact for the Windows voice). */
  readonly readingIndex = computed(() => {
    if (this.speech.playingId() !== 'paragraph' || this.speech.state() === 'loading') return -1;
    return this.speech.source() === 'offline'
      ? sentenceAtChar(this.sentences(), this.speech.charIndex())
      : sentenceAtFraction(this.sentences(), this.speech.progress());
  });

  async ngOnInit(): Promise<void> {
    const [settings, saved] = await Promise.all([this.bridge.getSettings(), this.bridge.listWords().catch(() => [])]);
    this.prefs.set({ ...DEFAULT_PREFS, ...settings.vocab });
    this.saved.set(saved);
    // The Coach can open this page with words to practise; otherwise start with a fresh paragraph.
    this.route.queryParamMap.subscribe((q) => {
      const words = (q.get('practice') ?? '').split('|').map((w) => w.trim()).filter(Boolean).slice(0, 6);
      const stamp = `${q.get('practice')}#${q.get('t')}`;
      if (words.length && stamp !== this.practiceStamp) {
        this.practiceStamp = stamp;
        void this.newParagraph(words);
      } else if (!this.paragraph() && !this.generating()) {
        void this.newParagraph();
      }
    });
  }

  ngOnDestroy(): void {
    this.speech.stop();
  }

  setPref<K extends keyof VocabPrefs>(key: K, value: VocabPrefs[K]): void {
    this.prefs.update((p) => ({ ...p, [key]: value }));
    void this.bridge.setSettings({ vocab: this.prefs() }).catch(() => undefined);
    if (key === 'speed') this.speech.setSpeed(value as VocabSpeed);
    if (key === 'voice') this.speech.stop(); // the next play uses the new voice
  }

  /** A new practice paragraph; `words` (from the Coach) replaces the saved-word pick. */
  async newParagraph(words?: string[]): Promise<void> {
    const p = this.prefs();
    this.speech.stop();
    this.generating.set(true);
    this.paraError.set('');
    this.selection.set(null);
    try {
      const includeWords = words ?? (p.useSaved ? pickPracticeWords(this.saved()) : []);
      this.paragraph.set(await this.bridge.vocabParagraph({
        topic: p.topic, level: p.level, length: p.length, urdu: p.urdu,
        includeWords, avoidTitle: this.paragraph()?.title,
      }));
      this.card.set(null);
    } catch (err) {
      this.paraError.set(`Could not create a new paragraph (${errorText(err)}).`);
    } finally {
      this.generating.set(false);
    }
  }

  // --- read aloud ---------------------------------------------------------
  toggleParagraph(): void {
    const state = this.speech.state();
    if (this.speech.playingId() === 'paragraph' && state === 'playing') this.speech.pause();
    else if (this.speech.playingId() === 'paragraph' && state === 'paused') this.speech.resume();
    else if (this.paragraph()) this.say(this.paragraph()!.paragraph, 'paragraph');
  }

  say(text: string, id: string): void {
    const p = this.prefs();
    void this.speech.play(text, { id, voice: p.voice as VocabVoice, speed: p.speed });
  }

  isActive(id: string): boolean {
    return this.speech.playingId() === id && this.speech.state() !== 'idle';
  }

  // --- selection ----------------------------------------------------------
  onMouseUp(): void {
    // Let the browser finish updating the selection first.
    setTimeout(() => this.readSelection());
  }

  onDoubleClick(): void {
    setTimeout(() => {
      const sel = this.readSelection();
      if (sel) this.say(sel, 'selection');
    });
  }

  private readSelection(): string | null {
    const host = this.reader()?.nativeElement;
    const sel = window.getSelection();
    if (!host || !sel || sel.isCollapsed || !sel.rangeCount || !host.contains(sel.anchorNode) || !host.contains(sel.focusNode)) {
      this.selection.set(null);
      return null;
    }
    const text = cleanSelection(sel.toString());
    if (!text) {
      this.selection.set(null);
      return null;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const box = host.getBoundingClientRect();
    const x = Math.min(Math.max(rect.left + rect.width / 2 - box.left, 120), box.width - 120);
    this.selection.set({ text, x, y: rect.top - box.top });
    return text;
  }

  @HostListener('document:keydown.escape')
  clearSelection(): void {
    this.selection.set(null);
    window.getSelection()?.removeAllRanges();
  }

  speakSelection(): void {
    const sel = this.selection();
    if (sel) this.say(sel.text, 'selection');
  }

  async explainSelection(): Promise<VocabWord | null> {
    const sel = this.selection();
    if (!sel) return null;
    return this.explain(sel.text);
  }

  async saveSelection(): Promise<void> {
    const word = await this.explainSelection();
    if (word) await this.save(word);
  }

  /** Meaning card: key word or saved word if known, otherwise ask Gemini (cached per selection). */
  async explain(text: string): Promise<VocabWord | null> {
    const key = text.toLowerCase();
    const known = this.paragraph()?.words.find((w) => w.word.toLowerCase() === key)
      ?? this.saved().find((w) => w.word.toLowerCase() === key)
      ?? this.meanings.get(key);
    if (known && (known.urdu || !this.prefs().urdu)) {
      this.card.set({ word: known, text, loading: false, error: '' });
      return known;
    }
    this.card.set({ word: null, text, loading: true, error: '' });
    try {
      const word = await this.bridge.explainText({ text, context: this.paragraph()?.paragraph, urdu: this.prefs().urdu });
      this.meanings.set(key, word);
      if (this.card()?.text === text) this.card.set({ word, text, loading: false, error: '' });
      return word;
    } catch (err) {
      if (this.card()?.text === text) this.card.set({ word: null, text, loading: false, error: `Could not get the meaning (${errorText(err)}).` });
      return null;
    }
  }

  openWord(word: VocabWord): void {
    this.card.set({ word, text: word.word, loading: false, error: '' });
  }

  // --- saved words --------------------------------------------------------
  isSaved(word: VocabWord): boolean {
    return this.savedKeys().has(word.word.toLowerCase());
  }

  async save(word: VocabWord): Promise<void> {
    const { word: w, partOfSpeech, meaning, example, sayIt, urdu } = word;
    this.saved.set(await this.bridge.saveWord({ word: w, partOfSpeech, meaning, example, sayIt, urdu }));
  }

  async remove(word: SavedWord): Promise<void> {
    this.saved.set(await this.bridge.removeWord(word.id));
  }
}
