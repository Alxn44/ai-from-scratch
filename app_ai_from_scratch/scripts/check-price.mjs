#!/usr/bin/env node
/**
 * Fails when the advertised price and the charged price disagree.
 *
 * WHY THIS EXISTS
 * The price lived in five places at once: `PRICE_CENTS = 999` in payments/src/db.ts,
 * two `9.99` literals in payments/src/mercadopago.ts, `PRECIO = '9.99'` in
 * web/src/lib/site.ts, `monto: 9.99` in api/src/product.ts (what the agent QUOTES to
 * a student), and about seventy strings of copy. Moving to COP touched every one of
 * them, and the failure mode of missing one is not a crash — it is a landing page
 * advertising one number while the checkout charges another. Nothing turns red.
 *
 * Worse, the conversion to the provider's amount was a hand-written `/ 100` in two
 * files. `cents` and `minor unit` were the same thing only because USD has two
 * decimals; COP has none. Writing 35000 where 999 was and leaving the divisions
 * charges 350 pesos, silently, with no error anywhere.
 *
 * WHY A COPY IS ALLOWED AT ALL
 * `payments/` and `web/` are separate packages with separate installs, so web cannot
 * import across the boundary at build time. The copy is unavoidable; the drift is
 * not. This is the same shape as check-ontology-drift.mjs: the duplicate is
 * tolerated because a gate compares it to the source of truth on every run.
 *
 * WHAT IT PROVES
 *   1. payments (charged) == web (advertised) == api/product.ts (quoted by the agent)
 *      on amount, currency and decimal exponent.
 *   2. No copy anywhere still names the OLD price or the OLD currency. This is the
 *      half that actually catches human error: constants are easy to move, and
 *      seventy strings of marketing are not.
 *
 * Usage:  node --experimental-strip-types scripts/check-price.mjs
 * Exit 0 = one price, everywhere. Exit 1 = drift or stale copy, listed.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => relative(ROOT, p);

const problems = [];
const note = (msg) => problems.push(msg);

// ---------------------------------------------------------------------------
// 1. The three declarations, read by IMPORTING them. A regex over the source is
//    what house rule 4 forbids: it has gone dark twice here while staying green.
// ---------------------------------------------------------------------------
const pay = await import(join(ROOT, 'payments/src/price.ts'));
const web = await import(join(ROOT, 'web/src/lib/price.ts'));
const api = await import(join(ROOT, 'api/src/product.ts'));

const CHARGED = { amount: pay.PRICE_MINOR, currency: pay.CURRENCY, decimals: pay.DECIMALS };
const ADVERTISED = { amount: web.PRECIO_MENOR, currency: web.MONEDA, decimals: web.DECIMALES };
const QUOTED = { amount: api.PRICE.monto * 10 ** pay.DECIMALS, currency: api.PRICE.moneda,
  decimals: pay.DECIMALS };

for (const [what, got] of [['web/src/lib/price.ts (advertised)', ADVERTISED],
                           ['api/src/product.ts (quoted by the agent)', QUOTED]]) {
  for (const field of ['amount', 'currency', 'decimals']) {
    if (got[field] !== CHARGED[field]) {
      note(`${what}: ${field} is ${JSON.stringify(got[field])}, but payments/src/price.ts `
        + `charges ${JSON.stringify(CHARGED[field])}.`);
    }
  }
}

// The provider amount is the number that leaves for Mercado Pago. Assert the
// identity the `/100` removal rests on, rather than trusting it.
const sent = pay.providerAmount(pay.PRICE_MINOR);
const expected = pay.DECIMALS === 0 ? pay.PRICE_MINOR : pay.PRICE_MINOR / 10 ** pay.DECIMALS;
if (sent !== expected) {
  note(`providerAmount(${pay.PRICE_MINOR}) returned ${sent}, expected ${expected}. `
    + `This is the number Mercado Pago charges.`);
}
// A currency with no decimals must not be divided. This is the 350-vs-35.000 bug.
if (pay.DECIMALS === 0 && sent !== pay.PRICE_MINOR) {
  note(`${pay.CURRENCY} has no decimals, so providerAmount must be the identity. `
    + `It returned ${sent} for ${pay.PRICE_MINOR}: the charge is off by a factor of `
    + `${pay.PRICE_MINOR / sent}.`);
}

// ---------------------------------------------------------------------------
// 2. Stale copy. Currencies and amounts the product does NOT sell in must not
//    appear in user-facing text. `payments/` is excluded: its comments discuss
//    the old USD price on purpose, and its stored rows keep the USD they were
//    actually charged in.
// ---------------------------------------------------------------------------
const COPY_DIRS = ['web/src', 'api/src'];
const COPY_EXT = new Set(['.ts', '.tsx', '.astro', '.mts', '.json']);
const SKIP_FILES = new Set(['api/src/ontologia.json', 'api/src/ontology.json']);

/** Old prices and currencies. Add a row when the price moves; never remove one. */
const STALE = [
  { pattern: /\b9\.99\b/, what: 'the old price 9.99' },
  { pattern: /\bUSD\b/, what: "the old currency 'USD'" },
  { pattern: /\$49\b/, what: 'the old $49 anchor' },
  { pattern: /\b(total|discount|price)Cents\b/i, what: 'a *Cents field name (COP has no cents)' },
];

