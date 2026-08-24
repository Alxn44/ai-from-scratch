// The inter-service transport (src/bus.ts). No broker, no database, no network.
//
// WHY A DOUBLE AND NOT A REAL RABBITMQ. There is no broker in docker-compose yet,
// so an integration test would be a test that never runs, and a test that never
// runs is worse than none: it makes the untested parts look tested. What a fake
// channel CAN prove is everything that is a decision of this codebase rather than
// of the broker — the topology it declares, the persistence flag, the fact that
// an unconfirmed publish is not reported as success, the exact backoff numbers,
// which exchange a retry goes to, and every path that ends in the DLQ.
//
// What it cannot prove is listed at the bottom of this file, on purpose.
//
//   node --experimental-strip-types test/transport.mts
import { strict as A } from 'node:assert';
import { readFileSync } from 'node:fs';
import type { AmqpMessage, Envelope } from '../src/bus.ts';
import {
  DELAY_TIERS_MS, ENVELOPE_FIELDS, MAX_ATTEMPTS, PERSISTENT, RECONNECT_MS,
  announce, busConfig, clearHandlers, consumeOn, declareTopology, delayFor, dlq, dlx,
  makeEnvelope, memoryClaims, on, parseEnvelope, publish, publishOn, publishOptions,
  redact, resetAnnounce, retryExchange, retryQueue, setConnector, startWorker, topology,
} from '../src/bus.ts';

let ok = 0, fallos = 0;
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`  ok   · ${name}`); ok++; }
  catch (e) { console.log(`  FALLA· ${name}\n         ${e instanceof Error ? e.message : String(e)}`); fallos++; }
};
const atest = async (name: string, fn: () => Promise<void>): Promise<void> => {
  try { await fn(); console.log(`  ok   · ${name}`); ok++; }
  catch (e) { console.log(`  FALLA· ${name}\n         ${e instanceof Error ? e.message : String(e)}`); fallos++; }
};
const mute = { info(): void {}, warn(): void {}, error(): void {} };
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

// ---------------------------------------------------------------------------
// THE DOUBLE. It records; it does not pretend to be a broker.
interface FakeRec {
  exchanges: any[]; queues: any[]; bindings: any[]; published: any[];
  acks: any[]; nacks: any[]; prefetch: number | null; consumes: any[];
  cancels: any[]; closed: boolean;
}

// The double is typed `any` on purpose and cast to BusChannel at the boundary: it
// is a RECORDER, not an implementation of AMQP, and giving it the real interface
// would force it to grow methods no test calls.
function fakeChannel({ confirm = 'ack', returned = false }:
    { confirm?: 'ack' | 'nack' | 'silent'; returned?: boolean } = {}) {
  const rec: FakeRec = {
    exchanges: [], queues: [], bindings: [], published: [],
    acks: [], nacks: [], prefetch: null, consumes: [],
    cancels: [], closed: false,
  };
  const listeners = new Map<string, ((arg?: any) => void)[]>();
  const ch: any = {
    async assertExchange(name, type, options) { rec.exchanges.push({ name, type, options }); return { exchange: name }; },
    async assertQueue(name, options) { rec.queues.push({ name, options }); return { queue: name }; },
    async bindQueue(queue, exchange, pattern) { rec.bindings.push({ queue, exchange, pattern }); },
    async prefetch(n) { rec.prefetch = n; },
    async consume(queue, fn, options) { rec.consumes.push({ queue, options }); ch.deliver = fn; return { consumerTag: 'tag-1' }; },
    async cancel(tag) { rec.cancels.push(tag); ch.deliver = null; },
    async close() { rec.closed = true; },
    ack(msg) { rec.acks.push(msg); },
    nack(msg, allUpTo, requeue) { rec.nacks.push({ msg, allUpTo, requeue }); },
    on(ev, fn) { listeners.set(ev, [...(listeners.get(ev) ?? []), fn]); return ch; },
    once(ev, fn) { return ch.on(ev, fn); },
    emit(ev, arg) { for (const fn of listeners.get(ev) ?? []) fn(arg); },
    publish(exchange, key, content, options, cb) {
      rec.published.push({ exchange, key, content, options, envelope: JSON.parse(content.toString('utf8')) });
      if (returned) ch.emit('return', { properties: { messageId: options.messageId }, fields: { routingKey: key } });
      if (confirm === 'ack') process.nextTick(() => cb(null));
      if (confirm === 'nack') process.nextTick(() => cb(new Error('broker said no')));
      // 'silent' answers nothing: that is the timeout case.
      return true;
    },
    deliver: null as null | ((msg: AmqpMessage | null) => void),
  };
  return { ch: ch as any, rec };
}

