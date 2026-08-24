// Inter-service transport. RabbitMQ topic exchange, one queue per consumer, one
// dead-letter queue, and the retry policy written down as numbers.
//
// WHY THIS IS A LIBRARY AND NOT A SERVICE
//
// docs/ARCHITECTURE.md refuses to build an `orchestrator` container, and this file is
// the other half of that argument: the routing substrate is RabbitMQ, and the
// POLICY (envelope shape, routing keys, idempotency, retry ceiling, backoff) is
// compiled into the services that do the work. There is no central router here
// on purpose. `ai/src/course_ai/bus.py` is the same contract in Python; the two files
// must stay readable as one document, because the two runtimes read each other's
// messages.
//
// WHERE THE BOUNDARY WITH jobs.ts IS  (read this before adding a job type)
//
//   jobs.ts      Postgres queue. Work that ONE service both enqueues and runs,
//                inside its own database transaction story: the Mercado Pago
//                webhook, the persisted spend counters. It stays. It is not
//                deprecated by this file and this file does not replace it.
//   bus.ts       Work that CROSSES a service boundary, or that fans out to more
//                than one interested consumer: batch grading, embeddings, the
//                weekly league close, e-mail, exports, re-indexing.
//
// The test is not "is it asynchronous", it is "does anybody else need to see
// it". A job whose producer and consumer are the same process has no business
// paying for a broker hop; a job whose consumer is a different image cannot use
// a Postgres queue without giving `ai` the database, which docs/ARCHITECTURE.md
// forbids. Two mechanisms, one rule each, stated here so the next person does
// not add a third.
//
// HTTP IS STILL THE CHAT PATH. Nothing in this file touches `api ↔ ai` for a
// chat turn. A person is blocked on that request; a broker round-trip would buy
// a reply queue, a correlation id and a timeout policy in exchange for latency.
// See the transport rule in docs/ARCHITECTURE.md.
//
// -----------------------------------------------------------------------------
// THE ENVELOPE  —  keep identical to the block in ai/src/course_ai/bus.py
//
//   {
//     "id":              "0f9c1e6a-...",             uuid4, the message identity
//     "type":            "league.week.close",        what to do / what happened
//     "key":             "league.week.close",         routing key it went out with
//     "idempotency_key": "league.week.close:2026-08-17",  the unit of "already done"
//     "attempt":         1,                          1 on first publish, +1 per retry
//     "produced_at":     "2026-08-23T14:05:00.000Z", RFC3339, UTC, milliseconds
//     "payload":         {}                          free-form JSON, per type
//   }
//
// Rules that make the two runtimes interoperable:
//   · snake_case field names, because half the readers are Python.
//   · `id` is STABLE across retries: a retry is the same message, later. The
//     AMQP `messageId` property carries `${id}:${attempt}`, which IS unique per
//     publish attempt, so a publisher confirm or a mandatory-return can be
//     correlated without adding a field nobody reads.
//   · `produced_at` is the time of the FIRST publish and is copied forward by
//     retries. That is what makes "this work is 40 minutes old" answerable.
//   · `attempt` is an integer >= 1. `idempotency_key` is what dedupe keys on, so
//     it MUST survive the republish untouched.
//   · unknown extra fields are preserved on retry, so a newer producer can add
//     one without an older consumer dropping it.
// -----------------------------------------------------------------------------
import { randomUUID } from 'node:crypto';

// The field list, in order. Asserted by the tests on BOTH sides: renaming one
// here without renaming it in ai/src/course_ai/bus.py breaks the other service silently.
export const ENVELOPE_FIELDS = ['id', 'type', 'key', 'idempotency_key', 'attempt', 'produced_at', 'payload'];

// AMQP delivery mode 2 = persist to disk. Not configurable, in either runtime: a
// message the broker forgets on restart is not a message, it is a hope.
export const PERSISTENT = 2;

export interface Log {
  info?: (...a: unknown[]) => void;
  warn?: (...a: unknown[]) => void;
  error?: (...a: unknown[]) => void;
}

/** The envelope. snake_case because half the readers are Python. */
export interface Envelope {
  id: string;
  type: string;
  key: string;
  idempotency_key: string;
  attempt: number;
  produced_at: string;
  payload: Record<string, unknown>;
}

export type Handler =
  (payload: Record<string, unknown>, meta: { envelope: Envelope; log: Log }) => Promise<void> | void;

/** The idempotency lease. Two implementations below: Postgres and in-memory. */
export interface Claims {
  claim(key: string): Promise<boolean>;
  complete(key: string): Promise<void>;
  release(key: string): Promise<void>;
}

// The slice of an AMQP channel and connection this module actually uses.
//
// Declared structurally rather than imported from amqplib for the same reason the
// driver import is by variable: amqplib is an OPTIONAL runtime dependency (a
// service with no AMQP_URL never loads it) and api/test/transport.mts injects a
// double instead. Naming the methods here is what makes a typo in one of them a
// compile error rather than a broker that silently consumes nothing.
export interface AmqpMessage {
  content: Buffer | string;
  fields?: { routingKey?: string; redelivered?: boolean; deliveryTag?: number };
  properties?: { messageId?: string };
}

