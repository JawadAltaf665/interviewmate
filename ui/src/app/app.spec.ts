import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { InterviewConfig, SessionStateService } from './core/session-state.service';

@Component({ template: '<p class="page-stub">page</p>' })
class StubPage {}

const CONFIG: InterviewConfig = {
  level: 'junior', mode: 1, role: 'Angular dev', durationMin: 15, language: 'English', transcriptLanguage: 'English',
  cvSummary: null, cvFileName: null, generalSkills: '', simulation: true, coachingConsent: false,
  candidateName: '', interviewerName: 'Alex', answerMode: 'auto', pauseSec: 2.5,
};

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the InterviewMate brand and main nav', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.titlebar')?.textContent).toContain('InterviewMate');
    const links = [...el.querySelectorAll('nav a')].map((a) => a.textContent?.trim());
    expect(links).toEqual(['Dashboard', 'New Interview', 'Interview', 'Feedback', 'Reports', 'Vocabulary', 'Settings']);
  });

  it('keeps an open interview room alive while switching tabs', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([{ path: 'interview', component: StubPage }, { path: 'vocabulary', component: StubPage }])],
    }).compileComponents();
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const state = TestBed.inject(SessionStateService);
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        fixture.detectChanges();
        await fixture.whenStable();
      }
    };

    await router.navigateByUrl('/interview');
    state.openRoom(CONFIG);
    await settle();
    const room = el.querySelector('app-interview-room') as HTMLElement;
    expect(room).toBeTruthy();
    expect(room.hidden).toBe(false);
    expect(room.textContent).toContain('Junior interview');

    state.live.set(true); // as if Begin was pressed
    await router.navigateByUrl('/vocabulary');
    await settle();
    expect(el.querySelector('app-interview-room')).toBe(room); // same element: nothing was torn down
    expect(room.hidden).toBe(true);
    expect(el.querySelector('.live-banner')?.textContent).toContain('Interview in progress');

    await router.navigateByUrl('/interview');
    await settle();
    expect(el.querySelector('app-interview-room')).toBe(room);
    expect(room.hidden).toBe(false);
    expect(el.querySelector('.live-banner')).toBeNull();

    state.closeRoom();
    await settle();
    expect(el.querySelector('app-interview-room')).toBeNull();
  });
});