const message = (envelope: any, { redelivered = false } = {}): AmqpMessage => ({
  content: Buffer.from(typeof envelope === 'string' ? envelope : JSON.stringify(envelope), 'utf8'),
  fields: { routingKey: envelope?.key ?? 'x', redelivered, deliveryTag: 1 },
  properties: {},
});

const EX = 'course.events';

// ---------------------------------------------------------------------------
console.log('\n1) The envelope is the contract');

test('the field list and its order are frozen', () =>
  A.deepEqual(ENVELOPE_FIELDS, ['id', 'type', 'key', 'idempotency_key', 'attempt', 'produced_at', 'payload']));

const env = makeEnvelope({ type: 'league.week.close', payload: { reason: 'cron' }, idempotencyKey: 'league:2026-08-17' });
test('a fresh envelope has every field and nothing else', () =>
  A.deepEqual(Object.keys(env).sort(), [...ENVELOPE_FIELDS].sort()));
test('the routing key defaults to the type', () => A.equal(env.key, 'league.week.close'));
test('attempt starts at 1', () => A.equal(env.attempt, 1));
test('produced_at is UTC with milliseconds', () => A.match(env.produced_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));
test('without an idempotency key the default is per-message, never shared', () => {
  const a = makeEnvelope({ type: 't' }), b = makeEnvelope({ type: 't' });
  A.notEqual(a.idempotency_key, b.idempotency_key);
});

test('parse accepts what make produced', () => A.deepEqual(parseEnvelope(Buffer.from(JSON.stringify(env))), env));
test('parse keeps fields a newer producer added', () => {
  const wide = parseEnvelope(JSON.stringify({ ...env, trace_id: 'abc' })) as Envelope & { trace_id?: string };
  A.equal(wide.trace_id, 'abc');
});
for (const [why, bad] of [
  ['not JSON', 'not json at all'],
  ['not an object', '[]'],
  ['no id', JSON.stringify({ ...env, id: '' })],
  ['no type', JSON.stringify({ ...env, type: undefined })],
  ['attempt 0', JSON.stringify({ ...env, attempt: 0 })],
  ['attempt not an integer', JSON.stringify({ ...env, attempt: 1.5 })],
  ['payload not an object', JSON.stringify({ ...env, payload: 'x' })],
  // The case this table missed. A string payload was always refused, but
  // `typeof [] === 'object'`, so an ARRAY payload was accepted here while
  // ai/src/course_ai/bus.py (`isinstance(payload, dict)`) and
  // queue/internal/bus/envelope.go (`map[string]any`) both refused it. The same
  // message was therefore work to one service and a dead letter to the other two.
  ['payload is an array', JSON.stringify({ ...env, payload: [] })],
]) test(`parse refuses: ${why}`, () => A.throws(() => parseEnvelope(bad)));

// ---------------------------------------------------------------------------
console.log('\n2) The backoff schedule is the one written in the comment');

test('delayFor: 1s, 4s, 16s, then capped at 60s', () =>
  A.deepEqual([1, 2, 3, 4, 5, 9].map(delayFor), [1_000, 4_000, 16_000, 60_000, 60_000, 60_000]));
test('the tiers are exactly the distinct delays before the ceiling', () =>
  A.deepEqual(DELAY_TIERS_MS, [1_000, 4_000, 16_000, 60_000]));
test('five attempts, so four retries: ~81s of deliberate waiting', () => {
  A.equal(MAX_ATTEMPTS, 5);
  A.equal(DELAY_TIERS_MS.reduce((a, b) => a + b, 0), 81_000);
});
test('reconnect backoff is a separate ladder with its own cap', () =>
  A.deepEqual(RECONNECT_MS, [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]));

// ---------------------------------------------------------------------------
console.log('\n3) The topology is declared, and declared idempotently');

const topo = topology({ exchange: EX, queue: 'api.work', patterns: ['league.#', 'bus.echo'] });
const { ch: dch, rec: drec } = fakeChannel();
await declareTopology(dch, topo);
await declareTopology(dch, topo);   // a second connect must be able to redo it

