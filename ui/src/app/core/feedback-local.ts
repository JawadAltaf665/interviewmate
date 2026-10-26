import { Feedback, TranscriptEntry } from './interviewmate-api';
import { buildLocalQuestions, parseSummarySkills } from './prompt';

// Honest local feedback: simple, measurable heuristics only (answer count,
// answer length, structure markers, filler words). It cannot judge technical
// accuracy — the summary says so. Scores are labeled as local heuristics.

const FILLERS = ['um', 'uh', 'like', 'basically', 'actually', 'you know', 'stuff'];
const STRUCTURE_MARKERS = [
  'first', 'second', 'then', 'finally', 'because', 'for example', 'example',
  'result', 'outcome', 'in summary', 'overall', 'so ', 'therefore',
];

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

export function localFeedback(transcript: TranscriptEntry[], cvSummary: string | null): Feedback {
  const answers = transcript.filter((t) => t.speaker === 'user' && t.text.trim());
  const questions = transcript.filter((t) => t.speaker === 'interviewer');

  if (answers.length === 0) {
    return {
      summary:
        'Feedback is limited: no answers were captured in the transcript, so answer quality cannot be assessed. This local summary only uses simple text heuristics and cannot judge technical accuracy.',
      strengths: [],
      improvements: ['Complete at least one full practice answer so feedback has something to measure.'],
      practiceQuestions: buildLocalQuestions(cvSummary, '', 'junior').slice(0, 3),
      scores: [],
    };
  }

  const counts = answers.map((a) => words(a.text).length);
  const avgWords = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
  const allWords = answers.flatMap((a) => words(a.text));
  const fillerCount = allWords.filter((w) => FILLERS.includes(w)).length;
  const fillerPer100 = allWords.length ? Math.round((fillerCount / allWords.length) * 1000) / 10 : 0;
  const structured = answers.filter((a) =>
    STRUCTURE_MARKERS.some((m) => a.text.toLowerCase().includes(m)),
  ).length;
  const structurePct = Math.round((structured / answers.length) * 100);
  const skills = parseSummarySkills(cvSummary);
  const mentionedSkills = skills.filter((s) =>
    answers.some((a) => a.text.toLowerCase().includes(s.toLowerCase())),
  );

  const detailScore = avgWords >= 80 ? 85 : avgWords >= 50 ? 70 : avgWords >= 25 ? 50 : 30;
  const structureScore = Math.min(95, 25 + structurePct);
  const fluencyScore = Math.max(30, Math.round(95 - fillerPer100 * 6));

  const strengths: string[] = [];
  if (avgWords >= 50) strengths.push(`Your answers averaged ${avgWords} words — a good level of detail for spoken answers.`);
  if (structurePct >= 50) strengths.push(`${structurePct}% of your answers used structure or example markers (e.g. "first", "for example", "because").`);
  if (mentionedSkills.length) strengths.push(`You referred back to your CV skills in your answers: ${mentionedSkills.join(', ')}.`);
  if (fillerPer100 <= 2) strengths.push('Filler words were rare, which keeps answers sounding confident.');
  if (!strengths.length) strengths.push('You completed the practice session — consistency is what improves interview performance.');

  const improvements: string[] = [];
  if (avgWords < 40) improvements.push(`Answers averaged only ${avgWords} words. Aim for 60–120 words: claim, example, and result.`);
  if (structurePct < 50) improvements.push('Add visible structure: start with your main point, give a concrete example, then state the result.');
  if (fillerPer100 > 3) improvements.push(`Filler words were frequent (about ${fillerPer100} per 100 words). Short pauses sound better than "um" or "like".`);
  const unmentioned = skills.filter((s) => !mentionedSkills.includes(s));
  if (skills.length && unmentioned.length) {
    improvements.push(`These CV skills never came up in your answers — prepare a short example for each: ${unmentioned.slice(0, 5).join(', ')}.`);
  }
  improvements.push('Example of a stronger structure (not your words): "In my project I used X to do Y. The main problem was Z, so I … and the result was …".');

  return {
    summary:
      `Local heuristic feedback from ${answers.length} captured answer(s) to ${questions.length} question(s): average answer length ${avgWords} words, structure markers in ${structurePct}% of answers, about ${fillerPer100} filler words per 100 words. This was computed on your device from the transcript text only — it cannot judge technical accuracy.`,
    strengths,
    improvements,
    practiceQuestions: buildLocalQuestions(cvSummary, '', 'junior').slice(0, 4),
    scores: [
      {
        label: 'Answer detail (local heuristic)',
        score: detailScore,
        explanation: `Based only on average answer length (${avgWords} words). Longer, specific answers usually score better with interviewers.`,
      },
      {
        label: 'Structure (local heuristic)',
        score: structureScore,
        explanation: `Based on structure/example markers found in ${structured} of ${answers.length} answers.`,
      },
      {
        label: 'Fluency (local heuristic)',
        score: fluencyScore,
        explanation: `Based on filler-word frequency (about ${fillerPer100} per 100 words).`,
      },
    ],
  };
}
