import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { many, manyAuthorized, one, write, writeMany, writeAuthorized } from './data.ts';
import type { LabRow, LessonRow } from './db.ts';
import { COOKIE, mandaPlataforma } from '../../auth/src/core.ts';
import { localizeLesson } from './lesson-meta.ts';
import { createAuth } from '../../auth/src/index.ts';
import type { AuthUser } from '../../auth/src/index.ts';
import { grade, hint, publicLab } from './grading.ts';
import type { BestAttempt, PublicLabSource } from './grading.ts';
import { examGate, ofPack, packScore, publicQuestion } from './assess.ts';
import type { QuestionBest, QuestionRow } from './assess.ts';
import { achievementsFor, rankLevel } from './achievements.ts';
import { LEAGUE_ZONE, closeWeek, leaguesState } from './leagues.ts';
// INTERMEDIATE STATE, said on purpose: the agent LOOP already lives in Python
// (ai/), and the TOOLS are still here — Python asks for them through
// /api/interno/herramienta and this process runs them with the userId from the
// cookie. It is coherent and it works, but it is not the destination: the tools
// move to Python (everything that is AI goes to Python) and then src/tools/
// follows src/legacy/ — the v2 agent loop and its six providers, which were
// deleted once nothing imported them. See docs/MIGRATION.md.
import { catalog, families, run as runTool } from './tools/index.ts';
import { AI_SECRET, AI_URL, aiHealth, hasAi, talkToAi } from './ai-bridge.ts';
import { loadTurns, rememberTurn, type ChatSource } from './messages-bridge.ts';
import { increment, queueState } from './jobs.ts';
import { coachState } from './coach.ts';
import { publish as publishEvent } from './bus.ts';

// ---------------------------------------------------------------------------
// API VERSIONING
//
// v3 is the canonical path: /api/v3/*. EVERYTHING older is DEPRECATED LEGACY:
//
//   /api/v3/...   CURRENT
//   /api/v2/...   deprecated legacy  (explicit alias)
//   /api/v1/...   deprecated legacy  (explicit alias; it was never published under
//                 this prefix, it is accepted so a client that writes it gets the
//                 retirement notice instead of an unexplained 404)
//   /api/...      deprecated legacy  (the unversioned surface = v2)
//
// HOW, and what this is NOT: rewriteUrl runs BEFORE routing, so /api/v3/ligas
// enters through the SAME handler as /api/ligas. They are the same handlers, not
// two copies, and by construction they cannot diverge.
//
// The cost, stated: v3 is today a ROUTE ALIAS, not a separately evolvable version.
// The day v4 has to answer differently on the same route, handlers will have to be
// duplicated for real. What it buys today: a stable path for new clients, a
// machine-readable notice on the old one, and a hit count so we know when it can
// be deleted.
//
// And with ONE consumer of our own (this repo's front end) this buys nothing
// functional yet: it is done now because it is cheap before there are clients
// outside, and very expensive afterwards.
const V_CURRENT = 3;
const V_LEGACY = 2;                       // the unversioned surface is this one
const V_OLD = [1, 2];                     // explicit prefixes, all deprecated
// Retirement date of the unversioned surface. Sunset is an HTTP date field
// (RFC 8594); Deprecation is its companion and says it already is.
const SUNSET = new Date('2027-02-21T00:00:00Z').toUTCString();
// Counted per version, not as a total: «there are 40 legacy hits» does not say
// whether v1 can be deleted, and deleting the one still in use is the mistake this
// prevents.
const hits: Record<number, number> = { 1: 0, 2: 0 };
let legacyHits = 0;   // total, for the /api/version summary

// The version marker hangs off the RAW request because rewriteUrl runs before
// Fastify's object exists. It is declared so the type checker does not read it as
// an invented property.
type RawRequest = import('node:http').IncomingMessage & { __api?: number };

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Runs before routing: it is the only place the URL can be rewritten without
  // duplicating routes. It marks the version on the raw request because after the
  // rewrite there is no way to tell which prefix it came in through.
  rewriteUrl: (req: RawRequest): string => {
    const url = req.url ?? '/';
    const pref = `/api/v${V_CURRENT}/`;
    if (url.startsWith(pref)) { req.__api = V_CURRENT; return '/api/' + url.slice(pref.length); }
    for (const v of V_OLD) {
      const p = `/api/v${v}/`;
      if (url.startsWith(p)) {
        req.__api = v; hits[v] = (hits[v] ?? 0) + 1; legacyHits++;
        return '/api/' + url.slice(p.length);
      }
    }
    if (url.startsWith('/api/')) { req.__api = V_LEGACY; hits[V_LEGACY] = (hits[V_LEGACY] ?? 0) + 1; legacyHits++; }
    return url;
  },
});

app.addHook('onSend', async (req, reply, payload) => {
  const v = (req.raw as RawRequest).__api;
  if (!v) return payload;
  reply.header('x-api-version', v === V_CURRENT ? String(V_CURRENT) : `${v}-legacy`);
  if (v !== V_CURRENT) {
    reply.header('deprecation', 'true');
    reply.header('sunset', SUNSET);
    reply.header('link', `<${req.url.replace('/api/', `/api/v${V_CURRENT}/`)}>; rel="successor-version"`);
  }
  return payload;
});
await app.register(cookie);