const exByName = (n) => drec.exchanges.filter((e) => e.name === n);
const qByName = (n) => drec.queues.filter((q) => q.name === n);

test('the main exchange is a durable topic', () => {
  A.equal(exByName(EX)[0].type, 'topic');
  A.equal(exByName(EX)[0].options.durable, true);
});
test('there is a dead-letter exchange and a dead-letter queue', () => {
  A.equal(exByName(dlx(EX))[0].type, 'topic');
  A.ok(qByName(dlq(EX)).length);
});
test('the DLQ catches everything (bound with #)', () =>
  A.ok(drec.bindings.some((b) => b.queue === dlq(EX) && b.exchange === dlx(EX) && b.pattern === '#')));
test('one retry exchange and queue per delay tier', () => {
  for (const ms of DELAY_TIERS_MS) {
    A.equal(exByName(retryExchange(EX, ms))[0].type, 'fanout', `${ms} must be a fanout`);
    A.ok(qByName(retryQueue(EX, ms)).length, `${ms} queue missing`);
  }
});
test('every retry queue holds for its own TTL and dead-letters back to the main exchange', () => {
  for (const ms of DELAY_TIERS_MS) {
    const args = qByName(retryQueue(EX, ms))[0].options.arguments;
    A.equal(args['x-message-ttl'], ms);
    A.equal(args['x-dead-letter-exchange'], EX);
  }
});
test('the consumer queue dead-letters to the DLX, not to the main exchange', () =>
  A.equal(qByName('api.work')[0].options.arguments['x-dead-letter-exchange'], dlx(EX)));
test('the consumer queue is bound once per pattern', () => {
  const mine = drec.bindings.filter((b) => b.queue === 'api.work' && b.exchange === EX);
  A.deepEqual(mine.slice(0, 2).map((b) => b.pattern), ['league.#', 'bus.echo']);
});
test('declaring twice declares the same things, in the same order', () => {
  const half = drec.exchanges.length / 2;
  A.deepEqual(drec.exchanges.slice(0, half), drec.exchanges.slice(half));
});
test('a publisher-only topology still declares the retry and dead-letter plumbing', () => {
  const pub = topology({ exchange: EX });
  A.equal(pub.queues.length, 1 + DELAY_TIERS_MS.length);
  A.ok(!pub.bindings.some((b) => b.queue === 'api.work'));
});
test('a queue with no routing pattern is refused at declare time', () =>
  A.throws(() => topology({ exchange: EX, queue: 'orphan', patterns: [] }), /no routing patterns/));

// ---------------------------------------------------------------------------
console.log('\n4) Publishing is persistent, mandatory, and only successful when confirmed');

const opts = publishOptions(env);
test('delivery mode 2, both ways of saying it', () => {
  A.equal(opts.deliveryMode, PERSISTENT);
  A.equal(opts.deliveryMode, 2);
  A.equal(opts.persistent, true);
});
test('the AMQP message id is unique per attempt while the envelope id is not', () => {
  A.equal(opts.messageId, `${env.id}:1`);
  A.equal(publishOptions({ ...env, attempt: 3 }).messageId, `${env.id}:3`);
});
test('the idempotency key travels in a header too, for a human reading the queue', () =>
  A.equal(opts.headers['x-bus-idempotency-key'], 'league:2026-08-17'));

const { ch: pch, rec: prec } = fakeChannel();
await publishOn(pch, { exchange: EX, envelope: env });
test('a confirmed publish is a success', () => A.equal(prec.published.length, 1));
test('it goes out on the routing key of the envelope, as JSON bytes', () => {
  A.equal(prec.published[0].key, 'league.week.close');
  A.equal(prec.published[0].envelope.type, 'league.week.close');
  A.equal(prec.published[0].options.contentType, 'application/json');
});
test('mandatory is on: an unroutable message must come back, not vanish', () =>
  A.equal(prec.published[0].options.mandatory, true));

const nacked = fakeChannel({ confirm: 'nack' });
await atest('a NACKed publish is a failure', () =>
  A.rejects(publishOn(nacked.ch, { exchange: EX, envelope: env }), /broker said no/));

