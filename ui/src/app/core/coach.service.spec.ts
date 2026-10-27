import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { BridgeService } from './bridge.service';
import { CoachService } from './coach.service';
import { CoachTurnResult } from './interviewmate-api';
import { ScheduleService } from './schedule.service';

const reply = (r: Partial<CoachTurnResult>): CoachTurnResult =>
  ({ content: { role: 'model', parts: [{ text: r.text ?? '' }] }, text: '', functionCalls: [], finishReason: 'STOP', model: 'm', ...r });

function setup(turns: CoachTurnResult[]) {
  const scheduled = vi.fn(async () => undefined);
  const bridge = {
    isDesktop: () => true,
    coachTurn: vi.fn(async () => turns.shift()!),
    listSessions: vi.fn(async () => []),
    listChats: vi.fn(async () => []),
    saveChat: vi.fn(async (c: { id?: string }) => ({ ...c, id: c.id ?? 'chat1' })),
    getSettings: vi.fn(async () => ({})),
  };
  const schedule = { refresh: vi.fn(async () => undefined), items: () => [], schedule: scheduled, now: () => Date.now() };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: BridgeService, useValue: bridge }, { provide: ScheduleService, useValue: schedule }],
  });
  return { coach: TestBed.inject(CoachService), bridge, scheduled };
}

const scheduleCall = reply({ functionCalls: [{ name: 'schedule_interview', args: { level: 'junior', at: '2099-01-01T10:00' } }] });
const later = new Date(Date.now() + 86_400_000);
const at = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, '0')}-${String(later.getDate()).padStart(2, '0')}T10:00`;
scheduleCall.functionCalls[0].args['at'] = at;

describe('CoachService', () => {
  it('never runs an action until the user confirms it', async () => {
    const { coach, scheduled } = setup([scheduleCall, reply({ text: 'Scheduled for you.' })]);
    const done = coach.send('Schedule a practice interview tomorrow at 10');
    await vi.waitFor(() => expect(coach.pending()).not.toBeNull());
    expect(scheduled).not.toHaveBeenCalled();
    expect(coach.messages().at(-1)?.actions?.[0]).toMatchObject({ title: 'Schedule interview', status: 'pending' });
    coach.answer(true);
    await done;
    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(coach.messages().at(-1)).toMatchObject({ text: 'Scheduled for you.' });
    expect(coach.messages().at(-1)?.actions?.[0].status).toBe('done');
  });

  it('tells the model when the user cancels, and does nothing', async () => {
    const { coach, scheduled, bridge } = setup([scheduleCall, reply({ text: 'No problem.' })]);
    const done = coach.send('Schedule one');
    await vi.waitFor(() => expect(coach.pending()).not.toBeNull());
    coach.answer(false);
    await done;
    expect(scheduled).not.toHaveBeenCalled();
    expect(coach.messages().at(-1)?.actions?.[0].status).toBe('cancelled');
    const sent = (bridge.coachTurn.mock.calls.at(-1) as unknown as [{ contents: { parts: { functionResponse?: { response: unknown } }[] }[] }])[0].contents;
    const result = sent.flatMap((c) => c.parts).find((p) => p.functionResponse)?.functionResponse?.response;
    expect(result).toMatchObject({ ok: false, cancelled: true });
  });

  it('opens a page only after Confirm', async () => {
    const { coach } = setup([reply({ functionCalls: [{ name: 'open_page', args: { page: 'settings' } }] }), reply({ text: 'Opened.' })]);
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const done = coach.send('Take me to settings');
    await vi.waitFor(() => expect(coach.pending()).not.toBeNull());
    expect(nav).not.toHaveBeenCalled();
    coach.answer(true);
    await done;
    expect(nav).toHaveBeenCalledWith(['/settings'], { queryParams: {} });
  });

  it('keeps the old history when a turn fails', async () => {
    const { coach, bridge } = setup([]);
    bridge.coachTurn.mockRejectedValueOnce(new Error('All keys are out of quota.'));
    await coach.send('Hello');
    expect(coach.messages().at(-1)).toMatchObject({ role: 'error' });
    expect(coach.messages().at(-1)?.text).toContain('out of quota');
    bridge.coachTurn.mockResolvedValueOnce(reply({ text: 'Hi again.' }));
    await coach.send('Hello?');
    const sent = (bridge.coachTurn.mock.calls.at(-1) as unknown as [{ contents: { role: string; parts: { text?: string }[] }[] }])[0].contents;
    // The failed turn left nothing behind: the history is the new message and its reply.
    expect(sent.map((c) => c.role)).toEqual(['user', 'model']);
    expect(sent[0].parts[0].text).toBe('Hello?');
  });
});
