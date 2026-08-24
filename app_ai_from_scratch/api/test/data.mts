// The client for the data service (src/data.ts). No database, no Go, no network
// beyond the loopback.
//
// WHAT THIS IS FOR, and what it deliberately does NOT cover.
//
// The data service's own guarantees -- the closed catalogue, statements
// assembled from a declared column list, the forbidden-column scrub, an `own`
// operation proved to filter on the actor -- are Go, and they are tested in Go,
// inside the image build, where they can run against a real schema. Restating
// them here would be a second, weaker copy of a proof that already exists.
//
// What is NOT covered anywhere else is the WIRE CONTRACT this client speaks:
// which headers go out, what never goes out, and what happens on each kind of
// refusal. Those are this file's business, and every one of them is a way to
// lose the isolation without any Go code being wrong:
//
//   * the actor in `args` instead of a header would make obligation P3 -- "no
//     argument can express another person" -- a matter of api's good behaviour
//     rather than of the wire format having no field for it;
//   * a retried write would run twice, because a lost response is
//     indistinguishable from a lost request;
//   * a missing secret silently sending an unauthenticated request would turn a
//     misconfiguration into a 401 at the far end, on every request, forever.
//
// It runs against an in-process stub on a kernel-assigned port, so it needs
// nothing installed and CANNOT skip. There is no branch in this file that exits
// 0 without having asserted something -- three guards in this repository have
// already gone dark while reporting green, and the last one was in this
// directory.
import { strict as A } from 'node:assert';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// The secret has to satisfy the real service's own rule -- at least 32
// characters and no placeholder word inside -- because a future version of this
// suite may point at the real binary, and a fixture that only works against a
// stub is a fixture that hides the change.
const SECRET = 'wQ7mZk2pRv9TxB4LsJ6nYd3HcF1gEuAo';

// ---------------------------------------------------------------------------
// THE STUB. Records what it was sent and answers whatever the test set up. A
// stub rather than the real service because what is under test is the request
// this client BUILDS, and the real service would only ever tell us it was
// acceptable -- not what it contained.
interface Seen {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string;
}
const seen: Seen[] = [];
let reply: (n: number) => { status: number; body: unknown } =
  () => ({ status: 200, body: { operation: 'stub', rows: [], affected: 0 } });

const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    seen.push({
      method: req.method ?? '', path: req.url ?? '',
      headers: req.headers as Record<string, string | undefined>,
      body: Buffer.concat(chunks).toString('utf8'),
    });
    const r = reply(seen.length);
    // status 0 means "die at the connection level": the request was received and
    // recorded, and then the socket goes away without an answer. That is what a
    // restarting service looks like from here, and it is the only failure the
    // client is allowed to retry.
    if (r.status === 0) { req.socket.destroy(); return; }
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.body));
  });
});
await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
const port = (srv.address() as AddressInfo).port;

// Set BEFORE importing the client: it reads the environment once, at module
// load, exactly as it does in the server. Importing first and assigning after
// would test a configuration the process never has.
process.env.DATA_URL = `http://127.0.0.1:${port}`;
process.env.DATA_SECRETO = SECRET;

const { op, one, many, write, DataRefused, DataUnreachable, hasData, DATA_URL } =
  await import('../src/data.ts');

let passed = 0, failed = 0;
const test = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
  try { await fn(); console.log(`  ok   · ${name}`); passed++; }
  catch (e) { console.log(`  FAIL · ${name}\n         ${e instanceof Error ? e.message : String(e)}`); failed++; }
};
const reset = (): void => {
  seen.length = 0;
  reply = () => ({ status: 200, body: { operation: 'stub', rows: [], affected: 0 } });
};
const last = (): Seen => {
  A.ok(seen.length, 'the client sent no request at all');
  return seen[seen.length - 1]!;
};

console.log('\nthe data service client — the wire contract');

