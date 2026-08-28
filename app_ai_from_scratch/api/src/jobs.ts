// The job queue. Postgres as the queue, not RabbitMQ — and the reason is measured.
//
// THE WORK THAT GENUINELY CANNOT BE SYNCHRONOUS
//
// One, today: the Mercado Pago webhook. Before this module the handler verified
// the signature and THEN called the Mercado Pago API and wrote to the database
// twice, all before answering 200. Two real consequences:
//
//   · If their API is slow, MP times the webhook out and RETRIES. The database is
//     idempotent thanks to the ON CONFLICT, so no duplicate rows appear, but the
//     buyer's `paid = 1` ends up at the mercy of a third party's retry policy.
//   · If the fetch fails we answer 500 and the event is lost unless MP insists. A
//     payment confirmation cannot depend on that.
//
// The right shape: verify the signature, RECORD the event, answer 200 in
// milliseconds, and process it separately with retries.
//
// WHY NOT RABBITMQ (yet)
//
// A broker solves fan-out between services, high throughput and consumers on
// several machines. Today there is one job, one consumer and a USD 9.99 payment
// per person. Adding RabbitMQ would be one more container, one more protocol, a
// dead-letter queue to watch and a new failure mode (broker down = payments not
// processed) in order to move one message every so often.
//
// `FOR UPDATE SKIP LOCKED` gives real queue semantics — a job is taken by exactly
// one worker, even with several processes — on a database that is ALREADY deployed
// and backed up. It is the same technique pgmq, Oban and Solid Queue use; it is
// not a hack.
//
// WHEN TO SWITCH TO RABBITMQ (conditions, not opinions)
//
//   1. More than ~50 jobs per second sustained, or
//   2. a consumer that is NOT this process (a mail service, a PDF generator on
//      another machine), or
//   3. fan-out is needed: one event with several distinct interested parties.
//
// While none of those holds, the Postgres queue is cheaper and fails in fewer
// places. The change is prepared: enqueue() and the worker loop are the only
// boundary; a RabbitMQ driver replaces takeBatch() and finish() without touching
// who enqueues or who executes.
//
// NOTE ON NAMES: the KEYS of the returned objects — `nuevo`, `tomados`, `hechos`,
// `fallos`, `muertos`, `por`, `esperaMax`, `manejadores`, `huerfanos` — are the
// wire format of GET /api/health and what api/test/queue.mts asserts on, so they
// are unchanged. So are the `jobs` column names (tipo, clave, datos, estado,
// intentos, corre_en, tomado_en, acabado_en, creado_en) and the `estado` values
// ('pendiente', 'curso', 'hecho', 'muerto'), which the jobs_estado_check
// constraint enumerates: those are api/prisma/, not this module.
import { many, one, write, writeMany } from './data.ts';

// The MINIMUM the worker needs from a log. Not `Console`: asking for Console
// forces every test double to implement 21 methods nobody calls, and then the
// tests pass an `any` and the type stops protecting anything.
export interface Log {
  warn?: (...a: unknown[]) => void;
  error?: (...a: unknown[]) => void;
}

// `throw` accepts anything, not just Error: a library that throws a string leaves
// `e.message` undefined and the log would say «retry: undefined». This gets text
// out of whatever it is.
const text = (e: unknown): string =>
  (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e));

/** A job handler. Receives the parsed `datos` payload. */
export type Handler = (data: Record<string, unknown>) => Promise<void> | void;

/** Handlers by type. Registered from outside so the queue is not coupled to the domain. */
const HANDLERS = new Map<string, Handler>();

const JOB_TYPE = /^[a-z0-9_.-]{1,100}$/;
export function register(type: string, fn: Handler): void {
  if (!JOB_TYPE.test(type)) throw new Error(`invalid job type: ${type}`);
  HANDLERS.set(type, fn);
}

export const MAX_ATTEMPTS = 6;
// Exponential backoff with a ceiling: 2s, 8s, 32s, 128s, 512s, 1024s. A payment
// that fails because the gateway is down is retried for a good half hour; beyond
// that the problem is not transient and somebody has to look at it.
export const backoff = (attempts: number): number =>
  Math.min(1024, 2 * 4 ** Math.max(0, attempts - 1));