const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:4321';
app.addHook('onRequest', async (req, reply) => {
  const origin = req.headers.origin;
  if (origin === ORIGIN) {
    reply.header('access-control-allow-origin', origin);
    reply.header('access-control-allow-credentials', 'true');
    reply.header('access-control-allow-headers', 'content-type');
    reply.header('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
  }
  if (req.method === 'OPTIONS') reply.code(204).send();
});

// ---------- auth boundary ----------
// Identity, sessions, account lifecycle and entitlement application live in
// /auth. This process mounts that module and consumes its guards; it does not
// carry a second implementation.
const auth = createAuth({
  one, many, write, writeAuthorized,
  origin: ORIGIN, production: process.env.NODE_ENV === 'production', log: app.log,
  signal: async (signal, payload) => {
    await publishEvent('defense.signal', { signal, ...payload }, {
      key: `defense.signal.${signal}`,
      idempotencyKey: `${signal}:${String(payload.subject ?? 'unknown')}:${Date.now()}`,
      log: app.log,
    });
  },
});
auth.registerRoutes(app);
const { currentUser, requireUser, requireRole } = auth;
const LANGS = [...auth.langs];

// ---------- course ----------
// Paywall: lesson 01 and its three labs are free; the rest of Vol. 1 opens with
// the purchase. Tutors and admins see everything because accompanying is their job.
export const FREE_LESSONS = 1;
const hasAccess = (u: Pick<AuthUser, 'paid' | 'role'>, n: unknown): boolean =>
  !!u.paid || u.role !== 'student' || Number(n) <= FREE_LESSONS;

type LessonCard = Pick<LessonRow, 'n' | 'eyebrow' | 'title' | 'summary' | 'math' | 'math_cap'>;
type LabIndex = Pick<LabRow, 'id' | 'lesson_n' | 'idx' | 'level' | 'kind' | 'draft'>;

app.get<{ Querystring: { lang?: string } }>('/api/lessons', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const asked = req.query?.lang;
  const lang = asked && LANGS.includes(asked) && asked !== 'auto' ? asked : (u.lang === 'auto' ? 'es' : u.lang);
  const [bestRows, lessons, labs] = await Promise.all([
    many<BestAttempt>('attempt.best_by_lab', {}, u.id),
    many<LessonCard>('lesson.list'),
    many<LabIndex>('lab.index'),
  ]);
  const best = new Map(bestRows.map((r) => [r.lab_id, r]));
  return {
    lessons: lessons.map((l) => {
      const own = labs.filter((x) => x.lesson_n === l.n);
      const solved = own.filter((x) => best.get(x.id)?.solved === 1).length;
      const locked = !hasAccess(u, l.n);
      return { ...localizeLesson(l, lang), locked, labs: own.map((x) => ({ ...x, draft: !!x.draft, solved: best.get(x.id)?.solved === 1 })), solved, total: own.length };
    }),
  };
});

app.get<{ Params: { n: string }; Querystring: { lang?: string } }>('/api/lessons/:n', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1) return reply.code(404).send({ error: 'no_existe' });
  const asked = req.query?.lang;
  const lang = asked && LANGS.includes(asked) && asked !== 'auto' ? asked : (u.lang === 'auto' ? 'es' : u.lang);
  const card = await one<LessonCard>('lesson.card', { n });
  if (!card) return reply.code(404).send({ error: 'no_existe' });
  // The 402 carries the lesson's public card (without labs): a locked page is a
  // shop window, not a dead end.
  if (!hasAccess(u, n)) return reply.code(402).send({
    error: 'requiere_compra', libres: FREE_LESSONS,
    lesson: localizeLesson(card, lang),
    labs: await many<Pick<LabRow, 'id' | 'idx' | 'level'>>('lab.list_for_lesson_locked', { lesson_n: n }),
  });
  const [lesson, bestRows, paidLabs] = await Promise.all([
    one<LessonRow>('lesson.get', { n }),
    many<BestAttempt>('attempt.best_by_lab', {}, u.id),
    many<PublicLabSource>('lab.list_for_lesson', { lesson_n: n }),
  ]);
  if (!lesson) return reply.code(404).send({ error: 'no_existe' });
  const best = new Map(bestRows.map((r) => [r.lab_id, r]));
  const labs = paidLabs
    .map((l) => publicLab(l, best.get(l.id)?.solved === 1 ? best.get(l.id) : null));
  // Technical explanation + analogy + examples: without this the lab cannot be solved.
  type TextRow = { technical: string; analogy: string; examples: unknown };
  let texto = await one<TextRow>('lesson_text.get', { lesson_n: n, lang });
  let textoIdioma = texto ? lang : null;
  if (!texto && lang !== 'es') {
    texto = await one<TextRow>('lesson_text.get', { lesson_n: n, lang: 'es' });
    textoIdioma = texto ? 'es' : null;
  }
  const quizPack = `q${String(n).padStart(2, '0')}`;
  const [quizRows, allBest] = await Promise.all([
    many<QuestionRow>('question.list_for_pack', { pack: quizPack }),
    many<QuestionBest>('qattempt.best_by_question', {}, u.id),
  ]);
  const quizBest = ofPack(allBest, quizPack);
  const qBest = new Map(quizBest.map((b) => [b.question_id, b]));
  const quiz = quizRows.map((r) => publicQuestion(r, lang, qBest.get(r.id)));
  const quizScore = packScore(quizBest, quizRows.length);
  return { lesson: localizeLesson(lesson, lang), labs, texto, textoIdioma, quiz, quizScore };
});

// ---------- Achievements ----------
interface PerLessonRow { n: number; total: number; solved: number }

/** Recomputes the achievements they are owed and stores the ones they did not
 *  have. Returns only the new ones: the front end uses them to fire the animation. */
async function syncAchievements(userId: number) {
  const perLesson = await many<PerLessonRow>('achievement.progress_by_lesson', {}, userId);
  const should = achievementsFor(perLesson);
  const has = new Set((await many<{ code: string }>('achievement.codes', {}, userId)).map((r) => r.code));
  const nuevos = should.filter((l) => !has.has(l.code));
  for (const l of nuevos) {
    await write('achievement.record', { code: l.code, kind: l.kind, lesson_n: l.lesson_n }, userId);
  }
  return { nuevos, todos: should, perLesson };
}

app.get('/api/logros', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const { todos, perLesson } = await syncAchievements(u.id);
  const rows = await many<{ code: string; kind: string; lesson_n: number | null; earned_at: string }>(
    'achievement.mine', {}, u.id);
  const codes = rows.map((f) => f.code);
  return {
    logros: rows,
    nivel: rankLevel(codes),
    total: todos.length,
    perLesson,
  };
});

// ---------- Ranking (only whoever opts in) ----------
const ALIAS_OK = /^[a-z0-9._-]{3,18}$/;

