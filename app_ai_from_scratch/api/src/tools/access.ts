// The shared foundation of the tool surface: the paywall gate, the ontology guard
// wrappers, and the read helpers the four families reuse.
//
// It lives in one module for the same reason the paywall is one gate: every one of
// these was computed in several places before, and every duplicate was a chance to
// drift. Nothing here accepts a person identifier — everything takes the `ctx` the
// server built from the session cookie.
//
// WIRE FORMAT. The KEYS of everything returned from here reach the model as tool
// results and are asserted by api/test/tools.mts and by
// ai/src/course_ai/, so they are unchanged. `descripcion` texts and `nota` texts
// stay Spanish for the same reason (docs/NAMING.md, "Model-facing strings").
import { many, one } from '../data.ts';
import type { LabRow, LessonRow, LessonTextRow, UserRow } from '../db.ts';
import { assertNoForbidden } from '../ontology.ts';
import { METALS, MIN_LEAGUE, ZONE, assignMetals, currentWeek, flow } from '../leagues.ts';
import type { Metal, WeekRow } from '../leagues.ts';
import { MECHANICS, PRICE, inLanguage } from '../product.ts';
import type { Bus } from '../agent-bus.ts';

export const LAB_ID = /^([1-9]|1[0-2])\.[1-3]$/;
export const LANGUAGES = ['es', 'en', 'fr', 'pt'] as const;
export const FREE_LESSONS = 1;   // same as in the server: lesson 1 is the shop window
export const TOTAL_LABS = 36;
export const TOTAL_LESSONS = 12;

export const COLS_LAB = 'id, lesson_n, idx, level, kind, prompt, payload, draft';

/** The lab columns a tool may return. `solution` and `explanation` are NOT here. */
export type SafeLab = Pick<LabRow, 'id' | 'lesson_n' | 'idx' | 'level' | 'kind' | 'prompt' | 'payload' | 'draft'>;

/**
 * What the SERVER hands a tool. Never anything the model can write.
 *
 * `userId` comes from the session cookie, `turn` is minted per model turn (it is
 * what expires the memo for own data), and `readable` is the open-lesson set the
 * dispatcher resolves once for any tool flagged `paywalled`.
 */
export interface Ctx {
  userId: number;
  lang?: string;
  role?: string;
  turn?: string | null;
  readable?: Set<number>;
}

/** Every tool answers a plain JSON object. `error` is how it says no. */
export type ToolResult = Record<string, unknown>;

/**
 * One tool.
 *
 *   descripcion · what the model sees. It is the only guidance it has for choosing.
 *   args        · declared as text; a leading «opcional ·» makes it not required.
 *   publico     · true = course content (caches 10 min); false = own data
 *                 (caches only inside the same turn).
 *   cachea      · false on the ones that touch the stack or the queue: they
 *                 mutate, they are not repeated.
 *   paywalled   · true = the dispatcher resolves the open-lesson set and the tool
 *                 must gate on it. Cross-checked against the Python ontology by
 *                 ai/tests/test_node_contract.py.
 *   efecto      · always runs, even when the output came from the memo. This is
 *                 where the focus push and the work enqueue go.
 */
export interface Tool {
  familia: 'contenido' | 'propio' | 'producto' | 'coordinar';
  publico: boolean;
  paywalled?: boolean;
  cachea?: boolean;
  descripcion: string;
  args: Record<string, string>;
  fn(ctx: Ctx, args: Record<string, unknown>): Promise<ToolResult>;
  efecto?(ctx: Ctx, args: Record<string, unknown>, out: ToolResult): void;
}

export type Registry = Record<string, Tool>;

// The registry size, for `bus_diagnostico`. Set by index.ts once the four
// families are merged. A plain import would be a cycle: index imports the
// families and one of the families needs the total.
let registrySize = 0;
export const setRegistrySize = (n: number): void => { registrySize = n; };
export const toolCount = (): number => registrySize;

export const language = (ctx: Ctx | null | undefined, asked?: unknown): string =>
  (LANGUAGES.includes(asked as never) ? String(asked)
    : LANGUAGES.includes(ctx?.lang as never) ? String(ctx!.lang) : 'es');

/** The `users` columns any tool may see. Everything else is `jamas`. */
export type Me = Pick<UserRow, 'name' | 'role' | 'lang' | 'theme' | 'paid' | 'cohort' | 'created_at'>;

// Reads `users`. Wrapped in the ontology guard rather than trusting the column
// list to stay correct: thirteen tools funnel through this one helper, so one
// careless column added here would ship `email` or `pass_hash` into the model's
// context. Guarding the helper covers all thirteen; guarding the call sites was
// what left 26 of the original 37 tools unchecked.
export const me = async (ctx: Ctx): Promise<Me | null> => assertNoForbidden('users',
  await one<Me>('user.me', {}, ctx.userId));

