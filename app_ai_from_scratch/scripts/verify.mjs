#!/usr/bin/env node
/**
 * `pnpm verify` — every gate, one command, one honest verdict.
 *
 * WHY THIS EXISTS
 * The gates were spread across four package managers and two languages, so
 * "is it green?" meant remembering eight commands and reading eight exit codes.
 * That is how a red gate goes unnoticed for a day.
 *
 * THREE RULES IT ENFORCES ON ITSELF, all learned the hard way in this repo:
 *
 * 1. EXIT CODES ARE READ DIRECTLY, NEVER THROUGH A PIPE. `cmd | tail` reports
 *    tail's status, not cmd's. That mistake produced a confident "exit 0" here
 *    for a command that had actually died with a NameError. So: the child's own
 *    `close` code is the truth, and a spawn that never started is a failure.
 *
 * 2. A GATE THAT CANNOT RUN IS A FAILURE, NOT A SKIP. A missing tool, an absent
 *    database, a server that never came up — all red. This codebase has been
 *    bitten three times by a check that inspected nothing and reported success,
 *    and a skip is indistinguishable from a pass at a glance. The single
 *    exception is a service that does not exist yet, which is reported as ABSENT
 *    and listed separately so it can never masquerade as passing.
 *
 * 3. CONCURRENCY MUST NOT BUY SPEED WITH ATTRIBUTION. The gates run in
 *    parallel, so their output arrives interleaved. Every byte is therefore
 *    buffered PER GATE and printed only once that gate has settled — a failure
 *    dump that mixes two children's stderr is worse than a slow run, because it
 *    sends the reader to the wrong service.
 *
 * Usage:
 *   node scripts/verify.mjs            every gate
 *   node scripts/verify.mjs --fast     static + unit only; no DB, no server
 *   node scripts/verify.mjs --list     print the gates and exit
 *   node scripts/verify.mjs --serial   one gate at a time (bisecting a flake)
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FAST = process.argv.includes('--fast');
const LIST = process.argv.includes('--list');
const SERIAL = process.argv.includes('--serial');

// A live, redrawing board only makes sense on a terminal. Written to a file or a
// CI log, cursor-movement escapes turn the transcript into confetti, so there the
// output is one plain append-only line per gate as it settles.
const TTY = Boolean(process.stdout.isTTY);

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

/**
 * HOW MANY GATES AT ONCE.
 *
 * `availableParallelism() - 1`, floored at 1. Two reasons for the -1, and
 * neither is superstition:
 *
 *   - the gates are not the only thing running. This process itself renders the
 *     board, and half the gates are process TREES (pnpm -> tsgo, `go test ./...`
 *     forks a test binary per package, pytest forks collectors). Saturating every
 *     core with parent processes means the children fight their own parents for
 *     a timeslice, and the measured effect of that is a LONGER wall clock, not a
 *     shorter one.
 *   - it leaves the machine usable. `pnpm verify` is run from a laptop dozens of
 *     times a day, and a gate runner that freezes the editor gets run less often.
 *
 * Measured on this machine (availableParallelism() = 10, so cap 9) over three
 * interleaved A/B pairs of all 15 gates: sequential 17.05 / 17.13 / 17.38s,
 * concurrent 6.90 / 7.15 / 7.17s. 2.4x, and the same 15 verdicts both ways.
 *
 * The floor is not the cap. It is the longest single gate: py-tests runs 5.4s
 * alone and 7.0s with fourteen siblings competing for the same ten cores, and
 * that stretch IS the whole remaining wall clock. Raising the cap cannot help —
 * peak observed concurrency is already 9 — and there is nothing left to win here
 * without making py-tests itself faster.
 */
const CAP = SERIAL ? 1 : Math.max(1, availableParallelism() - 1);