app.get('/api/ranking', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  // Lessons completed per person, counting only lessons with all their labs solved.
  //
  // The join on users is not decoration: account deletion now removes the opt-in
  // row, and this predicate is the second lock. A row that survives — restored
  // from a backup, written by a script, inserted before the delete handler was
  // fixed — still does not put a deleted person back on the public table.
  const [table, mine] = await Promise.all([
    many<{ alias: string; lecciones: number; labs: number }>('ranking.table'),
    one<{ alias: string }>('ranking.mine', {}, u.id),
  ]);
  const pos = mine ? table.findIndex((r) => r.alias === mine.alias) + 1 : null;
  return { tabla: table, yo: { alias: mine?.alias ?? null, apuntado: !!mine, puesto: pos || null } };
});

app.post<{ Body: { alias?: unknown } }>('/api/ranking/optin', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const alias = String(req.body?.alias ?? '').trim().toLowerCase();
  if (!ALIAS_OK.test(alias)) {
    return reply.code(400).send({ error: 'alias_invalido', msg: 'De 3 a 18 caracteres: letras, números, punto, guion o guion bajo.' });
  }
  // The alias is the only public thing: the name and the email never leave the server.
  const clash = await one<{ alias: string }>('ranking.alias_clash', { alias }, u.id);
  if (clash) return reply.code(409).send({ error: 'alias_tomado' });
  await write('ranking.upsert', { alias }, u.id);
  return { alias, apuntado: true };
});

app.delete('/api/ranking/optin', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  await write('ranking.delete', {}, u.id);
  return { apuntado: false };
});

// ---------------------------------------------------------------------------
// Weekly leagues
//
// Decisions taken, not inherited:
//  · ZONE: America/Bogota for everybody. One declared zone, because with each
//    person's own zone two people see different cut-offs and the table stops
//    comparing anything.
//  · COHORT MINIMUM: below MIN_LEAGUE nobody has a league. A league of two is a
//    fake competition; saying there is not one yet is more honest.
//  · PAID AND OPTED IN ONLY: it needs ranking_optin and paid=1.
//  · TERMINAL: whoever finished all 36 labs moves to 'salon' and keeps their metal.
//
// The calculation lives in ./leagues.ts because the cron and the agent tools use it
// too: if it were here, the chat, the screen and the weekly close would count the
// week differently.
//
// leaguesState() is called instead of rebuilding the response by hand: that
// function is the only one that computes `subida` (the promotion against the last
// CLOSED week, with the window that avoids comparing you against yourself from a
// few hours ago). The other branch's inline version did not carry it, and without
// `subida` the promotion card never appears.
app.get('/api/ligas', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  return leaguesState(u.id);
});

app.post('/api/ligas/cerrar', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  if (!mandaPlataforma(u.role)) return reply.code(403).send({ error: 'solo_admin' });
  // Idempotent thanks to the PK (user_id, week) with DO NOTHING: the cron can fail
  // and retry without anybody looking at anything by hand.
  return closeWeek();
});

app.post<{ Params: { id: string }; Body: { answer?: unknown; lang?: unknown } }>('/api/labs/:id/attempt', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const id = String(req.params.id);
  const card = await one<Pick<LabRow, 'id' | 'lesson_n' | 'idx' | 'level' | 'kind' | 'draft'>>('lab.card_by_id', { id });
  if (!card) return reply.code(404).send({ error: 'no_existe' });
  if (card.draft) return reply.code(409).send({ error: 'borrador', msg: 'Este lab todavía no está escrito.' });
  if (!hasAccess(u, card.lesson_n)) return reply.code(402).send({ error: 'requiere_compra', libres: FREE_LESSONS });
  const answer = req.body?.answer;
  if (answer === undefined) return reply.code(400).send({ error: 'falta_respuesta' });
  const [gradable, explanation] = await Promise.all([
    one<{ id: string; kind: string; solution: string }>('lab.solution_for_grading', { id }),
    one<{ explanation: string }>('lab.explanation', { id }),
  ]);
  if (!gradable) return reply.code(404).send({ error: 'no_existe' });
  const correct = grade(gradable, answer);
  await write('attempt.record', { lab_id: id, answer: JSON.stringify(answer), correct: correct ? 1 : 0 }, u.id);
  // Only a correct answer can unlock anything: if they got it wrong, nothing is
  // recomputed.
  const achievements = correct ? await syncAchievements(u.id) : { nuevos: [] };
  const lang = req.body?.lang === 'en' ? 'en' : 'es';
  return { correct, explanation: explanation?.explanation ?? '', hint: hint(gradable, answer, lang), nuevos: achievements.nuevos };
});

app.get('/api/exams', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const [packs, qBest] = await Promise.all([
    many<{ pack: string; kind: string; from_n: number; to_n: number; total: number }>('question.packs'),
    many<QuestionBest>('qattempt.best_by_question', {}, u.id),
  ]);
  const currentByPack = new Map(await Promise.all(packs.map(async (p) => [
    p.pack, new Set((await many<{ id: string }>('question.list_for_pack', { pack: p.pack })).map((r) => r.id)),
  ] as const)));
  return {
    exams: packs.filter((p) => p.kind === 'exam').map((p) => {
      const n = Number(p.pack.slice(1));
      const gate = examGate(n) ?? p.to_n;
      const ids = currentByPack.get(p.pack) ?? new Set<string>();
      const score = packScore(qBest.filter((b) => ids.has(b.question_id)), ids.size);
      return { n, from: p.from_n, to: p.to_n, locked: !hasAccess(u, gate), ...score };
    }),
  };
});

app.get<{ Params: { n: string }; Querystring: { lang?: string } }>('/api/exams/:n', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const n = Number(req.params.n);
  const gate = examGate(n);
  if (gate == null) return reply.code(404).send({ error: 'no_existe' });
  if (!hasAccess(u, gate)) return reply.code(402).send({ error: 'requiere_compra', libres: FREE_LESSONS, n, from: gate - 3, to: gate });
  const asked = req.query?.lang;
  const lang = asked && LANGS.includes(asked) && asked !== 'auto' ? asked : (u.lang === 'auto' ? 'es' : u.lang);
  const pack = `e${n}`;
  const [rows, allBest] = await Promise.all([
    many<QuestionRow>('question.list_for_pack', { pack }),
    many<QuestionBest>('qattempt.best_by_question', {}, u.id),
  ]);
  const ids = new Set(rows.map((r) => r.id));
  const bestRows = ofPack(allBest, pack).filter((b) => ids.has(b.question_id));
  if (!rows.length) return reply.code(404).send({ error: 'no_existe' });
  const best = new Map(bestRows.map((b) => [b.question_id, b]));
  return {
    n, from: gate - 3, to: gate,
    questions: rows.map((r) => publicQuestion(r, lang, best.get(r.id))),
    score: packScore(bestRows, rows.length),
  };
});

