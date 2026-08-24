// Type check of the API with tsgo (the TS 7 compiler written in Go).
//
// The API is TypeScript now and tsgo both checks and emits. THIS script only
// CHECKS: it passes --noEmit so a check never writes dist/ behind somebody's back.
// The build is `pnpm --dir api build`.
//
// WHY THERE IS A BASELINE AND NOT ZERO: there used to be 59 messages and 60 of
// the 61 before them were the same thing — `req.body` and `await res.json()` read
// with no declared shape, so their type was `unknown` or `{}`. Those are gone: the
// routes declare their body through Fastify's generics and the tests declare the
// shapes they read. What the baseline still protects is the same thing it always
// did: it stops the number GOING UP without anybody noticing. A report of N that
// nobody reads protects nothing; a report that fails at N+1 does.
//
//   node scripts/types.mjs           checks against the baseline
//   node scripts/types.mjs --pin     rewrites the baseline (on purpose)
//   node scripts/types.mjs --list    prints every message
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const BASE = `${ROOT}scripts/types-baseline.json`;
const args = process.argv.slice(2);

/** Text out of whatever execFileSync threw: it is not necessarily an Error. */
const failure = (e) => {
  const o = /** @type {{stdout?: unknown, stderr?: unknown, message?: unknown}} */ (
    e && typeof e === 'object' ? e : {});
  return {
    out: `${String(o.stdout ?? '')}${String(o.stderr ?? '')}`,
    msg: e instanceof Error ? e.message : String(e),
  };
};

let output = '';
try {
  output = execFileSync(`${ROOT}node_modules/.bin/tsgo`, ['-p', 'tsconfig.json', '--noEmit'],
                        { cwd: ROOT, encoding: 'utf8' });
} catch (e) {
  // tsgo exits != 0 when there are messages: here that is normal, not a failure.
  const f = failure(e);
  output = f.out;
  if (!output.trim()) { console.error('tsgo produced no output:', f.msg); process.exit(2); }
}

const lines = output.split('\n').filter((l) => / error TS\d+:/.test(l));
/** @type {Record<string, number>} */
const perFile = {};
for (const l of lines) {
  const f = l.split('(')[0];
  perFile[f] = (perFile[f] ?? 0) + 1;
}

if (args.includes('--list') || args.includes('--lista')) { console.log(lines.join('\n')); }

if (args.includes('--pin') || args.includes('--fijar')) {
  writeFileSync(BASE, `${JSON.stringify({ total: lines.length, perFile }, null, 2)}\n`);
  console.log(`baseline pinned: ${lines.length} messages`);
  process.exit(0);
}

/** @type {{total: number, perFile: Record<string, number>}} */
let base;
try { base = JSON.parse(readFileSync(BASE, 'utf8')); }
catch { console.log(`no baseline; pin it with --pin (right now there are ${lines.length})`); process.exit(1); }

if (lines.length > base.total) {
  console.error(`types: WENT UP from ${base.total} to ${lines.length}`);
  const grown = Object.entries(perFile)
    .filter(([f, n]) => n > (base.perFile[f] ?? 0))
    .map(([f, n]) => `  ${f}: ${base.perFile[f] ?? 0} -> ${n}`);
  console.error(grown.join('\n'));
  console.error('\nsee the messages with: node scripts/types.mjs --list');
  process.exit(1);
}
if (lines.length < base.total) {
  console.log(`types: WENT DOWN from ${base.total} to ${lines.length} — pin it with --pin`);
  process.exit(0);
}
console.log(`types: ${lines.length} messages, same as the baseline`);
