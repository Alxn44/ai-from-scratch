// La cola de trabajos. Sin red y sin servidor: solo Postgres.
import { strict as A } from 'node:assert';
import { all, migrate, run } from '../src/db.js';
import { MAX_INTENTOS, corre, encola, espera, estadoCola, registra, tomaLote } from '../src/trabajos.js';

let ok = 0, fallos = 0;
const prueba = (n, fn) => { try { fn(); console.log(`  ok   · ${n}`); ok++; }
  catch (e) { console.log(`  FALLA· ${n}\n         ${e instanceof Error ? e.message : String(e)}`); fallos++; } };
const mudo = { error() {}, warn() {} };

await migrate();
await run(`DELETE FROM jobs WHERE tipo LIKE 'test.%'`);

console.log('\ncola de trabajos');

// --- idempotencia por clave ---
const a = await encola('test.uno', { x: 1 }, 'k1');
const b = await encola('test.uno', { x: 1 }, 'k1');
prueba('el primer encolado es nuevo', () => A.equal(a.nuevo, true));
prueba('el segundo con la misma clave no duplica', () => A.equal(b.nuevo, false));
const filas = await all(`SELECT id FROM jobs WHERE tipo = 'test.uno' AND clave = 'k1'`);
prueba('en la tabla hay UN trabajo, no dos', () => A.equal(filas.length, 1));

// --- se ejecuta y termina ---
let vistos = [];
registra('test.uno', async (d) => { vistos.push(d); });
const r1 = await corre(10, mudo);
prueba('el trabajo se ejecuta', () => A.deepEqual(vistos, [{ x: 1 }]));
prueba('queda hecho, no pendiente', () => A.equal(r1.hechos, 1));
const hecho = await all(`SELECT estado, intentos FROM jobs WHERE clave = 'k1'`);
prueba('el estado es hecho con 1 intento', () => {
  A.equal(hecho[0].estado, 'hecho'); A.equal(hecho[0].intentos, 1);
});
const r2 = await corre(10, mudo);
prueba('la segunda pasada no toma nada', () => A.equal(r2.tomados, 0));

// --- SKIP LOCKED: dos obreros no se pisan ---
// Hay que registrar el tipo: desde que el obrero solo toma lo que sabe ejecutar,
// tomaLote() filtra por manejador. Sin este registro tomaria 0 — que es
// exactamente el comportamiento que se quiere en un despliegue rodado.
registra('test.carrera', async () => {});
await run(`DELETE FROM jobs WHERE tipo LIKE 'test.%'`);
for (let i = 0; i < 12; i++) await encola('test.carrera', { i }, `c${i}`);
const [l1, l2] = await Promise.all([tomaLote(6), tomaLote(6)]);
const ids = [...l1, ...l2].map((j) => j.id);
prueba('dos obreros simultaneos toman 12 trabajos entre los dos', () => A.equal(ids.length, 12));
prueba('ningun trabajo lo toman los dos (SKIP LOCKED)', () =>
  A.equal(new Set(ids).size, 12));

// --- reintentos con espera exponencial ---
await run(`DELETE FROM jobs WHERE tipo LIKE 'test.%'`);
prueba('la espera crece y tiene techo', () => {
  A.deepEqual([1, 2, 3, 4, 5, 6, 9].map(espera), [2, 8, 32, 128, 512, 1024, 1024]);
});
let intentos = 0;
registra('test.falla', async () => { intentos++; throw new Error('la pasarela no responde'); });
await encola('test.falla', {}, 'f1');
const r3 = await corre(10, mudo);
prueba('un fallo no se pierde: se reprograma', () => A.equal(r3.fallos, 1));
const rep = await all(`SELECT estado, intentos, error, corre_en > now() AS futuro FROM jobs WHERE clave = 'f1'`);
prueba('vuelve a pendiente con el error anotado', () => {
  A.equal(rep[0].estado, 'pendiente');
  A.equal(rep[0].intentos, 1);
  A.match(rep[0].error, /pasarela/);
});
prueba('y no se reintenta inmediatamente (espera en el futuro)', () => A.equal(rep[0].futuro, true));
const r4 = await corre(10, mudo);
prueba('mientras espera, el obrero no lo toma', () => A.equal(r4.tomados, 0));

// --- muere tras MAX_INTENTOS y NO se borra ---
await run(`UPDATE jobs SET intentos = ${MAX_INTENTOS - 1}, corre_en = now() WHERE clave = 'f1'`);
const r5 = await corre(10, mudo);
prueba(`muere al llegar a ${MAX_INTENTOS} intentos`, () => A.equal(r5.muertos, 1));
const muerto = await all(`SELECT estado, error FROM jobs WHERE clave = 'f1'`);
prueba('el trabajo muerto se CONSERVA (un pago perdido sin rastro es peor)', () => {
  A.equal(muerto.length, 1); A.equal(muerto[0].estado, 'muerto');
});

// --- un tipo sin manejador NO se toma (y por eso no se pierde) ---
await encola('test.huerfano', {}, 'h1');
const r6 = await corre(10, mudo);
prueba('un tipo sin manejador no se toma', () => A.equal(r6.tomados, 0));
const huerf = await all(`SELECT estado FROM jobs WHERE clave = 'h1'`);
prueba('se queda pendiente, no muerto: otra instancia puede saber hacerlo', () =>
  A.equal(huerf[0].estado, 'pendiente'));
const estH = await estadoCola();
prueba('y estadoCola lo cuenta como huerfano para que no sea invisible', () =>
  A.equal(estH.huerfanos['test.huerfano'], 1));

// --- el estado de la cola es legible ---
const est = await estadoCola();
prueba('estadoCola cuenta por estado', () => A.ok(est.por.muerto >= 1));
prueba('estadoCola lista los manejadores registrados en este proceso', () => {
  // 'pago.mercadopago' lo registra src/server.js, que este test NO importa a
  // proposito (importarlo abriria un puerto). Aqui se comprueban los de la prueba.
  for (const t of ['test.uno', 'test.falla']) A.ok(est.manejadores.includes(t), t);
});

await run(`DELETE FROM jobs WHERE tipo LIKE 'test.%'`);
console.log(fallos ? `\n${fallos} fallo(s) de ${ok + fallos}` : `\nsin fallos (${ok} comprobaciones)`);
process.exit(fallos ? 1 : 0);
