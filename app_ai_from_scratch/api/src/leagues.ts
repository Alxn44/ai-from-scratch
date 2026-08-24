// Weekly leagues: bronze, silver, gold.
//
// The endpoint and the cron both use THIS module. The logic used to live inside
// server.ts, and the cron would then have had to call it over HTTP with admin
// credentials, or duplicate the SQL. Duplicating the metal split guarantees that
// one day the table you see and the table that gets closed do not match.
//
// Decisions taken, not inherited:
//  · ZONE: America/Bogota for everybody. One declared zone, because with each
//    person's own zone two people see different cut-offs and the table stops
//    comparing anything.
//  · COHORT MINIMUM: below MIN_LEAGUE nobody has a league. A league of two is a
//    fake competition; saying there is not one yet is more honest.
//  · PAID AND OPTED IN ONLY: it needs ranking_optin (the alias is the only public
//    thing) and paid=1. Competing for a promotion you cannot use is a bad
//    experience.
//  · TERMINAL: whoever finished all 36 labs produces no weekly flow and would
//    drop for having finished. They move to 'salon' and keep their metal.
//
// NOTE ON NAMES: the strings in the returned objects — `activa`, `tabla`, `yo`,
// `metal`, `puesto`, `caudal`, `estado`, `subida`, `semana`, `zona` — are the WIRE
// FORMAT of GET /api/ligas, read by web/src/pages/ligas.astro and panel.astro.
// They are data, not identifiers, so they are unchanged. `metal` / `estado` /
// `puesto` / `caudal` are also league_week column names.
import { all, get, run } from './db.ts';
import type { LeagueWeekRow } from './db.ts';

export const LEAGUE_ZONE = 'America/Bogota';
export const MIN_LEAGUE = 5;
export const METALS = ['bronce', 'plata', 'oro'] as const;
export type Metal = (typeof METALS)[number];
const METAL_ORDER: Record<string, number> = { bronce: 1, plata: 2, oro: 3 };

/** One person's weekly flow, straight out of SQL_FLOW. */
export interface FlowRow {
  user_id: number;
  alias: string;
  caudal: number;
  total: number;
}

/** A flow row after the metal split. `user_id` is stripped before it goes out. */
export interface StandingRow extends FlowRow {
  metal: Metal;
  estado: 'activo' | 'salon';
  puesto: number;
}

/** The Monday of the current week and when it closes. */
export interface WeekRow {
  lunes: Date;
  cierra: Date;
}

// Flow for the week in progress: labs solved for the FIRST time inside it.
// The MIN(at) per (user_id, lab_id) is what makes inflating it by repeating
// impossible: solving an old lab again does not move its MIN(at) out of the
// original week, so the query does not admit the trick. There is nothing to
// detect.
//
// It uses a literal $1 instead of ? because the zone is reused three times and
// dollars() would number three separate parameters. dollars() only touches the ?.
//
// The `total` comes from an aggregated CTE and NOT from a correlated subquery.
// With `(SELECT COUNT(*) FROM primera q WHERE q.user_id = o.user_id)` the planner
// adds a SubPlan that rescans `primera` once per user: O(U x P). Measured with 11
// users and 74 first-times it gave `loops=9` over 74 rows — invisible today and
// quadratic tomorrow. Aggregating `totales` once and joining leaves every CTE
// Scan at loops=1: O(U + P).
//
//   before:  Execution 1.314 ms | Planning 2.194 ms | SubPlan 2, loops=9
//   after:   Execution 0.603 ms | Planning 1.090 ms | no SubPlan
//   (docker compose exec db, development dataset; scripts/medir.sh repeats it)
const SQL_FLOW = `
  WITH primera AS (
    SELECT user_id, lab_id, MIN(at) AS cuando
    FROM attempts WHERE correct = 1
    GROUP BY user_id, lab_id
  ), totales AS (
    SELECT user_id, COUNT(*)::int AS total FROM primera GROUP BY user_id
  ), sem AS (
    SELECT date_trunc('week', (now() AT TIME ZONE $1)) AS lunes
  )
  SELECT o.user_id, o.alias,
         COUNT(p.lab_id)::int AS caudal,
         COALESCE(t.total, 0) AS total
  FROM ranking_optin o
  -- deleted_at IS NULL is defence in depth. Account deletion now removes the
  -- ranking_optin row, but this join is what kept a deleted account's chosen
  -- alias and weekly flow in the league table indefinitely: it filtered by
  -- paid and never asked whether the person still existed. Both locks stay.
  JOIN users us ON us.id = o.user_id AND us.paid = 1 AND us.deleted_at IS NULL
  LEFT JOIN totales t ON t.user_id = o.user_id
  LEFT JOIN primera p ON p.user_id = o.user_id
       AND (p.cuando AT TIME ZONE $1) >= (SELECT lunes FROM sem)
  GROUP BY o.user_id, o.alias, t.total
  ORDER BY caudal DESC, o.alias ASC`;

