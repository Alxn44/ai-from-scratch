#!/usr/bin/env node
/**
 * Prints Node's tool registry as JSON, read from the registry ITSELF.
 *
 * WHY THIS EXISTS
 * The Python side has to compare what the ontology declares against what Node
 * actually executes (`ai/tests/test_node_contract.py`). It used to do that by
 * regex-scanning the TypeScript source, and that reader has now broken twice:
 * once when `HERRAMIENTAS` was renamed to `TOOLS`, and again when the single
 * `agent-tools.js` was split into four family files. Both times the guard did the
 * right thing and refused to compare against an empty list -- but a guard that is
 * switched off is a guard that is not protecting anything, and the 37-tool
 * catalogue check sat dark until someone noticed.
 *
 * The reason it keeps breaking is that the contract was source FORMATTING. The
 * note in api/src/tools/index.ts asks that tool keys stay at exactly two spaces
 * and that `paywalled: true` stay on the line after its key. Nothing enforces
 * that: not the compiler, not a test, not a formatter. A comment asking people
 * not to reformat code is a wish, not a contract.
 *
 * So this reads the registry by IMPORTING it. The output cannot drift from the
 * code, because it IS the code: rename the registry, split it into ten files,
 * reformat every line -- this still prints the same 37 tools, and a tool that is
 * genuinely gone genuinely disappears.
 *
 * WHY A DUMMY DSN AND NOT NODE_ENV=development
 * Importing the registry pulls in db.ts, which refuses to load without a
 * DATABASE_URL. The obvious fix -- NODE_ENV=development -- is too broad: that flag
 * also makes auth.ts mint an ephemeral JWT secret and can switch other dev-only
 * branches. Nothing here ever opens a connection (pg builds the pool lazily and we
 * only read an object), so a DSN that is deliberately undialable is both narrower
 * and more honest about what this script does.
 *
 * Usage:   node scripts/emit-tool-catalog.mjs           # JSON to stdout
 *          node scripts/emit-tool-catalog.mjs --names    # one tool name per line
 * Exit 0 with the catalogue. Exit 1, with a reason, rather than a partial one.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = resolve(ROOT, 'api/src/tools/index.ts');

// Never dialed: see the header. Set only if the caller has not set one, so running
// this inside an environment that already has a real DSN changes nothing.
process.env.DATABASE_URL ??= 'postgres://tool-catalog-emitter-never-connects/none';

const die = (msg) => { console.error(`emit-tool-catalog: ${msg}`); process.exit(1); };

let registry;
try {
  registry = await import(pathToFileURL(REGISTRY).href);
} catch (err) {
  die(
    `could not import ${REGISTRY.slice(ROOT.length + 1)}:\n  ${err.message}\n`
    + `This script needs Node's type stripping. On Node 22 run it as:\n`
    + `  node --experimental-strip-types scripts/emit-tool-catalog.mjs`,
  );
}

if (typeof registry.catalog !== 'function') {
  die(
    `api/src/tools/index.ts does not export catalog(). It is the only supported way `
    + `to read the registry from outside; exports found: ${Object.keys(registry).sort().join(', ') || 'none'}.`,
  );
}

const entries = registry.catalog();
if (!Array.isArray(entries) || entries.length === 0) {
  die(`catalog() returned ${Array.isArray(entries) ? 'an empty array' : typeof entries}; refusing to emit an empty catalogue.`);
}

/**
 * The paywall flag is not optional. The Python contract test requires the set of
 * tools carrying it to equal the set declaring `verifica_compra`, so emitting the
 * catalogue without it would let that comparison pass over an absent field --
 * which is the same silent-no-op failure this whole file exists to end.
 */
const missing = entries.filter((e) => typeof e.paywalled !== 'boolean');
if (missing.length) {
  die(
    `catalog() does not report the paywall flag (${missing.length}/${entries.length} entries lack a boolean 'paywalled').\n`
    + `Add it in api/src/tools/index.ts, in CatalogEntry and in catalog():\n`
    + `  export interface CatalogEntry { …; paywalled: boolean }\n`
    + `  return Object.entries(TOOLS).map(([nombre, h]) => ({ …, paywalled: !!h.paywalled }));\n`
    + `Without it the Python side cannot check that the gated tools are the tools that declare verifica_compra.`,
  );
}

const tools = entries
  .map((e) => ({ name: e.nombre, family: e.familia, paywalled: e.paywalled }))
  .sort((a, b) => a.name.localeCompare(b.name));

const names = new Set(tools.map((t) => t.name));
if (names.size !== tools.length) {
  die(`the catalogue contains duplicate tool names (${tools.length} entries, ${names.size} distinct).`);
}

if (process.argv.includes('--names')) {
  for (const t of tools) console.log(t.name);
} else {
  // The session bus caps ride along for the same reason the tool names do:
  // ONTOLOGY.md wants to state them, and a number typed into a document is a
  // second copy that nothing compares. Read from agent-bus.ts, they cannot rot.
  // Absent rather than fabricated if the module stops exporting them.
  let caps = null;
  try {
    const busModule = await import(pathToFileURL(resolve(ROOT, 'api/src/agent-bus.ts')).href);
    caps = busModule.CAPS ?? null;
  } catch {
    caps = null;
  }

  console.log(JSON.stringify({
    source: 'api/src/tools/index.ts',
    read_by: 'import, not regex — see the header of scripts/emit-tool-catalog.mjs',
    count: tools.length,
    paywalled: tools.filter((t) => t.paywalled).map((t) => t.name),
    families: registry.families ? registry.families() : null,
    caps,
    tools,
  }, null, 2));
}
