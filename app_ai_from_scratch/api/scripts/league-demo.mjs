// A test cohort, to SEE the leagues working locally.
//
// It is deliberately NOT in seed.ts: seed.ts runs on every boot, and putting demo
// users there is how you end up with test accounts in production. This is run by
// hand and deleted by hand:
//
//   node --experimental-strip-types api/scripts/league-demo.mjs            creates the cohort
//   node --experimental-strip-types api/scripts/league-demo.mjs --delete   removes it entirely
//
// The flag is needed because this script imports src/db.ts and src/auth.ts
// directly. Every account carries the @liga.demo suffix, so the delete is exact.
import { pool, run, all, get, ready } from '../src/db.ts';
import { hashPassword } from '../src/auth.ts';

// `--borrar` is still accepted so an old shell history keeps working.
const remove = process.argv.includes('--delete') || process.argv.includes('--borrar');
await ready();

if (remove) {
  const r = await run(`DELETE FROM users WHERE email LIKE '%@liga.demo'`);
  console.log(`borradas ${r.rowCount} cuentas de demo (intentos y alias caen en cascada)`);
  await pool.end();
  process.exit(0);
}

const labs = (await all(/** @type {const} */ (`SELECT id FROM labs WHERE draft = 0 ORDER BY id`)))
  .map((/** @type {{id: string}} */ r) => r.id);
if (!labs.length) { console.log('no hay labs escritos'); await pool.end(); process.exit(1); }

// The weekly flow aimed at per person: the thirds split sorts them into
// gold/silver/bronze.
/** @type {[string, string, number, boolean?][]} */
const PEOPLE = [
  ['ana',    'Ana Restrepo',    9],
  ['bruno',  'Bruno Salas',     7],
  ['caro',   'Carolina Diaz',   5],
  ['diego',  'Diego Moreno',    4],
  ['elena',  'Elena Vargas',    2],
  ['fabio',  'Fabio Torres',    1],
  ['gina',   'Gina Ochoa',      0, true],   // finished the course: estado salon
];

// Hashed ONCE, outside the loop: the KDF runs at N=2^17 and costs ~200 ms a call
// (see auth.ts), so seven derivations of the same password would be 1.4 seconds of
// pure waiting. And it is awaited — passing the Promise to pg would store the
// string "[object Promise]" as the hash and none of these accounts could log in.
const hash = await hashPassword('Demo2026*');

for (const [alias, name, flow, all36] of PEOPLE) {
  const email = `${alias}@liga.demo`;
  await run(`INSERT INTO users (email,name,pass_hash,role,paid,cohort)
    VALUES (?,?,?,'student',1,'demo') ON CONFLICT (email) DO NOTHING`,
    [email, name, hash]);
  const u = /** @type {{id: number}} */ (await get('SELECT id FROM users WHERE email = ?', [email]));
  await run(`INSERT INTO ranking_optin (user_id, alias) VALUES (?,?)
    ON CONFLICT (user_id) DO UPDATE SET alias = EXCLUDED.alias`, [u.id, alias]);
  await run('DELETE FROM attempts WHERE user_id = ?', [u.id]);

  // The ones for this week get this week's date; the rest land in an old week, to
  // prove that the flow does NOT count the running total.
  const howMany = all36 ? labs.length : flow;
  for (let i = 0; i < howMany; i++) {
    const old = all36 && i >= 3;      // whoever finished did most of it earlier
    await run(`INSERT INTO attempts (user_id, lab_id, answer, correct, at)
      VALUES (?,?,?,1, (now() AT TIME ZONE 'America/Bogota')
        - (CASE WHEN ? THEN interval '21 days' ELSE interval '2 hours' END))`,
      [u.id, labs[i % labs.length], '"demo"', old]);
    // Plus a second correct attempt TODAY on the same lab: if the flow could be
    // inflated by repeating, this would double it. MIN(at) prevents that.
    if (i === 0) await run(`INSERT INTO attempts (user_id, lab_id, answer, correct)
      VALUES (?,?,?,1)`, [u.id, labs[0], '"repetido"']);
  }
  console.log(`${String(alias).padEnd(7)} caudal objetivo ${String(howMany).padStart(2)}${all36 ? '  (curso terminado)' : ''}`);
}
console.log('\nlisto. para quitarla: node --experimental-strip-types api/scripts/league-demo.mjs --delete');
await pool.end();