const SQL_WEEK = `
  SELECT date_trunc('week', (now() AT TIME ZONE $1))::date AS lunes,
         (date_trunc('week', (now() AT TIME ZONE $1)) + interval '7 days')::date AS cierra`;

// The metal comes from the THIRD you land in, not from a fixed lab threshold.
// With a fixed threshold a weak week leaves the gold league empty and the bronze
// league full.
export function assignMetals(rows: readonly FlowRow[]): StandingRow[] {
  const n = rows.length;
  const cut1 = Math.ceil(n / 3), cut2 = Math.ceil((n * 2) / 3);
  return rows.map((f, i) => ({
    ...f,
    metal: (f.total >= 36 ? 'oro' : i < cut1 ? 'oro' : i < cut2 ? 'plata' : 'bronce') as Metal,
    estado: (f.total >= 36 ? 'salon' : 'activo') as 'activo' | 'salon',
    puesto: i + 1,
  }));
}

// --- The API src/tools/ consumes (came in with the 37-tool branch) ------------
//
// The add/add conflict is resolved like this: THIS implementation is kept (it has
// the measured query fix, O(U+P) instead of O(UxP), and the promotion window) and
// the three names the other branch defined on its own are exported. Wrappers over
// the SAME SQL: two copies of the flow split guarantee that one day the table you
// see and the one that gets closed do not match.

/** Historic alias. The other branch called ZONA what is LEAGUE_ZONE here. */
export const ZONE = LEAGUE_ZONE;

/** Raw weekly flow, before the metals are handed out. */
export const flow = (): Promise<FlowRow[]> => all<FlowRow>(SQL_FLOW, [LEAGUE_ZONE]);

/** The Monday of the week in progress and when it closes. */
export const currentWeek = (): Promise<WeekRow | null> => get<WeekRow>(SQL_WEEK, [LEAGUE_ZONE]);

/** A promotion against the last CLOSED week. */
export interface Promotion {
  de: string;
  a: string;
  semana: Date;
}

/** What GET /api/ligas answers. Wire format: web/src/pages/ligas.astro reads it. */
export type LeaguesState =
  | {
      activa: false; faltan: number; minimo: number; zona: string;
      semana: WeekRow | null; tabla: never[]; yo: null;
    }
  | {
      activa: true; zona: string; semana: WeekRow | null; minimo: number;
      metales: readonly Metal[];
      tabla: Omit<StandingRow, 'user_id'>[];
      yo: null | {
        alias: string; metal: Metal; puesto: number; caudal: number;
        estado: 'activo' | 'salon'; subida: Promotion | null;
      };
    };

