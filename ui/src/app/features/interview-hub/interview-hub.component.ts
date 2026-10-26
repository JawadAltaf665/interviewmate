import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ScheduledInterview } from '../../core/interviewmate-api';
import { relativeTime, toLocalInput } from '../../core/schedule';
import { ScheduleService } from '../../core/schedule.service';
import { InterviewConfig, SessionStateService } from '../../core/session-state.service';

/**
 * The Interview tab. While an interview room is open the app shell shows the
 * room here instead (it lives outside the router so tab switches keep it
 * running); otherwise this lists scheduled interviews.
 */
@Component({
  selector: 'app-interview-hub',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './interview-hub.component.html',
  styleUrl: './interview-hub.component.scss',
})
export class InterviewHubComponent implements OnInit {
  readonly schedule = inject(ScheduleService);
  readonly state = inject(SessionStateService);

  readonly editingId = signal<string | null>(null);
  readonly editValue = signal('');
  readonly error = signal('');

  ngOnInit(): void {
    void this.schedule.refresh();
  }

  when(item: ScheduledInterview): string {
    return relativeTime(Date.parse(item.at), this.schedule.now());
  }

  meta(item: ScheduledInterview): string {
    const c = item.config as unknown as InterviewConfig;
    return [
      `${c.durationMin} min`, c.language,
      c.cvFileName ? 'CV attached' : 'General questions',
      c.mode === 2 ? 'Voice + coaching' : 'Voice + preview',
      c.simulation ? 'Simulation' : '',
    ].filter(Boolean).join(' · ');
  }

  edit(item: ScheduledInterview): void {
    this.error.set('');
    this.editingId.set(item.id);
    this.editValue.set(toLocalInput(new Date(item.at)));
  }

  async saveTime(item: ScheduledInterview): Promise<void> {
    const at = new Date(this.editValue());
    if (Number.isNaN(at.getTime())) {
      this.error.set('Pick a valid date and time.');
      return;
    }
    if (at.getTime() < Date.now() - 60_000) {
      this.error.set('That time has already passed. Pick a time in the future.');
      return;
    }
    await this.schedule.reschedule(item, at);
    this.editingId.set(null);
  }

  minInput(): string {
    return toLocalInput(new Date());
  }

  start(item: ScheduledInterview): void {
    if (this.state.roomOpen()) {
      this.error.set('Another interview is already open. End it first, then start this one.');
      return;
    }
    void this.schedule.start(item);
  }
}