/**
 * MUTUAL EXCLUSION GROUPS.
 *
 * A gate with `exclusive: 'name'` never runs at the same time as another gate
 * carrying the same name. It is a NAMED LOCK, not a "slow" flag: two gates in
 * one group serialise against each other and against nothing else.
 *
 * This exists because a flaky gate is worse than a slow one. A gate that fails
 * one run in twenty teaches everybody to re-run it, and a re-run habit is how a
 * real failure gets clicked past.
 *
 * See `postgres` on schema-drift and api-tests below for the only current group
 * and the evidence for each member.
 */
const GROUP_WHY = {
  postgres: 'both reach the same Postgres server on localhost:5432',
};

/**
 * `slow` gates touch the database or need a running server.
 * `absentIf` marks a gate for a service that may not exist yet — the ONLY
 * legitimate skip, and it is reported as ABSENT rather than folded into a pass.
 * `exclusive` names a mutual-exclusion group (see GROUP_WHY).
 */
const GATES = [
  { id: 'ontology-drift', what: 'ontology declares every real column',
    cmd: ['node', ['scripts/check-ontology-drift.mjs']] },

  { id: 'price', what: 'one price: charged == advertised == quoted, and no stale copy',
    cmd: ['node', ['--experimental-strip-types', 'scripts/check-price.mjs']] },

  { id: 'tool-catalog', what: '41 tools readable from the registry by import',
    cmd: ['node', ['--experimental-strip-types', 'scripts/emit-tool-catalog.mjs']] },

  { id: 'py-lint', what: 'ruff',
    cmd: ['uv', ['--directory', 'ai', 'run', 'ruff', 'check', '.']] },

  { id: 'py-tests', what: 'pytest',
    cmd: ['uv', ['--directory', 'ai', 'run', 'pytest', '-q']] },

  { id: 'isolation-proof', what: 'P1..P4 over the bridged tools, P5 over the native ones',
    cmd: ['uv', ['--directory', 'ai', 'run', 'ai-prove-isolation']] },

  // The concept map routes a question to a lesson NUMBER, so it is only worth what
  // its agreement with the index Node serves is worth. The gate fetches that index
  // (scripts/emit-lesson-index.mjs, by import) and refuses on either arm: a concept
  // pointing at a lesson that does not exist, or a lesson no concept covers.
  { id: 'concept-map', what: 'the routing map agrees with the lesson index Node serves',
    cmd: ['uv', ['--directory', 'ai', 'run', 'ai-check-concepts']] },

  { id: 'api-types', what: 'tsgo against the pinned baseline',
    cmd: ['pnpm', ['--dir', 'api', 'check']] },

  { id: 'api-data-boundary', what: 'runtime API has no Postgres credential or SQL escape hatch',
    cmd: ['node', ['scripts/check-api-data-boundary.mjs']] },

  { id: 'payments', what: 'tsgo and webhook security contracts',
    absentIf: () => !existsSync(resolve(ROOT, 'payments/package.json')),
    absentNote: 'no payments service yet',
    cmd: ['sh', ['-c', 'pnpm --dir payments check && pnpm --dir payments test']] },

  { id: 'messages', what: 'tsgo and JSONB document contracts',
    absentIf: () => !existsSync(resolve(ROOT, 'messages/package.json')),
    absentNote: 'no messages service yet',
    cmd: ['sh', ['-c', 'pnpm --dir messages check && pnpm --dir messages test']] },

  { id: 'web-astro', what: 'astro check',
    cmd: ['pnpm', ['--dir', 'web', 'exec', 'astro', 'check']] },

  { id: 'web-types', what: 'tsgo, web',
    cmd: ['pnpm', ['--dir', 'web', 'exec', 'tsgo', '-p', 'tsconfig.tsgo.json']] },

  { id: 'web-scenes', what: 'every lesson has one scene, no orphans',
    cmd: ['node', ['web/scripts/scenes-check.mjs']] },

  // The five lines of defence. Two gates rather than one, deliberately:
  // `defense-build` is the ordinary Go suite, and `defense-policy` is the leash.
  // Separating them means an operator can see at a glance whether the tests are
  // red or whether the SAFETY invariants are -- "every action expires", "an
  // irreversible action needs a human", "exactly one agent may act", "the
  // detector cannot emit actions". Those are the ones where a green tick over a
  // broken table would be worst.
  { id: 'defense-build', what: 'go build + vet + gofmt + test -race',
    absentIf: () => !existsSync(resolve(ROOT, 'defense/go.mod')),
    absentNote: 'no defense/go.mod yet',
    cmd: ['sh', ['-c',
      'cd defense && go build ./... && go vet ./... '
      + '&& { test -z "$(gofmt -l .)" || { echo "gofmt would change:"; gofmt -l .; exit 1; }; } '
      + '&& go test ./... -race']] },

  { id: 'defense-policy', what: 'every action expires, one agent may act, the detector cannot',
    absentIf: () => !existsSync(resolve(ROOT, 'defense/go.mod')),
    absentNote: 'no defense/go.mod yet',
    cmd: ['sh', ['-c', 'cd defense && go run ./cmd/defense verify']] },

  { id: 'queue-build', what: 'go build + vet + gofmt + test -race',
    absentIf: () => !existsSync(resolve(ROOT, 'queue/go.mod')),
    absentNote: 'no queue/go.mod yet',
    cmd: ['sh', ['-c',
      'cd queue && go build ./... && go vet ./... '
      + '&& { test -z "$(gofmt -l .)" || { echo "gofmt would change:"; gofmt -l .; exit 1; }; } '
      + '&& go test ./... -race']] },

  // The credential holder. Its suite was running ONLY inside the image build
  // until this gate existed, which meant a developer could break the closed
  // catalogue, the actor-scoping proof or the paywall check and see fifteen green
  // ticks -- the failure would surface in CI, on a push, attributed to Docker.
  //
  // DATA_ONTOLOGY is set so the tests read the same artefact the service does.
  // Without it guard.FindForTests walks up the tree, which works here and fails
  // in the image, and that difference has already cost one debugging session.
  { id: 'data-build', what: 'go build + vet + gofmt + test -race',
    absentIf: () => !existsSync(resolve(ROOT, 'data/go.mod')),
    absentNote: 'no data/go.mod yet',
    cmd: ['sh', ['-c',
      'cd data && DATA_ONTOLOGY="$PWD/../api/src/ontologia.json" '
      + 'sh -c \'go build ./... && go vet ./... '
      + '&& { test -z "$(gofmt -l .)" || { echo "gofmt would change:"; gofmt -l .; exit 1; }; } '
      + '&& go test ./... -race\'']] },

  // The catalogue's own declarations, proved as a set rather than per operation:
  // no agent operation reaches a jamas column, every scoped read filters on the
  // actor, no assembled statement contains a star, and every operation declares
  // which side of the paywall it is on. Separate from data-build for the same
  // reason defense-policy is separate from defense-build: this is the one whose
  // green tick over a broken table would be worst.
  { id: 'data-catalog', what: 'the closed catalogue: P1, P3 and the paywall axis',
    absentIf: () => !existsSync(resolve(ROOT, 'data/go.mod')),
    absentNote: 'no data/go.mod yet',
    cmd: ['sh', ['-c',
      'cd data && DATA_ONTOLOGY="$PWD/../api/src/ontologia.json" go run ./cmd/data verify']] },

  // ---- the `postgres` mutual-exclusion group -------------------------------
  //
  // WHY schema-drift IS IN IT
  //   `prisma migrate diff --from-migrations prisma/migrations --to-config-datasource`
  //   is not a read. `--from-migrations` REPLAYS the whole migrations directory
  //   into the shadow database (api/prisma.config.ts wires SHADOW_DATABASE_URL to
  //   `curso_shadow`), which means dropping and recreating its schema, and
  //   `--to-config-datasource` then introspects the live `curso`. So this gate
  //   holds a DDL session on one database and a catalogue read on the other, on
  //   the same server, for its whole ~1s.
  //
  // WHY api-tests IS IN IT
  //   The api suites write to `curso` and clean up after themselves by
  //   PRIMARY KEY and by prefix, not in a transaction that rolls back:
  //   test/isolation.mts DELETEs and INSERTs `attempts` for user 2,
  //   test/tools.mts rewrites `attempts` for user 1, test/queue.mts and
  //   test/transport.mts DELETE and UPDATE `jobs` rows. Two of those suites also
  //   call `migrate()` from api/src/db.ts, which is a schema ASSERTION and not a
  //   migration (see the comment at api/src/db.ts:203) — so the tests never do
  //   DDL, but they are continuously mutating the database the other gate is
  //   introspecting.
  //
  // WHY NOT JUST LET THEM RACE
  //   Three back-to-back concurrent runs of the pair came back 0/0, so today
  //   they happen not to collide: the writes are row-level and the diff reads
  //   the catalogue. That is a measurement of one afternoon's luck, not a
  //   guarantee — nothing in either gate DECLARES that separation, and the first
  //   test that adds a CREATE TEMP TABLE, or the first `migrate diff` that starts
  //   taking an advisory lock on the target, turns it into a one-run-in-twenty
  //   failure that everybody learns to re-run past.
  //
  // WHAT IT COSTS: nothing. Measured, the chain is 1.0s + 2.9s = 3.9s, and the
  // longest single gate in the set (py-tests) is 4.6s. The group is entirely
  // hidden behind a gate that has to run anyway, so this is safety at zero
  // wall-clock. If that ever stops being true, the answer is a second database,
  // not a shared one with the lock removed.
  { id: 'schema-drift', what: 'migrations match schema.prisma', slow: true,
    exclusive: 'postgres',
    cmd: ['pnpm', ['--dir', 'api', 'db:drift']] },

  { id: 'api-tests', what: 'every api suite', slow: true,
    exclusive: 'postgres',
    cmd: ['pnpm', ['--dir', 'api', 'test']] },

  // EXECUTES every read operation in the data catalogue and checks that each
  // row's key set is exactly what the operation declared.
  //
  // data-catalog proves the catalogue is well FORMED. This proves the statements
  // RUN, and the difference is not academic: rows were being scrubbed by
  // forbidden column instead of by declared column, so the two internal
  // exemptions came back stripped -- user.credentials_by_email declares seven
  // columns and returned one. Login through the service could not work and all
  // seventeen gates were green. Calling the operations and looking at the keys
  // was the only thing that found it.
  //
  // In the postgres group because it reads the same database the api suites
  // mutate. DATABASE_URL comes from the environment in CI and from api/.env on a
  // laptop -- the same two places prisma.config.ts looks.
  { id: 'data-smoke', what: 'every operation actually runs and returns what it declares',
    slow: true, exclusive: 'postgres',
    absentIf: () => !existsSync(resolve(ROOT, 'data/go.mod')),
    absentNote: 'no data/go.mod yet',
    cmd: ['sh', ['-c',
      'cd data && { [ -n "$DATABASE_URL" ] || { set -a; . ../api/.env; set +a; }; } '
      + '&& DATA_ONTOLOGY="$PWD/../api/src/ontologia.json" go run ./cmd/data smoke']] },
];