// --- 1. what goes out ------------------------------------------------------
await test('the request is POST /v1/op and the body is exactly {op, args}', async () => {
  reset();
  reply = () => ({ status: 200, body: { operation: 'lesson.list', rows: [{ n: 1 }], affected: 1 } });
  await op('lesson.list', { lang: 'es' });
  const r = last();
  A.equal(r.method, 'POST');
  A.equal(r.path, '/v1/op');
  const body = JSON.parse(r.body) as Record<string, unknown>;
  // The real service sets DisallowUnknownFields, so ANY extra key is a 400 in
  // production and a passing test here. Assert the key set, not just presence.
  A.deepEqual(Object.keys(body).sort(), ['args', 'op']);
  A.equal(body.op, 'lesson.list');
  A.deepEqual(body.args, { lang: 'es' });
});

await test('the secret travels in x-data-secreto and nowhere else', async () => {
  reset();
  await op('lesson.list');
  const r = last();
  A.equal(r.headers['x-data-secreto'], SECRET);
  // Not in the body, not in the URL, and not in an Authorization header that
  // some proxy might log.
  A.ok(!r.body.includes(SECRET), 'the secret appeared in the request body');
  A.ok(!r.path.includes(SECRET), 'the secret appeared in the URL');
  A.equal(r.headers.authorization, undefined);
});

await test('the actor travels in a HEADER and never in args — this is P3 as a wire format', async () => {
  reset();
  await op('attempt.mine_for_lab', { lab_id: 'l1-a' }, 42);
  const r = last();
  A.equal(r.headers['x-data-actor'], '42');
  const body = JSON.parse(r.body) as { args: Record<string, unknown> };
  A.deepEqual(Object.keys(body.args), ['lab_id']);
  A.ok(!('actor' in body.args), 'the actor reached args, which is the field that must not exist');
  A.ok(!r.body.includes('42'), 'the actor id appeared somewhere in the body');
});

await test('a public operation sends no actor header at all, rather than actor 0', async () => {
  reset();
  await op('lesson.list');
  A.equal(last().headers['x-data-actor'], undefined);
});

await test('a non-positive or non-integer actor is refused before a request is made', async () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    reset();
    await A.rejects(() => op('user.me', {}, bad), /positive integer/,
      `actor ${String(bad)} was accepted`);
    A.equal(seen.length, 0, `actor ${String(bad)} still produced a request`);
  }
});

// --- 2. configuration ------------------------------------------------------
await test('hasData reflects the secret, and DATA_URL is the one that was set', () => {
  A.equal(hasData(), true);
  A.equal(DATA_URL, `http://127.0.0.1:${port}`);
});

// --- 3. refusals -----------------------------------------------------------
await test('unknown_operation surfaces as DataRefused carrying that code', async () => {
  reset();
  reply = () => ({ status: 404, body: { error: 'unknown_operation', detail: 'the catalogue has 10' } });
  await A.rejects(() => op('payment.list'), (e: unknown) => {
    A.ok(e instanceof DataRefused, `expected DataRefused, got ${String(e)}`);
    A.equal(e.code, 'unknown_operation');
    A.equal(e.status, 404);
    A.equal(e.operation, 'payment.list');
    // The message has to name the operation: during this migration an
    // unknown_operation IS the diagnosis, and one that does not say which call
    // site produced it sends the reader to grep.
    A.match(e.message, /payment\.list/);
    return true;
  });
});

await test('a refusal is never retried — one request, not two', async () => {
  reset();
  reply = () => ({ status: 400, body: { error: 'refused', detail: 'argument "n" is missing' } });
  await A.rejects(() => op('lesson.get'), DataRefused);
  A.equal(seen.length, 1,
    `a refusal was retried ${seen.length} times; a retried write runs twice`);
});

await test('a 401 does not leak into a generic error — the code is preserved', async () => {
  reset();
  reply = () => ({ status: 401, body: { error: 'unauthorised' } });
  await A.rejects(() => op('lesson.list'), (e: unknown) => {
    A.ok(e instanceof DataRefused);
    A.equal(e.code, 'unauthorised');
    return true;
  });
});

await test('a non-JSON error body still yields a usable code instead of a parse crash', async () => {
  reset();
  reply = () => ({ status: 502, body: '<html>bad gateway</html>' });
  await A.rejects(() => op('lesson.list'), (e: unknown) => {
    A.ok(e instanceof DataRefused, `expected DataRefused, got ${String(e)}`);
    // No `error` field to read, so the status is what there is. Anything is
    // better than the JSON parse error masking a 502.
    A.equal(e.status, 502);
    return true;
  });
});

