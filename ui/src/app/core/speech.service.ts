import { inject, Injectable, signal } from '@angular/core';
import { BridgeService } from './bridge.service';
import { VocabSpeed, VocabVoice } from './interviewmate-api';
import { errorText, SPEED_RATE } from './vocab';

export type SpeechState = 'idle' | 'loading' | 'playing' | 'paused';

const MAX_CACHED_CLIPS = 40;

/**
 * Read-aloud for the Vocabulary tab. Gemini voices are fetched once per
 * (voice, text) and kept as blob URLs, so replays and speed changes cost no
 * API call; speed is the player's playbackRate with pitch preserved. When the
 * Gemini voice is unavailable (quota, network) it falls back to the voice
 * built into Windows (speechSynthesis), which also reports exact word positions.
 */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  private readonly bridge = inject(BridgeService);

  readonly state = signal<SpeechState>('idle');
  /** What is being read (the caller's id, e.g. 'paragraph'), or null. */
  readonly playingId = signal<string | null>(null);
  readonly source = signal<'gemini' | 'offline' | null>(null);
  /** Gemini clip: fraction played (0–1). */
  readonly progress = signal(0);
  /** Offline voice: character offset of the word being spoken. */
  readonly charIndex = signal(-1);
  /** Why the Gemini voice was not used for the last clip (empty when it was). */
  readonly note = signal('');

  private readonly clips = new Map<string, string>();
  private audio: HTMLAudioElement | null = null;
  private offline: { text: string; token: number; utter: SpeechSynthesisUtterance } | null = null;
  private rate = 1;
  private token = 0;

  async play(text: string, opts: { id: string; voice: VocabVoice; speed: VocabSpeed }): Promise<void> {
    this.stop();
    const my = ++this.token;
    this.rate = SPEED_RATE[opts.speed];
    this.playingId.set(opts.id);
    this.note.set('');
    if (opts.voice === 'offline') {
      this.speakOffline(text, 0, my);
      return;
    }
    this.state.set('loading');
    try {
      const url = await this.clipUrl(text, opts.voice);
      if (my !== this.token) return; // stopped or replaced while loading
      const audio = new Audio(url);
      audio.preservesPitch = true;
      audio.playbackRate = this.rate;
      audio.ontimeupdate = () => { if (audio.duration) this.progress.set(audio.currentTime / audio.duration); };
      audio.onended = () => { if (my === this.token) this.reset(); };
      this.audio = audio;
      this.source.set('gemini');
      await audio.play();
      if (my === this.token) this.state.set('playing');
    } catch (err) {
      if (my !== this.token) return;
      this.note.set(`Gemini voice unavailable (${errorText(err)}). Using the Windows voice instead.`);
      this.speakOffline(text, 0, my);
    }
  }

  pause(): void {
    if (this.state() !== 'playing') return;
    if (this.audio) this.audio.pause();
    else window.speechSynthesis?.pause();
    this.state.set('paused');
  }

  resume(): void {
    if (this.state() !== 'paused') return;
    if (this.audio) void this.audio.play();
    else window.speechSynthesis?.resume();
    this.state.set('playing');
  }

  /** Change speed now: live for Gemini audio; the offline voice restarts from the current word. */
  setSpeed(speed: VocabSpeed): void {
    this.rate = SPEED_RATE[speed];
    if (this.audio) this.audio.playbackRate = this.rate;
    else if (this.offline && this.state() === 'playing') {
      const { text, token } = this.offline;
      this.speakOffline(text, Math.max(0, this.charIndex()), token);
    }
  }

  stop(): void {
    this.token++;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
    }
    if (this.offline) window.speechSynthesis?.cancel();
    this.reset();
  }

  private reset(): void {
    this.audio = null;
    this.offline = null;
    this.state.set('idle');
    this.playingId.set(null);
    this.source.set(null);
    this.progress.set(0);
    this.charIndex.set(-1);
  }

  private async clipUrl(text: string, voice: Exclude<VocabVoice, 'offline'>): Promise<string> {
    const key = `${voice}|${text}`;
    const hit = this.clips.get(key);
    if (hit) {
      this.clips.delete(key); // re-insert: most recently used last
      this.clips.set(key, hit);
      return hit;
    }
    const { audioBase64, mimeType } = await this.bridge.speak(text, voice);
    const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    this.clips.set(key, url);
    if (this.clips.size > MAX_CACHED_CLIPS) {
      const [oldKey, oldUrl] = this.clips.entries().next().value!;
      this.clips.delete(oldKey);
      URL.revokeObjectURL(oldUrl);
    }
    return url;
  }

  private speakOffline(text: string, offset: number, my: number): void {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) {
      this.note.set('No voice is available on this computer.');
      this.reset();
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(offset));
    u.rate = this.rate;
    u.lang = 'en-US';
    const voices = synth.getVoices();
    u.voice = voices.find((v) => v.lang === 'en-US') ?? voices.find((v) => v.lang.startsWith('en')) ?? null;
    // Only the current utterance may report: a speed change replaces it mid-sentence.
    const current = () => my === this.token && this.offline?.utter === u;
    u.onboundary = (e) => { if (current()) this.charIndex.set(offset + e.charIndex); };
    u.onend = () => { if (current()) this.reset(); };
    u.onerror = (e) => {
      if (!current() || e.error === 'interrupted' || e.error === 'canceled') return;
      this.note.set(`The Windows voice could not read this (${e.error}).`);
      this.reset();
    };
    this.offline = { text, token: my, utter: u };
    this.source.set('offline');
    this.state.set('playing');
    synth.speak(u);
  }
}