if (LIST) {
  console.log(`\n${C.cyan('gates')}  (--fast runs the ones not marked slow)\n`);
  for (const g of GATES) {
    const tag = g.slow ? C.yellow('slow') : '    ';
    const lock = g.exclusive ? C.yellow(` [${g.exclusive}]`) : '';
    console.log(`  ${tag}  ${g.id.padEnd(16)} ${C.dim(g.what)}${lock}`);
  }
  console.log(`\n${C.dim(`up to ${CAP} at once`)}`);
  for (const [name, why] of Object.entries(GROUP_WHY)) {
    const members = GATES.filter((g) => g.exclusive === name).map((g) => g.id);
    console.log(C.dim(`  [${name}] never concurrent with each other — ${why}: ${members.join(', ')}`));
  }
  console.log();
  process.exit(0);
}

const chosen = GATES.filter((g) => !(FAST && g.slow));

// `absentIf` is resolved BEFORE anything is dispatched. It is a filesystem
// question, it costs nothing, and settling it up front keeps the one legitimate
// skip out of the concurrent path entirely — an ABSENT gate can never be a
// half-started child.
const absent = [];
const runnable = [];
for (const g of chosen) {
  if (g.absentIf?.()) absent.push({ ...g, state: 'absent' });
  else runnable.push(g);
}