app.post<{ Params: { id: string }; Body: { answer?: unknown; lang?: unknown } }>('/api/questions/:id/attempt', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const id = String(req.params.id);
  const card = await one<{ id: string; kind: string; pack: string; lesson_n: number }>('question.card_by_id', { id });
  if (!card) return reply.code(404).send({ error: 'no_existe' });
  const gateLesson = card.kind === 'exam' ? (examGate(Number(card.pack.slice(1))) ?? card.lesson_n) : card.lesson_n;
  if (!hasAccess(u, gateLesson)) return reply.code(402).send({ error: 'requiere_compra', libres: FREE_LESSONS });
  const answer = req.body?.answer;
  if (answer === undefined || answer === null || String(answer).trim() === '') {
    return reply.code(400).send({ error: 'falta_respuesta' });
  }
  const gradable = await one<{ id: string; solution: string }>('question.solution_for_grading', { id });
  if (!gradable) return reply.code(404).send({ error: 'no_existe' });
  const correct = grade({ kind: 'choice', solution: gradable.solution }, answer);
  await write('qattempt.record', { question_id: id, answer: JSON.stringify(answer), correct: correct ? 1 : 0 }, u.id);
  // Explanation is actor-scoped in /data and is deliberately read only after
  // the attempt is recorded. This prevents an unattempted question from
  // becoming an explanation oracle and makes the ownership boundary explicit.
  const expl = await one<{ explanation_es: string; explanation_en: string }>('question.explanation', { id }, u.id);
  const lang = req.body?.lang === 'en' ? 'en' : 'es';
  const explanation = lang === 'en' ? (expl?.explanation_en ?? '') : (expl?.explanation_es ?? '');
  const pack = card.pack;
  const allBest = await many<QuestionBest>('qattempt.best_by_question', {}, u.id);
  const listed = await many<{ id: string }>('question.list_for_pack', { pack });
  const listedIds = new Set(listed.map((r) => r.id));
  const bestRows = ofPack(allBest, pack).filter((b) => listedIds.has(b.question_id));
  return { correct, explanation, score: packScore(bestRows, listed.length) };
});

app.get('/api/progress', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const rows = await many<BestAttempt>('attempt.best_by_lab', {}, u.id);
  const solvedLabs = rows.filter((r) => r.solved === 1).length;
  const [totals, perLesson, packs, qBest] = await Promise.all([
    one<{ c: number }>('lab.count'),
    many<PerLessonRow>('achievement.progress_by_lesson', {}, u.id),
    many<{ pack: string; kind: string; from_n: number; to_n: number; total: number }>('question.packs'),
    many<QuestionBest>('qattempt.best_by_question', {}, u.id),
  ]);
  const lessonsDone = perLesson.filter((r) => r.solved === r.total).length;
  const solvedQ = new Set(qBest.filter((b) => b.solved === 1).map((b) => b.question_id));
  const quizPacks = packs.filter((p) => p.kind === 'quiz');
  const examPacks = packs.filter((p) => p.kind === 'exam');
  const currentIds = new Map(await Promise.all(packs.map(async (p) => [
    p.pack, new Set((await many<{ id: string }>('question.list_for_pack', { pack: p.pack })).map((r) => r.id)),
  ] as const)));
  const quizzesDone = quizPacks.filter((p) =>
    [...solvedQ].filter((id) => currentIds.get(p.pack)?.has(id)).length >= (currentIds.get(p.pack)?.size ?? 0)).length;
  const exams = examPacks.map((p) => {
    const n = Number(p.pack.slice(1));
    const gate = examGate(n) ?? p.to_n;
    const score = packScore(
      qBest.filter((b) => currentIds.get(p.pack)?.has(b.question_id)),
      currentIds.get(p.pack)?.size ?? 0,
    );
    return { n, from: p.from_n, to: p.to_n, locked: !hasAccess(u, gate), ...score };
  });
  return {
    solvedLabs, totalLabs: totals?.c ?? 0, lessonsDone, totalLessons: perLesson.length, perLesson,
    quizzesDone, quizzesTotal: quizPacks.length,
    examsPassed: exams.filter((e) => e.passed).length, exams,
  };
});

// ---------- Proactive assistant ----------
//
// One request, four indexed reads, no provider call. It exists so the floating AI
// panel can say something TRUE and specific on arrival ("lesson 3 is two labs from
// closing") instead of "hi". Everything it returns is counted from `attempts`;
// src/coach.ts explains why it reuses the agent tools' helpers rather than
// re-deriving "what next" a second time.
//
// No brake here on purpose: this is a read of the asker's own rows, the same cost
// shape as /api/progress, and it never reaches a metered provider. The brake
// guards /api/chat because that one is billed per call.
app.get('/api/coach', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const state = await coachState(u.id, u.lang);
  // requireUser already resolved the session, so a null here means the row went
  // away between the two reads (account deleted mid-request). Fail closed.
  if (!state) return reply.code(401).send({ error: 'no_session' });
  return state;
});

// ---------- AI chat ----------
const MAX_MSG_LEN = 4000;
const MAX_HIST = 24;

// ---------------------------------------------------------------------------
// SPEND CEILING ON /api/chat
//
// The endpoint capped how LONG a message could be and how MANY turns of history
// it carried, and then ran a four-turn agent loop against a metered provider
// with no limit on how OFTEN. The only counters in the process were the legacy
// API-version hit counters. So one registered account, one loop, and the bill is
// unbounded — the cheapest attack in the repository.
//
// Three limits, because one is not enough:
//
//   CHAT_PER_MINUTE      in memory, per person. Absorbs a burst and a runaway
//                        client. A restart forgetting it is harmless: the window
//                        is 60 seconds.
//   CHAT_DAY_CAP         per person per calendar day, IN POSTGRES. This one must
//                        survive a restart — an in-memory daily counter resets on
//                        deploy, and a deploy is exactly when an attacker retries.
//   CHAT_GLOBAL_DAY_CAP  per day across everyone. Without it, N accounts times the
//                        per-person cap is still unbounded, and registration is
//                        free.
//
// The day is America/Bogota, the same single declared zone as the leagues: with
// each viewer's own zone, "today" means two different things and the ceiling has
// two different edges.
const CHAT_PER_MINUTE = Math.max(1, Number(process.env.CHAT_POR_MINUTO ?? 6));
const CHAT_DAY_CAP = Math.max(1, Number(process.env.CHAT_TOPE_DIA ?? 120));
const CHAT_GLOBAL_DAY_CAP = Math.max(1, Number(process.env.CHAT_TOPE_DIA_GLOBAL ?? 4000));
const WINDOW_MS = 60_000;

