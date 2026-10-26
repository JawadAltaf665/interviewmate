import { localFeedback } from './feedback-local';
import { TranscriptEntry } from './interviewmate-api';

const LONG_ANSWER =
  'First I designed the API with clear endpoints because the front end needed predictable data. ' +
  'For example in my Shop Dashboard project I used Angular services to call the .NET API, and the result was a page that loaded in under a second.';

describe('localFeedback', () => {
  it('reports limited feedback when no answers were captured', () => {
    const fb = localFeedback([], null);
    expect(fb.summary).toContain('limited');
    expect(fb.scores).toEqual([]);
  });

  it('measures answer count, length and structure honestly', () => {
    const transcript: TranscriptEntry[] = [
      { speaker: 'interviewer', text: 'How have you used Angular in a real project?' },
      { speaker: 'user', text: LONG_ANSWER },
      { speaker: 'interviewer', text: 'Tell me about the project.' },
      { speaker: 'user', text: LONG_ANSWER },
    ];
    const fb = localFeedback(transcript, 'Skills: Angular, .NET');
    expect(fb.summary).toContain('2 captured answer');
    expect(fb.scores.length).toBe(3);
    expect(fb.scores.every((s) => s.explanation.length > 0)).toBe(true);
    expect(fb.strengths.join(' ')).toContain('Angular');
    expect(fb.summary).toContain('cannot judge technical accuracy');
  });

  it('flags very short answers as an improvement area', () => {
    const transcript: TranscriptEntry[] = [
      { speaker: 'interviewer', text: 'Question?' },
      { speaker: 'user', text: 'Yes I did that once.' },
    ];
    const fb = localFeedback(transcript, null);
    expect(fb.improvements.join(' ')).toContain('Aim for 60–120 words');
  });
});