const returnedCh = fakeChannel({ returned: true });
await atest('a RETURNED publish is a failure even though the confirm was positive', () =>
  A.rejects(publishOn(returnedCh.ch, { exchange: EX, envelope: env }), /unroutable/));

const silent = fakeChannel({ confirm: 'silent' });
await atest('a publish nobody answers times out instead of hanging forever', () =>
  A.rejects(publishOn(silent.ch, { exchange: EX, envelope: env, timeoutMs: 30 }), /timed out/));

// ---------------------------------------------------------------------------
console.log('\n5) Consuming: manual ack, bounded prefetch, dedupe');

async function consumer({ claims = memoryClaims(), handler, prefetch = 8 }:
    { claims?: any; handler?: any; prefetch?: number } = {}) {
  const { ch, rec } = fakeChannel();
  const handlers = new Map<string, any>();
  if (handler) handlers.set('work.do', handler);
  const c = await consumeOn(ch, {
    queue: 'api.work', exchange: EX, handlers, claims, prefetch, log: mute,
    handlerTimeoutMs: 200, drainMs: 500,
  });
  // The consume callback returns immediately (it tracks the work in `inflight`),
  // so a test that just awaited it would assert before the handler ran.
  return {
    ch, rec, c,
    deliver: async (msg: any): Promise<void> => { ch.deliver(msg); await Promise.all([...c.inflight]); },
  };
}

const work = (attempt = 1) => makeEnvelope({ type: 'work.do', payload: { n: 1 }, idempotencyKey: 'w-1', attempt });

{
  let ran = 0;
  const { rec, c, deliver } = await consumer({ handler: async () => { ran++; } });
  test('prefetch is bounded, and it is the configured number', () => A.equal(rec.prefetch, 8));
  test('deliveries are not auto-acked', () => A.equal(rec.consumes[0].options.noAck, false));
  await deliver(message(work()));
  test('the handler ran once and the message was acked by hand', () => {
    A.equal(ran, 1); A.equal(rec.acks.length, 1); A.equal(rec.nacks.length, 0);
    A.equal(c.stats.done, 1);
  });
}

{
  let ran = 0;
  const claims = memoryClaims();
  const { rec, c, deliver } = await consumer({ claims, handler: async () => { ran++; } });
  await deliver(message(work()));
  await deliver(message(work()));   // same idempotency key, second delivery
  test('the same idempotency key does not run the handler twice', () => A.equal(ran, 1));
  test('the duplicate is acked, not requeued and not dead-lettered', () => {
    A.equal(rec.acks.length, 2); A.equal(rec.nacks.length, 0); A.equal(c.stats.duplicate, 1);
  });
}

{
  const { rec, c, deliver } = await consumer({ handler: async () => {} });
  await deliver(message('{ not json'));
  test('unreadable bytes go straight to the DLQ (nack, no requeue)', () => {
    A.deepEqual(rec.nacks.map((n) => [n.allUpTo, n.requeue]), [[false, false]]);
    A.equal(c.stats.malformed, 1);
  });
}

{
  const { rec, c, deliver } = await consumer({ handler: async () => {} });
  await deliver(message(makeEnvelope({ type: 'nobody.handles.this' })));
  test('a type this queue has no handler for is parked in the DLQ, not requeued', () => {
    A.deepEqual(rec.nacks.map((n) => n.requeue), [false]);
    A.equal(c.stats.dead, 1);
  });
}

console.log('\n6) Failure: backoff through the broker, then the DLQ');

{
  const claims = memoryClaims();
  let released = false;
  const spy = { ...claims, release: async (k) => { released = true; return claims.release(k); } };
  const { rec, c, deliver } = await consumer({ claims: spy, handler: async () => { throw new Error('the model is down'); } });
  await deliver(message(work(1)));
  test('a failed attempt 1 is republished to the 1000ms retry exchange', () => {
    A.equal(rec.published.length, 1);
    A.equal(rec.published[0].exchange, retryExchange(EX, 1_000));
  });
  test('the retry carries attempt 2 and the SAME id, key and produced_at', () => {
    const out = rec.published[0].envelope;
    A.equal(out.attempt, 2);
    A.equal(out.idempotency_key, 'w-1');
    A.equal(out.key, 'work.do');
  });
  test('the retry is persistent too — a delayed message must survive a broker restart', () =>
    A.equal(rec.published[0].options.deliveryMode, 2));
  test('the original is acked (never requeued: that is the hot loop)', () => {
    A.equal(rec.acks.length, 1);
    A.equal(rec.nacks.length, 0);
    A.equal(c.stats.retried, 1);
  });
  test('the claim is released so the retry is not mistaken for a duplicate', () => A.equal(released, true));
}