/**
 * Enqueues a job. `key` makes it idempotent: enqueuing the same key twice does
 * not create two jobs. For a webhook the key is the payment id, so Mercado Pago's
 * retry does not duplicate work.
 */
export async function enqueue(
  type: string, data: unknown, key: string | null = null): Promise<{ nuevo: boolean }> {
  if (!JOB_TYPE.test(type)) throw new Error(`invalid job type: ${type}`);
  const affected = await write('job.enqueue', {
    type,
    key: key ?? `${type}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    payload: JSON.stringify(data ?? {}),
  });
  return { nuevo: affected > 0 };
}

/** A job as takeBatch() returns it. */
export interface TakenJob {
  id: number;
  tipo: string;
  clave: string | null;
  datos: unknown;
  intentos: number;
}

/**
 * Takes up to `n` due jobs and marks them in progress IN THE SAME query.
 *
 * SKIP LOCKED is what makes this a queue: two workers running at once do not
 * fight over the same job — the second skips the locked rows instead of waiting.
 * Without SKIP LOCKED, with two processes, one blocks behind the other and the
 * queue serialises with nothing to warn you.
 *
 * ONLY THE TYPES THIS PROCESS KNOWS HOW TO RUN ARE TAKEN. That is not a detail:
 * without the filter, during a rolling deploy the OLD instance takes a job of a
 * new type, finds no handler and kills it — killing work the new instance would
 * have known how to do. A test found it: the running server's worker was eating
 * the `test.*` jobs of api/test/queue.mts.
 *
 * A type with no handler in ANY process stays pending, and queueState() counts it
 * as an orphan so it is not invisible.
 */
export async function takeBatch(n = 5, types: readonly string[] = [...HANDLERS.keys()]): Promise<TakenJob[]> {
  if (!types.length) return [];
  if (!types.every((type) => JOB_TYPE.test(type))) throw new Error('invalid job type in handler set');
  return writeMany<TakenJob>('job.take', { types: types.join(','), limit: n });
}

async function finish(id: number): Promise<void> {
  await write('job.finish', { job: id });
}

async function reschedule(
  id: number, attempts: number, error: unknown): Promise<{ muerto: boolean; enSegundos?: number }> {
  const msg = text(error).slice(0, 500);
  if (attempts >= MAX_ATTEMPTS) {
    // It is not deleted: a dead job that disappears is a lost payment with no
    // trace. It stays as 'muerto' so it can be seen and retried by hand.
    await write('job.dead', { job: id, error: msg });
    return { muerto: true };
  }
  const s = backoff(attempts);
  await write('job.reschedule', { job: id, error: msg, seconds: s });
  return { muerto: false, enSegundos: s };
}

/** What one pass over the queue did. Wire format of api/test/queue.mts. */
export interface BatchResult {
  tomados: number;
  hechos: number;
  fallos: number;
  muertos: number;
}

/**
 * Runs one batch. Returns the counts; does not throw: one bad job does not take
 * the worker down.
 */
export async function runBatch(n = 5, log: Log = console): Promise<BatchResult> {
  const batch = await takeBatch(n);
  let hechos = 0, fallos = 0, muertos = 0;
  for (const j of batch) {
    const fn = HANDLERS.get(j.tipo);
    if (!fn) {
      // With takeBatch's filter this should not happen. If it does, somebody
      // unregistered a type between taking and running: it goes back to pending
      // instead of being killed, because the job is still valid.
      await write('job.release', { job: j.id });
      continue;
    }
    try {
      const data = typeof j.datos === 'string' ? JSON.parse(j.datos) : j.datos;
      await fn((data ?? {}) as Record<string, unknown>);
      await finish(j.id);
      hechos++;
    } catch (e) {
      const r = await reschedule(j.id, j.intentos, e);
      if (r.muerto) { muertos++; log.error?.({ trabajo: j.id, tipo: j.tipo }, `dead job: ${text(e)}`); }
      else { fallos++; log.warn?.({ trabajo: j.id, tipo: j.tipo, enSegundos: r.enSegundos }, `retry: ${text(e)}`); }
    }
  }
  return { tomados: batch.length, hechos, fallos, muertos };
}

export interface WorkerOptions {
  idleMs?: number;
  busyMs?: number;
  batch?: number;
  log?: Log;
}

/**
 * The worker loop. Polls every `idleMs` when there is nothing.
 *
 * Polling is not elegant and it is the right thing here: at one job every few
 * hours, a LISTEN/NOTIFY adds a dedicated connection and a reconnection path in
 * order to save a query that costs less than a millisecond. When the volume asks
 * for it, this is the place that changes.
 *
 * @returns the function that stops it.
 */
export function worker({ idleMs = 5000, busyMs = 200, batch = 5, log = console }: WorkerOptions = {}): () => void {
  let alive = true;
  let timer: NodeJS.Timeout | null = null;
  const tick = async (): Promise<void> => {
    if (!alive) return;
    let r: BatchResult = { tomados: 0, hechos: 0, fallos: 0, muertos: 0 };
    try { r = await runBatch(batch, log); }
    catch (e) { log.error?.(`worker: ${text(e)}`); }
    if (!alive) return;
    timer = setTimeout(tick, r.tomados ? busyMs : idleMs);
    timer.unref?.();   // does not keep the process alive
  };
  void tick();
  return () => { alive = false; if (timer) clearTimeout(timer); };
}

// ---------------------------------------------------------------------------
// PERSISTED COUNTERS
//
// A daily spend ceiling that lives in a Map is not a ceiling: it resets on every
// deploy, and a deploy is exactly when an attacker retries. So the counter has to
// survive a restart, which means it has to be in Postgres.
//
// It lives in the `jobs` table, on purpose and with the cost stated. jobs already
// has what a counter needs — a UNIQUE (tipo, clave) to make the increment atomic
// through ON CONFLICT, and a JSONB payload to hold the number — so this needs no
// migration, and migrations are the one thing this module cannot add.
//
// The rows are written as estado='hecho' so no worker ever looks at them:
// 'pendiente' rows of a type with no handler are what queueState() reports as
// `huerfanos`, and a counter showing up as an orphaned job is a false alarm every
// time someone reads /api/health. queueState() also excludes this tipo from its
// per-state census for the same reason.
//
// WHEN THIS MOVES: the day a second kind of counter appears, or the day quotas
// need a window that is not a calendar day, this earns its own table. Until
// then, one type of row in an existing table beats a schema change.
let lastPrune = 0;
const PRUNE_MS = 60 * 60 * 1000;

/**
 * Adds `n` to the counter under `key` and returns its new value.
 * Atomic: the increment happens inside the ON CONFLICT, so two concurrent
 * requests cannot both read 4 and both write 5.
 */
export async function increment(key: string, n = 1): Promise<number> {
  await write('counter.bump', { key: String(key), amount: n });
  const row = await one<{ n: number }>('counter.read', { key: String(key) });
  // Counters are one row per key per day and nothing else prunes this table, so
  // they would accumulate forever. Swept at most once an hour per process.
  if (Date.now() - lastPrune > PRUNE_MS) {
    lastPrune = Date.now();
    await write('counter.prune');
  }
  return row?.n ?? n;
}

/** Reads a counter without touching it. 0 when it was never written. */
export async function readCounter(key: string): Promise<number> {
  const row = await one<{ n: number }>('counter.read', { key: String(key) });
  return row?.n ?? 0;
}

/** What GET /api/health reports about the queue. Keys are wire format. */
export interface QueueState {
  por: Record<string, number>;
  esperaMax: number;
  manejadores: string[];
  huerfanos: Record<string, number>;
}

/** For /api/health, and to know whether something is piling up. */
export async function queueState(): Promise<QueueState> {
  const byState = await many<{ estado: string; n: number }>('job.state_counts');
  const oldest = await one<{ oldest: string | null }>('job.oldest_due');
  const types = [...HANDLERS.keys()];
  // Orphans: pending jobs of a type THIS process cannot run. With a single
  // instance it is a programming error; with several it can be normal for a while
  // during a deploy. Either way it has to be visible: a job nobody takes and
  // nobody counts is a job lost in silence.
  const orphans = await many<{ tipo: string; n: number }>(
    'job.orphans', { handled: types.join(',') });
  return {
    por: Object.fromEntries(byState.map((f) => [f.estado, f.n])),
    esperaMax: oldest?.oldest
      ? Math.max(0, Math.floor((Date.now() - Date.parse(oldest.oldest)) / 1000))
      : 0,
    manejadores: types,
    huerfanos: Object.fromEntries(orphans.map((f) => [f.tipo, f.n])),
  };
}
