// Intenta sacarle a las herramientas datos de OTRO usuario. Si algo de esto pasa,
// el agente no se puede publicar.
import { all, get, run, pool } from '../src/db.js';
import { ejecutar, catalogo } from '../src/agent-tools.js';

let fallos = 0;
const ok = (t) => console.log('  ok   ·', t);
const mal = (t, extra) => { fallos++; console.log('  MAL  ·', t, extra ? '\n         ' + extra : ''); };

// --- preparar: la víctima deja un rastro reconocible -----------------------
const VICTIMA = 'RESPUESTA-SECRETA-DE-PAULA';
await run('DELETE FROM attempts WHERE user_id = 2');
await run('INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES (2, ?, ?, 1)', ['5.1', JSON.stringify(VICTIMA)]);

const paula = await get('SELECT id, email, name, pass_hash FROM users WHERE id = 2');
const soluciones = (await all('SELECT id, solution FROM labs')).map((r) => r.solution);
const SECRETOS = [
  ['answer de otro usuario', VICTIMA],
  ['pass_hash de otro usuario', paula.pass_hash],
  ['email de otro usuario', paula.email],
  ['nombre completo de otro usuario', paula.name],
  ...soluciones.slice(0, 6).map((s, i) => [`solution del lab #${i + 1}`, s]),
];

const CTX = { userId: 1, role: 'student', lang: 'es' };
const CONTAMINADO = { user_id: 2, userId: 2, id: 2, uid: 2, where: "1=1 OR user_id=2", sql: 'SELECT * FROM users' };

console.log('\n1) Ninguna salida contiene secretos de terceros ni soluciones');
const salidas = [];
for (const h of catalogo()) {
  const args = h.nombre === 'leccion' ? { n: 5 } : h.nombre === 'mis_intentos' ? { lab_id: '5.1' } : {};
  const r = await ejecutar(CTX, h.nombre, args);
  salidas.push([h.nombre, JSON.stringify(r)]);
}
for (const [etiqueta, secreto] of SECRETOS) {
  const donde = salidas.filter(([, s]) => secreto && s.includes(secreto)).map(([n]) => n);
  donde.length ? mal(`${etiqueta} se filtró en: ${donde.join(', ')}`) : ok(`${etiqueta} no aparece`);
}

console.log('\n2) Colar un identificador de usuario no cambia nada');
for (const h of catalogo()) {
  const base = h.nombre === 'leccion' ? { n: 5 } : h.nombre === 'mis_intentos' ? { lab_id: '5.1' } : {};
  const limpio = JSON.stringify(await ejecutar(CTX, h.nombre, base));
  const sucio = await ejecutar(CTX, h.nombre, { ...base, ...CONTAMINADO });
  const ignorado = sucio._ignorado ?? [];
  delete sucio._ignorado;
  if (JSON.stringify(sucio) !== limpio) mal(`${h.nombre} cambió su salida con args contaminados`);
  else if (!ignorado.length) mal(`${h.nombre} no registró los args colados`);
  else ok(`${h.nombre} ignoró ${ignorado.length} claves coladas`);
}

console.log('\n3) Cada usuario ve solo sus intentos');
const r1 = await ejecutar({ userId: 1, role: 'student' }, 'mis_intentos', { lab_id: '5.1' });
const r2 = await ejecutar({ userId: 2, role: 'tutor' }, 'mis_intentos', { lab_id: '5.1' });
JSON.stringify(r1).includes(VICTIMA) ? mal('el usuario 1 vio el intento del usuario 2') : ok('el usuario 1 no ve los intentos del 2');
JSON.stringify(r2).includes(VICTIMA) ? ok('el usuario 2 sí ve su propio intento') : mal('el usuario 2 no ve su propio intento');

console.log('\n4) La explicación no llega antes del primer intento');
await run('DELETE FROM attempts WHERE user_id = 1 AND lab_id = ?', ['9.3']);
const sinIntento = await ejecutar(CTX, 'mis_intentos', { lab_id: '9.3' });
sinIntento.explicacion === null && sinIntento.nota ? ok('sin intentos: explicación null + aviso al modelo')
  : mal('entregó explicación sin que la persona lo intentara', JSON.stringify(sinIntento).slice(0, 160));

console.log('\n5) Guardas de entrada');
const casos = [
  ['herramienta inventada', await ejecutar(CTX, 'labs; DROP TABLE users', {}), 'herramienta_desconocida'],
  ['sin contexto', await ejecutar(null, 'mi_perfil', {}), 'sin_sesion'],
  ['userId no entero', await ejecutar({ userId: '2' }, 'mi_perfil', {}), 'sin_sesion'],
  ['lab_id con inyección', await ejecutar(CTX, 'mis_intentos', { lab_id: "5.1' OR '1'='1" }), 'lab_invalido'],
  ['leccion fuera de rango', await ejecutar(CTX, 'leccion', { n: 99 }), 'leccion_invalida'],
  ['leccion no numérica', await ejecutar(CTX, 'leccion', { n: 'DROP' }), 'leccion_invalida'],
];
for (const [etiqueta, res, esperado] of casos) {
  res.error === esperado ? ok(`${etiqueta} → ${esperado}`) : mal(`${etiqueta} devolvió ${JSON.stringify(res).slice(0, 120)}`);
}

console.log('\n6) La ontología que ve el modelo no nombra lo prohibido');
const { renderParaModelo } = await import('../src/ontology.js');
const txt = renderParaModelo();
for (const c of ['pass_hash', 'solution', 'raw', 'email', 'ext_id', 'locked_until']) {
  txt.includes(c) ? mal(`el prompt menciona la columna ${c}`) : ok(`el prompt no menciona ${c}`);
}

await run('DELETE FROM attempts WHERE user_id = 2');
await pool.end();
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nsin fallos');
process.exit(fallos ? 1 : 0);
