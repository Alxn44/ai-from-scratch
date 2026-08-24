// The internal v3 bridge: /api/interno/*. This is where the isolation holds now
// that the agent loop lives in ai/ (Python).
//
// IT NO LONGER SKIPS, and that is the point of the code below.
//
// This suite used to print «saltado: no hay servidor» and exit 0 when nothing was
// listening on 127.0.0.1:8787, and again when IA_SECRETO was unset. So on any
// machine without `pnpm --dir api dev` running in another terminal — which is
// every machine, most of the time — the bridge isolation checks reported GREEN
// having tested nothing, inside a gate that reported PASS. House rule 3: a check
// that cannot run has FAILED, not skipped. It is the same failure this repository
// has already been bitten by three times, and it was sitting in the suite whose
// entire job is proving the isolation holds.
//
// It runs against a REAL server over HTTP rather than with inject(), because
// src/server.ts calls listen() on import and there is no app to inject into
// without splitting it in two. What changed is where that server comes from:
//
//   1. API_TEST_URL, if it is set AND answering. This is the CI path; the
//      workflow starts a server and points the suite at it.
//   2. Otherwise this process starts one ITSELF, in-process, on a free port with
//      an ephemeral service secret. server.ts listens on process.env.PORT at
//      import, so setting PORT before importing it is all it takes.
//   3. If neither works, it EXITS NON-ZERO with the reason. There is no third
//      path where it exits 0 having checked nothing.
//
// What this still needs, and cannot invent: a reachable Postgres, because
// server.ts runs migrate() at boot. `pnpm verify` already requires one — the
// schema-drift gate and isolation.mts both talk to it — so this adds no new
// dependency. If the database is missing, the failure says so.
import { strict as A } from 'node:assert';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

/** A port nothing is listening on. Asking the kernel beats guessing. */
const freePort = async (): Promise<number> => new Promise((resolve, reject) => {
  const s = createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const a = s.address();
    if (typeof a === 'string' || a === null) { reject(new Error('no port')); return; }
    const p = a.port;
    s.close(() => resolve(p));
  });
});

const answering = (url: string): Promise<boolean> =>
  fetch(`${url}/api/version`).then((r) => r.ok).catch(() => false);

