// Quien puede repartir el rol root.
//
// Esta prueba existe porque el endpoint no tenia ninguna, y lo que no se prueba
// se rompe callado. Lo que cubre no es un caso raro: era el estado del sistema.
// PATCH /api/admin/users/:id/role exigia ['admin'] y aceptaba role: 'root', asi
// que cualquier admin abria /admin, se elegia a si mismo, marcaba Root, y en esa
// misma peticion ganaba /api/root/solved-labs -- la vista que api/src/server.ts
// se esfuerza en explicar que «must never become available to every
// administrator». La guarda de lectura estaba bien puesta; se saltaba por otra
// puerta.
//
// El cuarto caso es tan importante como los tres primeros: comprueba que la
// restriccion no se comio la administracion normal de roles.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAuth } from '../../auth/src/index.ts';
import { COOKIE, sign } from '../../auth/src/core.ts';
import { get, run, pool } from '../src/db.ts';
import { many, one, write, writeAuthorized } from '../src/data.ts';

const log = { info: () => {}, warn: () => {} };
const auth = createAuth({ one, many, write, writeAuthorized,
  origin: 'http://localhost', production: false, log });

/** App falsa: registerRoutes registra veintitantas rutas, aqui solo interesa una. */
let cambiarRol: ((req: any, reply: any) => Promise<unknown>) | null = null;
const nada = () => {};
const app: any = { get: nada, post: nada, delete: nada, put: nada,
  patch: (ruta: string, handler: any) => {
    if (ruta === '/api/admin/users/:id/role') cambiarRol = handler;
  } };
auth.registerRoutes(app);
assert.ok(cambiarRol, 'no se registro PATCH /api/admin/users/:id/role');

/** Reply falso que guarda el ultimo code() y send(). */
function reply() {
  const r: any = { status: 200, body: null as any };
  r.code = (s: number) => { r.status = s; return r; };
  r.send = (v: unknown) => { r.body = v; return v; };
  r.setCookie = nada;
  r.clearCookie = nada;
  return r;
}

async function crear(rol: string) {
  const email = `role-esc-${randomUUID()}@example.test`;
  const u = await get<{ id: number; token_version: number }>(
    `INSERT INTO users (email,name,pass_hash,role,paid,lang,theme)
     VALUES (?,?,?,?,0,'auto','auto') RETURNING id,token_version`,
    [email, 'Escalada', 'test-only-not-a-password-hash', rol]);
  assert.ok(u);
  return u!;
}

/** Peticion autenticada como `quien`. El rol del token es decorativo:
 *  resolveSession relee el usuario de la base en cada peticion. */
const como = (quien: { id: number; token_version: number }, rol: string, id: number, role: string) => ({
  req: { cookies: { [COOKIE]: sign({ sub: quien.id, role: rol, v: quien.token_version }) },
    headers: {}, params: { id: String(id) }, body: { role } },
});

const rolDe = async (id: number) =>
  (await get<{ role: string }>('SELECT role FROM users WHERE id = ?', [id]))?.role;

const admin = await crear('admin');
const raiz = await crear('root');
const victima = await crear('student');
const otro = await crear('student');

try {
  // 1. un admin NO puede dar root -- el agujero original
  let r = reply();
  await cambiarRol!(como(admin, 'admin', victima.id, 'root').req, r);
  assert.equal(r.status, 403, 'un admin pudo dar root');
  assert.equal(r.body?.error, 'solo_root');
  assert.equal(await rolDe(victima.id), 'student', 'el rol cambio pese al 403');

  // 2. ni quitarlo: degradar al root y quedarse mandando es la misma escalada
  r = reply();
  await cambiarRol!(como(admin, 'admin', raiz.id, 'student').req, r);
  assert.equal(r.status, 403, 'un admin pudo degradar a un root');
  assert.equal(r.body?.error, 'solo_root');
  assert.equal(await rolDe(raiz.id), 'root');

  // 3. un root si puede
  r = reply();
  await cambiarRol!(como(raiz, 'root', victima.id, 'root').req, r);
  assert.equal(r.status, 200, `un root no pudo dar root: ${JSON.stringify(r.body)}`);
  assert.equal(await rolDe(victima.id), 'root');

  // 4. y la administracion normal sigue funcionando: si esto falla, la
  //    restriccion se llevo por delante lo que si debia poder hacer un admin
  r = reply();
  await cambiarRol!(como(admin, 'admin', otro.id, 'tutor').req, r);
  assert.equal(r.status, 200, `un admin no pudo ascender a tutor: ${JSON.stringify(r.body)}`);
  assert.equal(await rolDe(otro.id), 'tutor');

  console.log('role escalation: solo root reparte root, y el admin conserva el resto ok');
} finally {
  for (const u of [admin, raiz, victima, otro]) {
    await run('DELETE FROM role_audit WHERE user_id = ? OR actor_id = ?', [u.id, u.id]);
    await run('DELETE FROM users WHERE id = ?', [u.id]);
  }
  await pool.end();
}
