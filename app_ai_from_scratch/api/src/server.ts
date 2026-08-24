import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { all, get, migrate, run } from './db.ts';
import type { LabRow, LessonRow, UserRow } from './db.ts';
import { COOKIE, TOKEN_MINUTES, cookieOpts, hashPassword, hashToken, newToken, sign, spendKdf, verify, verifyPassword } from './auth.ts';
import { grade, hint, publicLab } from './grading.ts';
import type { BestAttempt } from './grading.ts';
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
import { enqueue, increment, queueState, register, worker } from './jobs.ts';
import { coachState } from './coach.ts';

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

// ---------- session ----------
const USER_BY_ID = 'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL';

// THE session resolver. Every door — browser cookie and AI service header alike —
// goes through this one function.
//
// It used to exist twice. The browser copy compared token_version; the copy in
// /api/interno/herramienta selected only `id`, so it had no column to compare and
// never checked. A password reset therefore revoked the browser session and left
// the agent session alive, while the reset endpoint answered
// { sesionesCerradas: true }. Proven: token_version 0 -> 1, same cookie, GET /me
// answered 401 and the tool call answered 200.
//
// Two implementations of one rule is how that happened, so there is now one.
async function resolveSession(token: unknown): Promise<UserRow | null> {
  const t = verify(token);
  if (!t?.sub) return null;
  const u = await get<UserRow>(USER_BY_ID, [t.sub]);
  // Changing the password bumps token_version: every cookie issued before it dies.
  if (!u || (t.v ?? 0) !== u.token_version) return null;
  return u;
}

const currentUser = (req: FastifyRequest): Promise<UserRow | null> => resolveSession(req.cookies?.[COOKIE]);

async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<UserRow | null> {
  const u = await currentUser(req);
  if (!u) { reply.code(401).send({ error: 'no_session' }); return null; }
  return u;
}

async function requireRole(req: FastifyRequest, reply: FastifyReply, roles: readonly string[]): Promise<UserRow | null> {
  const u = await requireUser(req, reply);
  if (!u) return null;
  if (!roles.includes(u.role)) { reply.code(403).send({ error: 'forbidden', need: roles }); return null; }
  return u;
}

/** The public shape of a user. Wire format: web/src/lib/session.ts reads it. */
const shape = (u: UserRow) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, lang: u.lang,
  theme: u.theme, paid: !!u.paid, cohort: u.cohort,
});

// 'auto' = follow the device (Accept-Language / prefers-color-scheme).
// fr and pt are already accepted: if there is no dictionary yet, the front end
// falls back to Spanish and the lesson says so. That way adding a language does
// not require touching the API.
const LANGS = ['es', 'en', 'fr', 'pt', 'auto'];
const THEMES = ['dark', 'paper', 'auto'];
const pref = (v: unknown, allowed: readonly string[]): string =>
  (typeof v === 'string' && allowed.includes(v) ? v : 'auto');

// ---------- auth ----------
// ONE failure answer for every way of not getting in. Frozen as a constant so a
// later edit cannot add a field to one branch and forget the other — which is
// exactly how the previous three oracles appeared.
const LOGIN_NO = { error: 'credenciales' };
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const isLocked = (u: UserRow | null | undefined): boolean =>
  Boolean(u?.locked_until && u.locked_until > new Date());

/** POST /api/auth/login. Everything is optional because it is attacker input. */
interface LoginBody { email?: unknown; password?: unknown; lang?: unknown; theme?: unknown }

