// El puente interno v3: /api/interno/*. Es donde se cumple el aislamiento ahora
// que el bucle del agente vive en ai/ (Python).
//
// Va contra el servidor VIVO por HTTP, no con inject(): src/server.js llama a
// listen() al importarse, asi que no hay app que inyectar sin partirlo en dos.
// Partirlo es lo correcto a futuro; mientras no este hecho, este test dice la
// verdad sobre el proceso real en vez de fingir con un doble.
//
//   pnpm --dir api dev            (en otra terminal)
//   pnpm --dir api test:puente
import { strict as A } from 'node:assert';

const API = process.env.API_TEST_URL ?? 'http://127.0.0.1:8787';
const SECRETO = process.env.IA_SECRETO ?? '';
const CORREO = process.env.TEST_EMAIL ?? 'ricardo@velez.co';
const CLAVE = process.env.TEST_PASS ?? 'Curso2026*';

let ok = 0, fallos = 0;
const prueba = (nombre, fn) => { try { fn(); console.log(`  ok   · ${nombre}`); ok++; }
  catch (e) { console.log(`  FALLA· ${nombre}\n         ${e.message}`); fallos++; } };

const vivo = await fetch(`${API}/api/version`).then((r) => r.ok).catch(() => false);
if (!vivo) {
  console.log(`saltado: no hay servidor en ${API} (arranca \`pnpm --dir api dev\`)`);
  process.exit(0);
}
if (!SECRETO) {
  console.log('saltado: falta IA_SECRETO en el entorno del test');
  process.exit(0);
}

const RUTA = `${API}/api/v3/interno/herramienta`;
const pide = (cab, cuerpo) => fetch(RUTA, {
  method: 'POST', headers: { 'content-type': 'application/json', ...cab },
  body: JSON.stringify(cuerpo),
});

console.log('\npuente interno v3');

// --- quien puede llamar ---
const sinSecreto = await pide({}, { nombre: 'mi_perfil' });
prueba('sin el secreto de servicio responde 401', () => A.equal(sinSecreto.status, 401));

const secretoMalo = await pide({ 'x-ia-secreto': 'no' }, { nombre: 'mi_perfil' });
prueba('con un secreto equivocado responde 401', () => A.equal(secretoMalo.status, 401));

const sinSesion = await pide({ 'x-ia-secreto': SECRETO }, { nombre: 'mi_perfil' });
prueba('con secreto pero sin cookie responde 401', () => A.equal(sinSesion.status, 401));

const sesionFalsa = await pide({ 'x-ia-secreto': SECRETO, 'x-ia-sesion': 'a.b.c' }, { nombre: 'mi_perfil' });
prueba('una cookie inventada responde 401', () => A.equal(sesionFalsa.status, 401));

// --- con sesion real ---
const login = await fetch(`${API}/api/v3/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: CORREO, password: CLAVE }),
});
if (!login.ok) {
  console.log(`saltado: no se pudo entrar como ${CORREO} (${login.status})`);
  process.exit(0);
}
const sid = (login.headers.getSetCookie?.() ?? [])
  .map((c) => /(?:^|;\s*)sid=([^;]+)/.exec(c)?.[1]).find(Boolean) ?? '';
prueba('el login devuelve cookie de sesion', () => A.ok(sid.length > 20));

const cab = { 'x-ia-secreto': SECRETO, 'x-ia-sesion': sid };
const perfil = await (await pide(cab, { nombre: 'mi_perfil' })).json();
prueba('mi_perfil devuelve la persona de la cookie', () => A.ok(perfil.nombre));
prueba('mi_perfil no devuelve correo ni id', () => {
  A.equal(perfil.email, undefined);
  A.equal(perfil.id, undefined);
});

// --- la garantia: el modelo no puede expresar «otro» ---
const colado = await (await pide(cab, {
  nombre: 'mis_intentos', args: { lab_id: '1.1', user_id: 2, userId: 2, email: 'otro@x.com' },
})).json();
prueba('el user_id colado por el modelo queda ignorado y anotado', () => {
  A.deepEqual([...(colado._ignorado ?? [])].sort(), ['email', 'userId', 'user_id']);
});
prueba('los intentos devueltos son de la cookie, no del id colado', () => {
  for (const i of colado.intentos ?? []) A.equal(i.user_id, undefined);
});

// --- la columna que destruiria el curso ---
const leccion = await (await pide(cab, { nombre: 'leccion', args: { n: 3 } })).json();
prueba('leccion devuelve los tres labs', () => A.equal(leccion.labs?.length, 3));
prueba('ningun lab trae solution', () => {
  A.equal(JSON.stringify(leccion).includes('solution'), false);
  for (const l of leccion.labs) A.equal(l.solution, undefined);
});

const inventada = await (await pide(cab, { nombre: 'leer_solucion' })).json();
prueba('una herramienta que no existe se rechaza por nombre', () =>
  A.equal(inventada.error, 'herramienta_desconocida'));

// --- versionado: v1 y v2 deprecadas, v3 actual ---
console.log('\nversionado');
for (const [ruta, esperado] of [
  ['/api/v3/version', '3'], ['/api/v2/version', '2-legacy'],
  ['/api/v1/version', '1-legacy'], ['/api/version', '2-legacy'],
]) {
  const r = await fetch(`${API}${ruta}`);
  prueba(`${ruta} responde x-api-version: ${esperado}`, () =>
    A.equal(r.headers.get('x-api-version'), esperado));
  if (esperado !== '3') {
    prueba(`${ruta} avisa de retirada`, () => {
      A.equal(r.headers.get('deprecation'), 'true');
      A.ok(r.headers.get('sunset'));
      A.ok(r.headers.get('link')?.includes('successor-version'));
    });
  }
}

console.log(fallos ? `\n${fallos} fallo(s) de ${ok + fallos}` : `\nsin fallos (${ok} comprobaciones)`);
process.exit(fallos ? 1 : 0);