/**
 * Strips comments so history can be documented without failing the gate.
 *
 * The comments in these files name the OLD price on purpose -- they exist to say why
 * the *Cents fields were renamed and what the `/100` used to charge. Matching them
 * would make the honest explanation the thing that breaks the build.
 *
 * It is a small lexer, not a parser: it tracks block comments and the three quote
 * kinds, and cuts a `//` only outside a quote. A `//` inside an unterminated template
 * literal would cut the rest of that LINE, which loses coverage on that line's tail
 * rather than reporting a wrong result. Templates spanning lines are the known blind
 * spot; the constants check above does not depend on this.
 */
function stripComments(source) {
  const out = [];
  let inBlock = false;
  for (const line of source.split('\n')) {
    let kept = '';
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i], next = line[i + 1];
      if (inBlock) { if (c === '*' && next === '/') { inBlock = false; i++; } continue; }
      if (quote) { if (c === '\\') { i++; continue; } if (c === quote) quote = null; kept += c; continue; }
      if (c === '/' && next === '*') { inBlock = true; i++; continue; }
      if (c === '/' && next === '/') break;                      // line comment
      if (c === '"' || c === "'" || c === '`') { quote = c; kept += c; continue; }
      kept += c;
    }
    out.push(kept);
  }
  return out;
}

/**
 * `.astro` is two languages in one file: a `---` fenced JavaScript frontmatter and a
 * template that is HTML. Only the frontmatter gets the JavaScript comment stripper;
 * the template is scanned raw except for `<!-- -->`, because an HTML attribute can
 * legitimately contain `//` and cutting there would blind the scan to the rest of a
 * line that is almost always the whole markup.
 */
function stripAstro(source) {
  const lines = source.split('\n');
  const fences = lines.reduce((acc, l, i) => (l.trim() === '---' && acc.length < 2 ? [...acc, i] : acc), []);
  if (fences.length < 2) return stripComments(source);
  const [open, close] = fences;
  const head = stripComments(lines.slice(open + 1, close).join('\n'));
  // Dentro de `<script>` el cuerpo ES JavaScript, asi que ahi si vale el stripper
  // de `//`: es donde vive el codigo de cliente, y por tanto donde un comentario
  // explicando el precio viejo es mas probable.
  const body = [];
  let inScript = false;
  for (const raw of lines.slice(close + 1)) {
    const line = raw.replace(/<!--[\s\S]*?-->/g, '');
    if (/<script[\s>]/.test(line)) { inScript = true; body.push(line); continue; }
    if (/<\/script>/.test(line)) { inScript = false; body.push(line); continue; }
    body.push(inScript ? stripComments(line)[0] : line);
  }
  // Padding keeps the reported line numbers pointing at the real file.
  return [...Array(open + 1).fill(''), ...head, '', ...body];
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...walk(full)); continue; }
    if (COPY_EXT.has(extname(full))) out.push(full);
  }
  return out;
}

for (const dir of COPY_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    if (SKIP_FILES.has(rel(file))) continue;
    // `.astro` lleva HTML, donde `<!-- -->` es el comentario y `//` no lo es. El
    // stripper es de JavaScript, asi que en .astro solo se le pasa el frontmatter
    // y el resto se mira crudo: un `//` dentro de un atributo de estilo no debe
    // borrar la linea entera.
    const raw = readFileSync(file, 'utf8');
    const lines = extname(file) === '.astro'
      ? stripAstro(raw)
      : stripComments(raw);
    lines.forEach((line, i) => {
      for (const { pattern, what } of STALE) {
        if (pattern.test(line)) {
          note(`${rel(file)}:${i + 1} still names ${what}: ${line.trim().slice(0, 110)}`);
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------
const label = `${CHARGED.amount} ${CHARGED.currency} (${CHARGED.decimals} decimals)`;
if (!problems.length) {
  console.log(`ok: ${label} — charged, advertised and quoted by the agent, all three agree,`);
  console.log(`    and no copy under ${COPY_DIRS.join(' / ')} names a price the product does not sell.`);
  process.exit(0);
}

console.log(`price: payments charges ${label}`);
console.log();
for (const p of problems) console.log(`  ${p}`);
console.log();
console.log(`${problems.length} finding(s).`);
console.log();
console.log(`The price is declared in THREE files, on purpose — separate packages cannot`);
console.log(`import across the boundary. Change payments/src/price.ts first (it is what`);
console.log(`Mercado Pago is told), then match web/src/lib/price.ts and api/src/product.ts.`);
console.log(`Copy findings are strings a human has to rewrite; there is no constant to move.`);
process.exit(1);