// Login used to answer three different things depending on whether the address
// had an account, and all three were readable from outside:
//
//   body    { left: 2 } when the row existed, { left: null } when it did not
//   timing  verifyPassword only ran on a found row: 52 ms present, 26 ms absent
//   status  423 'bloqueada' before the password was checked — a lock reply on an
//           address you do not own confirms the account by itself
//
// Now: same status, same body, same work spent. The remaining-attempts hint is
// gone from the pre-auth response; web/src/pages/login.astro:118 already falls
// back to a generic message when `left` is absent.
app.post<{ Body: LoginBody }>('/api/auth/login', async (req, reply) => {
  const { email, password, lang, theme } = req.body ?? {};
  if (!email || !password) return reply.code(400).send({ error: 'faltan_datos' });
  const plain = String(password);
  const u = await get<UserRow>('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [String(email).toLowerCase()]);

  // The KDF is spent either way. With no row there is no hash to check, so the
  // same work goes into a decoy: the two paths cost the same wall clock.
  const ok = u ? await verifyPassword(plain, u.pass_hash) : await spendKdf(plain);
  if (!ok) {
    // A locked account is not counted again: re-arming the lock on every attempt
    // would let anyone hold someone else out forever.
    if (u && !isLocked(u)) {
      const failed = u.failed + 1;
      const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MS).toISOString() : null;
      await run('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?', [failed, lock, u.id]);
    }
    return reply.code(401).send(LOGIN_NO);
  }
  // The password checked out, so whoever is asking owns the account: from here
  // it is safe to say the account is locked. Saying it BEFORE was the oracle.
  if (isLocked(u)) return reply.code(423).send({ error: 'bloqueada', until: u!.locked_until });

  await run('UPDATE users SET failed = 0, locked_until = NULL WHERE id = ?', [u!.id]);
  // The language or theme the visitor chose before logging in is adopted only if
  // the account was still on 'auto': an explicit account preference is never
  // overwritten.
  if (u!.lang === 'auto' && typeof lang === 'string' && LANGS.includes(lang) && lang !== 'auto') {
    await run('UPDATE users SET lang = ? WHERE id = ?', [lang, u!.id]);
  }
  if (u!.theme === 'auto' && typeof theme === 'string' && THEMES.includes(theme) && theme !== 'auto') {
    await run('UPDATE users SET theme = ? WHERE id = ?', [theme, u!.id]);
  }
  reply.setCookie(COOKIE, sign({ sub: u!.id, role: u!.role, v: u!.token_version }), cookieOpts);
  const fresh = await get<UserRow>(USER_BY_ID, [u!.id]);
  return { user: shape(fresh!) };
});

app.post('/api/auth/logout', async (req, reply) => {
  reply.clearCookie(COOKIE, { path: '/' });
  return { ok: true };
});

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

interface RegisterBody { email?: unknown; name?: unknown; password?: unknown; lang?: unknown; theme?: unknown }

app.post<{ Body: RegisterBody }>('/api/auth/register', async (req, reply) => {
  const { email, name, password, lang, theme } = req.body ?? {};
  const mail = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) return reply.code(400).send({ error: 'correo_invalido' });
  if (String(name ?? '').trim().length < 2) return reply.code(400).send({ error: 'nombre_corto' });
  if (String(password ?? '').length < 8) return reply.code(400).send({ error: 'clave_corta', msg: 'Mínimo 8 caracteres.' });
  const taken = await get<{ id: number }>('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', [mail]);
  if (taken) return reply.code(409).send({ error: 'correo_en_uso' });
  const u = await get<UserRow>(`INSERT INTO users (email,name,pass_hash,role,paid,lang,theme)
                                VALUES (?,?,?,?,0,?,?) RETURNING *`,
    [mail, String(name).trim(), await hashPassword(String(password)), 'student',
     pref(lang, LANGS), pref(theme, THEMES)]);
  reply.setCookie(COOKIE, sign({ sub: u!.id, role: u!.role, v: u!.token_version }), cookieOpts);
  return reply.code(201).send({ user: shape(u!) });
});

// Asks for a recovery link. It ALWAYS answers the same thing, whether the account
// exists or not: if it said «that email has no account», anybody could find out
// who bought the course.
app.post<{ Body: { email?: unknown } }>('/api/auth/recover', async (req, reply) => {
  const mail = String(req.body?.email ?? '').trim().toLowerCase();
  const answer = { ok: true, msg: 'Si ese correo tiene cuenta, el enlace ya salió.' };
  if (!EMAIL_RE.test(mail)) return reply.code(400).send({ error: 'correo_invalido' });

  const u = await get<Pick<UserRow, 'id' | 'name'>>('SELECT id, name FROM users WHERE email = ? AND deleted_at IS NULL', [mail]);
  if (!u) return answer;

  // Per-account limit: 3 links an hour. Without this the form is an email cannon
  // aimed at any address somebody wants to bother.
  const rate = await get<{ c: number }>(
    "SELECT COUNT(*)::int AS c FROM reset_tokens WHERE user_id = ? AND created_at > now() - interval '1 hour'",
    [u.id]);
  if ((rate?.c ?? 0) >= 3) {
    app.log.warn({ userId: u.id }, 'recover: hourly limit reached');
    return answer;
  }

  const token = newToken();
  await run(
    `INSERT INTO reset_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, now() + interval '${TOKEN_MINUTES} minutes')`,
    [u.id, hashToken(token)]);

  const link = `${ORIGIN}/recuperar?t=${token}`;
  // There is no mail provider configured. Instead of faking a send, the link goes
  // to the server log and, outside production, is returned to the client.
  app.log.info({ link }, 'recover: link generated (no mail provider configured)');
  if (process.env.NODE_ENV !== 'production') return { ...answer, dev_enlace: link };
  return answer;
});

