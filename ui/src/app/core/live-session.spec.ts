import { realtimeInputConfig } from './live-session';

describe('realtimeInputConfig', () => {
  it('auto: low end-of-speech sensitivity with the chosen pause', () => {
    const cfg = realtimeInputConfig({ answerMode: 'auto', pauseSec: 4 });
    expect(cfg.automaticActivityDetection?.endOfSpeechSensitivity).toBe('END_SENSITIVITY_LOW');
    expect(cfg.automaticActivityDetection?.silenceDurationMs).toBe(4000);
    expect(cfg.automaticActivityDetection?.disabled).toBeUndefined();
  });

  it('manual: server detection off, interviewer never cuts in', () => {
    const cfg = realtimeInputConfig({ answerMode: 'manual', pauseSec: 2.5 });
    expect(cfg.automaticActivityDetection?.disabled).toBe(true);
    expect(cfg.activityHandling).toBe('NO_INTERRUPTION');
  });
});
