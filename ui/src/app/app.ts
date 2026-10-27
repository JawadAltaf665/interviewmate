import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { BridgeService } from './core/bridge.service';
import { CoachService } from './core/coach.service';
import { relativeTime } from './core/schedule';
import { ScheduleService } from './core/schedule.service';
import { SessionStateService } from './core/session-state.service';
import { InterviewRoomComponent } from './features/interview-room/interview-room.component';
import { CoachChatComponent } from './shared/coach-chat/coach-chat.component';
import { ThemeService } from './core/theme.service';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, InterviewRoomComponent, CoachChatComponent],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly bridge = inject(BridgeService);
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  protected readonly activeKeys = signal(0);
  protected readonly version = signal('');
  protected readonly state = inject(SessionStateService);
  protected readonly schedule = inject(ScheduleService);
  protected readonly coach = inject(CoachService);
  private readonly url = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map((e) => e.urlAfterRedirects)),
    { initialValue: this.router.url },
  );
  /** The Interview tab is showing: the hosted interview room is visible. */
  protected readonly onInterview = computed(() => this.url().split(/[?#]/)[0] === '/interview');
  /** The Coach panel and its button stay away from the Coach page and the live interview room. */
  protected readonly coachAllowed = computed(() => {
    const path = this.url().split(/[?#]/)[0];
    return path !== '/coach' && !(this.onInterview() && this.state.roomOpen());
  });
  protected readonly coachDocked = computed(() => this.coachAllowed() && this.coach.panelOpen());
  protected readonly scheduledCount = computed(() => this.schedule.buckets().upcoming.length + this.schedule.buckets().due.length);

  ngOnInit(): void {
    this.schedule.init();
    if (!this.bridge.isDesktop()) return;
    void this.bridge.getAppInfo().then((i) => this.version.set(i.version)).catch(() => undefined);
    void this.refreshKeys();
    // Keys change on the Settings page; refresh the sidebar status on navigation.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => void this.refreshKeys());
  }

  protected startsIn(at: string): string {
    const when = relativeTime(Date.parse(at), this.schedule.now());
    return when === 'now' ? 'starts now' : `starts ${when}`;
  }

  private async refreshKeys(): Promise<void> {
    try {
      this.activeKeys.set((await this.bridge.listCredentials()).filter((c) => !c.disabled).length);
    } catch {
      this.activeKeys.set(0);
    }
  }
}