// Redeems the link. The token is compared by hash, used exactly once, and changing
// the password closes the sessions open on other devices.
app.post<{ Body: { token?: unknown; password?: unknown } }>('/api/auth/reset', async (req, reply) => {
  const { token, password } = req.body ?? {};
  if (String(password ?? '').length < 8) {
    return reply.code(400).send({ error: 'clave_corta', msg: 'Mínimo 8 caracteres.' });
  }
  const row = await get<{ id: number; user_id: number; used_at: Date | null; vencido: boolean }>(
    `SELECT r.id, r.user_id, r.used_at, r.expires_at < now() AS vencido
     FROM reset_tokens r WHERE r.token_hash = ?`, [hashToken(String(token ?? ''))]);
  if (!row) return reply.code(400).send({ error: 'enlace_invalido', msg: 'Ese enlace no sirve. Pide uno nuevo.' });
  if (row.used_at) return reply.code(409).send({ error: 'enlace_usado', msg: 'Ese enlace ya se usó. Pide uno nuevo.' });
  if (row.vencido) return reply.code(410).send({ error: 'enlace_vencido', msg: `El enlace dura ${TOKEN_MINUTES} minutos. Pide uno nuevo.` });

  const u = await get<UserRow>('UPDATE users SET pass_hash = ?, token_version = token_version + 1, failed = 0, locked_until = NULL WHERE id = ? RETURNING *',
    [await hashPassword(String(password)), row.user_id]);
  await run('UPDATE reset_tokens SET used_at = now() WHERE id = ?', [row.id]);
  // This person's other pending links die with the one just used.
  await run('UPDATE reset_tokens SET used_at = now() WHERE user_id = ? AND used_at IS NULL', [row.user_id]);

  reply.setCookie(COOKIE, sign({ sub: u!.id, role: u!.role, v: u!.token_version }), cookieOpts);
  return { user: shape(u!), sesionesCerradas: true };
});

// Soft delete: keeps the row and the attempts, rotates the email to free it, and
// anonymises the name.
app.post<{ Body: { password?: unknown } }>('/api/account/delete', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const { password } = req.body ?? {};
  if (!await verifyPassword(String(password ?? ''), u.pass_hash)) {
    return reply.code(401).send({ error: 'clave_incorrecta', msg: 'Confirma con tu contraseña actual.' });
  }
  if (u.role === 'admin') {
    const admins = await get<{ c: number }>("SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND deleted_at IS NULL");
    if ((admins?.c ?? 0) <= 1) return reply.code(409).send({ error: 'ultimo_admin', msg: 'No puedes dejar la plataforma sin admins.' });
  }
  await run(`UPDATE users SET deleted_at = now(), email = ?, name = 'Cuenta borrada' WHERE id = ?`,
    [`borrado+${u.id}@alpadev.local`, u.id]);
  // The opt-in row goes with the account. The soft delete rotated the email and
  // blanked the name, but ranking_optin held an alias the person CHOSE — and
  // aliases allow 3-18 chars of [a-z0-9._-], so real names pass the validator.
  // Left behind, that alias and their weekly progress kept appearing in the
  // public ranking and in the league table forever, while the product had just
  // told them the account was gone.
  await run('DELETE FROM ranking_optin WHERE user_id = ?', [u.id]);
  reply.clearCookie(COOKIE, { path: '/' });
  return { ok: true, deleted: u.id };
});

app.get('/api/me', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  return { user: shape(u) };
});

app.patch<{ Body: { lang?: unknown; theme?: unknown } }>('/api/settings', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const { lang, theme } = req.body ?? {};
  if (lang && (typeof lang !== 'string' || !LANGS.includes(lang))) return reply.code(400).send({ error: 'lang' });
  if (theme && (typeof theme !== 'string' || !THEMES.includes(theme))) return reply.code(400).send({ error: 'theme' });
  const saved = await get<UserRow>(`UPDATE users SET lang = COALESCE(?, lang), theme = COALESCE(?, theme)
                                    WHERE id = ? RETURNING *`,
    [(lang as string) ?? null, (theme as string) ?? null, u.id]);
  return { user: shape(saved!) };
});

