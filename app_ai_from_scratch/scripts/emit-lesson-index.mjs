#!/usr/bin/env node
/**
 * Prints the PUBLIC lesson index as JSON, read from api's own modules.
 *
 * WHY THIS EXISTS
 * `ai/src/course_ai/retrieval/concepts.py` is a curated map from the words a
 * beginner TYPES to the lesson NUMBER that answers them. That map is only worth
 * anything if the numbers in it are the numbers Node can actually serve, and the
 * glossary terms in it are terms `glosario` actually knows. A hand-typed second
 * copy of the lesson list is the drift bug this repository has fought all the way
 * through v3, so the check fetches the index instead of trusting a transcription:
 * `ai-check-concepts` runs this and refuses when the two disagree.
 *
 * It is the same shape as scripts/emit-tool-catalog.mjs and for the same reason:
 * the output cannot drift from the code because it IS the code. Rename a constant,
 * add a glossary entry, move a term to another lesson — this prints the new answer
 * and the Python gate goes red on the stale map.
 *
 * WHAT IT MAY PRINT, and why the shape is this narrow.
 * Lesson NUMBERS and glossary TERMS. No titles, no summaries, no prose. Two
 * reasons, and the second is the load-bearing one:
 *
 *   1. The concept map stores lesson numbers only. Anything the model must SEE
 *      about a lesson beyond its number is fetched at call time from the bridged
 *      `curso_indice`, which is `publico` and returns identical bytes for a free
 *      and a paid account. Printing titles here would create the second copy.
 *   2. `lessons.technical`, `lessons.analogy`, `lesson_text.*` and `labs.prompt`
 *      are `muro: de_pago`. An emitter that can only print integers and glossary
 *      keys CANNOT emit paid prose, whatever it is pointed at later. That is a
 *      structural guarantee rather than a promise in a comment.
 *
 * WHERE THE NUMBERS COME FROM, and why not from the database.
 * `TOTAL_LESSONS` in api/src/tools/access.ts — the constant the registry itself
 * uses to build `readableLessons()` and to report `cerradas` in
 * `buscar_en_curso`. It is api's own answer to «how many lessons exist», and it
 * is imported, not read off a page.
 *
 * The obvious alternative is to call `curso_indice.fn()` and let Postgres answer.
 * Rejected: that makes `pnpm verify` need a live database, and a gate that cannot
 * run without infrastructure is a gate that gets skipped — which in this
 * repository is the failure mode, not the inconvenience. `ai-check-concepts`
 * refuses loudly when it cannot read this index; it must be readable on a laptop
 * with nothing running. The runtime half of the same guarantee is not skipped
 * either: `entender_pregunta` re-checks every routed lesson number against the
 * live `curso_indice` response on every single call, so a map that agrees with
 * this constant and disagrees with the database is caught in the session.
 *
 * WHY A DUMMY DSN: importing access.ts pulls in db.ts, which refuses to load
 * without a DATABASE_URL. Nothing here opens a connection (pg builds its pool
 * lazily and we only read constants), so an undialable DSN is both narrower than
 * NODE_ENV=development — which also makes auth.ts mint an ephemeral JWT secret —
 * and more honest about what this script does.
 *
 * Usage:   node --experimental-strip-types scripts/emit-lesson-index.mjs
 * Exit 0 with the index. Exit 1, with a reason, rather than a partial one.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACCESS = resolve(ROOT, 'api/src/tools/access.ts');
const PRODUCT = resolve(ROOT, 'api/src/product.ts');

process.env.DATABASE_URL ??= 'postgres://lesson-index-emitter-never-connects/none';

const die = (msg) => { console.error(`emit-lesson-index: ${msg}`); process.exit(1); };

const load = async (path) => {
  try {
    return await import(pathToFileURL(path).href);
  } catch (err) {
    die(
      `could not import ${path.slice(ROOT.length + 1)}:\n  ${err.message}\n`
      + `This script needs Node's type stripping. On Node 22 run it as:\n`
      + `  node --experimental-strip-types scripts/emit-lesson-index.mjs`,
    );
  }
};

const access = await load(ACCESS);
const product = await load(PRODUCT);

const total = access.TOTAL_LESSONS;
if (!Number.isInteger(total) || total <= 0) {
  die(
    `api/src/tools/access.ts does not export a usable TOTAL_LESSONS (got ${JSON.stringify(total)}). `
    + `It is how this script knows how many lessons exist; guessing one would defeat the check.`,
  );
}

if (typeof product.terms !== 'function' || !Array.isArray(product.GLOSSARY)) {
  die(
    `api/src/product.ts must export GLOSSARY and terms(); exports found: `
    + `${Object.keys(product).sort().join(', ') || 'none'}. Without them the concept map's `
    + `glossary terms cannot be checked against the ones \`glosario\` really answers with.`,
  );
}

// `terms()` is what the bridged `glosario` returns when called with no argument.
// Reading THAT function, and not GLOSSARY directly, means the emitted list is the
// list the model is shown.
const termList = product.terms();
if (!Array.isArray(termList) || termList.length === 0
    || termList.some((t) => typeof t !== 'string' || !t)) {
  die(`terms() did not return a non-empty list of strings; refusing to emit an empty glossary.`);
}
if (new Set(termList).size !== termList.length) {
  die(`terms() returned duplicate terms (${termList.length} entries, ${new Set(termList).size} distinct).`);
}

// term -> lesson number, so the gate can also catch a term pinned to the wrong
// lesson, not just a term that does not exist.
const perTerm = {};
// alias -> canonical term. The aliases are the only place the ENGLISH side of a
// term exists (`hallucination`, `temperature`, `knob`, `context window`), and
// `glossaryFor()` matches against them exactly like against the term itself, so
// they are public glossary data by the same definition. The concept map's
// `terms_en` are validated against this map, which is why it has to travel:
// checking them against the Spanish `terms()` list alone would either reject
// every English term or, worse, invite the map to invent its own.
const alias = {};
for (const g of product.GLOSSARY) {
  if (typeof g?.termino !== 'string' || !Number.isInteger(g?.leccion)) {
    die(`a GLOSSARY entry has no «termino»/«leccion» pair: ${JSON.stringify(g)}.`);
  }
  if (g.leccion < 1 || g.leccion > total) {
    die(`GLOSSARY term «${g.termino}» points at lesson ${g.leccion}, outside 1..${total}.`);
  }
  perTerm[g.termino] = g.leccion;
  for (const a of Array.isArray(g.alias) ? g.alias : []) {
    if (typeof a !== 'string' || !a) die(`GLOSSARY term «${g.termino}» has a non-string alias.`);
    // An alias that means two different lessons would make routing ambiguous by
    // construction, and the map would inherit the ambiguity silently.
    if (a in alias && alias[a] !== g.termino) {
      die(`the alias «${a}» belongs to both «${alias[a]}» and «${g.termino}».`);
    }
    alias[a] = g.termino;
  }
}
if (Object.keys(perTerm).length !== termList.length) {
  die(
    `terms() lists ${termList.length} term(s) and GLOSSARY yields ${Object.keys(perTerm).length} `
    + `«termino» key(s). A payload that disagrees with itself cannot be compared against anything.`,
  );
}

const lecciones = [];
for (let n = 1; n <= total; n++) lecciones.push({ n });

console.log(JSON.stringify({
  source: 'api/src/tools/access.ts (TOTAL_LESSONS) + api/src/product.ts (terms, GLOSSARY)',
  read_by: 'import, not regex — see the header of scripts/emit-lesson-index.mjs',
  publico: 'lesson numbers and glossary terms only. No title, no summary, no prose: nothing '
    + 'behind `muro: de_pago` can reach this file.',
  count: lecciones.length,
  lecciones,
  glosario: termList,
  glosario_lecciones: perTerm,
  glosario_alias: alias,
}, null, 2));
