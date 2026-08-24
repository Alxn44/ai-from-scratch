/**
 * A stand-in for api/src/db.ts that keeps rows in memory instead of Postgres.
 *
 * WHY IT EXISTS. `scripts/emit-search-baseline.mjs` has to run the REAL
 * `buscar_en_curso` over the REAL corpus, on a laptop with nothing running. The
 * corpus lives in api/src/seed.ts (lesson rows and lab statements) and
 * api/src/content.ts (the teaching text), and the only way to read it without
 * transcribing it is to let the seed script run and record what it would have
 * written. So this module answers the seed's INSERTs by remembering them, and
 * answers the tool's SELECTs out of that memory.
 *
 * It is substituted for `db.ts` by scripts/lib/db-swap-loader.mjs, so api's own
 * modules are imported unmodified: nothing in api/src knows this file exists.
 *
 * IT FAILS CLOSED, LOUDLY. This is a fake, and a fake that quietly answers `[]`
 * to a query it did not understand would report a baseline of zero hits and look
 * like a measurement. Every unsupported table, statement or clause THROWS, so the
 * emitter exits 1 with the SQL it could not answer rather than printing a number
 * nobody can trust. The one thing it may never do is guess.
 *
 * WHAT IT DOES NOT DO: connect, authenticate, or write anything to disk. There is
 * no `pg` import here at all, which is what makes «this cannot reach a database»
 * a property of the file rather than a promise in a comment.
 */

/** table -> rows, in insertion order. Populated by run(); read by all()/get(). */
export const tables = Object.create(null);

/**
 * Columns Postgres would fill in that an INSERT may leave out. Only the ones the
 * search reads: `lessons.technical` and `lessons.analogy` are `DEFAULT ''` in
 * api/prisma/schema.prisma and api/src/seed.ts never writes them, so in the real
 * database they are empty strings — which is exactly what the search counts over.
 * Leaving them `undefined` would work by accident (`String(undefined ?? '')`); it
 * is written down instead, because «works by accident» is how a fake starts lying.
 */
const DEFAULTS = {
  lessons: { technical: '', analogy: '' },
};

const fail = (what, sql) => {
  throw new Error(`db-memory: ${what}\n  SQL: ${String(sql).replace(/\s+/g, ' ').trim()}`);
};

const tableOf = (sql, re, what) => {
  const m = re.exec(sql);
  if (!m) fail(what, sql);
  return m[1].toLowerCase();
};

/** INSERT INTO t (a,b,c) VALUES (?,?,?) — the shape api/src/seed.ts writes. */
export const run = async (sql, params = []) => {
  const text = String(sql);
  if (!/^\s*insert\s+into/i.test(text)) {
    fail('only INSERT is supported; this fake is for reading a seeded corpus back', text);
  }
  const table = tableOf(text, /insert\s+into\s+([a-z_][a-z0-9_]*)/i, 'unreadable INSERT target');
  const cols = /\(([^)]*)\)\s*values/i.exec(text);
  if (!cols) fail('INSERT without an explicit column list', text);
  const names = cols[1].split(',').map((c) => c.trim());
  if (names.length !== params.length) {
    fail(`INSERT names ${names.length} column(s) and got ${params.length} parameter(s)`, text);
  }
  const row = { ...(DEFAULTS[table] ?? {}) };
  names.forEach((n, i) => { row[n] = params[i]; });
  (tables[table] ??= []).push(row);
  return { rowCount: 1, rows: [] };
};

const ORDERABLE = /^[a-z_][a-z0-9_]*$/;

/** SELECT ... FROM t [WHERE lang = ?] [ORDER BY c[, c]] — the shapes the search issues. */
export const all = async (sql, params = []) => {
  const text = String(sql);
  if (!/^\s*select/i.test(text)) fail('only SELECT is supported', text);
  const table = tableOf(text, /from\s+([a-z_][a-z0-9_]*)/i, 'unreadable SELECT source');
  const rows = tables[table];
  if (rows === undefined) {
    fail(`nothing was seeded into «${table}», so answering this would invent an empty corpus`,
         text);
  }
  let out = [...rows];

  const where = /\bwhere\b(.*?)(?:\border\s+by\b|$)/is.exec(text);
  if (where) {
    const clause = where[1].trim();
    const lang = /^lang\s*=\s*\?$/i.exec(clause);
    if (!lang) fail(`unsupported WHERE clause «${clause}»`, text);
    if (params.length !== 1) fail('WHERE lang = ? needs exactly one parameter', text);
    out = out.filter((r) => String(r.lang) === String(params[0]));
  } else if (params.length) {
    fail(`${params.length} parameter(s) for a statement with no WHERE clause`, text);
  }

  const order = /\border\s+by\s+(.+?)\s*$/is.exec(text);
  if (order) {
    const keys = order[1].split(',').map((k) => k.trim());
    if (!keys.every((k) => ORDERABLE.test(k))) {
      fail(`unsupported ORDER BY «${order[1].trim()}»`, text);
    }
    out.sort((a, b) => {
      for (const k of keys) {
        const x = a[k], y = b[k];
        if (x === y) continue;
        return Number(x) - Number(y) || String(x).localeCompare(String(y));
      }
      return 0;
    });
  }
  return out;
};

export const get = async (sql, params = []) => (await all(sql, params))[0] ?? null;

// The rest of db.ts's surface, so importing modules resolve. Each one refuses
// rather than pretending: a caller that needs a migration or a live pool is a
// caller this fake cannot serve, and saying so is the whole point.
export const migrate = async () => {};
export const ready = async () => {};
export const close = async () => {};
export const pool = {
  end: async () => {},
  query: () => { throw new Error('db-memory: pool.query() is not available; use all/get/run.'); },
};