// ---------- course ----------
// Paywall: lesson 01 and its three labs are free; the rest of Vol. 1 opens with
// the purchase. Tutors and admins see everything because accompanying is their job.
export const FREE_LESSONS = 1;
const hasAccess = (u: UserRow, n: unknown): boolean =>
  !!u.paid || u.role !== 'student' || Number(n) <= FREE_LESSONS;

const BEST = `SELECT lab_id, MAX(correct) AS solved, COUNT(*)::int AS attempts
              FROM attempts WHERE user_id = ? GROUP BY lab_id`;

app.get('/api/lessons', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const best = new Map((await all<BestAttempt>(BEST, [u.id])).map((r) => [r.lab_id, r]));
  const lessons = await all<LessonRow>('SELECT * FROM lessons ORDER BY n');
  const labs = await all<Pick<LabRow, 'id' | 'lesson_n' | 'idx' | 'level' | 'kind' | 'draft'>>(
    'SELECT id, lesson_n, idx, level, kind, draft FROM labs ORDER BY lesson_n, idx');
  return {
    lessons: lessons.map((l) => {
      const own = labs.filter((x) => x.lesson_n === l.n);
      const solved = own.filter((x) => best.get(x.id)?.solved === 1).length;
      const locked = !hasAccess(u, l.n);
      return { ...l, locked, labs: own.map((x) => ({ ...x, draft: !!x.draft, solved: best.get(x.id)?.solved === 1 })), solved, total: own.length };
    }),
  };
});

app.get<{ Params: { n: string }; Querystring: { lang?: string } }>('/api/lessons/:n', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const n = Number(req.params.n);
  const lesson = await get<LessonRow>('SELECT * FROM lessons WHERE n = ?', [n]);
  if (!lesson) return reply.code(404).send({ error: 'no_existe' });
  // The 402 carries the lesson's public card (without labs): a locked page is a
  // shop window, not a dead end.
  if (!hasAccess(u, n)) return reply.code(402).send({
    error: 'requiere_compra', libres: FREE_LESSONS,
    lesson: { n: lesson.n, eyebrow: lesson.eyebrow, title: lesson.title, summary: lesson.summary, math: lesson.math, math_cap: lesson.math_cap },
    labs: (await all<Pick<LabRow, 'id' | 'idx' | 'level'>>('SELECT id, idx, level FROM labs WHERE lesson_n = ? ORDER BY idx', [n])),
  });
  const best = new Map((await all<BestAttempt>(BEST, [u.id])).map((r) => [r.lab_id, r]));
  const labs = (await all<LabRow>('SELECT * FROM labs WHERE lesson_n = ? ORDER BY idx', [n]))
    .map((l) => publicLab(l, best.get(l.id)?.solved === 1 ? best.get(l.id) : null));
  // Technical explanation + analogy + examples: without this the lab cannot be solved.
  const asked = req.query?.lang;
  const lang = asked && LANGS.includes(asked) && asked !== 'auto' ? asked : (u.lang === 'auto' ? 'es' : u.lang);
  const Q_TEXT = 'SELECT technical, analogy, examples FROM lesson_text WHERE lesson_n = ? AND lang = ?';
  type TextRow = { technical: string; analogy: string; examples: unknown };
  let texto = await get<TextRow>(Q_TEXT, [n, lang]);
  let textoIdioma = texto ? lang : null;
  if (!texto && lang !== 'es') { texto = await get<TextRow>(Q_TEXT, [n, 'es']); textoIdioma = texto ? 'es' : null; }
  return { lesson, labs, texto, textoIdioma };
});

// ---------- Achievements ----------
const PER_LESSON = `
  SELECT l.lesson_n AS n, COUNT(*)::int AS total,
         SUM(CASE WHEN a.solved = 1 THEN 1 ELSE 0 END)::int AS solved
  FROM labs l
  LEFT JOIN (SELECT lab_id, MAX(correct) AS solved FROM attempts WHERE user_id = ? GROUP BY lab_id) a
    ON a.lab_id = l.id
  GROUP BY l.lesson_n ORDER BY l.lesson_n`;

interface PerLessonRow { n: number; total: number; solved: number }

/** Recomputes the achievements they are owed and stores the ones they did not
 *  have. Returns only the new ones: the front end uses them to fire the animation. */
