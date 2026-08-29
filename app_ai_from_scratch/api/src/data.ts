// ============================================================================
// THE CLIENT FOR THE data SERVICE.
//
// This file exists so that api can stop holding a database credential.
//
// Runtime API and api-worker now hold no database credential. Every read and
// write crosses this client, and scripts/check-api-data-boundary.mjs refuses a
// runtime db.ts import, pg import, DATABASE_URL reference or SQL literal.
//
// WHAT DOES NOT MOVE, and why that is not a leak. src/seed.ts and db.ts's
// migrate()/CHECK-constraint verification run in the `init` service, which
// applies migrations once and exits. init legitimately holds the credential;
// there is no request path into it and no model behind it. The runtime -- api
// and api-worker -- is what must come away empty-handed.
//
// ---------------------------------------------------------------------------
// THE WIRE. POST /v1/op, body {"op": name, "args": {...}} and nothing else --
// the server sets DisallowUnknownFields, so an undeclared key is a 400 rather
// than a value smuggled past a validator. Two headers:
//
//   x-data-secreto   DATA_SECRETO, compared in constant time
//   x-data-actor     the id of the person this request is FOR
//
// The actor travels in a HEADER and never in `args`. That is the whole of
// obligation P3 ("no argument can express another person") expressed as a wire
// format: there is no field a caller could put somebody else's id into, so the
// question of validating it does not arise. An operation declared `own` whose
// request carries no actor is REFUSED, loudly, rather than served with a
// substituted value -- see bind() in data/internal/store/store.go.
//
// There is no SQL endpoint. Not "a guarded one" -- none. Statements are
// assembled from each operation's declared column list, so a wildcard is
// unreachable rather than merely rejected.
//
// ---------------------------------------------------------------------------
// TYPES ACROSS THE WIRE, MEASURED. `pg` returns JS values; this returns parsed
// JSON, and the two are not the same. The Go side scans with pgx's
// rows.Values(), so these are the mappings, each one observed against the real
// database rather than assumed:
//
//   jsonb, json     -> object / array. NOT base64. jobs.datos and labs.examples
//                      survive the crossing intact -- worth stating because a
//                      []byte scan would have marshalled to base64 and
//                      corrupted every job payload silently.
//   timestamptz     -> RFC3339 STRING with offset ("2026-08-23T23:10:54.008-05:00")
//   date            -> RFC3339 string at UTC midnight ("2026-08-24T00:00:00Z"),
//                      so .slice(0, 10) is the correct way to read a date
//                      column and Date arithmetic on it is not.
//   float8, numeric -> number
//   smallint, int   -> number. The 0/1 booleans stay 0/1, so the `!!` at every
//                      use site keeps working.
//   NULL            -> null
//
// The consequence, and the one real behavioural change: a timestamptz column
// arrives as a STRING. Row interfaces that declare `Date` become lies. This
// codebase mostly survives it because its date arithmetic happens in Postgres
// (`AT TIME ZONE`, `date_trunc`) rather than in Node -- but the interfaces are
// corrected as each family migrates, so tsgo finds any call site that assumed
// otherwise instead of production finding it.
//
// No BigInt column exists in the schema, so the JSON >2^53 precision cliff is
// not reachable here. If one is ever added, this comment is the warning.
// ============================================================================

const env = (k: string): string | null => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : null;
};

export const DATA_URL = env('DATA_URL') ?? 'http://127.0.0.1:8788';
export const DATA_SECRET = env('DATA_SECRETO');

/**
 * Whether this process can reach the data service at all.
 *
 * Deliberately a secret check and not a ping: a ping answers a question about
 * this instant, and every caller wants to know whether it was CONFIGURED. Same
 * shape as hasAi() in src/ai-bridge.ts.
 */
export const hasData = (): boolean => Boolean(DATA_SECRET);

/** The default per-call deadline. The service caps its own statement at 10s. */
export const TIMEOUT_MS = 12_000;

export interface DataResult<T> {
  operation: string;
  rows: T[];
  /** Rows returned, or rows changed for a write. */
  affected: number;
  /**
   * Columns the ontology guard removed on the way out. Should always be empty:
   * the service's startup check makes a forbidden column unreachable through a
   * declared operation. A non-empty array means a migration added a column no
   * declaration mentions, and it is logged as an error on both sides.
   */
  scrubbed?: string[];
}

/**
 * A refusal from the data service, carrying its code so callers can branch.
 *
 * The codes are the service's own: `unknown_operation` (a typo or an
 * unmigrated call, and the most useful one during this migration), `refused`
 * (the operation exists and the arguments did not fit), `bad_actor`,
 * `bad_request`, `unauthorised`.
 */
export class DataRefused extends Error {
  // Declared and assigned explicitly rather than as constructor parameter
  // properties. This repository runs TypeScript through Node's
  // --experimental-strip-types, which ERASES types and emits nothing, so a
  // parameter property -- whose whole meaning is an assignment the compiler
  // generates -- is a syntax error at load time. tsgo accepts it happily, which
  // is the trap: `pnpm check` passes and the process will not start.
  readonly code: string;
  readonly status: number;
  readonly operation: string;