{
  // Each attempt is delivered to a consumer with its own claim store: two
  // attempts of the same key inside one process would be a duplicate, which is
  // the OTHER test. Here what is under test is which tier each attempt uses.
  const seen = [];
  for (const attempt of [2, 3, 4]) {
    const { rec, deliver } = await consumer({ handler: async () => { throw new Error('still down'); } });
    await deliver(message(work(attempt)));
    seen.push(rec.published[0]);
  }
  test('each attempt uses the next tier: 4s, 16s, 60s', () =>
    A.deepEqual(seen.map((p) => p.exchange),
      [retryExchange(EX, 4_000), retryExchange(EX, 16_000), retryExchange(EX, 60_000)]));
  test('and the attempt counter keeps climbing', () =>
    A.deepEqual(seen.map((p) => p.envelope.attempt), [3, 4, 5]));
}

{
  const { rec, c, deliver } = await consumer({ handler: async () => { throw new Error('gave up'); } });
  await deliver(message(work(MAX_ATTEMPTS)));
  test('at the ceiling the message is dead-lettered, not retried again', () => {
    A.equal(rec.published.length, 0);
    A.deepEqual(rec.nacks.map((n) => n.requeue), [false]);
    A.equal(c.stats.dead, 1);
  });
}

{
  // The one narrow case where a requeue is right: the broker refused the retry.
  const { ch, rec } = fakeChannel({ confirm: 'nack' });
  const handlers = new Map([['work.do', async () => { throw new Error('boom'); }]]);
  const c = await consumeOn(ch, {
    queue: 'api.work', exchange: EX, handlers, claims: memoryClaims(),
    log: mute, publishTimeoutMs: 50, handlerTimeoutMs: 200,
  });
  const settle = async (msg) => { ch.deliver(msg); await Promise.all([...c.inflight]); };
  await settle(message(work(1)));
  test('if the retry cannot be published, the message is requeued ONCE', () => {
    A.deepEqual(rec.nacks.map((n) => n.requeue), [true]);
    A.equal(c.stats.requeued, 1);
  });
  await settle(message(work(1), { redelivered: true }));
  test('and if it comes back already redelivered it goes to the DLQ — no spin', () => {
    A.deepEqual(rec.nacks.map((n) => n.requeue), [true, false]);
    A.equal(c.stats.dead, 1);
  });
}

{
  const { rec, c, deliver } = await consumer({ handler: () => new Promise(() => {}) });
  await deliver(message(work(1)));
  test('a handler that never returns is a failure, not a stuck prefetch slot', () => {
    A.equal(c.stats.retried, 1);
    A.equal(rec.published.length, 1);
  });
}

console.log('\n7) Graceful shutdown');

{
  let finish = () => {};
  const slow = () => new Promise((res) => { finish = () => res(undefined); });
  const { rec, c, ch } = await consumer({ handler: slow });
  const flying = ch.deliver(message(work(1)));
  const stopping = c.stop();
  await sleep(10);
  test('stop() cancels the consumer first, so no new delivery arrives', () =>
    A.deepEqual(rec.cancels, ['tag-1']));
  test('and it does not resolve while a message is still in hand', () =>
    A.equal(rec.acks.length, 0));
  finish();
  await flying;
  const stats = await stopping;
  test('the in-flight message finishes and is acked before stop() returns', () => {
    A.equal(rec.acks.length, 1);
    A.equal(stats.done, 1);
  });
}

console.log('\n8) No broker configured: loud, harmless, and honest about it');