async function syncAchievements(userId: number) {
  const perLesson = await all<PerLessonRow>(PER_LESSON, [userId]);
  const should = achievementsFor(perLesson);
  const has = new Set((await all<{ code: string }>('SELECT code FROM achievements WHERE user_id = ?', [userId])).map((r) => r.code));
  const nuevos = should.filter((l) => !has.has(l.code));
  for (const l of nuevos) {
    await run(`INSERT INTO achievements (user_id, code, kind, lesson_n) VALUES (?,?,?,?)
      ON CONFLICT (user_id, code) DO NOTHING`, [userId, l.code, l.kind, l.lesson_n]);
  }
  return { nuevos, todos: should, perLesson };
}

app.get('/api/logros', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const { todos, perLesson } = await syncAchievements(u.id);
  const rows = await all<{ code: string; kind: string; lesson_n: number | null; earned_at: Date }>(
    'SELECT code, kind, lesson_n, earned_at FROM achievements WHERE user_id = ? ORDER BY earned_at, code', [u.id]);
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
  const table = await all<{ alias: string; lecciones: number; labs: number }>(`
    SELECT o.alias,
           COUNT(DISTINCT hechas.lesson_n)::int AS lecciones,
           COUNT(DISTINCT ok.lab_id)::int       AS labs
    FROM ranking_optin o
    JOIN users us ON us.id = o.user_id AND us.deleted_at IS NULL
    LEFT JOIN (SELECT DISTINCT user_id, lab_id FROM attempts WHERE correct = 1) ok ON ok.user_id = o.user_id
    LEFT JOIN (
      SELECT a.user_id, l.lesson_n
      FROM labs l
      JOIN attempts a ON a.lab_id = l.id AND a.correct = 1
      GROUP BY a.user_id, l.lesson_n
      HAVING COUNT(DISTINCT a.lab_id) = (SELECT COUNT(*) FROM labs x WHERE x.lesson_n = l.lesson_n)
    ) hechas ON hechas.user_id = o.user_id
    GROUP BY o.alias, o.joined_at
    ORDER BY lecciones DESC, labs DESC, o.joined_at ASC
    LIMIT 50`);
  const mine = await get<{ alias: string }>('SELECT alias FROM ranking_optin WHERE user_id = ?', [u.id]);
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
  const clash = await get<{ user_id: number }>('SELECT user_id FROM ranking_optin WHERE alias = ? AND user_id <> ?', [alias, u.id]);
  if (clash) return reply.code(409).send({ error: 'alias_tomado' });
  await run(`INSERT INTO ranking_optin (user_id, alias) VALUES (?,?)
    ON CONFLICT (user_id) DO UPDATE SET alias = EXCLUDED.alias`, [u.id, alias]);
  return { alias, apuntado: true };
});

app.delete('/api/ranking/optin', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  await run('DELETE FROM ranking_optin WHERE user_id = ?', [u.id]);
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
  if (u.role !== 'admin') return reply.code(403).send({ error: 'solo_admin' });
  // Idempotent thanks to the PK (user_id, week) with DO NOTHING: the cron can fail
  // and retry without anybody looking at anything by hand.
  return closeWeek();
});

app.post<{ Params: { id: string }; Body: { answer?: unknown } }>('/api/labs/:id/attempt', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const lab = await get<LabRow>('SELECT * FROM labs WHERE id = ?', [String(req.params.id)]);
  if (!lab) return reply.code(404).send({ error: 'no_existe' });
  if (lab.draft) return reply.code(409).send({ error: 'borrador', msg: 'Este lab todavía no está escrito.' });
  if (!hasAccess(u, lab.lesson_n)) return reply.code(402).send({ error: 'requiere_compra', libres: FREE_LESSONS });
  const answer = req.body?.answer;
  if (answer === undefined) return reply.code(400).send({ error: 'falta_respuesta' });
  const correct = grade(lab, answer);
  await run('INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES (?,?,?,?)',
    [u.id, lab.id, JSON.stringify(answer), correct ? 1 : 0]);
  // Only a correct answer can unlock anything: if they got it wrong, nothing is
  // recomputed.
  const achievements = correct ? await syncAchievements(u.id) : { nuevos: [] };
  return { correct, explanation: lab.explanation, hint: hint(lab, answer), nuevos: achievements.nuevos };
});

