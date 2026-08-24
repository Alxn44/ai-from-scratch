// Postgres. A container of its own for the database (docker compose: db), so the
// backend can scale to several instances without fighting over one file.
import pg from 'pg';

const { Pool } = pg;
// No hardcoded credential outside development.
//
// The default used to be 'postgres://curso:curso@localhost:5432/curso' — password
// equal to username, published in this repository, and reachable from the host
// because compose bound 5432 on 0.0.0.0. One connection reaches users.pass_hash,
// payments.raw and labs.solution. Same failure shape as the JWT_SECRET default in
// auth.ts: it works, so nobody notices it is public.
//
// Development keeps a convenience default so `pnpm dev` needs no setup; anything
// else must be told, and refuses to boot otherwise.
const DEV_DSN = 'postgres://curso:curso@localhost:5432/curso';
const url = process.env.DATABASE_URL
  ?? (process.env.NODE_ENV === 'development'
        ? DEV_DSN
        : (() => { throw new Error('DATABASE_URL is required. Run scripts/keys.sh, or set NODE_ENV=development for the local default.'); })());
export const pool = new Pool({ connectionString: url, max: 8 });

// ---------------------------------------------------------------------------
// ROW SHAPES
//
// These are the point of the TypeScript migration, not decoration. Every query in
// this codebase is raw SQL: nothing between the string and the property access
// used to notice that `u.emial` or `r.resueltas` is not a column, so a typo became
// `undefined` at runtime and travelled as far as whatever read it. Naming the
// shape at the call site — `get<UserRow>('SELECT ...')` — turns that into a
// compile error.
//
// They mirror api/prisma/schema.prisma, which owns the schema. `paid`, `correct`,
// `draft` and `cerrada` are SMALLINT and arrive as numbers, not booleans: the 0/1
// is deliberate and the `!!` at every use site is what converts it.
// ---------------------------------------------------------------------------

export interface UserRow {
  id: number;
  email: string;
  name: string;
  pass_hash: string;
  role: string;
  lang: string;
  theme: string;
  paid: number;
  cohort: string | null;
  created_at: Date;
  failed: number;
  locked_until: Date | null;
  deleted_at: Date | null;
  token_version: number;
}

export interface LessonRow {
  n: number;
  eyebrow: string;
  title: string;
  summary: string;
  math: string;
  math_cap: string;
  technical: string;
  analogy: string;
}

export interface LabRow {
  id: string;
  lesson_n: number;
  idx: number;
  level: string;
  kind: string;
  prompt: string;
  payload: string;
  solution: string;
  explanation: string;
  draft: number;
}

export interface LessonTextRow {
  lesson_n: number;
  lang: string;
  technical: string;
  analogy: string;
  examples: unknown;
}

export interface AttemptRow {
  id: number;
  user_id: number;
  lab_id: string;
  answer: string;
  correct: number;
  at: Date;
}

export interface AchievementRow {
  user_id: number;
  code: string;
  kind: string;
  lesson_n: number | null;
  earned_at: Date;
}

export interface RankingOptinRow {
  user_id: number;
  alias: string;
  joined_at: Date;
}

export interface LeagueWeekRow {
  user_id: number;
  week: Date;
  metal: string;
  caudal: number;
  puesto: number | null;
  estado: string;
  cerrada: number;
}

export interface PaymentRow {
  id: number;
  user_id: number | null;
  provider: string;
  ext_id: string | null;
  status: string;
  amount: number;
  currency: string;
  raw: string | null;
  at: Date;
}

export interface ResetTokenRow {
  id: number;
  user_id: number;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

// The queue table. The column names stay Spanish because they are SCHEMA, owned
// by api/prisma/schema.prisma: renaming them is a migration, not a rename.
export interface JobRow {
  id: number;
  tipo: string;
  clave: string;
  datos: unknown;
  estado: string;
  intentos: number;
  error: string | null;
  corre_en: Date;
  tomado_en: Date | null;
  acabado_en: Date | null;
  creado_en: Date;
}

/** What a query parameter may be. Wider than the row types on purpose: arrays go
 *  to `= ANY(?)`, and Date/null are both real parameter values. */
export type SqlParam = string | number | boolean | Date | null | undefined
  | readonly (string | number)[];

// The SQL is written with ? (it came from SQLite); Postgres numbers its parameters.
const dollars = (text: string): string => { let i = 0; return text.replace(/\?/g, () => '$' + ++i); };

export const get = async <T = Record<string, unknown>>(
  text: string, params: readonly SqlParam[] = []): Promise<T | null> =>
  (await pool.query<T & pg.QueryResultRow>(dollars(text), params as unknown[])).rows[0] ?? null;

export const all = async <T = Record<string, unknown>>(
  text: string, params: readonly SqlParam[] = []): Promise<T[]> =>
  (await pool.query<T & pg.QueryResultRow>(dollars(text), params as unknown[])).rows;

export const run = async (
  text: string, params: readonly SqlParam[] = []): Promise<pg.QueryResult> =>
  pool.query(dollars(text), params as unknown[]);

// The database container takes a while to accept connections even after the
// healthcheck passes.
export async function ready(tries = 40): Promise<void> {
  for (let i = 1; i <= tries; i++) {
    try { await pool.query('SELECT 1'); return; } catch (e) {
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

// Expected value constraints. Prisma cannot express a CHECK, so it drops them from
// every generated migration — a baseline diffed from a database holding three of
// them came out with zero. They are re-added by hand in the baseline SQL, and
// verified here, because "we remembered to keep them" is not a mechanism.
const CHECKS = ['users_role_check', 'labs_level_check', 'jobs_estado_check'];

/**
 * Verifies the schema is present and current. It does NOT create it.
 *
 * The schema used to be twenty idempotent DDL statements executed by this
 * function at every boot. That shape cannot express a rename, a type change or a
 * drop; it accumulated dead `ADD COLUMN IF NOT EXISTS` lines; it kept no history,
 * so nothing could be rolled back; and it could not detect a hand-altered
 * database. Prisma owns the schema now (prisma/schema.prisma, prisma/migrations).
 *
 * Applying it is a SEPARATE STEP, on purpose: `prisma migrate deploy`. Two API
 * instances booting at once would otherwise both run DDL against the same
 * database, and "it worked because only one instance existed" is not a property
 * worth keeping while planning to scale.
 *
 * So this only checks, and says exactly what to run when the check fails.
 */
export async function migrate(): Promise<void> {
  await ready();

  const missing: string[] = [];
  for (const table of ['users', 'lessons', 'labs', 'attempts', 'jobs']) {
    const r = await get<{ present: boolean }>('SELECT to_regclass(?) IS NOT NULL AS present', [table]);
    if (!r?.present) missing.push(table);
  }
  if (missing.length) {
    throw new Error(
      `The schema is not applied (missing: ${missing.join(', ')}). `
      + 'Apply it with:  pnpm --dir api db:deploy');
  }

  const present = (await all<{ conname: string }>(
    "SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname = ANY(?)",
    [CHECKS])).map((r) => r.conname);
  const lost = CHECKS.filter((c) => !present.includes(c));
  if (lost.length) {
    throw new Error(
      `Missing CHECK constraints: ${lost.join(', ')}. Prisma drops them from every `
      + 'migration it generates. Without them, role = «superadmin» is insertable. '
      + 'Put them back before starting.');
  }
}

/** Closes the pool. Tests and one-shot scripts need this to exit. */
export const close = (): Promise<void> => pool.end();