/** The same rule as the server's paywall, not an approximate copy. */
export const hasAccess = (u: Me | null | undefined, n: unknown): boolean =>
  !!u?.paid || (!!u?.role && u.role !== 'student') || Number(n) <= FREE_LESSONS;

// ---------------------------------------------------------------------------
// THE PAYWALL, AS ONE GATE
//
// `hasAccess` used to be computed in six places and used as a LABEL — the tools
// returned `cerrado: !hasAccess(u, n)` alongside the content it was supposed to
// be withholding. Four content tools never called it at all, so a free account
// read the whole paid corpus through the chat while GET /api/lessons/:n answered
// 402. Proven: `leccion_texto {n:12}` returned 614 characters of teaching text to
// an account the HTTP route had just refused.
//
// Five separate checks are five chances to drift, and they did. There is now one
// entry point. Every tool that returns lesson prose, lab statements or lab
// payloads asks this and nothing else.
//
// Note the tools that use it must be `publico: false`: their output depends on
// who is asking, so it cannot sit in a ten-minute shared slot — and a stale
// `requiere_compra` right after a purchase would be its own bug.

/**
 * The set of lesson numbers this session may read. One query, one truth.
 *
 * `run` (src/tools/index.ts) resolves this once for any tool flagged `paywalled`
 * and hands it back on the ctx, so gating a tool costs no extra query.
 */
export async function readableLessons(ctx: Ctx): Promise<Set<number>> {
  if (ctx?.readable instanceof Set) return ctx.readable;
  const u = await me(ctx);
  const readable = new Set<number>();
  for (let n = 1; n <= TOTAL_LESSONS; n++) if (hasAccess(u, n)) readable.add(n);
  return readable;
}

/** What a locked lesson answers. Same shape as the HTTP 402: a shop window, not a wall. */
export const lockedByPaywall = (n: number): ToolResult => ({
  error: 'requiere_compra', leccion: n, libres: FREE_LESSONS, ruta: '/pago',
  nota: 'Esa lección está cerrada para esta cuenta. No la resumas ni la enseñes: di que se abre con la compra y ofrece la lección 1.',
});

// ---------------------------------------------------------------------------
// PROGRESS READS
// ---------------------------------------------------------------------------

/** One lesson's lab counts for this person. */
export interface PerLessonRow { n: number; total: number; resueltos: number }

export const perLesson = async (ctx: Ctx): Promise<PerLessonRow[]> =>
  (await many<{ n: number; total: number; solved: number }>(
    'achievement.progress_by_lesson', {}, ctx.userId))
    .map((r) => ({ n: r.n, total: r.total, resueltos: r.solved }));

export const completed = (rows: readonly PerLessonRow[]): number =>
  rows.filter((r) => r.total > 0 && r.resueltos === r.total).length;

/** An unsolved lab, with its padlock already computed. */
export interface PendingLab {
  lab_id: string;
  leccion: number;
  titulo: string;
  idx: number;
  level: string;
  kind: string;
  borrador: boolean;
  cerrado: boolean;
}

/** Unsolved labs, in course order. Carries the padlock already computed. */
export async function pending(ctx: Ctx, u: Me | null): Promise<PendingLab[]> {
  const rows = await many<Pick<LabRow, 'id' | 'lesson_n' | 'idx' | 'level' | 'kind' | 'draft'> & { title: string }>(
    'progress.pending_labs', {}, ctx.userId);
  return rows.map((l) => ({
    lab_id: l.id, leccion: l.lesson_n, titulo: l.title, idx: l.idx, level: l.level,
    kind: l.kind, borrador: !!l.draft, cerrado: !hasAccess(u, l.lesson_n),
  }));
}

/** Dates (product zone) with activity, most recent first. */
export const activeDays = (ctx: Ctx): Promise<{ dia: string }[]> =>
  many<{ dia: string }>('progress.active_days', { zone: ZONE }, ctx.userId);

export interface Streak {
  racha: number;
  mejorRacha: number;
  activo: string | null;
  diasActivos: number;
}

/** Streak in consecutive days. It breaks if there was nothing yesterday. */
export function computeStreak(days: readonly string[]): Streak {
  if (!days.length) return { racha: 0, mejorRacha: 0, activo: null, diasActivos: 0 };
  const d = (s: string): number => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
  const nums = days.map(d);
  let best = 1, run = 1;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i - 1]! - nums[i]! === 1) { run++; best = Math.max(best, run); } else run = 1;
  }
  // The live streak only counts if the last day is today or yesterday; otherwise
  // it has already broken.
  const today = Math.floor(Date.now() / 86_400_000);
  let live = 0;
  if (today - nums[0]! <= 1) {
    live = 1;
    for (let i = 1; i < nums.length; i++) { if (nums[i - 1]! - nums[i]! === 1) live++; else break; }
  }
  return { racha: live, mejorRacha: best, activo: days[0] ?? null, diasActivos: days.length };
}