export interface BusChannel {
  assertExchange(name: string, type: string, options?: unknown): Promise<unknown>;
  assertQueue(name: string, options?: unknown): Promise<unknown>;
  bindQueue(queue: string, exchange: string, pattern: string): Promise<unknown>;
  prefetch(n: number): Promise<unknown>;
  consume(queue: string, cb: (msg: AmqpMessage | null) => void, options?: unknown):
    Promise<{ consumerTag: string }>;
  cancel(tag: string): Promise<unknown>;
  ack(msg: AmqpMessage): void;
  nack(msg: AmqpMessage, allUpTo?: boolean, requeue?: boolean): void;
  publish(exchange: string, key: string, body: Buffer, options: Record<string, unknown>,
          cb?: (err?: Error | null) => void): boolean;
  close?(): Promise<unknown>;
  on?(event: string, cb: (arg?: never) => void): unknown;
  once?(event: string, cb: (arg?: never) => void): unknown;
}

export interface BusConnection {
  createConfirmChannel(): Promise<BusChannel>;
  close?(): Promise<unknown>;
  on?(event: string, cb: (arg?: never) => void): unknown;
  once?(event: string, cb: (arg?: never) => void): unknown;
}

interface Link { conn: BusConnection; ch: BusChannel }

// `throw` accepts anything, not only Error: a library that throws a string
// leaves `e.message` undefined and the log reads "retry: undefined".
const text = (e: unknown): string =>
  (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e));

// ---------------------------------------------------------------------------
// RETRY POLICY. Numbers, not adjectives.
//
// delay(attempt) = min(CAP, BASE * FACTOR^(attempt-1))
//   attempt 1 fails -> wait  1s
//   attempt 2 fails -> wait  4s
//   attempt 3 fails -> wait 16s
//   attempt 4 fails -> wait 60s   (256s clipped by the cap)
//   attempt 5 fails -> dead-letter queue, no further retry
//
// Five handler runs spread over ~81 seconds of deliberate waiting. Past that the
// failure is not transitory and a human has to look at the DLQ.
//
// The wait happens IN THE BROKER, never in the consumer: the message is
// republished to a per-tier delay queue whose only job is to hold it for its
// TTL and then dead-letter it back to the main exchange. A nack with
// requeue=true would put the message straight back at the head of the queue and
// spin the CPU at broker speed — that is the hot loop this design refuses.
//
// Fixed tiers instead of a per-message TTL: a single delay queue with per-message
// expiry blocks head-of-line (a 60s message at the head holds up a 1s message
// behind it), which silently breaks the schedule above. Four queues cost four
// declarations and keep the numbers honest. The trade-off accepted here is that
// tiers have no jitter, so a batch that fails together retries together.
export const BASE_DELAY_MS = 1_000;
export const DELAY_FACTOR = 4;
export const DELAY_CAP_MS = 60_000;
export const MAX_ATTEMPTS = 5;

/** Backoff for a failed attempt, in milliseconds. Same numbers in Python. */
export const delayFor = (attempt: number): number =>
  Math.min(DELAY_CAP_MS, BASE_DELAY_MS * DELAY_FACTOR ** Math.max(0, (attempt | 0) - 1));

/** The distinct delay tiers, which is exactly the set of retry queues to declare. */
export const DELAY_TIERS_MS = [...new Set(
  Array.from({ length: MAX_ATTEMPTS - 1 }, (_, i) => delayFor(i + 1)),
)].sort((a, b) => a - b);

// Reconnect backoff is a DIFFERENT policy from message retry and is kept
// separate on purpose: a broker that is down does not mean a message is bad.
export const RECONNECT_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
const reconnectDelay = (n: number): number => RECONNECT_MS[Math.min(n, RECONNECT_MS.length - 1)]!;

// ---------------------------------------------------------------------------
// CONFIGURATION. Environment only. No default that points at a real host and no
// embedded credentials — this repository just had a security pass over exactly
// that (see the DATABASE_URL note in db.ts and the JWT_SECRET one in auth.ts).
// An unset AMQP_URL is a supported state, not an error: the broker container is
// not in docker-compose yet and `api` must keep booting without it.
const pos = (v: unknown, d: number): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

/** Resolved configuration. `url` is in here; never log this object whole. */
export interface BusConfig {
  url: string;
  enabled: boolean;
  exchange: string;
  prefetch: number;
  worker: string;
  claimLeaseS: number;
  handlerTimeoutMs: number;
  drainMs: number;
  publishTimeoutMs: number;
}

export function busConfig(env: Record<string, string | undefined> = process.env): BusConfig {
  const url = (env.AMQP_URL ?? '').trim();
  return {
    url,
    enabled: Boolean(url),
    exchange: (env.BUS_EXCHANGE || 'course.events').trim(),
    prefetch: pos(env.BUS_PREFETCH, 8),
    // Identity of this worker, used by the idempotency lease so that a worker
    // which restarts can reclaim its OWN half-finished claim without waiting
    // out the lease. Stable across restarts on purpose: a pid would not be.
    worker: (env.BUS_WORKER_ID || env.HOSTNAME || 'worker').trim(),
    claimLeaseS: pos(env.BUS_CLAIM_LEASE_S, 300),
    handlerTimeoutMs: pos(env.BUS_HANDLER_TIMEOUT_MS, 60_000),
    drainMs: pos(env.BUS_DRAIN_MS, 20_000),
    publishTimeoutMs: pos(env.BUS_PUBLISH_TIMEOUT_MS, 10_000),
  };
}

