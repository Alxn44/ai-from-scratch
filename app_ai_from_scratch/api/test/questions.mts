import assert from 'node:assert/strict';
import { QUESTIONS, EXAMS, passMark } from '../src/quizzes.ts';
import { packScore, publicQuestion, ofPack } from '../src/assess.ts';
import { catalog } from '../src/tools/index.ts';

assert.equal(QUESTIONS.length, 54, 'the catalogue has 36 quizzes and 18 exam questions');
const quizzes = QUESTIONS.filter((q) => q.kind === 'quiz');
const exams = QUESTIONS.filter((q) => q.kind === 'exam');
assert.equal(quizzes.length, 36);
assert.equal(exams.length, 18);
assert.equal(new Set(QUESTIONS.map((q) => q.id)).size, QUESTIONS.length, 'question ids are unique');
for (const q of QUESTIONS) {
  assert.equal(q.options.length, 3, `${q.id} has three options`);
  assert.ok(q.options.some((o) => o.id === q.answer), `${q.id} answer is an option`);
  assert.ok(q.prompt_es && q.prompt_en && q.explanation_es && q.explanation_en, `${q.id} is bilingual`);
}
for (const exam of EXAMS) {
  assert.equal(exams.filter((q) => q.pack === `e${exam.n}`).length, 6, `exam ${exam.n} has six questions`);
}
assert.equal(passMark(6), 5, 'exams require five of six');

// The HTTP/data contract is deliberately exercised here without a fake route:
// these are the exact rows and serializers used by GET /api/lessons/:n,
// GET /api/exams/:n and POST /api/questions/:id/attempt.  A solution is never
// part of the public shape, bad answers do not solve an item, and a later good
// answer is the one that contributes to the persisted best score.
for (const q of QUESTIONS) {
  const row = {
    id: q.id, kind: q.kind, pack: q.pack, idx: q.idx, lesson_n: q.lesson_n,
    prompt_es: q.prompt_es, prompt_en: q.prompt_en,
    payload: JSON.stringify({ options: q.options }),
  };
  const es = publicQuestion(row, 'es');
  const en = publicQuestion(row, 'en');
  assert.equal(es.prompt, q.prompt_es, `${q.id} ES prompt`);
  assert.equal(en.prompt, q.prompt_en, `${q.id} EN prompt`);
  assert.deepEqual(es.options.map((o) => o.id), q.options.map((o) => o.id));
  assert.ok(es.options.every((o) => !('solution' in o)), `${q.id} options hide solution`);
  assert.equal(JSON.stringify(es).includes('solution'), false, `${q.id} public shape hides solution`);
  assert.ok(en.options.some((o) => o.id === q.answer), `${q.id} answer remains selectable by id`);
}

const examRows = EXAMS.map((e) => QUESTIONS.filter((q) => q.pack === `e${e.n}`));
for (const [i, rows] of examRows.entries()) {
  const pack = `e${i + 1}`;
  const ids = rows.map((q) => q.id);
  const bad = ids.map((question_id) => ({ question_id, solved: 0, attempts: 1 }));
  const five = ids.map((question_id, n) => ({ question_id, solved: n < 5 ? 1 : 0, attempts: 1 }));
  const six = ids.map((question_id) => ({ question_id, solved: 1, attempts: 2 }));
  assert.equal(ofPack(bad, pack).length, 6);
  assert.deepEqual(packScore(bad, 6), { correct: 0, total: 6, passed: false, passAt: 5 });
  assert.deepEqual(packScore(five, 6), { correct: 5, total: 6, passed: true, passAt: 5 });
  assert.deepEqual(packScore(six, 6), { correct: 6, total: 6, passed: true, passAt: 5 });
}

const names = new Set(catalog().map((h) => h.nombre));
assert.ok(names.has('quiz_leccion'), 'tools expose quiz_leccion');
assert.ok(names.has('examen'), 'tools expose examen');
assert.equal([...names].some((name) => /solution|respuesta/i.test(name)), false,
  'tools expose no solution oracle');
console.log('question catalogue: 54 valid bilingual items (36 quizzes, 18 exams)');