/** The recommended next lab. Respects the padlock and the drafts. */
export async function nextStep(ctx: Ctx, u: Me | null): Promise<ToolResult> {
  const queue = await pending(ctx, u);
  const open = queue.find((l) => !l.cerrado && !l.borrador);
  if (open) {
    return {
      hay: true, lab_id: open.lab_id, leccion: open.leccion, titulo: open.titulo,
      nivel: open.level, mecanica: open.kind, ruta: `/leccion/${open.leccion}`,
      porQue: 'Es el primer lab sin resolver de la lección más baja que tienes abierta.',
    };
  }
  const locked = queue.find((l) => l.cerrado);
  if (locked) {
    return {
      hay: false, motivo: 'requiere_compra', siguienteCerrado: locked.leccion,
      ruta: '/pago', precio: { monto: PRICE.monto, moneda: PRICE.moneda },
      porQue: `Terminaste lo abierto. La lección ${locked.leccion} necesita la compra.`,
    };
  }
  return { hay: false, motivo: 'curso_completo', ruta: '/ligas',
           porQue: 'No queda ningún lab sin resolver: los 36 están hechos.' };
}

/** This week's league state, with the person's own place if there is one. */
export interface LeagueFor {
  zona: string;
  semana: WeekRow | null;
  minimo: number;
  metales: readonly Metal[];
  participantes: number;
  activa: boolean;
  yo: null | { alias: string; metal: Metal; puesto: number; caudal: number; estado: string };
  motivo?: 'requiere_compra' | 'sin_alias' | 'cohorte_insuficiente';
  ruta?: string;
  faltan?: number;
}

export async function leagueFor(ctx: Ctx, u: Me): Promise<LeagueFor> {
  const [rows, week] = await Promise.all([flow(), currentWeek()]);
  const optin = await one<{ alias: string }>('ranking.mine', {}, ctx.userId);
  const base = { zona: ZONE, semana: week, minimo: MIN_LEAGUE, metales: METALS, participantes: rows.length };
  if (!u.paid) return { ...base, activa: false, yo: null, motivo: 'requiere_compra' };
  if (!optin) return { ...base, activa: false, yo: null, motivo: 'sin_alias', ruta: '/ranking' };
  if (rows.length < MIN_LEAGUE) {
    return { ...base, activa: false, yo: null, motivo: 'cohorte_insuficiente', faltan: MIN_LEAGUE - rows.length };
  }
  const table = assignMetals(rows);
  const mine = table.find((r) => r.user_id === ctx.userId) ?? null;
  return {
    ...base, activa: true,
    yo: mine ? { alias: mine.alias, metal: mine.metal, puesto: mine.puesto, caudal: mine.caudal, estado: mine.estado } : null,
  };
}

/** Teaching text for a lesson, falling back to Spanish. */
export async function lessonText(n: number, lang: string):
    Promise<{ texto: Pick<LessonTextRow, 'technical' | 'analogy' | 'examples'> | null; escritoEn: string | null }> {
  type Row = Pick<LessonTextRow, 'technical' | 'analogy' | 'examples'>;
  let row = await one<Row>('lesson_text.get', { lesson_n: n, lang });
  let writtenIn = row ? lang : null;
  if (!row && lang !== 'es') {
    row = await one<Row>('lesson_text.get', { lesson_n: n, lang: 'es' });
    writtenIn = row ? 'es' : null;
  }
  if (row) assertNoForbidden('lesson_text', row);
  return { texto: row, escritoEn: writtenIn };
}

export const truncate = (s: unknown, length = 180): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > length ? `${t.slice(0, length - 1)}…` : t;
};

/**
 * The memo key: the tool, the session language and its already-cleaned arguments.
 * The language goes inside because half a dozen tools answer translated text:
 * without it, asking for lesson 4 in English and then in Spanish would return the
 * English one twice.
 */
export const memoKey = (name: string, clean: Record<string, unknown>, ctx: Ctx): string =>
  `${name}|${language(ctx, clean?.['idioma'])}|${JSON.stringify(clean, Object.keys(clean).sort())}`;

/** Re-exported so a family file needs one import for the mechanics lookup. */
export const mechanicIn = (kind: string, lang: string): string | null =>
  inLanguage(MECHANICS[kind], lang) ?? null;

/** Types the families need but do not own. */
export type { Bus, LessonRow, SafeLab as LabCard, WeekRow };