/** A connection URL with the credentials removed, safe for a log line. */
export function redact(url: string | undefined | null): string {
  if (!url) return '(unset)';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username ? '***@' : ''}${u.host}${u.pathname}`;
  } catch { return '(unparseable AMQP_URL)'; }
}

let announced = false;
/**
 * Says out loud, once, whether the broker is configured. Called by the worker at
 * boot and by the first publish, so a disabled bus is never a silent one.
 */
export function announce(log: Log = console): boolean {
  if (announced) return busConfig().enabled;
  announced = true;
  const c = busConfig();
  if (c.enabled) log.info?.(`bus: enabled, exchange=${c.exchange} broker=${redact(c.url)}`);
  else log.warn?.('bus: DISABLED — AMQP_URL is not set. Cross-service messages are dropped '
                + 'and nothing is consumed. This service keeps running on purpose; set AMQP_URL '
                + 'once the broker container exists.');
  return c.enabled;
}

/** Only for tests: forget that announce() already spoke. */
export function resetAnnounce(): void { announced = false; }

// ---------------------------------------------------------------------------
// TOPOLOGY, as data. Pure function so it can be asserted in a test without a
// broker, and applied idempotently on every connect so a cold start in any
// order converges: whoever arrives first declares, the rest re-declare the same
// thing, and AMQP declarations with identical arguments are no-ops.
//
//   exchange  {ex}                 topic     durable   the one everybody binds to
//   exchange  {ex}.dlx             topic     durable   dead letters
//   queue     {ex}.dead            durable             bound to .dlx with '#'
//   exchange  {ex}.retry.{ms}      fanout    durable   one per delay tier
//   queue     {ex}.retry.{ms}      durable             ttl={ms}, dead-letters to {ex}
//   queue     {consumer}           durable             dead-letters to {ex}.dlx
//
// Why fanout for the retry tiers and not one direct exchange: a message
// dead-lettered out of a delay queue keeps the routing key it was PUBLISHED
// with. Publishing to a direct exchange means publishing with the tier's name as
// the key, and the message would come back to the main exchange with that key
// and match nothing. A fanout ignores the routing key for routing while the
// message keeps its original one, so the delayed message re-enters the main
// exchange exactly as it left it.
export const retryExchange = (ex: string, ms: number): string => `${ex}.retry.${ms}`;
export const retryQueue = (ex: string, ms: number): string => `${ex}.retry.${ms}`;
export const dlx = (ex: string): string => `${ex}.dlx`;
export const dlq = (ex: string): string => `${ex}.dead`;

export interface ExchangeDecl { name: string; type: string; options: { durable: boolean } }
export interface QueueDecl { name: string; options: { durable: boolean; arguments?: Record<string, unknown> } }
export interface BindingDecl { queue: string; exchange: string; pattern: string }
export interface Topology { exchanges: ExchangeDecl[]; queues: QueueDecl[]; bindings: BindingDecl[] }

export function topology(
  { exchange, queue = null, patterns = [] }:
    { exchange: string; queue?: string | null; patterns?: string[] }): Topology {
  const exchanges: ExchangeDecl[] = [
    { name: exchange, type: 'topic', options: { durable: true } },
    { name: dlx(exchange), type: 'topic', options: { durable: true } },
  ];
  const queues: QueueDecl[] = [
    { name: dlq(exchange), options: { durable: true } },
  ];
  const bindings: BindingDecl[] = [
    { queue: dlq(exchange), exchange: dlx(exchange), pattern: '#' },
  ];
  for (const ms of DELAY_TIERS_MS) {
    exchanges.push({ name: retryExchange(exchange, ms), type: 'fanout', options: { durable: true } });
    queues.push({
      name: retryQueue(exchange, ms),
      options: {
        durable: true,
        arguments: {
          'x-message-ttl': ms,
          // Back to the main exchange, keeping the original routing key.
          'x-dead-letter-exchange': exchange,
        },
      },
    });
    bindings.push({ queue: retryQueue(exchange, ms), exchange: retryExchange(exchange, ms), pattern: '' });
  }
  if (queue) {
    queues.push({
      name: queue,
      options: { durable: true, arguments: { 'x-dead-letter-exchange': dlx(exchange) } },
    });
    // A consumer with no pattern would be a queue nothing routes to, which looks
    // like a broker problem and is a wiring problem. Say it at declare time.
    if (!patterns.length) throw new Error(`bus: queue "${queue}" declared with no routing patterns`);
    for (const p of patterns) bindings.push({ queue, exchange, pattern: p });
  }
  return { exchanges, queues, bindings };
}

/** Applies a topology to a channel. Idempotent by construction. */
export async function declareTopology(ch: BusChannel, topo: Topology): Promise<Topology> {
  for (const e of topo.exchanges) await ch.assertExchange(e.name, e.type, e.options);
  for (const q of topo.queues) await ch.assertQueue(q.name, q.options);
  for (const b of topo.bindings) await ch.bindQueue(b.queue, b.exchange, b.pattern);
  return topo;
}

// ---------------------------------------------------------------------------
// ENVELOPE
const nowIso = (): string => new Date().toISOString();

export interface MakeEnvelope {
  type: string;
  payload?: Record<string, unknown>;
  key?: string;
  idempotencyKey?: string;
  attempt?: number;
  id?: string;
  producedAt?: string;
}

export function makeEnvelope(
  { type, payload = {}, key, idempotencyKey, attempt = 1, id, producedAt }: MakeEnvelope): Envelope {
  if (!type || typeof type !== 'string') throw new Error('bus: envelope needs a string type');
  // The id is generated FIRST because the default idempotency key is derived
  // from it. Deriving it from the `id` PARAMETER instead gave every message of a
  // type the same key (`type:auto`), so two unrelated publishes deduped into one
  // and the second was acked without ever running. Found by test/transporte.mjs.
  const mid = id ?? randomUUID();
  return {
    id: mid,
    type,
    key: key ?? type,
    // Default identity of the work: the message id. That makes every publish a
    // distinct unit of work, which is the SAFE default — dedupe only collapses
    // two messages when the caller says what "the same work" means.
    idempotency_key: idempotencyKey ?? `${type}:${mid}`,
    attempt: Math.max(1, attempt | 0),
    produced_at: producedAt ?? nowIso(),
    payload: payload ?? {},
  };
}

/** Throws on anything that is not a readable envelope. The caller dead-letters it. */
export function parseEnvelope(content: Buffer | string): Envelope {
  const raw = JSON.parse(Buffer.isBuffer(content) ? content.toString('utf8') : String(content)) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') throw new Error('envelope is not an object');
  for (const f of ENVELOPE_FIELDS.filter((n) => n !== 'attempt' && n !== 'payload')) {
    if (typeof raw[f] !== 'string' || !raw[f]) throw new Error(`envelope field "${f}" missing`);
  }
  if (!Number.isInteger(raw.attempt) || Number(raw.attempt) < 1) throw new Error('envelope field "attempt" invalid');
  // `!Array.isArray` is the load-bearing clause. `typeof [] === 'object'`, so without it
  // an array payload was ACCEPTED here while the other two consumers of this same wire
  // format rejected it: ai/src/course_ai/bus.py asks `isinstance(payload, dict)`, and
  // queue/internal/bus/envelope.go types Payload as map[string]any so an array cannot
  // even decode. `{"payload": []}` was therefore valid work to this service and a dead
  // letter to the other two — which of them happened to consume the message decided
  // whether it ran at all. Nothing publishes an array payload today, which is exactly
  // why it went unnoticed. All three headers document payload as an object; this makes
  // the three implementations agree on it instead of two out of three.
  if (raw.payload == null || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) {
    throw new Error('envelope field "payload" invalid');
  }
  return raw as unknown as Envelope;
}

/** The AMQP properties every publish uses. delivery mode 2 is not negotiable. */
export interface PublishOptions {
  persistent: boolean;
  deliveryMode: number;
  contentType: string;
  messageId: string;
  timestamp: number;
  type: string;
  headers: Record<string, unknown>;
}

export function publishOptions(env: Envelope): PublishOptions {
  return {
    persistent: true,             // amqplib writes deliveryMode: 2
    deliveryMode: PERSISTENT,     // stated twice on purpose: this is the whole point
    contentType: 'application/json',
    messageId: `${env.id}:${env.attempt}`,
    timestamp: Math.floor(new Date(env.produced_at).getTime() / 1000) || Math.floor(Date.now() / 1000),
    type: env.type,
    headers: { 'x-bus-attempt': env.attempt, 'x-bus-idempotency-key': env.idempotency_key },
  };
}

// ---------------------------------------------------------------------------
// PUBLISH, on a confirm channel.
//
// Three ways a publish can fail to be a publish, and all three must report
// failure rather than success:
//   1. the broker nacks it (confirm callback gets an error),
//   2. the broker cannot route it and returns it (mandatory=true), which is
//      followed by a POSITIVE confirm — so waiting for the confirm alone would
//      call an unroutable message delivered,
//   3. nothing answers at all, which is why there is a timeout.
const returnsHooked = new WeakSet<BusChannel>();
const pendingReturns = new Map<string, ((e: Error) => void)[]>();

function hookReturns(ch: BusChannel): void {
  if (returnsHooked.has(ch)) return;
  returnsHooked.add(ch);
  ch.on?.('return', ((msg: AmqpMessage) => {
    const id = msg?.properties?.messageId;
    const waiting = id ? pendingReturns.get(id) : null;
    const reject = waiting?.shift();
    if (waiting && !waiting.length) pendingReturns.delete(id);
    reject?.(new Error(`unroutable: no queue bound for "${msg?.fields?.routingKey}"`));
  }) as (arg?: never) => void);
}

export interface PublishAck { published: true; id: string }

/**
 * Publishes one envelope and waits for the confirm. Resolves only when the
 * broker took durable responsibility for the message.
 */
export function publishOn(
  ch: BusChannel,
  { exchange, envelope, key, timeoutMs = 10_000, mandatory = true }:
    { exchange: string; envelope: Envelope; key?: string; timeoutMs?: number; mandatory?: boolean },
): Promise<PublishAck> {
  hookReturns(ch);
  const opts = publishOptions(envelope);
  const rk = key ?? envelope.key;
  const body = Buffer.from(JSON.stringify(envelope), 'utf8');
  return new Promise<PublishAck>((resolve, reject) => {
    let done = false;
    const finish = (err?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const waiting = pendingReturns.get(opts.messageId);
      if (waiting) {
        const i = waiting.indexOf(onReturn);
        if (i >= 0) waiting.splice(i, 1);
        if (!waiting.length) pendingReturns.delete(opts.messageId);
      }
      if (err) reject(err); else resolve({ published: true, id: envelope.id });
    };
    const onReturn = (e: Error): void => finish(e);
    // NOT unref'd: a publish in flight is real work, and a process that exits
    // while waiting for a confirm cannot know whether the message survived.
    const timer = setTimeout(() => finish(new Error(`publish confirm timed out after ${timeoutMs}ms`)), timeoutMs);

    if (mandatory) {
      const waiting = pendingReturns.get(opts.messageId) ?? [];
      waiting.push(onReturn);
      pendingReturns.set(opts.messageId, waiting);
    }
    let ok = true;
    try {
      ok = ch.publish(exchange, rk, body, { ...opts, mandatory }, (err) => finish(err ?? undefined));
    } catch (e) {
      finish(e instanceof Error ? e : new Error(text(e)));
      return;
    }
    // `false` means amqplib's write buffer is full. The message is queued in the
    // library, the confirm still arrives, so this is back-pressure information
    // and not a failure — the caller learns about it by waiting.
    if (!ok) ch.once?.('drain', () => {});
  });
}

// ---------------------------------------------------------------------------
// IDEMPOTENCY. The Postgres pattern already in jobs.ts, reused, not
// reinvented: one row per key on the `jobs` table, UNIQUE (tipo, clave), and the
// race decided by ON CONFLICT rather than by reading first.
//
// It lives in `jobs` for the same reason the persisted counters do (see the
// PERSISTED COUNTERS note in jobs.ts): the table already has the unique
// constraint an atomic claim needs and a JSONB column to hold the state, so this
// needs no migration — and a migration is the one thing this module cannot add.
// Rows are written with estado='hecho' so no `worker()` ever picks them up. The
// cost, stated: queueState() counts them in its 'hecho' census. They are
// recognisable by tipo='bus.claim'. The day a second kind of claim shows up, or
// the day these need their own retention, this earns a table.
//
// A CLAIM IS A LEASE, NOT A FLAG. Marking "done" before running loses work when
// the process dies mid-handler; marking it only after running lets a redelivery
// run the handler twice. So the row says running|done plus who and when:
//   · no row            -> claim it, run the handler
//   · running, ours     -> we crashed holding it; take it again immediately
//   · running, theirs, fresh -> somebody is on it; skip
//   · running, theirs, older than the lease -> they died; take it
//   · done              -> skip, forever
// A failed handler DELETES its own claim, so the scheduled retry is not mistaken
// for a duplicate.
const CLAIM_TYPE = 'bus.claim';
const PRUNE_MS = 60 * 60 * 1000;
let pruned = 0;

// db.ts is imported lazily so that this module can be loaded by a test with no
// DATABASE_URL: importing it eagerly builds a pool and, outside development,
// throws at import time. A transport library must be readable without a database.
const dbGet = async <T>(sql: string, params: readonly (string | number)[]): Promise<T | null> =>
  (await import('./db.ts')).get<T>(sql, params);
const dbRun = async (sql: string, params: readonly (string | number)[]): Promise<unknown> =>
  (await import('./db.ts')).run(sql, params);

/** Postgres-backed claims. */
export function pgClaims({ worker, leaseS = 300 }: { worker: string; leaseS?: number }): Claims {
  return {
    async claim(key) {
      const row = await dbGet<{ ok: number }>(
        `INSERT INTO jobs (tipo, clave, datos, estado, acabado_en)
         VALUES (?, ?, jsonb_build_object('state','running','owner',?::text,'at',to_jsonb(now())), 'hecho', now())
         ON CONFLICT (tipo, clave) DO UPDATE
            SET datos = jsonb_build_object('state','running','owner',?::text,'at',to_jsonb(now()))
          WHERE jobs.datos->>'state' = 'running'
            AND (jobs.datos->>'owner' = ?::text
                 OR (jobs.datos->>'at')::timestamptz < now() - make_interval(secs => ?::double precision))
         RETURNING 1 AS ok`,
        [CLAIM_TYPE, String(key), worker, worker, worker, leaseS]);
      // Nothing else prunes this table, so old 'done' rows are swept at most
      // once an hour per process — same policy as the counters in jobs.ts.
      if (Date.now() - pruned > PRUNE_MS) {
        pruned = Date.now();
        await dbRun(`DELETE FROM jobs WHERE tipo = ? AND creado_en < now() - interval '30 days'`, [CLAIM_TYPE]);
      }
      return Boolean(row);
    },
    async complete(key) {
      await dbRun(
        `UPDATE jobs
            SET datos = jsonb_build_object('state','done','owner',?::text,'at',to_jsonb(now())),
                acabado_en = now()
          WHERE tipo = ? AND clave = ?`,
        [worker, CLAIM_TYPE, String(key)]);
    },
    async release(key) {
      await dbRun(
        `DELETE FROM jobs
          WHERE tipo = ? AND clave = ?
            AND datos->>'state' = 'running' AND datos->>'owner' = ?::text`,
        [CLAIM_TYPE, String(key), worker]);
    },
  };
}

/** Claims that only remember inside this process. For tests. */
export function memoryClaims(): Claims {
  const seen = new Map<string, string>();
  return {
    async claim(key) { if (seen.get(key)) return false; seen.set(key, 'running'); return true; },
    async complete(key) { seen.set(key, 'done'); },
    async release(key) { seen.delete(key); },
  };
}

// ---------------------------------------------------------------------------
// CONSUME
// Deliberately NOT unref'd, anywhere in this module. Node exits when the only
// thing left is an unref'd timer, so an unref'd drain sleep turns "finish the
// message in hand" into "maybe finish it", and an unref'd reconnect wait lets a
// worker whose broker is down exit quietly instead of waiting for it to return.
// A worker is a daemon: staying alive is the job.
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race<T>([
      p,
      // Not unref'd either: a handler that is running is work in progress.
      new Promise<T>((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export interface ConsumerStats {
  taken: number; done: number; duplicate: number;
  retried: number; dead: number; malformed: number; requeued: number;
}

export interface Consumer {
  consumerTag: string;
  stats: ConsumerStats;
  inflight: Set<Promise<void>>;
  stop(): Promise<ConsumerStats>;
}

export interface ConsumeOptions {
  queue: string;
  exchange: string;
  handlers: Map<string, Handler>;
  claims: Claims;
  prefetch?: number;
  handlerTimeoutMs?: number;
  drainMs?: number;
  publishTimeoutMs?: number;
  log?: Log;
}

/**
 * Consumes one queue with manual ack, bounded prefetch, dedupe and the retry
 * ladder. Returns a handle whose stop() is the graceful shutdown.
 */
export async function consumeOn(ch: BusChannel, {
  queue, exchange, handlers, claims,
  prefetch = 8, handlerTimeoutMs = 60_000, drainMs = 20_000, publishTimeoutMs = 10_000, log = console,
}: ConsumeOptions): Promise<Consumer> {
  await ch.prefetch(prefetch);
  const stats: ConsumerStats = { taken: 0, done: 0, duplicate: 0, retried: 0, dead: 0, malformed: 0, requeued: 0 };
  const inflight = new Set<Promise<void>>();
  let cancelling = false;

  const deadLetter = (msg: AmqpMessage, why: string): void => {
    log.error?.(`bus: dead-lettering — ${why}`); ch.nack(msg, false, false);
  };

  const one = async (msg: AmqpMessage): Promise<void> => {
    stats.taken++;
    let env: Envelope;
    try { env = parseEnvelope(msg.content); }
    catch (e) {
      // Unreadable bytes cannot be retried into readability. Straight to the DLQ,
      // where it is visible and replayable instead of silently dropped.
      stats.malformed++;
      deadLetter(msg, `malformed envelope: ${text(e)}`);
      return;
    }
    const fn = handlers.get(env.type);
    if (!fn) {
      // A type nobody here handles means a binding wider than the handler set.
      // jobs.ts returns such a job to 'pendiente' because another instance
      // may know it; a broker cannot do that without a requeue loop, so it goes
      // to the DLQ — parked, counted and replayable once the handler ships.
      stats.dead++;
      deadLetter(msg, `no handler for type "${env.type}" on queue "${queue}"`);
      return;
    }
    if (!(await claims.claim(env.idempotency_key))) {
      stats.duplicate++;
      log.info?.(`bus: duplicate ${env.type} key=${env.idempotency_key} — already claimed, acking`);
      ch.ack(msg);
      return;
    }
    try {
      await withTimeout(Promise.resolve(fn(env.payload, { envelope: env, log })), handlerTimeoutMs, `handler ${env.type}`);
      await claims.complete(env.idempotency_key);
      ch.ack(msg);
      stats.done++;
    } catch (e) {
      // Let the retry run: without this the scheduled retry would look like a
      // duplicate and be acked away.
      await claims.release(env.idempotency_key);
      if (env.attempt >= MAX_ATTEMPTS) {
        stats.dead++;
        deadLetter(msg, `${env.type} failed ${env.attempt} attempts, last: ${text(e)}`);
        return;
      }
      const ms = delayFor(env.attempt);
      const next = { ...env, attempt: env.attempt + 1 };
      try {
        await publishOn(ch, {
          exchange: retryExchange(exchange, ms),
          envelope: next,
          timeoutMs: publishTimeoutMs,
          // The delay queue is the only thing bound to that fanout, so an
          // unroutable return here means the topology is not there yet.
          mandatory: true,
        });
        ch.ack(msg);
        stats.retried++;
        log.warn?.(`bus: ${env.type} attempt ${env.attempt} failed, retry in ${ms}ms: ${text(e)}`);
      } catch (pe) {
        // The retry could not be handed to the broker. Requeue ONCE — this is
        // the single place a requeue is correct, because the alternative is
        // losing the message, and it cannot spin: a message that comes back
        // already redelivered goes to the DLQ instead.
        if (msg?.fields?.redelivered) {
          stats.dead++;
          deadLetter(msg, `retry publish failed twice for ${env.type}: ${text(pe)}`);
        } else {
          stats.requeued++;
          log.error?.(`bus: retry publish failed for ${env.type}, requeueing once: ${text(pe)}`);
          ch.nack(msg, false, true);
        }
      }
    }
  };

  const { consumerTag } = await ch.consume(queue, (msg) => {
    // A null delivery is amqplib telling us the consumer was cancelled.
    if (!msg) return;
    const p = one(msg)
      .catch((e) => log.error?.(`bus: consumer loop error: ${text(e)}`))
      .finally(() => inflight.delete(p));
    inflight.add(p);
  }, { noAck: false });

  log.info?.(`bus: consuming ${queue} (prefetch ${prefetch}, tag ${consumerTag})`);

  return {
    consumerTag,
    stats,
    inflight,
    /**
     * SIGTERM path: stop accepting deliveries, finish and ack what is in hand,
     * then let the caller close the channel. A message still unacked when the
     * connection finally drops is redelivered by the broker — nothing is lost,
     * it is only done twice, and the claim above is what makes twice harmless.
     */
    async stop(): Promise<ConsumerStats> {
      if (cancelling) return stats;
      cancelling = true;
      try { await ch.cancel(consumerTag); }
      catch (e) { log.warn?.(`bus: cancel failed: ${text(e)}`); }
      const deadline = Date.now() + drainMs;
      while (inflight.size && Date.now() < deadline) await sleep(25);
      if (inflight.size) log.error?.(`bus: ${inflight.size} message(s) still in flight after ${drainMs}ms; they will be redelivered`);
      return stats;
    },
  };
}

// ---------------------------------------------------------------------------
// DRIVER. The amqplib import is by variable, not by literal, for two reasons:
// the module is optional at runtime (a service with no AMQP_URL never needs it),
// and a test can inject its own connect() and never load it at all.
const DRIVER = 'amqplib';
export type Connector = (url: string) => Promise<BusConnection>;
let connectImpl: Connector | null = null;

/** Overrides how a connection is opened. Tests inject a double here. */
export function setConnector(fn: Connector | null): void { connectImpl = fn; }

async function openConnection(url: string): Promise<BusConnection> {
  if (connectImpl) return connectImpl(url);
  const mod = await import(DRIVER) as { default?: { connect(url: string): Promise<BusConnection> },
                                        connect?(url: string): Promise<BusConnection> };
  const lib = mod.default ?? mod;
  return lib.connect!(url);
}

// ---------------------------------------------------------------------------
// PROCESS-LEVEL API. One connection per process, shared by the publisher and the
// consumer, re-established with backoff.
const handlers = new Map<string, Handler>();
/** Registers a handler for a message type. Same shape as jobs.ts register(). */
export function on(type: string, fn: Handler): Map<string, Handler> { handlers.set(type, fn); return handlers; }
export function handlerTypes(): string[] { return [...handlers.keys()]; }
/** Only for tests. */
export function clearHandlers(): void { handlers.clear(); }

let shared: Link | null = null;
let opening: Promise<Link> | null = null;

async function ensureChannel(log: Log = console): Promise<Link | null> {
  const c = busConfig();
  if (!c.enabled) return null;
  if (shared) return shared;
  if (!opening) {
    opening = (async () => {
      const conn = await openConnection(c.url);
      const ch = await conn.createConfirmChannel();
      conn.on?.('close', () => { if (shared?.conn === conn) shared = null; });
      conn.on?.('error', ((e: unknown) => log.warn?.(`bus: connection error: ${text(e)}`)) as (arg?: never) => void);
      ch.on?.('error', ((e: unknown) => log.warn?.(`bus: channel error: ${text(e)}`)) as (arg?: never) => void);
      await declareTopology(ch, topology({ exchange: c.exchange }));
      shared = { conn, ch };
      return shared;
    })().finally(() => { opening = null; });
  }
  return opening;
}

/**
 * Publishes work nobody is waiting on.
 *
 * Returns a result instead of throwing, and the result MUST be checked: a
 * publish that was not confirmed is not a publish. It does not throw because
 * the common caller is an HTTP handler serving a person, and a broker hiccup
 * should not turn their request into a 500 — but it must not look like success
 * either, so `published: false` comes with a reason and an error-level log.
 * Use publishOrThrow() where the caller genuinely cannot continue.
 */
export interface PublishResult { published: boolean; id: string | null; reason?: string }

export async function publish(
  type: string, payload: Record<string, unknown>,
  { key, idempotencyKey, log = console }:
    { key?: string; idempotencyKey?: string; log?: Log } = {}): Promise<PublishResult> {
  const c = busConfig();
  if (!announce(log) || !c.enabled) {
    log.error?.(`bus: dropped ${type} — no AMQP_URL configured`);
    return { published: false, id: null, reason: 'bus_disabled' };
  }
  const env = makeEnvelope({ type, payload, key, idempotencyKey });
  try {
    const link = await ensureChannel(log);
    if (!link) return { published: false, id: env.id, reason: 'bus_disabled' };
    await publishOn(link.ch, { exchange: c.exchange, envelope: env, timeoutMs: c.publishTimeoutMs });
    return { published: true, id: env.id };
  } catch (e) {
    // Drop the shared channel: an unconfirmed publish usually means the channel
    // is gone, and the next call should build a new one rather than reuse a corpse.
    shared = null;
    log.error?.(`bus: publish of ${type} NOT confirmed: ${text(e)}`);
    return { published: false, id: env.id, reason: text(e) };
  }
}

/** publish(), but a failure is an exception. For callers that cannot go on without it. */
export async function publishOrThrow(
  type: string, payload: Record<string, unknown>,
  o: { key?: string; idempotencyKey?: string; log?: Log } = {}): Promise<PublishResult> {
  const r = await publish(type, payload, o);
  if (!r.published) throw new Error(`bus: publish of ${type} failed: ${r.reason}`);
  return r;
}

export interface WorkerHandle {
  enabled: boolean;
  readonly consumer: Consumer | null;
  stop(): Promise<ConsumerStats | null>;
}

/**
 * Runs a consumer until stop() is called, reconnecting with backoff and
 * re-declaring the topology every time. Survivable connection loss is the whole
 * point of the loop: the broker restarting must not need this container to.
 */
export function startWorker(
  { queue, patterns, log = console, claims = null }:
    { queue: string; patterns: string[]; log?: Log; claims?: Claims | null }): WorkerHandle {
  const c = busConfig();
  if (!announce(log)) {
    return { enabled: false, get consumer() { return null; }, async stop() { return null; } };
  }
  let stopping = false;
  let consumer: Consumer | null = null;
  let link: Link | null = null;
  let attempts = 0;
  // Unparks the loop on shutdown. The loop waits for the connection to close,
  // and a driver that is slow to emit 'close' (or a double that never does) would
  // otherwise leave stop() hanging until the runtime SIGKILLs the container.
  // Shutdown must not depend on a courtesy event.
  let onStop = (): void => {};
  const stopped = new Promise<void>((res) => { onStop = (): void => res(); });
  // The reconnect wait has to be interruptible: without this, SIGTERM during a
  // 30-second backoff would make shutdown take 30 seconds and the orchestrator
  // would SIGKILL the container instead.
  let wake = (): void => {};
  const waitOrWake = (ms: number): Promise<void> => new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    wake = (): void => { clearTimeout(t); res(); };
  });

  // The consumer gets its OWN connection, not the publisher's: a consumer under
  // flow control must not be able to stall an unrelated publish.
  const loop = (async () => {
    while (!stopping) {
      try {
        const conn = await openConnection(c.url);
        const ch = await conn.createConfirmChannel();
        link = { conn, ch };
        conn.on?.('error', ((e: unknown) => log.warn?.(`bus: consumer connection error: ${text(e)}`)) as (arg?: never) => void);
        // Re-declared on EVERY connect, not once at boot: after a broker restart
        // from an empty volume the exchanges are gone, and a consumer that
        // assumes otherwise silently consumes nothing.
        await declareTopology(ch, topology({ exchange: c.exchange, queue, patterns }));
        consumer = await consumeOn(ch, {
          queue, exchange: c.exchange, handlers, prefetch: c.prefetch,
          claims: claims ?? pgClaims({ worker: c.worker, leaseS: c.claimLeaseS }),
          handlerTimeoutMs: c.handlerTimeoutMs, drainMs: c.drainMs,
          publishTimeoutMs: c.publishTimeoutMs, log,
        });
        // Only NOW is the backoff reset. Resetting it right after connecting made
        // a broker that accepts TCP but rejects the declaration (a half-configured
        // vhost, a missing permission) retry every second forever at the first
        // rung of the ladder.
        attempts = 0;
        // Park here until the connection goes away, or until stop() says so.
        await Promise.race<void>([
          new Promise<void>((res) => {
            conn.once?.('close', (() => res()) as (arg?: never) => void);
            conn.once?.('error', (() => res()) as (arg?: never) => void);
          }),
          stopped,
        ]);
        consumer = null;
        link = null;
        if (!stopping) log.warn?.('bus: connection closed, reconnecting');
      } catch (e) {
        consumer = null;
        // Close what was half-opened. Without this, a failure between "connected"
        // and "consuming" leaks one connection per retry, and a broker that
        // rejects the declare accumulates them until it refuses new ones.
        const dying = link;
        link = null;
        try { await dying?.ch?.close?.(); } catch { /* nothing to salvage */ }
        try { await dying?.conn?.close?.(); } catch { /* idem */ }
        if (!stopping) log.error?.(`bus: connect/consume failed: ${text(e)}`);
      }
      if (stopping) break;
      const ms = reconnectDelay(attempts++);
      log.warn?.(`bus: retrying broker in ${ms}ms`);
      await waitOrWake(ms);
    }
  })();

  return {
    enabled: true,
    get consumer() { return consumer; },
    /**
     * Graceful shutdown, in this order: stop accepting deliveries, finish and
     * ack what is in hand, then close the channel and the connection. Returns
     * the consumer's counters so a container log shows what the last life did.
     */
    async stop(): Promise<ConsumerStats | null> {
      stopping = true;
      const stats = consumer ? await consumer.stop() : null;
      onStop();
      const dying = link;
      link = null;
      try { await dying?.ch?.close?.(); } catch { /* closing a closed channel is not news */ }
      try { await dying?.conn?.close?.(); } catch { /* idem */ }
      wake();
      await loop;
      return stats;
    },
  };
}

/** Closes the shared publisher connection. For a clean process exit. */
export async function closeBus(): Promise<void> {
  const link = shared;
  shared = null;
  try { await link?.ch?.close?.(); } catch { /* ignore */ }
  try { await link?.conn?.close?.(); } catch { /* ignore */ }
}
