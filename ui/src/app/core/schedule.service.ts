import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BridgeService } from './bridge.service';
import { ScheduledInterview } from './interviewmate-api';
import { pickInterviewerName } from './prompt';
import { bucketSchedule, interviewTitle } from './schedule';
import { InterviewConfig, SessionStateService } from './session-state.service';

/** A short two-note chime, so a reminder is noticed even with Windows notifications off. */
function chime(): void {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.22;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    /* no audio device: the banner still shows */
  }
}

/**
 * Scheduled interviews: the list (stored by the desktop app), a clock for
 * countdowns, and the reminder banner. Reminders themselves are timed in the
 * main process so they fire on any tab, or while the window is minimised.
 */
@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private readonly bridge = inject(BridgeService);
  private readonly router = inject(Router);
  private readonly state = inject(SessionStateService);

  readonly items = signal<ScheduledInterview[]>([]);
  readonly now = signal(Date.now());
  readonly buckets = computed(() => bucketSchedule(this.items(), this.now()));
  /** Reminder shown as an in-app banner until dismissed or started. */
  readonly reminder = signal<{ kind: 'early' | 'due'; item: ScheduledInterview } | null>(null);
  private started = false;

  /** Load the list and listen for reminders (once, from the app shell). */
  init(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
    setInterval(() => this.now.set(Date.now()), 15_000);
    this.bridge.onScheduleReminder(async ({ kind, id }) => {
      await this.refresh();
      const item = this.items().find((i) => i.id === id);
      if (item && !this.state.live()) {
        this.reminder.set({ kind, item });
        chime();
      }
    });
    this.bridge.onScheduleOpen(() => {
      if (!this.state.live()) void this.router.navigate(['/interview']);
    });
  }

  async refresh(): Promise<void> {
    try {
      this.items.set(await this.bridge.listSchedule());
    } catch {
      /* keep the last list */
    }
    this.now.set(Date.now());
  }

  async schedule(at: Date, config: InterviewConfig): Promise<void> {
    this.items.set(await this.bridge.saveSchedule({
      at: at.toISOString(), title: interviewTitle(config), config: config as unknown as Record<string, unknown>,
    }));
  }

  async reschedule(item: ScheduledInterview, at: Date): Promise<void> {
    this.items.set(await this.bridge.saveSchedule({ id: item.id, at: at.toISOString(), title: item.title, config: item.config }));
  }

  async remove(item: ScheduledInterview): Promise<void> {
    this.items.set(await this.bridge.removeSchedule(item.id));
    if (this.reminder()?.item.id === item.id) this.reminder.set(null);
  }

  /** Open the interview room with this item's setup; it leaves the schedule. */
  async start(item: ScheduledInterview): Promise<void> {
    const cfg = item.config as unknown as InterviewConfig;
    this.state.openRoom({ ...cfg, interviewerName: pickInterviewerName(cfg.language) });
    this.reminder.set(null);
    await this.remove(item).catch(() => undefined);
    void this.router.navigate(['/interview']);
  }
}
