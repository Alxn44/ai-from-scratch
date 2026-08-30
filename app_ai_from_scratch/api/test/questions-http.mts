import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { QUESTIONS } from '../src/quizzes.ts';
import { run, pool } from '../src/db.ts';
import { one } from '../src/data.ts';
import { catalog, run as runTool } from '../src/tools/index.ts';

const port = await new Promise<number>((resolve, reject) => {
  const s = createServer(); s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const a = s.address(); if (!a || typeof a === 'string') return reject(new Error('no port')); const p = a.port; s.close(() => resolve(p)); });
});
process.env.PORT = String(port); process.env.HOST = '127.0.0.1';
const API = `http://127.0.0.1:${port}`;
await import('../src/server.ts');
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${API}/api/version`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
assert.equal((await fetch(`${API}/api/version`)).ok, true, 'API must answer over HTTP');

const cookie = (r: Response): string => (r.headers.getSetCookie?.() ?? []).map((x) => /(?:^|;\s*)sid=([^;]+)/.exec(x)?.[1]).find(Boolean) ?? '';
const req = (path: string, init: RequestInit = {}, sid = '') => fetch(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(sid ? { cookie: `sid=${sid}` } : {}) } });
const json = (init: RequestInit = {}) => ({ ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const body = (r: Response): Promise<Record<string, any>> => r.json() as Promise<Record<string, any>>;
const hasSolution = (x: unknown): boolean => JSON.stringify(x).includes('solution');
const hasSubmission = (x: unknown): boolean => JSON.stringify(x).includes('answer');

const suffix = randomBytes(10).toString('hex');
const register = async (label: string) => {
  const password = `Safe-${randomBytes(12).toString('base64url')}`;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const r = await req('/api/v3/auth/register', json({ method: 'POST', body: JSON.stringify({ email: `${slug}-${suffix}@example.test`, name: label, password }) }));
  assert.equal(r.status, 201); const sid = cookie(r); assert.ok(sid.length > 20); const u = (await body(r)).user;
  return { sid, id: u.id, password };
};
const free = await register('Free quiz');
const paid = await register('Paid exam');
const root = await register('Root solved labs');
await run('UPDATE users SET paid = 1 WHERE id = ?', [paid.id]);
await run("UPDATE users SET role = 'root' WHERE id = ?", [root.id]);

// The root register is deliberately narrower than an admin capability. A
// normal signed-in student is still forbidden, while root receives completion
// metadata only -- never a student's submission or a lab solution.
assert.equal((await req('/api/v3/root/solved-labs')).status, 401);
assert.equal((await req('/api/v3/root/solved-labs', {}, free.sid)).status, 403);
const rootLabs = await req('/api/v3/root/solved-labs', {}, root.sid);
const rootLabsBody = await body(rootLabs);
assert.equal(rootLabs.status, 200);
assert.ok(Array.isArray(rootLabsBody.labs));
assert.equal(hasSolution(rootLabsBody), false);
assert.equal(hasSubmission(rootLabsBody), false);

assert.equal((await req('/api/v3/questions/q01.1/attempt', json({ method: 'POST', body: JSON.stringify({ answer: 'a' }) }))).status, 401);
const freeLesson = await req('/api/v3/lessons/1?lang=es', {}, free.sid); const freeBody = await body(freeLesson);
assert.equal(freeLesson.status, 200); assert.equal(freeBody.quiz?.length, 3); assert.equal(hasSolution(freeBody), false);
assert.equal((await req('/api/v3/lessons/2', {}, free.sid)).status, 402);
assert.equal((await req('/api/v3/exams/1', {}, free.sid)).status, 402);
assert.equal((await req('/api/v3/exams/1', {}, paid.sid)).status, 200);

const q = QUESTIONS.find((x) => x.id === 'q01.1')!;
const beforeExplanation = await one<{ explanation_es: string; explanation_en: string }>(
  'question.explanation', { id: q.id }, free.id);
assert.equal(beforeExplanation, null, 'question explanation is withheld before first attempt');
const blank = await req(`/api/v3/questions/${q.id}/attempt`, json({ method: 'POST', body: JSON.stringify({ answer: '' }) }), free.sid);
assert.equal(blank.status, 400);
const wrong = await req(`/api/v3/questions/${q.id}/attempt`, json({ method: 'POST', body: JSON.stringify({ answer: q.answer === 'a' ? 'b' : 'a' }) }), free.sid);
assert.equal(wrong.status, 200); assert.equal((await body(wrong)).correct, false); assert.equal(hasSolution(await body(await req('/api/v3/lessons/1', {}, free.sid))), false);
const good = await req(`/api/v3/questions/${q.id}/attempt`, json({ method: 'POST', body: JSON.stringify({ answer: q.answer }) }), free.sid);
const goodBody = await body(good); assert.equal(good.status, 200); assert.equal(goodBody.correct, true); assert.ok(typeof goodBody.explanation === 'string'); assert.equal(hasSolution(goodBody), false);
const afterExplanation = await one<{ explanation_es: string; explanation_en: string }>(
  'question.explanation', { id: q.id }, free.id);
assert.ok(afterExplanation && afterExplanation.explanation_es, 'question explanation is available after attempt');
const after = await body(await req('/api/v3/lessons/1?lang=en', {}, free.sid));
assert.equal(after.quiz.find((x: any) => x.id === q.id).solved, true); assert.equal(after.quiz.find((x: any) => x.id === q.id).prompt, q.prompt_en);
assert.equal((await body(await req('/api/v3/lessons/1?lang=es', {}, paid.sid))).quiz.find((x: any) => x.id === q.id).solved, false);

const exam = QUESTIONS.filter((x) => x.pack === 'e1');
for (const [i, item] of exam.entries()) {
  const answer = i < 5 ? item.answer : (item.answer === 'a' ? 'b' : 'a');
  const r = await req(`/api/v3/questions/${item.id}/attempt`, json({ method: 'POST', body: JSON.stringify({ answer }) }), paid.sid);
  assert.equal(r.status, 200); assert.equal(hasSolution(await body(r)), false);
}
const examAfter = await body(await req('/api/v3/exams/1?lang=en', {}, paid.sid));
assert.equal(examAfter.score.correct, 5); assert.equal(examAfter.score.total, 6); assert.equal(examAfter.score.passed, true);
assert.equal(examAfter.questions[0].prompt, exam[0].prompt_en); assert.equal(hasSolution(examAfter), false);

assert.ok(catalog().some((h) => h.nombre === 'quiz_leccion'));
assert.ok(catalog().some((h) => h.nombre === 'examen'));
for (const userId of [free.id, paid.id]) {
  for (const name of ['quiz_leccion', 'examen']) {
    const result = await runTool({ userId, role: 'student', lang: 'es', turn: `qa-${name}` }, name, name === 'quiz_leccion' ? { n: 1 } : { n: 1 });
    assert.equal(hasSolution(result), false, `${name} tool must not expose solution`);
  }
}
await run('DELETE FROM attempts WHERE user_id IN (?, ?, ?)', [free.id, paid.id, root.id]);
await run('DELETE FROM users WHERE id IN (?, ?, ?)', [free.id, paid.id, root.id]);
await pool.end();
console.log('questions HTTP: auth/paywall/persistence/isolation/ES-EN/exam 5-of-6/tools passed');
process.exit(0);