app.get('/api/progress', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const rows = await all<BestAttempt>(BEST, [u.id]);
  const solvedLabs = rows.filter((r) => r.solved === 1).length;
  const totals = await get<{ c: number }>('SELECT COUNT(*)::int AS c FROM labs');
  const perLesson = await all<PerLessonRow>(`
    SELECT l.lesson_n AS n, COUNT(*)::int AS total,
           SUM(CASE WHEN a.solved = 1 THEN 1 ELSE 0 END)::int AS solved
    FROM labs l
    LEFT JOIN (SELECT lab_id, MAX(correct) AS solved FROM attempts WHERE user_id = ? GROUP BY lab_id) a
      ON a.lab_id = l.id
    GROUP BY l.lesson_n ORDER BY l.lesson_n`, [u.id]);
  const lessonsDone = perLesson.filter((r) => r.solved === r.total).length;
  return { solvedLabs, totalLabs: totals?.c ?? 0, lessonsDone, totalLessons: perLesson.length, perLesson };
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

function isFromService(req: FastifyRequest): boolean {
  // A missing IA_SECRETO is our own configuration, not attacker input: nothing
  // about the request leaks by answering it early.
  if (!AI_SECRET) return false;
  const raw = req.headers['x-ia-secreto'];
  const given = typeof raw === 'string' ? raw : '';
  return timingSafeEqual(secretDigest(given), secretDigest(AI_SECRET));
}

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
  const u = await resolveSession(session);
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
    },
  },
};

interface ChatBody { mensajes?: unknown; lang?: unknown }

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
  const r = await talkToAi({ sesion: session, mensajes: messages, lang });
  if (r.error) return reply.code(r.error === 'sin_proveedor' ? 501 : 502).send(r);
  return r;
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
  const scope = u.role === 'admin' ? 'todos' : u.cohort ? 'cohorte' : 'ninguna';
  if (scope === 'ninguna') {
    return { alcance: scope, cohort: null, students: [], stuck: [],
             msg: 'Tu cuenta de tutor no tiene cohorte asignada, así que no hay estudiantes a tu cargo. Pide a un admin que te asigne una.' };
  }
  const filter = scope === 'cohorte' ? 'AND us.cohort = ?' : '';
  const args = scope === 'cohorte' ? [u.cohort] : [];
  const students = await all<{ id: number; name: string; email: string; solved: number; last_seen: Date | null }>(`
    SELECT us.id, us.name, us.email,
      (SELECT COUNT(*)::int FROM (SELECT lab_id FROM attempts
         WHERE user_id = us.id AND correct = 1 GROUP BY lab_id) hechos) AS solved,
      (SELECT MAX(at) FROM attempts WHERE user_id = us.id) AS last_seen
    FROM users us
    WHERE us.role = 'student' AND us.deleted_at IS NULL ${filter}
    ORDER BY last_seen ASC NULLS LAST`, args);
  // `stuck` follows the same scope. Aggregate difficulty is not personal data,
  // but a cohort view that silently mixes in other cohorts' numbers is a lie
  // about what the tutor is looking at.
  const stuck = await all<{ lab_id: string; tries: number; wins: number }>(`
    SELECT a.lab_id, COUNT(*)::int AS tries, SUM(a.correct)::int AS wins
    FROM attempts a
    JOIN users us ON us.id = a.user_id AND us.deleted_at IS NULL ${filter}
    GROUP BY a.lab_id HAVING COUNT(*) >= 2 ORDER BY tries DESC LIMIT 5`, args);
  return { alcance: scope, cohort: scope === 'cohorte' ? u.cohort : null, students, stuck };
});

// ---------- admin ----------
app.get('/api/admin/users', async (req, reply) => {
  const u = await requireRole(req, reply, ['admin']); if (!u) return;
  return { users: await all(`SELECT id,email,name,role,paid,cohort,created_at FROM users
                             WHERE deleted_at IS NULL ORDER BY created_at DESC`) };
});

app.patch<{ Params: { id: string }; Body: { role?: unknown } }>('/api/admin/users/:id/role', async (req, reply) => {
  const actor = await requireRole(req, reply, ['admin']); if (!actor) return;
  const target = await get<UserRow>(USER_BY_ID, [Number(req.params.id)]);
  const role = req.body?.role;
  if (!target) return reply.code(404).send({ error: 'no_existe' });
  if (typeof role !== 'string' || !['student', 'tutor', 'admin'].includes(role)) {
    return reply.code(400).send({ error: 'rol_invalido' });
  }
  if (target.role === 'admin' && role !== 'admin') {
    // Self-demotion was the unguarded door, and it is the only one that can
    // actually empty the admin role: the actor is an admin, so any OTHER admin
    // being demoted still leaves the actor behind. There is no recovery endpoint
    // and no way back in, so it is refused outright — ask another admin.
    if (target.id === actor.id) {
      return reply.code(409).send({ error: 'auto_degradacion',
        msg: 'No puedes quitarte a ti mismo el rol de admin. Pídeselo a otro admin.' });
    }
    // `deleted_at IS NULL` was missing here while the equivalent guard in
    // /api/account/delete has it. A soft-deleted ex-admin satisfied the count, so
    // the last ACTIVE admin could be demoted with nothing to recover the role.
    const admins = await get<{ c: number }>("SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND deleted_at IS NULL");
    if ((admins?.c ?? 0) <= 1) return reply.code(409).send({ error: 'ultimo_admin', msg: 'No puedes dejar la plataforma sin admins.' });
  }
  await run('UPDATE users SET role = ? WHERE id = ?', [role, target.id]);
  await run('INSERT INTO role_audit (actor_id,user_id,from_role,to_role) VALUES (?,?,?,?)',
    [actor.id, target.id, target.role, role]);
  const fresh = await get<UserRow>(USER_BY_ID, [target.id]);
  return { user: shape(fresh!) };
});