  constructor(code: string, status: number, operation: string, detail: string) {
    super(`data refused ${operation}: ${code}${detail ? ` -- ${detail}` : ''}`);
    this.name = 'DataRefused';
    this.code = code;
    this.status = status;
    this.operation = operation;
  }
}

/** The service could not be reached. Distinct from a refusal on purpose. */
export class DataUnreachable extends Error {
  readonly operation: string;

  constructor(operation: string, cause: unknown) {
    super(`data is unreachable (${operation}): ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'DataUnreachable';
    this.operation = operation;
  }
}

interface Refusal { error?: unknown; detail?: unknown }

/**
 * Calls one named operation.
 *
 * `actor` is the id of the person the request is for, taken from the session
 * this process already verified. It is a SEPARATE ARGUMENT and not part of
 * `args` so that no call site can accidentally read it out of a request body:
 * the type system makes the mistake unspellable rather than reviewable.
 *
 * Retries exactly once, and only when the connection failed. A refusal is
 * never retried -- the arguments will not fit any better the second time, and
 * retrying a write whose response was lost would run it twice.
 */
export async function op<T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown> = {},
  actor?: number,
  timeoutMs = TIMEOUT_MS): Promise<DataResult<T>> {
  const out = await post<DataResult<T>>('/v1/op', { op: name, args }, actor, timeoutMs, name);
  return { operation: out.operation ?? name, rows: out.rows ?? [], affected: out.affected ?? 0,
    ...(out.scrubbed?.length ? { scrubbed: out.scrubbed } : {}) };
}

/** A named operation carrying a second trusted administrative identity. */
export async function opAuthorized<T = Record<string, unknown>>(
  name: string, args: Record<string, unknown>, actor: number, authority: number,
  timeoutMs = TIMEOUT_MS): Promise<DataResult<T>> {
  const out = await post<DataResult<T>>(
    '/v1/op', { op: name, args }, actor, timeoutMs, name, authority);
  return { operation: out.operation ?? name, rows: out.rows ?? [], affected: out.affected ?? 0,
    ...(out.scrubbed?.length ? { scrubbed: out.scrubbed } : {}) };
}

/**
 * One POST, shared by every endpoint.
 *
 * Extracted when the planner arrived: two copies of "retry once on a connection
 * failure, never on a refusal, and map the error body to a code" would have been
 * two places for that rule to drift, and the retry rule is the one where drift
 * means a write running twice.
 */
async function post<T>(
  path: string, body: unknown, actor: number | undefined,
  timeoutMs: number, label: string, authority?: number): Promise<T> {
  const headers = authHeaders(label, actor, authority);
  const payload = JSON.stringify(body);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${DATA_URL}${path}`, {
        method: 'POST', headers, body: payload, signal: ctl.signal,
      });
      if (!res.ok) {
        // A refusal is an ANSWER: read it, name it, and do not retry it.
        let code = `http_${res.status}`;
        let detail = '';
        try {
          const j = await res.json() as Refusal;
          if (typeof j.error === 'string' && j.error) code = j.error;
          if (typeof j.detail === 'string') detail = j.detail;
        } catch { /* a non-JSON body from a proxy; the status is what we have */ }
        throw new DataRefused(code, res.status, label, detail);
      }
      return await res.json() as T;
    } catch (e) {
      if (e instanceof DataRefused) throw e;
      lastErr = e;
      // Second attempt only for a connection-level failure.
      if (attempt === 2) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new DataUnreachable(label, lastErr);
}

/** The two headers, and the actor rule, in one place. */
function authHeaders(label: string, actor?: number, authority?: number): Record<string, string> {
  if (!DATA_SECRET) {
    throw new Error(
      `data: DATA_SECRETO is not set, so "${label}" cannot be called. `
      + 'This service holds no database credential of its own by design; without the secret '
      + 'it can read nothing at all. Run scripts/keys.sh.');
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-data-secreto': DATA_SECRET,
  };
  // Only sent when there is one. An absent header means "public operation";
  // sending actor=0 would be a caller inventing an identity, which is exactly
  // what the header format exists to prevent.
  if (actor !== undefined) {
    if (!Number.isInteger(actor) || actor <= 0) {
      throw new Error(`data: actor for "${label}" must be a positive integer, got ${String(actor)}`);
    }
    headers['x-data-actor'] = String(actor);
  }
  if (authority !== undefined) {
    if (!Number.isInteger(authority) || authority <= 0) {
      throw new Error(`data: authority for "${label}" must be a positive integer, got ${String(authority)}`);
    }
    headers['x-data-authority'] = String(authority);
  }
  return headers;
}

/** A GET returning JSON, for the two read-only descriptive endpoints. */
async function getJson<T>(path: string, timeoutMs: number): Promise<T> {
  const headers = authHeaders(path);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${DATA_URL}${path}`, { headers, signal: ctl.signal });
    if (!res.ok) throw new DataRefused(`http_${res.status}`, res.status, path, '');
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One row or null.
 *
 * Returns the FIRST row and ignores the rest, which matches how `get` behaved
 * and is safe because every operation that can match more than one row
 * declares an ORDER BY.
 */
export async function one<T = Record<string, unknown>>(
  name: string, args: Record<string, unknown> = {}, actor?: number): Promise<T | null> {
  const r = await op<T>(name, args, actor);
  return r.rows[0] ?? null;
}

/** Every row. */
export async function many<T = Record<string, unknown>>(
  name: string, args: Record<string, unknown> = {}, actor?: number): Promise<T[]> {
  return (await op<T>(name, args, actor)).rows;
}

/** A write. Returns rows affected. */
export async function write(
  name: string, args: Record<string, unknown> = {}, actor?: number): Promise<number> {
  return (await op(name, args, actor)).affected;
}

/** An atomic write with a declared RETURNING list. */
export async function writeMany<T = Record<string, unknown>>(
  name: string, args: Record<string, unknown> = {}, actor?: number): Promise<T[]> {
  return (await op<T>(name, args, actor)).rows;
}

/** A write scoped to a target actor and authorized by a separate admin actor. */
export async function writeAuthorized(
  name: string, args: Record<string, unknown>, actor: number, authority: number): Promise<number> {
  return (await opAuthorized(name, args, actor, authority)).affected;
}

// ---------------------------------------------------------------------------
// THE PLANNER. A second endpoint, and a different shape of trust.
//
// /v1/op runs one of a closed list of named statements. /v1/query runs a
// statement the data service ASSEMBLES from a plan the caller composed. It is
// not a SQL endpoint and the distinction is the whole design: the body carries a
// table name, column names and values, and every one of them is checked against
// the ontology before any SQL exists. data/internal/plan holds the threat model
// and the attack suite.
//
// Why api has a typed client for it at all, rather than the agent talking to
// data directly: the actor. It comes from the session cookie THIS process
// verified, and it travels in a header. A plan has no field for an identity, so
// "read another person's rows" is unspellable rather than validated.

/** One AND-ed filter. There is no OR and no nesting, on purpose. */
export interface PlanCond {
  column: string;
  /** = <> < <= > >= in like is_null is_not_null */
  op: string;
  value?: string | number | boolean;
  /** For `in`. */
  values?: (string | number | boolean)[];
}

/** One aggregate. `column` omitted means count(*). */
export interface PlanAgg {
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max';
  column?: string;
  as: string;
}

export interface PlanSort { column: string; dir?: 'asc' | 'desc' }

export interface QueryPlan {
  table: string;
  select?: string[];
  where?: PlanCond[];
  group?: string[];
  aggregate?: PlanAgg[];
  order?: PlanSort[];
  limit?: number;
}

/** What a plan may read. Cache it: it changes only with a migration. */
export interface PlannableSurface {
  tables: Record<string, { columns: string[]; scope?: string }>;
  operators: string[];
  aggregates: string[];
  limits: Record<string, number>;
}

/**
 * Runs a composed plan.
 *
 * Refusals arrive as DataRefused with the service's own message, and those
 * messages are USEFUL to an agent: they name what is readable rather than only
 * saying no. Passing them through is what lets a model fix its own plan on the
 * next turn instead of probing one column at a time.
 */
export async function query<T = Record<string, unknown>>(
  plan: QueryPlan, actor?: number, timeoutMs = TIMEOUT_MS): Promise<DataResult<T>> {
  return post<DataResult<T>>('/v1/query', plan, actor, timeoutMs, `query:${plan.table}`);
}

/** The surface a plan may name. */
export async function plannable(timeoutMs = 5_000): Promise<PlannableSurface> {
  return getJson<PlannableSurface>('/v1/plannable', timeoutMs);
}

export interface DataHealth {
  up: boolean;
  status?: string;
  operations?: number;
  detail?: string;
}

/**
 * Whether the service is answering. Short deadline: this is used by /api/health
 * and by boot, where a slow answer is the same as no answer.
 */
export async function dataHealth(timeoutMs = 2_500): Promise<DataHealth> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${DATA_URL}/health`, { signal: ctl.signal });
    if (!res.ok) return { up: false, detail: `health answered ${res.status}` };
    const j = await res.json() as Record<string, unknown>;
    return {
      up: true,
      status: typeof j.status === 'string' ? j.status : undefined,
      operations: typeof j.operations === 'number' ? j.operations : undefined,
    };
  } catch (e) {
    return { up: false, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The catalogue, for diagnostics and for the migration itself: comparing this
 * list against the call sites still using db.ts is how the remaining work is
 * counted. Never used to DECIDE anything at runtime -- a client that asks what
 * it is allowed to do and then does it has moved the policy to the client.
 */
export async function catalog(timeoutMs = 5_000): Promise<{ count: number; operations: unknown[] }> {
  const j = await getJson<{ count?: number; operations?: unknown[] }>('/v1/catalog', timeoutMs);
  return { count: j.count ?? 0, operations: j.operations ?? [] };
}