/** Starts src/server.ts in this process and waits for it to answer. */
const startServer = async (): Promise<string> => {
  const port = await freePort();
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1';
  // Both sides of the bridge have to agree on the secret, and the secret must
  // not be a fixed string: a test that works because everybody uses the same
  // literal is a test that would also pass against a published placeholder.
  if (!process.env.IA_SECRETO) process.env.IA_SECRETO = randomBytes(24).toString('hex');
  const url = `http://127.0.0.1:${port}`;

  // Imported for its side effect: server.ts calls listen() at import.
  await import('../src/server.ts');

  for (let i = 0; i < 60; i++) {
    if (await answering(url)) return url;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the server started in this process never answered ${url}/api/version in 15s. `
    + 'The usual cause is that Postgres is unreachable, because server.ts runs migrate() at boot.');
};

let API = process.env.API_TEST_URL ?? '';
if (API && await answering(API)) {
  console.log(`puente: usando el servidor en ${API} (API_TEST_URL)`);
} else {
  if (API) console.log(`puente: API_TEST_URL=${API} no responde; arrancando uno propio`);
  try {
    API = await startServer();
    console.log(`puente: servidor propio en ${API}`);
  } catch (e) {
    // FAIL, never skip. This is the whole change.
    console.error(`puente: no se pudo arrancar un servidor para probar el aislamiento.\n  ${
      e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
const SECRETO = process.env.IA_SECRETO ?? '';
const CORREO = process.env.TEST_EMAIL ?? 'ricardo@velez.co';
const CLAVE = process.env.TEST_PASS ?? 'Curso2026*';

// The shapes this test reads out of the API. `await res.json()` is `unknown`, and
// naming what is expected is what turns a renamed field into a compile error
// instead of an assertion that quietly compares undefined against undefined.
interface ProfileResult { nombre?: string; email?: string; id?: number }
interface AttemptsResult { _ignorado?: unknown; intentos?: { user_id?: number }[] }
interface LessonResult { labs?: { solution?: unknown }[] }
interface ErrorResult { error?: string }

let ok = 0, fallos = 0;
const prueba = (nombre: string, fn: () => void): void => { try { fn(); console.log(`  ok   · ${nombre}`); ok++; }
  catch (e) { console.log(`  FALLA· ${nombre}\n         ${e instanceof Error ? e.message : String(e)}`); fallos++; } };

// A missing secret is a FAILURE, not a skip: without it every request below
// would get a 401 and the suite would "pass" by asserting nothing about the
// isolation. startServer() mints one when it starts its own server, so reaching
// here empty means API_TEST_URL was used and its secret was not passed along.
if (!SECRETO) {
  console.error('puente: falta IA_SECRETO. Con API_TEST_URL hay que pasar el mismo secreto que '
    + 'usa ese servidor, o el aislamiento no se comprueba: todo respondería 401.');
  process.exit(1);
}

const RUTA = `${API}/api/v3/interno/herramienta`;
const pide = (cab: Record<string, string>, cuerpo: Record<string, unknown>): Promise<Response> => fetch(RUTA, {
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
// The third skip that was here. Everything BELOW this line is the part that
// proves the isolation — that a real session sees its own data and cannot reach
// anybody else's — so exiting 0 when the login failed meant the suite announced
// success having run only the four unauthenticated 401 checks above.
//
// A failed login is a real failure: `pnpm --dir api seed` creates this account,
// and if it cannot log in then either the seed did not run or authentication is
// broken. Both are things a test must shout about.
if (!login.ok) {
  console.error(`puente: no se pudo entrar como ${CORREO} (HTTP ${login.status}). `
    + 'Sin sesión no se puede comprobar el aislamiento, que es justo para lo que existe esta '
    + 'suite. Si la base está vacía: `pnpm --dir api seed`.');
  process.exit(1);
}
const sid = (login.headers.getSetCookie?.() ?? [])
  .map((c) => /(?:^|;\s*)sid=([^;]+)/.exec(c)?.[1]).find(Boolean) ?? '';
prueba('el login devuelve cookie de sesion', () => A.ok(sid.length > 20));

const cab = { 'x-ia-secreto': SECRETO, 'x-ia-sesion': sid };
const perfil = await (await pide(cab, { nombre: 'mi_perfil' })).json() as ProfileResult;
prueba('mi_perfil devuelve la persona de la cookie', () => A.ok(perfil.nombre));
prueba('mi_perfil no devuelve correo ni id', () => {
  A.equal(perfil.email, undefined);
  A.equal(perfil.id, undefined);
});

// --- la garantia: el modelo no puede expresar «otro» ---
const colado = await (await pide(cab, {
  nombre: 'mis_intentos', args: { lab_id: '1.1', user_id: 2, userId: 2, email: 'otro@x.com' },
})).json() as AttemptsResult;
// This runs over HTTP, so it asserts the contract at the boundary the model sees:
// the rejected key names must NOT come back. Confirming which names were stripped
// hands a probe its answer. That the discard was recorded is asserted in-process
// by test/aislamiento.mjs, which can hook the logger.
prueba('las claves rechazadas no vuelven al modelo', () => {
  A.equal(colado._ignorado, undefined);
});
prueba('los intentos devueltos son de la cookie, no del id colado', () => {
  for (const i of colado.intentos ?? []) A.equal(i.user_id, undefined);
});

// --- la columna que destruiria el curso ---
const leccion = await (await pide(cab, { nombre: 'leccion', args: { n: 3 } })).json() as LessonResult;
prueba('leccion devuelve los tres labs', () => A.equal(leccion.labs?.length, 3));
prueba('ningun lab trae solution', () => {
  A.equal(JSON.stringify(leccion).includes('solution'), false);
  for (const l of leccion.labs ?? []) A.equal(l.solution, undefined);
});

const inventada = await (await pide(cab, { nombre: 'leer_solucion' })).json() as ErrorResult;
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