app.get('/api/admin/payments', async (req, reply) => {
  const u = await requireRole(req, reply, ['admin']); if (!u) return;
  return { payments: await all('SELECT * FROM payments ORDER BY at DESC LIMIT 100') };
});

// ---------- Mercado Pago ----------
// With no credentials there is no checkout: it answers 501, it does not fake a
// payment. This is where the payer comes back to after finishing on Mercado Pago.
const RETURN_ORIGIN = (process.env.PUBLIC_ORIGIN ?? 'http://localhost:4321').replace(/\/+$/, '');

app.post('/api/payments/mercadopago/preference', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    return reply.code(501).send({ error: 'sin_credenciales', msg: 'MP_ACCESS_TOKEN is missing. Checkout Bricks also needs MP_PUBLIC_KEY in the frontend.' });
  }
  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ title: 'IA desde cero · Fundamentos Vol. 1', quantity: 1, unit_price: 9.99, currency_id: 'USD' }],
      payer: { email: u.email },
      metadata: { user_id: u.id },
      external_reference: String(u.id),
      // Without back_urls the payer is left stranded on Mercado Pago's screen.
      back_urls: {
        success: `${RETURN_ORIGIN}/pago/gracias`,
        pending: `${RETURN_ORIGIN}/pago/gracias?estado=pendiente`,
        failure: `${RETURN_ORIGIN}/pago/error`,
      },
      // Mercado Pago rejects auto_return over http, so it is not sent locally.
      ...(RETURN_ORIGIN.startsWith('https://') ? { auto_return: 'approved' } : {}),
    }),
  });
  if (!res.ok) return reply.code(502).send({ error: 'mp_error', status: res.status, body: await res.text() });
  const pref = await res.json() as { id?: string };
  return { preferenceId: pref.id, publicKey: process.env.MP_PUBLIC_KEY ?? null };
});

// How far a webhook's signed timestamp may be from our clock. Five minutes
// absorbs ordinary skew and retry latency; anything older is a replay.
const WEBHOOK_WINDOW_S = Math.max(30, Number(process.env.MP_WEBHOOK_VENTANA_S ?? 300));

interface WebhookBody { data?: { id?: unknown } }

