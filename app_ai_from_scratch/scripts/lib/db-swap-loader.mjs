/**
 * A Node module-resolution hook that points every `db.ts` import at
 * scripts/lib/db-memory.mjs.
 *
 * WHY A LOADER AND NOT AN EDIT. `scripts/emit-search-baseline.mjs` needs to run
 * api's OWN `buscar_en_curso` over api's OWN corpus with no database. The
 * alternative to this hook is a second copy of the scorer or a second copy of the
 * corpus inside the emitter, and a hand-typed copy standing in for the source of
 * truth is the exact defect the emitter exists to remove. With the swap, api/src
 * is imported unmodified and unaware.
 *
 * WHAT IT SWAPS: a specifier whose final segment is `db.ts`, and nothing else. It
 * is deliberately not a pattern over `*.ts`: the point is to replace the one
 * module that opens a socket, and leaving everything else alone is what keeps the
 * measurement a measurement of the real code.
 */

const MEMORY = new URL('./db-memory.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (/(^|[./])db\.ts$/.test(specifier)) {
    // Only api's own relative imports. An absolute or bare specifier called
    // `db.ts` would be somebody else's module and swapping it would be a
    // surprise rather than a substitution.
    if (specifier.startsWith('.')) return { url: MEMORY, shortCircuit: true, format: 'module' };
  }
  return next(specifier, context);
}