const FMT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: LEAGUE_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const FMT_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: LEAGUE_ZONE, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const leagueDay = (): string => FMT_DAY.format(new Date());
export const chatDayKey = (userId: number, day = leagueDay()): string => `chat:u${userId}:${day}`;
export const chatGlobalKey = (day = leagueDay()): string => `chat:global:${day}`;

/** Seconds until the day rolls over in LEAGUE_ZONE — the retry-after for a daily cap. */
function secondsToMidnight(): number {
  const p = Object.fromEntries(FMT_TIME.formatToParts(new Date())
    .filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)])) as Record<string, number>;
  return Math.max(1, 86400 - ((p.hour ?? 0) * 3600 + (p.minute ?? 0) * 60 + (p.second ?? 0)));
}

// Sliding window per person, in memory on purpose: a burst limiter that hits
// Postgres on every message is a second cost added to fix the first one.
const windows = new Map<number, number[]>();
function minuteBucket(userId: number): { ok: boolean; esperaS?: number } {
  const now = Date.now();
  const w = (windows.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  windows.set(userId, w);
  if (w.length >= CHAT_PER_MINUTE) {
    return { ok: false, esperaS: Math.max(1, Math.ceil((WINDOW_MS - (now - w[0]!)) / 1000)) };
  }
  w.push(now);
  // The map holds one entry per person who ever chatted; swept when it grows.
  if (windows.size > 5000) {
    for (const [k, v] of windows) if (!v.some((t) => now - t < WINDOW_MS)) windows.delete(k);
  }
  return { ok: true };
}

/** The 429 payload. Keys read by web/src/lib/chat-client.ts. */
interface Brake { limite: string; esperaS: number; tope: number; msg: string }

/**
 * Returns null when the message may proceed, or the 429 payload when it may not.
 *
 * The daily counters are INCREMENTED and then compared, in one atomic statement
 * each, so two simultaneous messages cannot both read 119 and both pass. A
 * rejected message still counts, deliberately: hammering the endpoint after the
 * ceiling must not be free.
 */
async function chatBrake(userId: number): Promise<Brake | null> {
  const min = minuteBucket(userId);
  if (!min.ok) {
    return { limite: 'minuto', esperaS: min.esperaS ?? 1, tope: CHAT_PER_MINUTE,
             msg: 'Vas muy rápido. Espera un momento y vuelve a preguntar.' };
  }
  const day = leagueDay();
  const own = await increment(chatDayKey(userId, day));
  if (own > CHAT_DAY_CAP) {
    return { limite: 'dia', esperaS: secondsToMidnight(), tope: CHAT_DAY_CAP,
             msg: 'Llegaste al tope de preguntas de hoy. Mañana se reinicia.' };
  }
  const global = await increment(chatGlobalKey(day));
  if (global > CHAT_GLOBAL_DAY_CAP) {
    app.log.error({ day, global }, 'chat: platform-wide daily cap reached');
    return { limite: 'dia_global', esperaS: secondsToMidnight(), tope: CHAT_GLOBAL_DAY_CAP,
             msg: 'El chat alcanzó su tope de hoy para toda la plataforma. Vuelve mañana.' };
  }
  return null;
}

app.get('/api/chat/estado', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  // It says which provider is answering: the privacy policy promises that. The
  // fact comes from the AI service, which is what holds the keys since v3.
  //
  // And it says the tools GROUPED by family: 37 names in a row tell nobody
  // anything, and the family is exactly what explains why the agent knows about
  // your progress and about nobody else's.
  const s = await aiHealth();
  return {
    disponible: Boolean(s.ok) && (s.proveedores?.length ?? 0) > 0,
    proveedores: (s.proveedores ?? []).map((id) => ({ id, modelo: s.modelos?.[id] ?? null })),
    herramientas: catalog().map((h) => h.nombre),
    familias: families(),
    // The turn cap is declared by whoever RUNS the loop, which is the Python
    // service. It used to be imported from the v2 harness in this repository;
    // that harness is deleted, and this fallback of 4 is what the endpoint
    // reports when the AI service has not answered with its own number.
    vueltasMax: s.vueltas ?? 4,
    servicio: { ok: Boolean(s.ok), error: s.error ?? null, version: s.version ?? null,
                promptSha: s.prompt_sha ?? null, violaciones: s.violaciones ?? null },
  };
});

// ---------- Internal bridge: ONLY the AI service calls this ----------
//
// This is where the isolation actually holds. The service sends the tool name and
// the model's args; the userId comes from the COOKIE the service forwards without
// opening it. No signature accepts a person identifier, so the model has no way to
// express «somebody else's data».
//
// Both the service secret AND a valid session are required: the secret proves
// where the call came from, the cookie proves who it is for. Without both, nothing
// runs.
//
// The secret is compared in constant time, never with `===`. String `===`
// short-circuits at the first differing byte, so how long the answer takes leaks
// how many leading bytes of a guess were right, and the secret falls one byte at
// a time over enough requests.
//
// Both sides are hashed first so the comparison always runs over two 32-byte
// buffers. timingSafeEqual throws when the lengths differ, and the obvious guard
// for that -- `if (a.length !== b.length) return false` -- puts the secret's
// length back on the wire as a fast path that skips the constant-time compare
// entirely. Hashing removes the length from the comparison instead of branching
// on it.
//
// A header that is absent (undefined) or repeated (Node can hand back an array)
// collapses to '' and fails on that same single code path, without throwing.
const secretDigest = (v: string): Buffer => createHash('sha256').update(v, 'utf8').digest();

