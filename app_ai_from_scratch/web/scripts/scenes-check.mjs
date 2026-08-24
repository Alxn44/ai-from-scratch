#!/usr/bin/env node
/**
 * Every lesson has exactly one animation scene, and every scene belongs to a lesson.
 *
 * WHAT IT CATCHES
 * Nothing else notices these. `astro check` and `tsgo` verify that the code type
 * checks, which it does perfectly well when lesson 13 has no scene at all, or
 * when a scene file is written and never registered, or when a builder is
 * imported and then not put in the table. Each of those ships a lesson that
 * silently falls back to the static rows — the degradation path works, which is
 * exactly why the omission is invisible.
 *
 * WHY THIS ONE PARSES TEXT
 * Everywhere else in this repo a generator reads its source by IMPORTING it,
 * because a regex over source has broken twice here. That is not available here:
 * `web/src/lib/scenes/index.ts` imports its siblings with extensionless
 * specifiers ('./examples-arrive'), which only a bundler resolves — Node answers
 * `Cannot find module`. So this is a text parse by necessity, not by preference,
 * and it fails closed: if the SCENES block cannot be found or cannot be parsed,
 * it reports that as an error instead of concluding that zero scenes are missing.
 *
 * Usage:  node web/scripts/scenes-check.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENES_DIR = resolve(HERE, '../src/lib/scenes');
const INDEX = resolve(SCENES_DIR, 'index.ts');

/** Not lesson scenes: the shared kit, the strings, the registry, the mounter. */
const INFRASTRUCTURE = new Set(['index.ts', 'kit.ts', 'labels.ts', 'mount.ts']);

const problems = [];
const die = (msg) => { console.error(`scenes-check: ${msg}`); process.exit(1); };

let source;
try {
  source = readFileSync(INDEX, 'utf8');
} catch (e) {
  die(`cannot read ${INDEX}: ${e.message}`);
}

// The registry block. Anchored on the declaration and the first `};` at column 0
// after it, so a nested object inside a comment cannot end it early.
const block = /export const SCENES[^=]*=\s*\{([\s\S]*?)^\};/m.exec(source);
if (!block) {
  die(
    'could not find the `export const SCENES … = { … };` block in '
    + 'src/lib/scenes/index.ts. If the registry was renamed or restructured, update '
    + 'this checker — reporting "no problems" after finding no registry would be a '
    + 'guard that inspected nothing.',
  );
}

const registered = new Map();
for (const m of block[1].matchAll(/^\s*(\d+)\s*:\s*(\w+)\s*,/gm)) {
  const n = Number(m[1]);
  if (registered.has(n)) problems.push(`lesson ${n} is registered twice`);
  registered.set(n, m[2]);
}

if (registered.size === 0) {
  die('the SCENES block was found but no `<number>: <builder>,` entries parsed out of it.');
}

// Which builders index.ts actually imports, and from which file.
//
// The local binding is what SCENES refers to, so an aliased import has to
// resolve to its alias: every scene here is written
// `import { scene as dialsSettle } from './dials-settle'`, and reading that as a
// binding called "scene as dialsSettle" reported all 12 lessons broken and all 12
// files orphaned at once. A checker whose first run indicts everything is
// almost always wrong about the code and right about itself.
const imported = new Map();
const localName = (spec) => {
  const aliased = /^(\w+)\s+as\s+(\w+)$/.exec(spec.trim());
  return aliased ? aliased[2] : spec.trim();
};

for (const m of source.matchAll(/import\s+(\w+)\s+from\s+'\.\/([\w-]+)'/g)) imported.set(m[1], m[2]);
for (const m of source.matchAll(/import\s*(?:type\s+)?\{([^}]+)\}\s*from\s+'\.\/([\w-]+)'/g)) {
  for (const spec of m[1].split(',')) {
    const name = localName(spec);
    if (name) imported.set(name, m[2]);
  }
}

const sceneFiles = readdirSync(SCENES_DIR)
  .filter((f) => f.endsWith('.ts') && !INFRASTRUCTURE.has(f))
  .map((f) => f.replace(/\.ts$/, ''));

// 1. Contiguous from 1. A gap means a lesson quietly has no animation.
const numbers = [...registered.keys()].sort((a, b) => a - b);
const highest = numbers[numbers.length - 1];
for (let n = 1; n <= highest; n++) {
  if (!registered.has(n)) problems.push(`lesson ${n} has no scene registered (gap in 1..${highest})`);
}
if (numbers[0] !== 1) problems.push(`the registry starts at ${numbers[0]}, not 1`);

// 2. Every registered builder is actually imported.
for (const [n, builder] of registered) {
  if (!imported.has(builder)) {
    problems.push(`lesson ${n} is registered as \`${builder}\`, which index.ts never imports`);
  }
}

// 3. Every scene file is used. An orphan is a scene somebody wrote and forgot to
//    wire up — the failure that looks like nothing at all.
const usedFiles = new Set([...registered.values()].map((b) => imported.get(b)).filter(Boolean));
for (const file of sceneFiles) {
  if (!usedFiles.has(file)) problems.push(`${file}.ts is never registered in SCENES (orphan scene)`);
}

// 4. Nothing imported from a SCENE file but left out of the table. Restricted to
//    scene files on purpose: index.ts also imports types from kit.ts, and those
//    are not builders — counting them made this check indict `Example` and
//    `SceneBuilder` for not being lessons.
const sceneFileSet = new Set(sceneFiles);
const builders = new Set(registered.values());
for (const [name, file] of imported) {
  if (sceneFileSet.has(file) && !builders.has(name)) {
    problems.push(`\`${name}\` (from ${file}.ts) is imported but not in SCENES`);
  }
}

console.log(`scenes: ${registered.size} registered, ${sceneFiles.length} scene files`);

if (problems.length) {
  console.error();
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\n${problems.length} problem(s). A lesson with no scene still renders — it`);
  console.error('falls back to the static rows and nothing errors, which is why this check exists.');
  process.exit(1);
}

console.log(`ok: lessons 1..${highest} each have exactly one scene, and no scene file is orphaned.`);
