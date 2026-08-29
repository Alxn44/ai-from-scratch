// api-worker: the consumer entrypoint of the `api` image.
//
//   docker compose: image ./api, command `node dist/api/src/worker.js`
//
// SAME IMAGE, DIFFERENT COMMAND, and that is the point (docs/ARCHITECTURE.md, the
// container table): a worker built from different code than the API has an idea
// of a tool that can drift from the API's, and nothing detects the drift until a
// job produces a wrong answer. Sharing the image makes that divergence
// impossible to express — this file imports the very same leagues.ts the HTTP
// server does.
//
// WHAT THIS PROCESS IS NOT
//
//   · It is not an orchestrator. It starts nothing on anybody's behalf; it
//     consumes the routing keys its queue is bound to and runs the handler.
//     Policy lives in bus.ts, which is a library, compiled into both services.
//   · It is not the Postgres queue worker. Payment webhooks belong to the
//     independent payments service; this worker handles cross-service messages.
//   · It is not on any path a human waits on. The chat turn stays on HTTP.
//
// WITHOUT A BROKER. If AMQP_URL is unset the process says so loudly and then
// idles instead of exiting: `api-worker` under compose with `restart:` would
// otherwise crash-loop, and a crash-loop reads as a bug in this file rather than
// as a missing environment variable. Nothing is consumed and nothing is lost —
// there is no broker to lose it from.
import { announce, busConfig, closeBus, on, startWorker } from './bus.ts';
import { many, one, write, writeAuthorized } from './data.ts';
import { closeWeek } from './leagues.ts';
import { createAuth } from '../../auth/src/index.ts';

const log = {
  info: (m: string): void => console.log(`[api-worker] ${m}`),
  warn: (m: string): void => console.warn(`[api-worker] ${m}`),
  error: (m: string): void => console.error(`[api-worker] ${m}`),
};

// ---------------------------------------------------------------------------
// QUEUE AND BINDINGS
//
// One queue for this consumer, bound by routing key to the topic exchange. The
// patterns are the contract with every publisher: widen them only together with
// a handler, because a delivery this process cannot handle goes to the DLQ.
const QUEUE = process.env.BUS_QUEUE || 'api.work';
const PATTERNS = ['league.#', 'defense.action.#', 'bus.echo'];

// ---------------------------------------------------------------------------
// HANDLERS. Only work that actually exists is registered. A handler that
// pretends to do something is worse than a routing key nobody publishes.

// The weekly league close. It belongs on the broker rather than on the Postgres
// queue for one concrete reason: `web`, `api` or a cron container may all decide
// it is time, and none of them should have to own the doing of it. It is safe to
// receive twice — the close is idempotent by (user_id, week) with DO NOTHING —
// and the bus dedupes on top of that anyway, so a duplicate publish costs a
// query, not a wrong table.
on('league.week.close', async (payload) => {
  const r = await closeWeek();
  if ('motivo' in r && r.motivo === 'cohorte_insuficiente') {
    log.info(`league close skipped: ${r.total} people opted in, ${r.minimo} needed`);
    return;
  }
  const raw = 'semana' in r ? r.semana : null;
  const week = String(raw).slice(0, 10);
  const reason = (payload as { reason?: string } | undefined)?.reason;
  log.info(`league week ${week}: ${r.cerradas} new rows, ${r.saltadas} already closed (of ${r.total})`
         + `${reason ? ` — asked by ${reason}` : ''}`);
});

// The smoke test type. Both workers bind `bus.echo`, so publishing one message
// proves the topic exchange fans out to two services and that both consume —
// which is the property docs/ARCHITECTURE.md claims and nothing else exercises.
on('bus.echo', async (payload, { envelope }) => {
  log.info(`echo id=${envelope.id} attempt=${envelope.attempt} payload=${JSON.stringify(payload)}`);
});

// Neo owns the decision; /auth owns the identity state it affects. The defense
// containers never receive DATABASE_URL or JWT_SECRET. Only a closed pair of
// actions is accepted here, and auth clamps the TTL again at this boundary.
const auth = createAuth({ one, many, write, writeAuthorized,
  origin: 'http://localhost', production: true, log });
on('defense.action', async (payload) => {
  const result = await auth.applyDefenseAction({
    kind: String(payload.kind ?? ''), target: String(payload.target ?? ''),
    ttlSeconds: Number(payload.ttl_s ?? 0), why: String(payload.why ?? ''),
  });
  if (!result.applied) throw new Error(`unsupported or invalid defense action: ${String(payload.kind)}`);
  log.warn(`applied defense action ${String(payload.kind)} to identity ${String(payload.target)}`);
});

// Types that belong to this queue but have no implementation yet are NOT
// registered and NOT bound: `email.send`, `export.progress.requested`,
// `content.reindex.requested`. Bind them the day the handler ships, in the same
// commit, so nothing ever routes to a queue that will only dead-letter it.

// ---------------------------------------------------------------------------
// BOOT
const cfg = busConfig();
announce(log);

const worker = startWorker({ queue: QUEUE, patterns: PATTERNS, log });
if (worker.enabled) log.info(`bound ${QUEUE} to [${PATTERNS.join(', ')}] on ${cfg.exchange}`);

// Idle keeper for the no-broker case: something has to hold the event loop open,
// and an interval that logs nothing is cheaper than a fake consumer.
const idle: NodeJS.Timeout | null = worker.enabled ? null : setInterval(() => {}, 60_000);

// ---------------------------------------------------------------------------
// GRACEFUL SHUTDOWN. SIGTERM is how a container is asked to stop, and the
// sequence matters: cancel the consumer first so no new delivery arrives, then
// let the messages already in hand finish and be acked, then close. A message
// still unacked when the socket drops is redelivered by the broker, and the
// idempotency claim is what makes a redelivery harmless rather than a double
// charge.
let leaving = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    if (leaving) return;
    leaving = true;
    log.warn(`${sig}: draining`);
    try {
      const stats = await worker.stop();
      if (stats && typeof stats === 'object') log.info(`drained: ${JSON.stringify(stats)}`);
      await closeBus();
    } catch (e) {
      log.error(`shutdown: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (idle) clearInterval(idle);
    process.exit(0);
  });
}
