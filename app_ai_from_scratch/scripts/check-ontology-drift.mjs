#!/usr/bin/env node
/**
 * Fails when the ontology and the database schema disagree about which columns exist.
 *
 * WHY THIS EXISTS
 * The runtime guard (`assertNoForbidden`) works from a list of FORBIDDEN columns.
 * That makes it fail closed on an unknown table -- `forbiddenColumns` throws -- but
 * fail OPEN on an unknown column: a column nobody declared can never be forbidden, so
 * a query that returns it is approved by a guard that has never heard of it. Drift in
 * that direction silently shrinks the guarantee while every proof stays green.
 *
 * The mirror direction is not a leak but it is a lie: a declared column that does not
 * exist means the ontology documents protection for something nobody can query, and the
 * graph proof spends edges on it.
 *
 * WHY schema.prisma AND NOT THE LIVE DATABASE
 * This check is static on purpose: no database, no container, runnable in CI. Prisma
 * owns the schema, so `schema.prisma` is the declared truth, and `prisma migrate diff
 * --exit-code` already proves that file matches the live database. Chaining the two:
 *
 *     ontology <-> schema.prisma   (this script)
 *     schema.prisma <-> live DB    (db:drift)
 *     => ontology <-> live DB
 *
 * The chain only holds because this schema declares no `@map`, so every Prisma field
 * name IS its column name. `assertNoFieldMapping` below enforces that assumption rather
 * than trusting it -- a single `@map` would make this comparison quietly meaningless.
 *
 * Usage:  node scripts/check-ontology-drift.mjs
 * Exit 0 = ontology and schema agree, column for column. Exit 1 = drift, listed.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SCHEMA = join(ROOT, 'api/prisma/schema.prisma');

/** The generated artifact is mid-rename (ontologia.json -> ontology.json). Accept either. */
const ONTOLOGY_CANDIDATES = ['api/src/ontology.json', 'api/src/ontologia.json'];

/**
 * Prisma scalar types. A field whose type is NOT one of these is a relation, not a
 * column, and is skipped. Kept as a closed set so an unrecognised type is an error
 * rather than a silently skipped column.
 */
const SCALARS = new Set([
  'String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal',
  'DateTime', 'Json', 'Bytes',
]);

const fail = (msg) => {
  console.error(`ontology-drift: ${msg}`);
  process.exit(1);
};

function readOntology() {
  const found = ONTOLOGY_CANDIDATES.map((p) => join(ROOT, p)).find(existsSync);
  if (!found) {
    fail(
      `no generated ontology found. Looked for:\n`
      + ONTOLOGY_CANDIDATES.map((p) => `  ${p}`).join('\n')
      + `\nGenerate it with 'uv --directory ai run ai-export'.`,
    );
  }
  const doc = JSON.parse(readFileSync(found, 'utf8'));
  if (!doc.clases || typeof doc.clases !== 'object') {
    fail(`${found} has no 'clases' map; it is not a generated ontology artifact.`);
  }
  const byTable = new Map();
  for (const ref of Object.keys(doc.clases)) {
    const dot = ref.indexOf('.');
    if (dot < 1) fail(`malformed column reference in 'clases': '${ref}' (want 'table.column')`);
    const table = ref.slice(0, dot);
    const column = ref.slice(dot + 1);
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table).add(column);
  }
  return { path: found, byTable };
}

/**
 * A `@map` on a field would break the field-name-is-column-name assumption this whole
 * comparison rests on, so refuse to report a clean result instead of reporting a wrong one.
 */
function assertNoFieldMapping(source) {
  const mapped = source
    .split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /@map\s*\(/.test(line) && !/^\s*@@/.test(line));
  if (mapped.length) {
    fail(
      `schema.prisma uses @map on ${mapped.length} field(s), so a Prisma field name is no `
      + `longer its column name and this comparison cannot be trusted:\n`
      + mapped.map(([n, line]) => `  schema.prisma:${n}  ${line.trim()}`).join('\n')
      + `\nTeach this script to resolve @map before removing this guard.`,
    );
  }
}