/**
 * DISPATCH ORDER. Not the declaration order, and the difference is load-bearing.
 *
 * Members of a mutual-exclusion group form the only chain in the run that CANNOT
 * be shortened by adding workers: they go one after another whatever the cap is.
 * Started last, that chain hangs off the end of the run and becomes the critical
 * path; started first, it finishes underneath the longest independent gate.
 * Measured with per-gate timestamps, `postgres` dispatched first starts at t=0ms
 * and the chain closes at t=4.7-5.4s, entirely underneath py-tests at t=7.0s.
 * The two members never overlap by a single millisecond, and api-tests starts
 * within 1ms of schema-drift finishing — so the lock costs no idle time either.
 *
 * Everything after it keeps declaration order. This is a scheduling HINT only —
 * no verdict depends on it, so a new gate landing in the wrong place costs
 * milliseconds and never correctness.
 */
const dispatch = [
  ...runnable.filter((g) => g.exclusive),
  ...runnable.filter((g) => !g.exclusive),
];

const lanes = CAP === 1 ? 'one at a time' : `up to ${CAP} at once`;
console.log(`\n${C.cyan('verify')} — ${chosen.length} gates, ${lanes}`
  + `${FAST ? C.dim(' (fast: no DB, no server)') : ''}\n`);

// state per gate id, for the board. `results` is the verdict record.
const live = new Map(); // id -> { started }
const results = [...absent];
const byId = new Map(chosen.map((g) => [g.id, g]));