// --- 4. results ------------------------------------------------------------
await test('one() returns the first row, many() returns all, write() returns affected', async () => {
  reset();
  reply = () => ({ status: 200, body: { operation: 'x', rows: [{ n: 1 }, { n: 2 }], affected: 2 } });
  A.deepEqual(await one('x'), { n: 1 });
  A.deepEqual(await many('x'), [{ n: 1 }, { n: 2 }]);

  reply = () => ({ status: 200, body: { operation: 'w', affected: 3 } });
  A.equal(await write('w'), 3);
  // A write answers no rows at all; many() must give [] and not undefined,
  // because every call site does .map or .length on it.
  A.deepEqual(await many('w'), []);
});

await test('one() answers null for no rows, not undefined', async () => {
  reset();
  reply = () => ({ status: 200, body: { operation: 'x', rows: [], affected: 0 } });
  A.equal(await one('x'), null);
});

await test('scrubbed is surfaced when present and absent when empty', async () => {
  reset();
  reply = () => ({ status: 200, body: { operation: 'x', rows: [{ a: 1 }], affected: 1, scrubbed: ['pass_hash'] } });
  A.deepEqual((await op('x')).scrubbed, ['pass_hash']);
  reply = () => ({ status: 200, body: { operation: 'x', rows: [], affected: 0, scrubbed: [] } });
  A.equal((await op('x')).scrubbed, undefined);
});

await test('a timestamptz crosses as a STRING and is passed through untouched', async () => {
  reset();
  // Measured against the real database, not assumed: pgx scans timestamptz into
  // time.Time and Go marshals that to RFC3339. Any client-side revival here
  // would be inventing a type the service never sent.
  const at = '2026-08-23T23:10:54.00838-05:00';
  reply = () => ({ status: 200, body: { operation: 'x', rows: [{ at }], affected: 1 } });
  const row = await one<{ at: unknown }>('x');
  A.equal(typeof row!.at, 'string');
  A.equal(row!.at, at);
});

// --- 5. the connection -----------------------------------------------------
await test('a connection failure is retried EXACTLY once, then reported as unreachable', async () => {
  reset();
  // The socket dies both times. Asserting on the count is the point: a client
  // that never retried and one that retried forever both "fail", and only the
  // count tells them apart. Done against the same stub rather than a dead port
  // so the thrown value is an instance of the class this file imported.
  reply = () => ({ status: 0, body: null });
  await A.rejects(() => op('lesson.list'), (e: unknown) => {
    A.ok(e instanceof DataUnreachable, `expected DataUnreachable, got ${String(e)}`);
    A.equal(e.operation, 'lesson.list');
    return true;
  });
  A.equal(seen.length, 2, `expected 1 attempt + 1 retry, saw ${seen.length}`);
});

await test('the retry SUCCEEDS when the second attempt is answered', async () => {
  reset();
  // Otherwise the retry is only ever observed failing, and a retry that throws
  // away the second answer would pass the test above.
  reply = (n) => n === 1
    ? { status: 0, body: null }
    : { status: 200, body: { operation: 'lesson.list', rows: [{ n: 7 }], affected: 1 } };
  A.deepEqual(await many('lesson.list'), [{ n: 7 }]);
  A.equal(seen.length, 2);
});

await test('with no secret the client refuses locally instead of sending a doomed request', async () => {
  const saved = process.env.DATA_SECRETO;
  delete process.env.DATA_SECRETO;
  const { op: op2, hasData: has2 } =
    await import(`../src/data.ts?nosecret=${Date.now()}`) as { op: typeof op; hasData: typeof hasData };
  A.equal(has2(), false);
  reset();
  await A.rejects(() => op2('lesson.list'), /DATA_SECRETO is not set/);
  A.equal(seen.length, 0, 'an unauthenticated request was sent anyway');
  process.env.DATA_SECRETO = saved;
});

srv.close();
console.log(`\n${passed} ok · ${failed} failed`);
process.exit(failed ? 1 : 0);