app.post<{ Body: WebhookBody; Querystring: Record<string, string> }>(
  '/api/payments/mercadopago/webhook', async (req, reply) => {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return reply.code(501).send({ error: 'sin_secreto' });
  const { createHmac, timingSafeEqual: tse } = await import('node:crypto');
  const sigHeader = String(req.headers['x-signature'] ?? '');
  const reqId = String(req.headers['x-request-id'] ?? '');
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=').map((s) => s.trim()))) as Record<string, string | undefined>;
  const dataId = String(req.query?.['data.id'] ?? req.body?.data?.id ?? '');
  const manifest = `id:${dataId};request-id:${reqId};ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  const got = Buffer.from(String(parts.v1 ?? ''), 'hex');
  const exp = Buffer.from(expected, 'hex');
  if (got.length !== exp.length || !tse(got, exp)) {
    return reply.code(401).send({ error: 'firma_invalida' });
  }
  // The manifest SIGNS the timestamp and nothing ever compared it to the clock,
  // so a captured webhook stayed replayable forever. Today that replay is a
  // no-op — enqueue() is idempotent on (tipo, clave) and nothing prunes the jobs
  // table — but "harmless because of a property of another module" is not a
  // security boundary. The day job retention lands, the row disappears and the
  // same captured request enqueues real work again.
  //
  // Checked AFTER the HMAC on purpose: the signature covers ts, so a verified
  // signature is what makes the timestamp trustworthy enough to compare.
  const ts = Number(parts.ts);
  // Mercado Pago sends seconds; some of their examples show milliseconds. Both
  // are accepted, nothing else is.
  const tsSeconds = Number.isFinite(ts) ? (ts > 1e12 ? ts / 1000 : ts) : NaN;
  const age = Math.abs(Date.now() / 1000 - tsSeconds);
  if (!Number.isFinite(tsSeconds) || age > WEBHOOK_WINDOW_S) {
    app.log.warn({ dataId, ageS: Number.isFinite(age) ? Math.round(age) : null },
      'webhook: signature valid but timestamp outside the window');
    return reply.code(401).send({ error: 'firma_vencida', ventanaSegundos: WEBHOOK_WINDOW_S });
  }
  // Signature valid: it is RECORDED and 200 is answered straight away. Calling the
  // Mercado Pago API here was the problem — if it is slow, they time out and
  // retry, and the buyer's paid=1 was left at the mercy of their retry policy.
  // The key is the payment id: their retry does not enqueue a second job.
  const { nuevo } = await enqueue('pago.mercadopago', { dataId: String(dataId) }, String(dataId));
  return { ok: true, encolado: nuevo };
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
  const labs = await get<{ c: number }>('SELECT COUNT(*)::int AS c FROM labs');
  return { ok: true, labs: labs?.c ?? 0, cola: await queueState() };
});

// ---------- Background work ----------
//
// `paid` is DERIVED, never toggled.
//
// It used to be `UPDATE users SET paid = 1` on an approved payment, and the
// string `paid = 0` appeared nowhere in the repository — while 'refunded' is a
// status the payments table declares and expects. So: pay, get in, ask for a
// refund or file a chargeback, the webhook lands, payments.status becomes
// refunded, users.paid stays 1, access is permanent and free.
//
// Recomputing from the rows instead of flipping a flag is what makes two
// payments and one refund resolve correctly: the question is "does this person
// have ANY approved payment right now", and the answer is re-derived every time
// a payment row moves. A withdrawal needs no separate code path — the same
// statement that grants also revokes.
//
// PAID_STATUSES is the list of statuses that BUY access. Anything else —
// refunded, cancelled, charged_back, in_mediation, rejected, pending — does not,
// by omission rather than by enumeration, so a status nobody anticipated fails
// closed instead of granting.
const PAID_STATUSES = ['approved'];

/** Re-derives users.paid for one person from their payment rows. Returns the new value. */
export async function recomputeAccess(userId: number | null | undefined): Promise<boolean | null> {
  if (!userId) return null;
  const u = await get<{ paid: number }>(
    `UPDATE users SET paid = CASE WHEN EXISTS (
       SELECT 1 FROM payments WHERE user_id = ? AND status = ANY(?)
     ) THEN 1 ELSE 0 END
     WHERE id = ? RETURNING paid`, [userId, PAID_STATUSES, userId]);
  return u ? Boolean(u.paid) : null;
}

// The handler does what the webhook used to do, but outside its response and with
// retries. If the Mercado Pago API is down it throws: jobs.ts reschedules it with
// exponential backoff and the payment eventually lands.
register('pago.mercadopago', async ({ dataId }) => {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MP_ACCESS_TOKEN is missing');
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${String(dataId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`mercadopago ${res.status}`);
  const pay = await res.json() as {
    status?: string; transaction_amount?: number; currency_id?: string;
    metadata?: { user_id?: number };
  };
  const userId = pay?.metadata?.user_id ?? null;
  await run(`INSERT INTO payments (user_id,ext_id,status,amount,currency,raw) VALUES (?,?,?,?,?,?)
             ON CONFLICT (ext_id) DO UPDATE SET status = excluded.status, raw = excluded.raw`,
    [userId, String(dataId), String(pay.status), Number(pay.transaction_amount ?? 0),
     String(pay.currency_id ?? 'USD'), JSON.stringify(pay)]);
  if (userId) await recomputeAccess(userId);
});

// The schema is checked at boot: in Docker the backend can come up before the
// database.
await migrate();

// The worker starts AFTER migrate(): without the jobs table its first query would
// fail and the log would open with an error that means nothing.
const stopWorker = worker({ log: app.log });
for (const s of ['SIGTERM', 'SIGINT']) process.once(s, () => { stopWorker(); process.exit(0); });

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
app.listen({ port, host }).catch((e: unknown) => { app.log.error(e); process.exit(1); });