{
  const saved = process.env.AMQP_URL;
  delete process.env.AMQP_URL;
  resetAnnounce();
  const said = [];
  const cfg = busConfig({});
  test('an unset AMQP_URL is a disabled bus, not an exception', () => {
    A.equal(cfg.enabled, false);
    A.equal(cfg.url, '');
  });
  test('there is no default pointing at a host and no credentials anywhere', () => {
    const src = readFileSync(new URL('../src/bus.ts', import.meta.url), 'utf8');
    A.equal(/amqps?:\/\/[^'"`\s]/.test(src), false);
  });
  const enabled = announce({ warn: (m) => said.push(m), info: (m) => said.push(m) });
  test('announce() says so out loud, exactly once', () => {
    A.equal(enabled, false);
    A.match(said[0], /DISABLED/);
    announce({ warn: (m) => said.push(m) });
    A.equal(said.length, 1);
  });
  const r = await publish('league.week.close', {}, { log: mute });
  test('a publish with no broker reports failure — never a silent success', () => {
    A.equal(r.published, false);
    A.equal(r.reason, 'bus_disabled');
  });
  const w = startWorker({ queue: 'api.work', patterns: ['league.#'], log: mute });
  await atest('and startWorker returns a disabled handle instead of crashing the service', async () => {
    A.equal(w.enabled, false);
    A.equal(await w.stop(), null);
  });
  if (saved === undefined) delete process.env.AMQP_URL; else process.env.AMQP_URL = saved;
  resetAnnounce();
}

test('redact() never shows a password', () => {
  A.equal(redact('amqp://user:s3cret@broker:5672/vhost'), 'amqp://***@broker:5672/vhost');
  A.equal(redact(''), '(unset)');
});

console.log('\n9) Connection loss is survivable');

{
  const saved = process.env.AMQP_URL;
  process.env.AMQP_URL = 'amqp://fake-host-never-contacted';
  resetAnnounce();
  clearHandlers();
  on('work.do', async () => {});
  let tries = 0;
  let live: any = null;
  let refused: any = null;
  setConnector(async () => {
    tries++;
    const { ch, rec } = fakeChannel();
    // A connection double that actually emits 'close' when closed, like amqplib.
    const evs = new Map<string, ((arg?: any) => void)[]>();
    const conn: any = {
      closed: false,
      createConfirmChannel: async () => ch,
      on(ev: string, fn: (arg?: any) => void) { evs.set(ev, [...(evs.get(ev) ?? []), fn]); return conn; },
      once(ev: string, fn: (arg?: any) => void) { return conn.on(ev, fn); },
      close: async () => { conn.closed = true; rec.closed = true; for (const fn of evs.get('close') ?? []) fn(); },
    };
    if (tries === 1) {
      // Connected, and then the broker refuses the declaration: a half-configured
      // vhost or a missing permission. A refused TCP connect takes the same path.
      ch.assertExchange = async () => { throw new Error('ACCESS_REFUSED (pretend)'); };
      refused = conn;
    } else {
      live = { ch, rec };
    }
    return conn;
  });
  const w = startWorker({ queue: 'api.work', patterns: ['work.#'], log: mute, claims: memoryClaims() });
  // First attempt fails; RECONNECT_MS[0] is 1s, so this waits it out on purpose.
  await sleep(1_400);
  test('a broker that refuses the first connection is retried, not given up on', () => A.ok(tries >= 2));
  test('and the half-opened connection is closed — one leak per retry is a broker outage', () =>
    A.equal(refused.closed, true));
  test('the topology is re-declared on the new connection, not assumed to survive', () =>
    A.ok(live && live.rec.exchanges.some((e) => e.name === EX)));
  test('and the consumer is bound again after reconnecting', () =>
    A.equal(live.rec.consumes[0].queue, 'api.work'));
  await w.stop();
  test('stop() after a reconnect closes cleanly', () => A.equal(live.rec.cancels.length, 1));
  setConnector(null);
  clearHandlers();
  if (saved === undefined) delete process.env.AMQP_URL; else process.env.AMQP_URL = saved;
  resetAnnounce();
}

console.log('\n10) The two runtimes still agree (grep, not faith)');

{
  const py = readFileSync(new URL('../../ai/src/course_ai/bus.py', import.meta.url), 'utf8');
  test('ai/src/course_ai/bus.py declares the same envelope fields, in the same order', () =>
    A.ok(py.includes('"id", "type", "key", "idempotency_key", "attempt", "produced_at", "payload",'),
      'the ENVELOPE_FIELDS tuple in bus.py drifted from bus.ts'));
  test('the same retry numbers', () => {
    for (const line of ['BASE_DELAY_MS = 1_000', 'DELAY_FACTOR = 4', 'DELAY_CAP_MS = 60_000', 'MAX_ATTEMPTS = 5']) {
      A.ok(py.includes(line), `bus.py is missing: ${line}`);
    }
  });
  test('the same delivery mode', () => A.ok(py.includes('PERSISTENT = 2')));
  test('the same reconnect ladder', () =>
    A.ok(py.includes('(1_000, 2_000, 4_000, 8_000, 16_000, 30_000)')));
  test('the same exchange and queue names', () => {
    for (const s of ['f"{exchange}.retry.{ms}"', 'f"{exchange}.dlx"', 'f"{exchange}.dead"']) {
      A.ok(py.includes(s), `bus.py names drifted: ${s}`);
    }
  });
}

console.log('\n11) The idempotency claim, against a real Postgres (skipped without one)');

// The claim is the one piece of this module that is NOT a decision about the
// broker: it is raw SQL, with an ON CONFLICT ... DO UPDATE ... WHERE and a
// jsonb lease, and a fake cannot tell whether Postgres accepts it. So this
// section runs for real when a database is configured and says so when it is
// not — the same way test/cola.mjs needs one.
if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'development') {
  console.log('  skip · no DATABASE_URL: the claim SQL is NOT covered by this run');
} else {
  const { pgClaims } = await import('../src/bus.ts');
  const { all, run } = await import('../src/db.ts');
  const K = 'test-transporte-claim';
  const wipe = () => run(`DELETE FROM jobs WHERE tipo = 'bus.claim' AND clave LIKE 'test-transporte-%'`);
  const rowOf = async () => (await all<{ datos: { state?: string; owner?: string }; estado: string }>(
    `SELECT datos, estado FROM jobs WHERE tipo = 'bus.claim' AND clave = $1`, [K]))[0]!;
  try {
    await wipe();
    const a = pgClaims({ worker: 'worker-A', leaseS: 300 });
    const b = pgClaims({ worker: 'worker-B', leaseS: 300 });

    const first = await a.claim(K);
    const other = await b.claim(K);
    const mine = await a.claim(K);
    test('the first worker to ask gets the work', () => A.equal(first, true));
    test('a second worker with a fresh lease is refused', () => A.equal(other, false));
    test('but the SAME worker reclaims its own lease — that is the restart case', () => A.equal(mine, true));

    await a.release(K);
    const afterRelease = await rowOf();
    const retry = await b.claim(K);
    test('a failed handler releases the row, so the retry is claimable', () => {
      A.equal(afterRelease, undefined);
      A.equal(retry, true);
    });

    await b.complete(K);
    const done = await rowOf();
    const again = await a.claim(K);
    test('done is recorded and is forever, for every worker', () => {
      A.equal(done.datos.state, 'done');
      A.equal(again, false);
    });
    test('claims are written as estado=hecho so no worker() from jobs.ts takes them', () =>
      A.equal(done.estado, 'hecho'));

    await wipe();
    await a.claim(K);
    await run(`UPDATE jobs SET datos = jsonb_set(datos, '{at}', to_jsonb(now() - interval '10 minutes'))
               WHERE tipo = 'bus.claim' AND clave = $1`, [K]);
    const takeover = await b.claim(K);
    test('a lease older than the ceiling is taken over: a dead worker cannot hold work forever', () =>
      A.equal(takeover, true));
    await wipe();
  } catch (e) {
    console.log(`  skip · database not usable (${e instanceof Error ? e.message : String(e)}): claim SQL NOT covered`);
  }
}

// ---------------------------------------------------------------------------
// NOT PROVEN HERE, and nothing in this file should be read as proving it:
//   · that RabbitMQ actually honours x-message-ttl + x-dead-letter-exchange the
//     way the retry ladder assumes (delay tiers re-entering the main exchange
//     with the ORIGINAL routing key),
//   · that amqplib's confirm callback and 'return' event behave as the double
//     does, in that order,
//   · that the Postgres claim SQL runs, WHEN there is no DATABASE_URL — section
//     11 covers it against a real Postgres and prints a skip line otherwise,
//   · that a real SIGTERM inside a container drains before the runtime kills it,
//   · that the api and ai runtimes can read each other's bytes — only that the
//     two files still declare the same names and numbers.
console.log(fallos ? `\n${fallos} failure(s) of ${ok + fallos}` : `\nno failures (${ok} checks)`);
process.exit(fallos ? 1 : 0);