const QUEUE_SECRET = process.env.QUEUE_SECRETO?.trim() ?? '';

function matchesSecret(given: unknown, expected: string): boolean {
  if (!expected || typeof given !== 'string') return false;
  return timingSafeEqual(secretDigest(given), secretDigest(expected));
}

function isFromService(req: FastifyRequest): boolean {
  // A missing IA_SECRETO is our own configuration, not attacker input: nothing
  // about the request leaks by answering it early.
  if (!AI_SECRET) return false;
  return matchesSecret(req.headers['x-ia-secreto'], AI_SECRET ?? '');
}

// Durable bus idempotency. queue has its own identity and AI retains its own:
// accepting either credential lets both workers use the same lease contract
// without making a leaked queue credential valid against the agent/tool bridge.
// The API still does not own SQL; each action maps to one closed /data operation.
const SCHEMA_BUS_CLAIM = {
  body: {
    type: 'object', required: ['action', 'key', 'owner'], additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['claim', 'complete', 'release'] },
      key: { type: 'string', minLength: 1, maxLength: 500 },
      owner: { type: 'string', minLength: 1, maxLength: 200 },
      lease_s: { type: 'integer', minimum: 1, maximum: 86400 },
    },
  },
};

interface BusClaimBody { action: 'claim' | 'complete' | 'release'; key: string; owner: string; lease_s?: number }

app.post<{ Body: BusClaimBody }>('/api/interno/bus/claim', { schema: SCHEMA_BUS_CLAIM }, async (req, reply) => {
  const queue = matchesSecret(req.headers['x-queue-secreto'], QUEUE_SECRET);
  const ai = matchesSecret(req.headers['x-ia-secreto'], AI_SECRET ?? '');
  if (!queue && !ai) return reply.code(401).send({ error: 'servicio_no_autorizado' });

  const { action, key, owner } = req.body;
  if (action === 'claim') {
    const rows = await writeMany<{ clave: string }>('bus.claim', {
      key, worker: owner, lease: req.body.lease_s ?? 300,
    });
    return { claimed: rows.length > 0, state: rows.length ? 'running' : 'duplicate' };
  }
  await write(action === 'complete' ? 'bus.complete' : 'bus.release', { key, worker: owner });
  return { ok: true, state: action === 'complete' ? 'done' : 'released' };
});

app.get('/api/interno/catalogo', async (req, reply) => {
  if (!isFromService(req)) return reply.code(401).send({ error: 'no_es_el_servicio' });
  return { catalogo: catalog() };
});

// The schema is not decoration: Fastify validates BEFORE the handler and answers
// 400 by itself. It is the answer to tsgo's finding — «req.body is read with no
// declared shape» — in the new code. additionalProperties:false is what stops a
// field nobody looks at from arriving.
const SCHEMA_TOOL = {
  body: {
    type: 'object', required: ['nombre'], additionalProperties: false,
    properties: {
      nombre: { type: 'string', minLength: 1, maxLength: 64 },
      args: { type: 'object' },
    },
  },
};

interface ToolCallBody { nombre?: unknown; args?: unknown }

app.post<{ Body: ToolCallBody }>('/api/interno/herramienta', { schema: SCHEMA_TOOL }, async (req, reply) => {
  if (!isFromService(req)) return reply.code(401).send({ error: 'no_es_el_servicio' });
  const session = String(req.headers['x-ia-sesion'] ?? '');
  if (!session) return reply.code(401).send({ error: 'sin_sesion' });
  // The cookie is validated through the SAME path as a browser request: there is
  // no separate trusted route for the service.
  const u = await currentUser({ headers: { 'x-user-session': session } });
  if (!u) return reply.code(401).send({ error: 'sesion_invalida' });
  const name = String(req.body?.nombre ?? '');
  const args = req.body?.args && typeof req.body.args === 'object' ? req.body.args : {};
  return runTool({ userId: u.id }, name, args);
});

const SCHEMA_CHAT = {
  body: {
    type: 'object', required: ['mensajes'], additionalProperties: false,
    properties: {
      mensajes: {
        type: 'array', minItems: 1, maxItems: 64,
        items: {
          type: 'object', required: ['role', 'content'], additionalProperties: false,
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string', minLength: 1, maxLength: MAX_MSG_LEN },
          },
        },
      },
      lang: { type: 'string', enum: ['es', 'en', 'auto'] },
      fuente: { type: 'string', enum: ['chat', 'panel'] },
      proveedor: { type: 'string', enum: ['sonnet', 'deepseek', 'kimi', 'together', 'anthropic'] },
      esfuerzo: { type: 'string', enum: ['bajo', 'medio', 'alto'] },
    },
  },
};

interface ChatBody { mensajes?: unknown; lang?: unknown; fuente?: unknown; proveedor?: unknown; esfuerzo?: unknown }

app.post<{ Body: ChatBody }>('/api/chat', { schema: SCHEMA_CHAT }, async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  if (!hasAi()) {
    return reply.code(501).send({ error: 'sin_ia',
      msg: 'IA_SECRETO is missing: the API cannot talk to the AI service (ai/). Generate the keys with scripts/keys.sh.' });
  }
  const raw = Array.isArray(req.body?.mensajes) ? req.body.mensajes as { role?: unknown; content?: unknown }[] : [];
  const messages = raw
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
    .slice(-MAX_HIST)
    .map((m) => ({ role: String(m.role), content: String(m.content).slice(0, MAX_MSG_LEN) }));
  if (!messages.length) return reply.code(400).send({ error: 'sin_mensaje' });

  // The brake goes here: after the message is known to be real, before anything
  // is paid for. Every call past this line runs a four-turn agent loop against a
  // billed provider, so an unlimited endpoint is an unlimited invoice — one free
  // account with a loop is the whole attack.
  //
  // It sits AFTER requireUser so the counter is per person rather than per IP, and
  // BEFORE talkToAi so a refused message costs a Postgres increment instead of
  // four model calls.
  const brake = await chatBrake(u.id);
  if (brake) {
    reply.header('retry-after', String(brake.esperaS));
    return reply.code(429).send({ error: 'demasiadas_preguntas', ...brake });
  }

  const asked = req.body?.lang;
  const lang = typeof asked === 'string' && LANGS.includes(asked) && asked !== 'auto'
    ? asked : (u.lang === 'auto' ? 'es' : u.lang);

  // The cookie travels OPAQUE to the service: it is not opened and not translated
  // into a userId. That is the point — the AI service cannot leak what it does not
  // have.
  const session = req.cookies?.[COOKIE] ?? '';
  if (!session) return reply.code(401).send({ error: 'sin_sesion' });
  const source: ChatSource = req.body?.fuente === 'panel' ? 'panel' : 'chat';
  const pick = typeof req.body?.proveedor === 'string' ? req.body.proveedor : undefined;
  const effort = typeof req.body?.esfuerzo === 'string' ? req.body.esfuerzo : undefined;
  const r = await talkToAi({ sesion: session, mensajes: messages, lang,
    proveedor: pick, esfuerzo: effort });
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  await rememberTurn({
    userId: u.id, source, lang,
    user: lastUser ? { content: lastUser.content } : undefined,
    assistant: r.respuesta
      ? { content: r.respuesta, provider: r.proveedor, model: r.modelo, trace: r.traza }
      : undefined,
  });
  if (r.error) return reply.code(r.error === 'sin_proveedor' ? 501 : 502).send(r);
  return r;
});