// ---------------------------------------------------------------------------
// The board. On a TTY it is redrawn in place, one line per gate, ALWAYS in
// declaration order: a display whose rows move as gates finish is unreadable,
// and unreadable progress is the regression that concurrency usually ships.
let painted = 0;

const glyph = (id) => {
  const r = results.find((x) => x.id === id);
  if (r?.state === 'pass') return C.green('✓');
  if (r?.state === 'fail') return C.red('✗');
  if (r?.state === 'absent') return C.yellow('◦');
  if (live.has(id)) return C.cyan('▸');
  return C.dim('·');
};

const trailer = (g) => {
  const r = results.find((x) => x.id === g.id);
  if (r?.state === 'absent') return C.dim(`absent — ${g.absentNote}`);
  if (r) return C.dim(`${g.what}  ${r.ms}ms`);
  const l = live.get(g.id);
  if (l) return C.dim(`${g.what}  ${Date.now() - l.started}ms…`);
  return C.dim(g.what);
};

function paint() {
  if (!TTY) return;
  let out = painted ? `\x1b[${painted}A` : '';
  for (const g of chosen) out += `\x1b[2K${glyph(g.id)} ${g.id.padEnd(16)} ${trailer(g)}\n`;
  painted = chosen.length;
  process.stdout.write(out);
}

// Non-TTY: append one settled line per gate, so a log still shows progress and a
// hung run still says which gate it is hanging in.
function line(g) {
  if (TTY) return;
  console.log(`${glyph(g.id)} ${g.id.padEnd(16)} ${trailer(g)}`);
}

for (const a of absent) line(byId.get(a.id));
paint();
const ticker = TTY ? setInterval(paint, 120) : null;
ticker?.unref();

// ---------------------------------------------------------------------------
// The runner: bounded parallelism plus named locks.

const held = new Set(); // mutual-exclusion groups currently taken
const queue = [...dispatch];
let running = 0;
let settled = 0;

/**
 * Runs one gate. Every byte the child writes is buffered here and NOT printed:
 * two children writing to this terminal at once produces a transcript in which
 * a stack trace belongs to whichever gate you guess. The buffer is attributed
 * and dumped after the run, under the gate's own name.
 */