/** Parses `model X { ... }` blocks into table -> Set(column). Relations are excluded. */
function readSchema() {
  if (!existsSync(SCHEMA)) fail(`${SCHEMA} not found.`);
  const source = readFileSync(SCHEMA, 'utf8');
  assertNoFieldMapping(source);

  const models = new Map();
  const modelNames = new Set([...source.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]));

  for (const block of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, name, body] = block;
    const columns = new Set();
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const m = /^(\w+)\s+(\w+)(\[\])?\??/.exec(line);
      if (!m) continue;
      const [, field, type, list] = m;
      if (list || modelNames.has(type)) continue;              // relation, not a column
      if (type === 'Unsupported') { columns.add(field); continue; }
      if (!SCALARS.has(type)) {
        fail(
          `model ${name}: field '${field}' has type '${type}', which is neither a Prisma `
          + `scalar nor a model in this schema. Skipping it could hide a real column, so `
          + `add it to SCALARS (if it is an enum) instead.`,
        );
      }
      columns.add(field);
    }
    models.set(name, columns);
  }
  if (!models.size) fail(`parsed 0 models out of ${SCHEMA}; the parser is broken, not the schema.`);
  return models;
}

const ontology = readOntology();
const schema = readSchema();

const tables = [...new Set([...schema.keys(), ...ontology.byTable.keys()])].sort();
const rows = [];

for (const table of tables) {
  const inSchema = schema.get(table);
  const declared = ontology.byTable.get(table);

  if (!inSchema) {
    rows.push({ table, kind: 'table declared, absent from schema', detail: '' });
    continue;
  }
  if (!declared) {
    rows.push({ table, kind: 'table in schema, undeclared', detail: [...inSchema].sort().join(', ') });
    continue;
  }
  const phantom = [...declared].filter((c) => !inSchema.has(c)).sort();
  const undeclared = [...inSchema].filter((c) => !declared.has(c)).sort();
  if (undeclared.length) {
    // The leaking direction: no class, so it can never be forbidden.
    rows.push({ table, kind: 'undeclared column (guard is blind to it)', detail: undeclared.join(', ') });
  }
  if (phantom.length) {
    rows.push({ table, kind: 'declared column absent from schema', detail: phantom.join(', ') });
  }
}

const width = Math.max(5, ...tables.map((t) => t.length));
console.log(`ontology: ${ontology.path.slice(ROOT.length + 1)}`);
console.log(`schema:   api/prisma/schema.prisma  (${schema.size} models)`);
console.log();

if (!rows.length) {
  console.log(`ok: every column in ${schema.size} models has a declared class, and every`);
  console.log(`    declared column exists. Run 'pnpm --dir api db:drift' to extend this to the live DB.`);
  process.exit(0);
}

for (const { table, kind, detail } of rows) {
  console.log(`${table.padEnd(width)}  ${kind}${detail ? `: ${detail}` : ''}`);
}
console.log();
console.log(`${rows.length} drift finding(s).`);
console.log();
console.log(`This compares the GENERATED ARTEFACT, because that is the file the runtime guard`);
console.log(`loads. So there are two different faults it cannot tell apart, and they are fixed`);
console.log(`in opposite places — check them in this order:`);
console.log();
console.log(`  1. The artefact is STALE. data.py may already be right while the artefact lags,`);
console.log(`     and the guard is still running on the lag. Regenerate first:`);
console.log(`         uv --directory ai run ai-export`);
console.log(`     Then run this again. If the findings disappear, that was the whole problem.`);
console.log();
console.log(`  2. The declaration is WRONG. If they survive a regenerate, fix the source:`);
console.log(`         ai/src/course_ai/ontology/data.py`);
console.log();
console.log(`An undeclared column is the dangerous direction: the runtime guard works from a`);
console.log(`forbidden-column list, so a column with no class can never be forbidden. Note that`);
console.log(`a column COUNT would not have caught the drift this check was written for -- 90`);
console.log(`declared against 90 real, because the phantom columns exactly offset the missing`);
console.log(`ones. Comparing the sets is the point.`);
process.exit(1);