app.get<{ Querystring: { fuente?: string } }>('/api/chat/history', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const source: ChatSource = req.query?.fuente === 'panel' ? 'panel' : 'chat';
  const loaded = await loadTurns(u.id, source);
  if ('error' in loaded) return reply.code(503).send(loaded);
  return loaded;
});

// ---------- PDF ----------
app.get<{ Params: { lang: string } }>('/api/pdf/:lang', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  if (!u.paid) return reply.code(402).send({ error: 'sin_compra' });
  const lang = req.params.lang === 'en' ? 'en' : 'es';
  const { existsSync, createReadStream } = await import('node:fs');
  // The PDFs live at api/files/, and this module runs from TWO places: src/ under
  // `node --experimental-strip-types` and dist/src/ after `tsgo -p .`. One hop up
  // is right in the first case and two in the second, so both are tried. The
  // fallback keeps the old single-hop path so the 503 below still names the file
  // somebody has to generate.
  const candidates = [`../files/curso-${lang}.pdf`, `../../files/curso-${lang}.pdf`];
  const path = candidates.map((rel) => new URL(rel, import.meta.url).pathname)
    .find((p) => existsSync(p)) ?? new URL(candidates[0]!, import.meta.url).pathname;
  if (!existsSync(path)) {
    return reply.code(503).send({ error: 'pdf_no_generado', msg: `api/files/curso-${lang}.pdf is missing (the headless Chrome build produces it).` });
  }
  reply.header('content-type', 'application/pdf');
  reply.header('content-disposition', `attachment; filename="ia-desde-cero-${lang}.pdf"`);
  return reply.send(createReadStream(path));
});

// ---------- tutor ----------
// The scope is decided by the ACTOR'S ROLE and said out loud in `alcance`.
//
// It used to be one predicate for both roles:
//
//   AND (us.cohort = ? OR ?::text IS NULL)
//
// `cohort` is nullable, register never sets it, and nothing in the codebase ever
// writes it — so every tutor has cohort NULL, the OR arm was true for every row,
// and the endpoint handed any tutor the name and email of every student on the
// platform. Verified: a NULL-cohort tutor got all 10 students; the tutor with
// cohort 'agosto' got 1.
//
// An admin seeing everyone is intended, so that is now its own branch. A tutor
// with no cohort sees NOBODY and is told why, because "no cohort" cannot quietly
// mean "everyone".
app.get('/api/tutor/cohort', async (req, reply) => {
  const u = await requireRole(req, reply, ['tutor', 'admin']); if (!u) return;
  const scope = mandaPlataforma(u.role) ? 'todos' : u.cohort ? 'cohorte' : 'ninguna';
  if (scope === 'ninguna') {
    return { alcance: scope, cohort: null, students: [], stuck: [],
             msg: 'Tu cuenta de tutor no tiene cohorte asignada, así que no hay estudiantes a tu cargo. Pide a un admin que te asigne una.' };
  }
  const students = scope === 'cohorte'
    ? await many<{ id: number; name: string; email: string; solved: number; last_seen: string | null }>(
        'tutor.students_cohort', { cohort: u.cohort })
    : await many<{ id: number; name: string; email: string; solved: number; last_seen: string | null }>(
        'tutor.students_all');
  // `stuck` follows the same scope. Aggregate difficulty is not personal data,
  // but a cohort view that silently mixes in other cohorts' numbers is a lie
  // about what the tutor is looking at.
  const stuck = scope === 'cohorte'
    ? await many<{ lab_id: string; tries: number; wins: number }>(
        'tutor.stuck_cohort', { cohort: u.cohort })
    : await many<{ lab_id: string; tries: number; wins: number }>('tutor.stuck_all');
  return { alcance: scope, cohort: scope === 'cohorte' ? u.cohort : null, students, stuck };
});

// Individual history is deliberately narrower than the cohort endpoint. Only a
// platform administrator may ask for it, and the data service receives both the
// student identity and the administrator identity through trusted headers. The
// response has milestones only, never a student's submitted answer.
app.get<{ Params: { id: string } }>('/api/admin/students/:id/timeline', async (req, reply) => {
  const admin = await requireRole(req, reply, ['admin']); if (!admin) return;
  const studentId = Number(req.params.id);
  if (!Number.isInteger(studentId) || studentId < 1) {
    return reply.code(404).send({ error: 'no_existe' });
  }
  const events = await manyAuthorized<{ lab_id: string; correct: number; at: string }>(
    'admin.student_timeline', {}, studentId, admin.id);
  return { events };
});


// ---------- payments gateway ----------
// Provider credentials, webhooks, retries and subscription state live in the
// independent /payments service. The course API only authenticates its user and
// forwards the minimum actor identity required to create or manage checkout.
const PAYMENTS_URL = (process.env.PAYMENTS_URL ?? '').replace(/\/+$/, '');
const PAYMENTS_SECRET = process.env.PAYMENTS_SECRET ?? '';

