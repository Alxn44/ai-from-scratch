// Cohorte de prueba para VER las ligas funcionando en local.
//
// NO va en seed.js a proposito: seed.js corre en cada arranque, y meter usuarios
// de demo ahi es como se acaba con cuentas de prueba en produccion. Esto se
// ejecuta a mano y se borra a mano:
//
//   node api/scripts/liga-demo.mjs         crea la cohorte
//   node api/scripts/liga-demo.mjs --borrar  la quita entera
//
// Todas las cuentas llevan el sufijo @liga.demo, asi que el borrado es exacto.
import { pool, run, all, get, ready } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const borrar = process.argv.includes('--borrar');
await ready();

if (borrar) {
  const r = await run(`DELETE FROM users WHERE email LIKE '%@liga.demo'`);
  console.log(`borradas ${r.rowCount} cuentas de demo (intentos y alias caen en cascada)`);
  await pool.end();
  process.exit(0);
}

const labs = (await all(`SELECT id FROM labs WHERE draft = 0 ORDER BY id`)).map((r) => r.id);
if (!labs.length) { console.log('no hay labs escritos'); await pool.end(); process.exit(1); }

// caudal buscado por persona: la reparticion en tercios los ordena en oro/plata/bronce
const GENTE = [
  ['ana',    'Ana Restrepo',    9],
  ['bruno',  'Bruno Salas',     7],
  ['caro',   'Carolina Diaz',   5],
  ['diego',  'Diego Moreno',    4],
  ['elena',  'Elena Vargas',    2],
  ['fabio',  'Fabio Torres',    1],
  ['gina',   'Gina Ochoa',      0, true],   // termino el curso: estado salon
];

for (const [alias, nombre, caudal, todo] of GENTE) {
  const email = `${alias}@liga.demo`;
  await run(`INSERT INTO users (email,name,pass_hash,role,paid,cohort)
    VALUES (?,?,?,'student',1,'demo') ON CONFLICT (email) DO NOTHING`,
    [email, nombre, hashPassword('Demo2026*')]);
  const u = await get('SELECT id FROM users WHERE email = ?', [email]);
  await run(`INSERT INTO ranking_optin (user_id, alias) VALUES (?,?)
    ON CONFLICT (user_id) DO UPDATE SET alias = EXCLUDED.alias`, [u.id, alias]);
  await run('DELETE FROM attempts WHERE user_id = ?', [u.id]);

  // Los de esta semana entran con fecha de esta semana; el resto quedan en una
  // semana vieja, para probar que el caudal NO cuenta el acumulado.
  const cuantos = todo ? labs.length : caudal;
  for (let i = 0; i < cuantos; i++) {
    const viejo = todo && i >= 3;      // quien termino lo hizo casi todo antes
    await run(`INSERT INTO attempts (user_id, lab_id, answer, correct, at)
      VALUES (?,?,?,1, (now() AT TIME ZONE 'America/Bogota')
        - (CASE WHEN ? THEN interval '21 days' ELSE interval '2 hours' END))`,
      [u.id, labs[i % labs.length], '"demo"', viejo]);
    // y un segundo intento correcto HOY del mismo lab: si el caudal se pudiera
    // inflar repitiendo, esto lo duplicaria. MIN(at) lo impide.
    if (i === 0) await run(`INSERT INTO attempts (user_id, lab_id, answer, correct)
      VALUES (?,?,?,1)`, [u.id, labs[0], '"repetido"']);
  }
  console.log(`${alias.padEnd(7)} caudal objetivo ${String(cuantos).padStart(2)}${todo ? '  (curso terminado)' : ''}`);
}
console.log('\nlisto. para quitarla: node api/scripts/liga-demo.mjs --borrar');
await pool.end();