/** State of the week in progress. `userId` marks which row is "me" and whether they went up. */
export async function leaguesState(userId: number): Promise<LeaguesState> {
  const rows = await all<FlowRow>(SQL_FLOW, [LEAGUE_ZONE]);
  const week = await get<WeekRow>(SQL_WEEK, [LEAGUE_ZONE]);
  if (rows.length < MIN_LEAGUE) {
    return { activa: false, faltan: MIN_LEAGUE - rows.length, minimo: MIN_LEAGUE,
             zona: LEAGUE_ZONE, semana: week, tabla: [], yo: null };
  }
  const table = assignMetals(rows);
  const mine = table.find((r) => r.user_id === userId) ?? null;

  // Promotion: compared against the last CLOSED week, not against the previous
  // one by date. If the cron did not run one week, comparing with "last week"
  // would give null and the promotion would be lost; with the last closed week
  // the fact is still true, only older.
  let promotion: Promotion | null = null;
  if (mine) {
    // The `week < this week's Monday` is mandatory. Without it, the last closed
    // week can be THE CURRENT ONE (the cron already ran), and then you are
    // compared against yourself from a few hours ago: improve after the close and
    // it would report a promotion that never happened. Verified: with the cron
    // already past, without this filter `subida` came out comparing gold against
    // gold.
    // Every parameter as a literal $n, none as a ?. Mixing them is a trap:
    // dollars() (db.ts) numbers ONLY the ?, so a `?` plus a literal `$2` works by
    // coincidence while the order happens to match, and the day somebody puts
    // another ? in front the numbering collides with no error.
    const prev = await get<Pick<LeagueWeekRow, 'metal' | 'week'>>(
      `SELECT metal, week FROM league_week
       WHERE user_id = $1 AND cerrada = 1
         AND week < date_trunc('week', (now() AT TIME ZONE $2))::date
       ORDER BY week DESC LIMIT 1`, [userId, LEAGUE_ZONE]);
    if (prev && (METAL_ORDER[mine.metal] ?? 0) > (METAL_ORDER[prev.metal] ?? 0)) {
      promotion = { de: prev.metal, a: mine.metal, semana: prev.week };
    }
  }

  // The user_id does not go out: the alias is the only public thing about
  // another person.
  const publicTable = table.map(({ user_id, ...r }) => r);
  return {
    activa: true, zona: LEAGUE_ZONE, semana: week, minimo: MIN_LEAGUE, metales: METALS,
    tabla: publicTable,
    yo: mine ? { alias: mine.alias, metal: mine.metal, puesto: mine.puesto,
                 caudal: mine.caudal, estado: mine.estado, subida: promotion } : null,
  };
}

/** What closeWeek() answers. Wire format of POST /api/ligas/cerrar. */
export type CloseResult =
  | { cerradas: 0; saltadas: 0; motivo: 'cohorte_insuficiente'; minimo: number; total: number }
  | { cerradas: number; saltadas: number; semana: Date | undefined; total: number };

/**
 * Closes the week in progress. IDEMPOTENT: the PK (user_id, week) with DO NOTHING
 * lets it be retried without duplicating or altering anything, so the cron can
 * fail and retry without anybody looking at anything by hand.
 */
export async function closeWeek(): Promise<CloseResult> {
  const rows = await all<FlowRow>(SQL_FLOW, [LEAGUE_ZONE]);
  if (rows.length < MIN_LEAGUE) {
    return { cerradas: 0, saltadas: 0, motivo: 'cohorte_insuficiente', minimo: MIN_LEAGUE, total: rows.length };
  }
  const table = assignMetals(rows);
  const week = await get<WeekRow>(SQL_WEEK, [LEAGUE_ZONE]);
  let n = 0;
  for (const r of table) {
    const res = await run(
      `INSERT INTO league_week (user_id, week, metal, caudal, puesto, estado, cerrada)
       VALUES (?,?,?,?,?,?,1) ON CONFLICT (user_id, week) DO NOTHING`,
      [r.user_id, week?.lunes ?? null, r.metal, r.caudal, r.puesto, r.estado]);
    n += res?.rowCount ?? 0;
  }
  return { cerradas: n, saltadas: table.length - n, semana: week?.lunes, total: table.length };
}