function paymentsUnavailable(): Response {
  return new Response(JSON.stringify({ error: 'payments_unavailable' }),
    { status: 503, headers: { 'content-type': 'application/json' } });
}

async function callPayments(path: string, init: RequestInit = {}): Promise<Response> {
  if (!PAYMENTS_URL || !PAYMENTS_SECRET) return paymentsUnavailable();
  // Configurado pero apagado es el MISMO hecho que sin configurar: no hay
  // pagos ahora mismo. Sin este catch el fetch lanza, Fastify responde 500
  // «fetch failed» y /admin entero se cae porque su panel de cobros no
  // contesta. Un servicio de pagos caido no puede tumbar la administracion.
  try {
    return await fetch(`${PAYMENTS_URL}${path}`, { ...init, headers: {
      authorization: `Bearer ${PAYMENTS_SECRET}`, 'content-type': 'application/json', ...init.headers,
    } });
  } catch (e) {
    app.log.error({ err: e, path }, 'payments unreachable');
    return paymentsUnavailable();
  }
}

async function relay(reply: FastifyReply, response: Response): Promise<unknown> {
  const text = await response.text();
  reply.code(response.status);
  if ((response.headers.get('content-type') ?? '').includes('application/json')) {
    try { return reply.send(JSON.parse(text)); } catch {}
  }
  return reply.send(text);
}

app.post<{ Body: { mode?: unknown; couponCode?: unknown } }>('/api/payments/mercadopago/preference', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const mode = req.body?.mode === 'subscription' ? 'subscription' : 'one_time';
  const couponCode = typeof req.body?.couponCode === 'string' ? req.body.couponCode : '';
  if (mode === 'subscription') {
    await publishEvent('defense.signal', { signal: 'subscription.checkout_started',
      subject: String(user.id), target: String(user.id) }, {
      key: 'defense.signal.subscription.checkout_started',
      idempotencyKey: `subscription.checkout_started:${user.id}:${Date.now()}`, log: app.log,
    });
  }
  const response = await callPayments('/v1/checkout', { method: 'POST', body: JSON.stringify({
    userId: user.id, email: user.email, mode, ...(couponCode ? { couponCode } : {}),
  }) });
  return relay(reply, response);
});

app.get('/api/subscriptions/me', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  return relay(reply, await callPayments(`/v1/subscriptions/${user.id}`));
});

app.post('/api/subscriptions/cancel', async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  return relay(reply, await callPayments(`/v1/subscriptions/${user.id}/cancel`, { method: 'POST' }));
});

// Publico a proposito: dice si el checkout puede cobrar, nada mas. /pago se
// renderiza sin sesion, y sin este dato pintaba los botones de pago aunque no
// hubiera con que cobrar; el usuario solo se enteraba al final, tras elegir
// metodo y pulsar «Suscribirme», con un aviso generico de error.
app.get('/api/payments/estado', async () => {
  const response = await callPayments('/health');
  return { disponible: response.ok };
});

app.get('/api/admin/payments', async (req, reply) => {
  const user = await requireRole(req, reply, ['admin']); if (!user) return;
  return relay(reply, await callPayments('/v1/admin/payments'));
});

// Compatibility gateway while Mercado Pago is reconfigured to call the payments
// service directly. Signature verification still happens only in /payments.
app.post<{ Body: unknown; Querystring: Record<string, string> }>(
  '/api/payments/mercadopago/webhook', async (req, reply) => {
    const query = new URLSearchParams(req.query ?? {}).toString();
    const response = await fetch(`${PAYMENTS_URL}/v1/webhooks/mercadopago${query ? `?${query}` : ''}`, {
      method: 'POST', headers: { 'content-type': 'application/json',
        'x-signature': String(req.headers['x-signature'] ?? ''),
        'x-request-id': String(req.headers['x-request-id'] ?? '') },
      body: JSON.stringify(req.body ?? {}),
    }).catch(() => new Response(JSON.stringify({ error: 'payments_unavailable' }), { status: 503 }));
    return relay(reply, response);
  });

app.post<{ Body: { eventKey?: unknown; userId?: unknown; active?: unknown; source?: unknown;
  externalId?: unknown; occurredAt?: unknown; periodEnd?: unknown } }>('/api/internal/entitlements', async (req, reply) => {
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!PAYMENTS_SECRET || !timingSafeEqual(secretDigest(bearer), secretDigest(PAYMENTS_SECRET))) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const body = req.body ?? {};
  const event = { eventKey: String(body.eventKey ?? ''), userId: Number(body.userId),
    active: body.active === true, source: String(body.source ?? ''),
    externalId: String(body.externalId ?? ''), occurredAt: String(body.occurredAt ?? ''),
    periodEnd: body.periodEnd === undefined || body.periodEnd === null ? '' : String(body.periodEnd) };
  if (!event.eventKey || !Number.isSafeInteger(event.userId) || event.userId < 1 ||
      !event.source || !event.externalId || !Number.isFinite(Date.parse(event.occurredAt))) {
    return reply.code(400).send({ error: 'invalid_entitlement_event' });
  }
  // Una fecha que no se puede leer NO se acepta como "sin vencimiento": eso
  // convertiria un error de tipeo del emisor en una suscripcion perpetua, que
  // es exactamente el fallo que este cambio existe para cerrar. Se rechaza.
  if (event.periodEnd && !Number.isFinite(Date.parse(event.periodEnd))) {
    return reply.code(400).send({ error: 'invalid_entitlement_event' });
  }
  return auth.applyEntitlement(event);
});

app.get('/api/version', async () => ({
  actual: V_CURRENT,
  deprecadas: V_OLD.map((v) => ({ version: v, prefijo: `/api/v${v}/`, estado: 'legacy-deprecado',
                                  sunset: SUNSET, golpes: hits[v] ?? 0 })),
  sinVersion: { prefijo: '/api/', trata_como: V_LEGACY, estado: 'legacy-deprecado' },
  golpesLegacy: legacyHits,
  ia: { url: AI_URL, secreto: Boolean(AI_SECRET) },
}));

app.get('/api/health', async () => {
  const labs = await one<{ c: number }>('lab.count');
  return { ok: true, labs: labs?.c ?? 0, cola: await queueState() };
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
app.listen({ port, host }).catch((e: unknown) => { app.log.error(e); process.exit(1); });