function start(g, done) {
  const [bin, args] = g.cmd;
  const started = Date.now();
  live.set(g.id, { started });
  paint();

  // stdio 'pipe': the output is only worth showing when the gate fails. stdin is
  // 'ignore' rather than inherited — a concurrent child that reads the terminal
  // would fight its siblings for it, and none of these gates is interactive.
  const child = spawn(bin, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', (c) => chunks.push(c));
  child.stderr.on('data', (c) => chunks.push(c));

  // A child can emit BOTH `error` and `close`; the first one to arrive is the
  // verdict. Without this latch a failed spawn records twice and the counts lie.
  let recorded = false;
  const finish = (state, extra) => {
    if (recorded) return;
    recorded = true;
    live.delete(g.id);
    results.push({
      ...g, state, ms: Date.now() - started,
      out: Buffer.concat(chunks).toString('utf8').trimEnd(),
      ...extra,
    });
    line(g);
    paint();
    done();
  };

  // A missing binary, or a directory that is not there, arrives here and never
  // reaches `close`. That is a FAILURE: the gate did not run, so nothing was
  // proved.
  child.on('error', (err) => finish('fail', { spawnError: err.message }));
  child.on('close', (code, signal) => {
    // `code` is the child's OWN status, read off the process. `signal` non-null
    // means it was killed before it could set one — also a failure, and named
    // so a run that dies to an OOM killer does not read as an assertion.
    if (signal) finish('fail', { signal });
    else finish(code === 0 ? 'pass' : 'fail', { code });
  });
}

function pump(resolveAll) {
  for (let i = 0; i < queue.length;) {
    if (running >= CAP) break;
    const g = queue[i];
    // A gate whose lock is taken is stepped over, not waited on: the queue keeps
    // filling with independent work, and pump() is called again the moment the
    // holder settles, so nothing starves.
    if (g.exclusive && held.has(g.exclusive)) { i++; continue; }
    queue.splice(i, 1);
    running++;
    if (g.exclusive) held.add(g.exclusive);
    start(g, () => {
      running--;
      settled++;
      if (g.exclusive) held.delete(g.exclusive);
      if (settled === dispatch.length) { resolveAll(); return; }
      pump(resolveAll);
    });
  }
}

if (dispatch.length) {
  await new Promise((resolveAll) => pump(resolveAll));
}
if (ticker) clearInterval(ticker);
paint();

// ---------------------------------------------------------------------------
// The verdict. Failures are dumped in DECLARATION order, not completion order,
// so two runs of the same red tree produce diffable output.
const order = new Map(chosen.map((g, i) => [g.id, i]));
results.sort((a, b) => order.get(a.id) - order.get(b.id));

const failed = results.filter((x) => x.state === 'fail');
const absentFinal = results.filter((x) => x.state === 'absent');

for (const f of failed) {
  console.log(`\n${C.red('─'.repeat(70))}`);
  console.log(`${C.red('FAILED')}  ${f.id}   ${C.dim(`(${f.cmd[0]} ${f.cmd[1].join(' ')})`)}`);
  if (f.spawnError) console.log(`  could not run: ${f.spawnError}`);
  else if (f.signal) console.log(`  killed by ${f.signal}`);
  else console.log(`  exit ${f.code}`);
  if (f.out) console.log(f.out.split('\n').slice(-30).map((l) => `  ${l}`).join('\n'));
}

console.log(`\n${'─'.repeat(70)}`);
const passed = results.filter((x) => x.state === 'pass').length;
console.log(`${passed} passed · ${failed.length} failed`
  + `${absentFinal.length ? ` · ${absentFinal.length} absent` : ''}`);

if (absentFinal.length) {
  console.log(C.dim(`absent (not counted as passing): ${absentFinal.map((a) => a.id).join(', ')}`));
}
if (FAST) {
  const skipped = GATES.filter((g) => g.slow).map((g) => g.id);
  console.log(C.yellow(`--fast did NOT run: ${skipped.join(', ')}. Not green until they do.`));
}
console.log();

process.exit(failed.length ? 1 : 0);
