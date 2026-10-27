import { Component, effect, ElementRef, inject, input, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Block, parseMarkdown } from '../../core/coach';
import { CoachService } from '../../core/coach.service';
import { ChatMessage } from '../../core/interviewmate-api';

/**
 * The Coach conversation: used as the side panel on every page and as the
 * full Coach page (which adds the chat history list).
 */
@Component({
  selector: 'app-coach-chat',
  imports: [FormsModule],
  templateUrl: './coach-chat.component.html',
  styleUrl: './coach-chat.component.scss',
})
export class CoachChatComponent {
  readonly layout = input<'panel' | 'page'>('panel');
  protected readonly coach = inject(CoachService);
  private readonly router = inject(Router);
  protected readonly showHistory = signal(false);
  protected readonly suggestions = [
    'What should I improve first?',
    'Make me a 7-day practice plan',
    'Discuss my last interview',
    'Ask me a practice question',
    'Schedule a practice interview for tomorrow evening',
  ];
  @ViewChild('scroller') private scroller?: ElementRef<HTMLElement>;
  private readonly blockCache = new Map<string, { text: string; blocks: Block[] }>();

  constructor() {
    // Follow the conversation as it grows.
    effect(() => {
      this.coach.messages();
      this.coach.busy();
      setTimeout(() => {
        const el = this.scroller?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  }

  protected blocks(m: ChatMessage): Block[] {
    const hit = this.blockCache.get(m.id);
    if (hit && hit.text === m.text) return hit.blocks;
    const blocks = parseMarkdown(m.text);
    this.blockCache.set(m.id, { text: m.text, blocks });
    return blocks;
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.send();
    }
  }

  protected send(text = this.coach.draft()): void {
    void this.coach.send(text);
  }

  protected isPending(msgId: string, index: number): boolean {
    const p = this.coach.pending();
    return !!p && p.msgId === msgId && p.index === index;
  }

  protected openChat(id: string): void {
    void this.coach.loadChat(id);
    this.showHistory.set(false);
  }

  protected newChat(): void {
    this.coach.newChat();
    this.showHistory.set(false);
  }

  protected expand(): void {
    void this.router.navigate(['/coach']);
  }

  protected toggleHistory(): void {
    this.showHistory.update((v) => !v);
    if (this.showHistory()) void this.coach.refreshChats();
  }

  protected when(iso: string): string {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days < 1 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
}
