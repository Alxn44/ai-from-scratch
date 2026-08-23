import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { all, get, migrate, run } from './db.js';
import { COOKIE, MINUTOS_TOKEN, cookieOpts, hashPassword, hashToken, nuevoToken, sign, verify, verifyPassword } from './auth.js';
import { grade, hint, publicLab } from './grade.js';
import { logrosDe, nivelRango } from './logros.js';
import { cerrarSemana, estadoLigas } from './ligas.js';
// ESTADO INTERMEDIO, dicho a proposito: el BUCLE del agente ya vive en Python
// (ai/), y las HERRAMIENTAS siguen aqui — Python las pide por
// /api/interno/herramienta y este proceso las ejecuta con el userId de la cookie.
// Es coherente y funciona, pero no es el destino: las herramientas se portan a
// Python (todo lo que es IA va a Python) y entonces agent-tools.js pasa a v2
// legacy como harness.js y proveedores.js. Ver MIGRACION.md.
import { catalogo, ejecutar, familias } from './agent-tools.js';
import { IA_SECRETO, IA_URL, hablarConIA, hayIA, saludIA } from './ia.js';
import { encola, estadoCola, obrero, registra } from './trabajos.js';

// ---------------------------------------------------------------------------
// VERSIONADO DE LA API
//
// v3 es el camino canonico: /api/v3/*. TODO lo anterior es LEGACY DEPRECADO:
//
//   /api/v3/...   ACTUAL
//   /api/v2/...   legacy deprecado  (alias explicito)
//   /api/v1/...   legacy deprecado  (alias explicito; nunca se publico con este
//                 prefijo, se acepta para que un cliente que lo escriba reciba
//                 el aviso de retirada en vez de un 404 sin explicacion)
//   /api/...      legacy deprecado  (la superficie sin version = v2)
//
// COMO, y lo que esto NO es: rewriteUrl corre ANTES del enrutado, asi que
// /api/v3/ligas entra por el MISMO manejador que /api/ligas. Son los mismos
// handlers, no dos copias, y por construccion no pueden divergir.
//
// El coste, dicho: v3 es hoy un ALIAS de ruta, no una version evolucionable por
// separado. El dia que v4 tenga que responder distinto en la misma ruta hara
// falta duplicar handlers de verdad. Lo que compra hoy: un camino estable para
// clientes nuevos, un aviso legible por maquina en el viejo, y una cuenta de
// golpes para saber cuando se puede borrar.
//
// Y con UN solo consumidor propio (el front de este repo) esto no compra nada
// funcional todavia: se hace ahora porque es barato antes de que haya clientes
// fuera, y carisimo despues.
const V_ACTUAL = 3;
const V_LEGACY = 2;                       // la superficie sin version es esta
const V_VIEJAS = [1, 2];                  // prefijos explicitos, todos deprecados
// Fecha de retirada de la superficie sin version. Sunset es un campo HTTP de
// fecha (RFC 8594); Deprecation es su companero y avisa de que ya lo esta.
const SUNSET = new Date('2027-02-21T00:00:00Z').toUTCString();
// Cuenta por version, no un total: «hay 40 golpes legacy» no dice si se puede
// borrar v1, y borrar la que aun se usa es el error que esto evita.
const golpes = { 1: 0, 2: 0 };
let golpesLegacy = 0;   // total, para el resumen de /api/version

// La marca de version se cuelga de la peticion CRUDA porque rewriteUrl corre
// antes de que exista el objeto de Fastify. Se declara para que el chequeo de
// tipos no lo lea como una propiedad inventada.
/** @typedef {import('node:http').IncomingMessage & { __api?: number }} PeticionCruda */

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Corre antes del enrutado: es el unico sitio donde se puede reescribir la URL
  // sin duplicar rutas. Marca la version en la peticion cruda porque despues de
  // reescribir ya no se distingue por donde entro.
  /** @param {PeticionCruda} req */
  rewriteUrl: (req) => {
    const pref = `/api/v${V_ACTUAL}/`;
    if (req.url.startsWith(pref)) { req.__api = V_ACTUAL; return '/api/' + req.url.slice(pref.length); }
    for (const v of V_VIEJAS) {
      const p = `/api/v${v}/`;
      if (req.url.startsWith(p)) {
        req.__api = v; golpes[v]++; golpesLegacy++;
        return '/api/' + req.url.slice(p.length);
      }
    }
    if (req.url.startsWith('/api/')) { req.__api = V_LEGACY; golpes[V_LEGACY]++; golpesLegacy++; }
    return req.url;
  },
});

app.addHook('onSend', async (req, reply, payload) => {
  const v = /** @type {PeticionCruda} */ (req.raw).__api;
  if (!v) return payload;
  reply.header('x-api-version', v === V_ACTUAL ? String(V_ACTUAL) : `${v}-legacy`);
  if (v !== V_ACTUAL) {
    reply.header('deprecation', 'true');
    reply.header('sunset', SUNSET);
    reply.header('link', `<${req.url.replace('/api/', `/api/v${V_ACTUAL}/`)}>; rel="successor-version"`);
  }
  return payload;
});
await app.register(cookie);

const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:4321';
app.addHook('onRequest', async (req, reply) => {
  const origin = req.headers.origin;
  if (origin === ORIGIN) {
    reply.header('access-control-allow-origin', origin);
    reply.header('access-control-allow-credentials', 'true');
    reply.header('access-control-allow-headers', 'content-type');
    reply.header('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
  }
  if (req.method === 'OPTIONS') reply.code(204).send();
});

// ---------- sesión ----------
const USER_BY_ID = 'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL';
async function currentUser(req) {
  const t = verify(req.cookies?.[COOKIE]);
  if (!t) return null;
  const u = await get(USER_BY_ID, [t.sub]);
  // Cambiar la contraseña sube token_version: las cookies emitidas antes mueren.
  if (!u || (t.v ?? 0) !== u.token_version) return null;
  return u;
}
async function requireUser(req, reply) {
  const u = await currentUser(req);
  if (!u) { reply.code(401).send({ error: 'no_session' }); return null; }
  return u;
}
async function requireRole(req, reply, roles) {
  const u = await requireUser(req, reply);
  if (!u) return null;
  if (!roles.includes(u.role)) { reply.code(403).send({ error: 'forbidden', need: roles }); return null; }
  return u;
}
const shape = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, lang: u.lang, theme: u.theme, paid: !!u.paid, cohort: u.cohort });

// 'auto' = seguir al dispositivo (Accept-Language / prefers-color-scheme).
// fr y pt se aceptan ya: si aún no hay diccionario, el front cae al español y
// la lección avisa. Así añadir un idioma no exige tocar el API.
const LANGS = ['es', 'en', 'fr', 'pt', 'auto'];
const THEMES = ['dark', 'paper', 'auto'];
const pref = (v, allowed) => (allowed.includes(v) ? v : 'auto');

// ---------- auth ----------
app.post('/api/auth/login', async (req, reply) => {
  const { email, password, lang, theme } = req.body ?? {};
  if (!email || !password) return reply.code(400).send({ error: 'faltan_datos' });
  const u = await get('SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', [String(email).toLowerCase()]);
  if (u?.locked_until && u.locked_until > new Date()) {
    return reply.code(423).send({ error: 'bloqueada', until: u.locked_until });
  }
  if (!u || !verifyPassword(String(password), u.pass_hash)) {
    if (u) {
      const failed = u.failed + 1;
      const lock = failed >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      await run('UPDATE users SET failed = ?, locked_until = ? WHERE id = ?', [failed, lock, u.id]);
      return reply.code(401).send({ error: 'credenciales', left: Math.max(0, 5 - failed) });
    }
    return reply.code(401).send({ error: 'credenciales', left: null });
  }
  await run('UPDATE users SET failed = 0, locked_until = NULL WHERE id = ?', [u.id]);
  // El idioma o el tema que el visitante eligió antes de entrar se adopta solo si la
  // cuenta seguía en 'auto': una preferencia explícita de la cuenta nunca se pisa.
  if (u.lang === 'auto' && LANGS.includes(lang) && lang !== 'auto') {
    await run('UPDATE users SET lang = ? WHERE id = ?', [lang, u.id]);
  }
  if (u.theme === 'auto' && THEMES.includes(theme) && theme !== 'auto') {
    await run('UPDATE users SET theme = ? WHERE id = ?', [theme, u.id]);
  }
  reply.setCookie(COOKIE, sign({ sub: u.id, role: u.role, v: u.token_version }), cookieOpts);
  return { user: shape(await get(USER_BY_ID, [u.id])) };
});

app.post('/api/auth/logout', async (req, reply) => {
  reply.clearCookie(COOKIE, { path: '/' });
  return { ok: true };
});

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;

app.post('/api/auth/register', async (req, reply) => {
  const { email, name, password, lang, theme } = req.body ?? {};
  const mail = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) return reply.code(400).send({ error: 'correo_invalido' });
  if (String(name ?? '').trim().length < 2) return reply.code(400).send({ error: 'nombre_corto' });
  if (String(password ?? '').length < 8) return reply.code(400).send({ error: 'clave_corta', msg: 'Mínimo 8 caracteres.' });
  const taken = await get('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL', [mail]);
  if (taken) return reply.code(409).send({ error: 'correo_en_uso' });
  const u = await get(`INSERT INTO users (email,name,pass_hash,role,paid,lang,theme)
                       VALUES (?,?,?,?,0,?,?) RETURNING *`,
    [mail, String(name).trim(), hashPassword(String(password)), 'student',
     pref(lang, LANGS), pref(theme, THEMES)]);
  reply.setCookie(COOKIE, sign({ sub: u.id, role: u.role, v: u.token_version }), cookieOpts);
  return reply.code(201).send({ user: shape(u) });
});

// Pide un enlace de recuperación. Responde SIEMPRE lo mismo, exista o no la cuenta:
// si dijera «ese correo no existe», cualquiera podría averiguar quién compró el curso.
app.post('/api/auth/recover', async (req, reply) => {
  const mail = String(req.body?.email ?? '').trim().toLowerCase();
  const respuesta = { ok: true, msg: 'Si ese correo tiene cuenta, el enlace ya salió.' };
  if (!EMAIL_RE.test(mail)) return reply.code(400).send({ error: 'correo_invalido' });

  const u = await get('SELECT id, name FROM users WHERE email = ? AND deleted_at IS NULL', [mail]);
  if (!u) return respuesta;

  // Límite por cuenta: 3 enlaces por hora. Sin esto, el formulario es un cañón de
  // correo contra cualquier dirección que alguien quiera molestar.
  const { c } = await get(
    "SELECT COUNT(*)::int AS c FROM reset_tokens WHERE user_id = ? AND created_at > now() - interval '1 hour'",
    [u.id]);
  if (c >= 3) {
    app.log.warn({ userId: u.id }, 'recover: limite por hora alcanzado');
    return respuesta;
  }

  const token = nuevoToken();
  await run(
    `INSERT INTO reset_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, now() + interval '${MINUTOS_TOKEN} minutes')`,
    [u.id, hashToken(token)]);

  const enlace = `${ORIGIN}/recuperar?t=${token}`;
  // No hay proveedor de correo configurado. En vez de fingir un envío, el enlace
  // queda en el log del servidor y, fuera de producción, se devuelve al cliente.
  app.log.info({ enlace }, 'recover: enlace generado (sin proveedor de correo)');
  if (process.env.NODE_ENV !== 'production') return { ...respuesta, dev_enlace: enlace };
  return respuesta;
});

// Canjea el enlace. El token se compara por hash, se usa una sola vez, y al
// cambiar la contraseña se cierran las sesiones abiertas en otros equipos.
app.post('/api/auth/reset', async (req, reply) => {
  const { token, password } = req.body ?? {};
  if (String(password ?? '').length < 8) {
    return reply.code(400).send({ error: 'clave_corta', msg: 'Mínimo 8 caracteres.' });
  }
  const fila = await get(
    `SELECT r.id, r.user_id, r.used_at, r.expires_at < now() AS vencido
     FROM reset_tokens r WHERE r.token_hash = ?`, [hashToken(String(token ?? ''))]);
  if (!fila) return reply.code(400).send({ error: 'enlace_invalido', msg: 'Ese enlace no sirve. Pide uno nuevo.' });
  if (fila.used_at) return reply.code(409).send({ error: 'enlace_usado', msg: 'Ese enlace ya se usó. Pide uno nuevo.' });
  if (fila.vencido) return reply.code(410).send({ error: 'enlace_vencido', msg: `El enlace dura ${MINUTOS_TOKEN} minutos. Pide uno nuevo.` });

  const u = await get('UPDATE users SET pass_hash = ?, token_version = token_version + 1, failed = 0, locked_until = NULL WHERE id = ? RETURNING *',
    [hashPassword(String(password)), fila.user_id]);
  await run('UPDATE reset_tokens SET used_at = now() WHERE id = ?', [fila.id]);
  // Los demás enlaces pendientes de esta persona mueren con el que se acaba de usar.
  await run('UPDATE reset_tokens SET used_at = now() WHERE user_id = ? AND used_at IS NULL', [fila.user_id]);

  reply.setCookie(COOKIE, sign({ sub: u.id, role: u.role, v: u.token_version }), cookieOpts);
  return { user: shape(u), sesionesCerradas: true };
});

// Borrado suave: conserva la fila e intentos, rota el correo para liberarlo y anonimiza el nombre.
app.post('/api/account/delete', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const { password } = req.body ?? {};
  if (!verifyPassword(String(password ?? ''), u.pass_hash)) {
    return reply.code(401).send({ error: 'clave_incorrecta', msg: 'Confirma con tu contraseña actual.' });
  }
  if (u.role === 'admin') {
    const { c: admins } = await get("SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND deleted_at IS NULL");
    if (admins <= 1) return reply.code(409).send({ error: 'ultimo_admin', msg: 'No puedes dejar la plataforma sin admins.' });
  }
  await run(`UPDATE users SET deleted_at = now(), email = ?, name = 'Cuenta borrada' WHERE id = ?`,
    [`borrado+${u.id}@alpadev.local`, u.id]);
  reply.clearCookie(COOKIE, { path: '/' });
  return { ok: true, deleted: u.id };
});

app.get('/api/me', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  return { user: shape(u) };
});

app.patch('/api/settings', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const { lang, theme } = req.body ?? {};
  if (lang && !LANGS.includes(lang)) return reply.code(400).send({ error: 'lang' });
  if (theme && !THEMES.includes(theme)) return reply.code(400).send({ error: 'theme' });
  const saved = await get(`UPDATE users SET lang = COALESCE(?, lang), theme = COALESCE(?, theme)
                           WHERE id = ? RETURNING *`, [lang ?? null, theme ?? null, u.id]);
  return { user: shape(saved) };
});

// ---------- curso ----------
// Muro de pago: la lección 01 y sus tres labs son gratis; el resto del Vol. 1 se
// abre con la compra. Tutores y admins ven todo porque su trabajo es acompañar.
export const LECCIONES_LIBRES = 1;
const conAcceso = (u, n) => !!u.paid || u.role !== 'student' || Number(n) <= LECCIONES_LIBRES;

const BEST = `SELECT lab_id, MAX(correct) AS solved, COUNT(*)::int AS attempts
              FROM attempts WHERE user_id = ? GROUP BY lab_id`;

app.get('/api/lessons', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const best = new Map((await all(BEST, [u.id])).map((r) => [r.lab_id, r]));
  const lessons = await all('SELECT * FROM lessons ORDER BY n');
  const labs = await all('SELECT id, lesson_n, idx, level, kind, draft FROM labs ORDER BY lesson_n, idx');
  return {
    lessons: lessons.map((l) => {
      const own = labs.filter((x) => x.lesson_n === l.n);
      const solved = own.filter((x) => best.get(x.id)?.solved === 1).length;
      const locked = !conAcceso(u, l.n);
      return { ...l, locked, labs: own.map((x) => ({ ...x, draft: !!x.draft, solved: best.get(x.id)?.solved === 1 })), solved, total: own.length };
    }),
  };
});

app.get('/api/lessons/:n', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const n = Number(req.params.n);
  const lesson = await get('SELECT * FROM lessons WHERE n = ?', [n]);
  if (!lesson) return reply.code(404).send({ error: 'no_existe' });
  // El 402 lleva la ficha pública de la lección (sin labs): la página cerrada es
  // una vitrina, no un callejón sin salida.
  if (!conAcceso(u, n)) return reply.code(402).send({
    error: 'requiere_compra', libres: LECCIONES_LIBRES,
    lesson: { n: lesson.n, eyebrow: lesson.eyebrow, title: lesson.title, summary: lesson.summary, math: lesson.math, math_cap: lesson.math_cap },
    labs: (await all('SELECT id, idx, level FROM labs WHERE lesson_n = ? ORDER BY idx', [n])),
  });
  const best = new Map((await all(BEST, [u.id])).map((r) => [r.lab_id, r]));
  const labs = (await all('SELECT * FROM labs WHERE lesson_n = ? ORDER BY idx', [n]))
    .map((l) => publicLab(l, best.get(l.id)?.solved === 1 ? best.get(l.id) : null));
  // Explicación técnica + analogía + ejemplos: sin esto el lab no se puede resolver.
  const lang = LANGS.includes(req.query?.lang) && req.query.lang !== 'auto' ? req.query.lang : (u.lang === 'auto' ? 'es' : u.lang);
  const Q_TEXTO = 'SELECT technical, analogy, examples FROM lesson_text WHERE lesson_n = ? AND lang = ?';
  let texto = await get(Q_TEXTO, [n, lang]);
  let textoIdioma = texto ? lang : null;
  if (!texto && lang !== 'es') { texto = await get(Q_TEXTO, [n, 'es']); textoIdioma = texto ? 'es' : null; }
  return { lesson, labs, texto, textoIdioma };
});

// ---------- Logros ----------
const PER_LESSON = `
  SELECT l.lesson_n AS n, COUNT(*)::int AS total,
         SUM(CASE WHEN a.solved = 1 THEN 1 ELSE 0 END)::int AS solved
  FROM labs l
  LEFT JOIN (SELECT lab_id, MAX(correct) AS solved FROM attempts WHERE user_id = ? GROUP BY lab_id) a
    ON a.lab_id = l.id
  GROUP BY l.lesson_n ORDER BY l.lesson_n`;

/** Recalcula los logros que le corresponden y guarda los que aún no tenía.
 *  Devuelve solo los nuevos: el front los usa para disparar la animación. */
async function sincronizarLogros(userId) {
  const perLesson = await all(PER_LESSON, [userId]);
  const deberia = logrosDe(perLesson);
  const tiene = new Set((await all('SELECT code FROM achievements WHERE user_id = ?', [userId])).map((r) => r.code));
  const nuevos = deberia.filter((l) => !tiene.has(l.code));
  for (const l of nuevos) {
    await run(`INSERT INTO achievements (user_id, code, kind, lesson_n) VALUES (?,?,?,?)
      ON CONFLICT (user_id, code) DO NOTHING`, [userId, l.code, l.kind, l.lesson_n]);
  }
  return { nuevos, todos: deberia, perLesson };
}

app.get('/api/logros', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const { todos, perLesson } = await sincronizarLogros(u.id);
  const filas = await all('SELECT code, kind, lesson_n, earned_at FROM achievements WHERE user_id = ? ORDER BY earned_at, code', [u.id]);
  const codigos = filas.map((f) => f.code);
  return {
    logros: filas,
    nivel: nivelRango(codigos),
    total: todos.length,
    perLesson,
  };
});

// ---------- Ranking (solo quien acepta salir) ----------
const ALIAS_OK = /^[a-z0-9._-]{3,18}$/;

app.get('/api/ranking', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  // Cerradas por persona, contando solo lecciones con todos sus labs resueltos.
  const tabla = await all(`
    SELECT o.alias,
           COUNT(DISTINCT hechas.lesson_n)::int AS lecciones,
           COUNT(DISTINCT ok.lab_id)::int       AS labs
    FROM ranking_optin o
    LEFT JOIN (SELECT DISTINCT user_id, lab_id FROM attempts WHERE correct = 1) ok ON ok.user_id = o.user_id
    LEFT JOIN (
      SELECT a.user_id, l.lesson_n
      FROM labs l
      JOIN attempts a ON a.lab_id = l.id AND a.correct = 1
      GROUP BY a.user_id, l.lesson_n
      HAVING COUNT(DISTINCT a.lab_id) = (SELECT COUNT(*) FROM labs x WHERE x.lesson_n = l.lesson_n)
    ) hechas ON hechas.user_id = o.user_id
    GROUP BY o.alias, o.joined_at
    ORDER BY lecciones DESC, labs DESC, o.joined_at ASC
    LIMIT 50`);
  const mio = await get('SELECT alias FROM ranking_optin WHERE user_id = ?', [u.id]);
  const pos = mio ? tabla.findIndex((r) => r.alias === mio.alias) + 1 : null;
  return { tabla, yo: { alias: mio?.alias ?? null, apuntado: !!mio, puesto: pos || null } };
});

app.post('/api/ranking/optin', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const alias = String(req.body?.alias ?? '').trim().toLowerCase();
  if (!ALIAS_OK.test(alias)) {
    return reply.code(400).send({ error: 'alias_invalido', msg: 'De 3 a 18 caracteres: letras, números, punto, guion o guion bajo.' });
  }
  // El alias es lo único público: el nombre y el correo no salen nunca del servidor.
  const choca = await get('SELECT user_id FROM ranking_optin WHERE alias = ? AND user_id <> ?', [alias, u.id]);
  if (choca) return reply.code(409).send({ error: 'alias_tomado' });
  await run(`INSERT INTO ranking_optin (user_id, alias) VALUES (?,?)
    ON CONFLICT (user_id) DO UPDATE SET alias = EXCLUDED.alias`, [u.id, alias]);
  return { alias, apuntado: true };
});

app.delete('/api/ranking/optin', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  await run('DELETE FROM ranking_optin WHERE user_id = ?', [u.id]);
  return { apuntado: false };
});

// ---------------------------------------------------------------------------
// Ligas semanales
//
// Decisiones tomadas, no heredadas:
//  · ZONA: America/Bogota para todo el mundo. Una sola zona declarada, porque con
//    la de cada cual dos personas ven cierres distintos y la tabla no compara.
//  · MINIMO DE COHORTE: por debajo de MIN_LIGA nadie tiene liga. Una liga de dos
//    es una competicion falsa; es mas honesto decir que aun no hay.
//  · SOLO PAGO Y APUNTADO: hace falta ranking_optin y paid=1.
//  · TERMINAL: quien acabo los 36 labs pasa a 'salon' y conserva su metal.
//
// El calculo vive en ./ligas.js porque lo usan tambien el cron y las herramientas
// del agente: si estuviera aqui, el chat, la pantalla y el cierre semanal
// contarian la semana distinto.
//
// Se llama a estadoLigas() y no se reconstruye la respuesta a mano: esa funcion
// es la unica que calcula `subida` (el ascenso contra la ultima semana CERRADA,
// con la ventana que evita compararte contigo mismo de hace unas horas). La
// version en linea de la otra rama no lo traia, y sin `subida` la tarjeta de
// ascenso no aparece nunca.
app.get('/api/ligas', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  return estadoLigas(u.id);
});

app.post('/api/ligas/cerrar', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  if (u.role !== 'admin') return reply.code(403).send({ error: 'solo_admin' });
  // Idempotente por la PK (user_id, week) con DO NOTHING: el cron puede fallar
  // y reintentar sin que nadie mire nada a mano.
  return cerrarSemana();
});

app.post('/api/labs/:id/attempt', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const lab = await get('SELECT * FROM labs WHERE id = ?', [String(req.params.id)]);
  if (!lab) return reply.code(404).send({ error: 'no_existe' });
  if (lab.draft) return reply.code(409).send({ error: 'borrador', msg: 'Este lab todavía no está escrito.' });
  if (!conAcceso(u, lab.lesson_n)) return reply.code(402).send({ error: 'requiere_compra', libres: LECCIONES_LIBRES });
  const answer = req.body?.answer;
  if (answer === undefined) return reply.code(400).send({ error: 'falta_respuesta' });
  const correct = grade(lab, answer);
  await run('INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES (?,?,?,?)',
    [u.id, lab.id, JSON.stringify(answer), correct ? 1 : 0]);
  // Solo un acierto puede desbloquear algo: si falló, no se recalcula nada.
  const logros = correct ? await sincronizarLogros(u.id) : { nuevos: [] };
  return { correct, explanation: lab.explanation, hint: hint(lab, answer), nuevos: logros.nuevos };
});

app.get('/api/progress', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const rows = await all(BEST, [u.id]);
  const solvedLabs = rows.filter((r) => r.solved === 1).length;
  const { c: totalLabs } = await get('SELECT COUNT(*)::int AS c FROM labs');
  const perLesson = await all(`
    SELECT l.lesson_n AS n, COUNT(*)::int AS total,
           SUM(CASE WHEN a.solved = 1 THEN 1 ELSE 0 END)::int AS solved
    FROM labs l
    LEFT JOIN (SELECT lab_id, MAX(correct) AS solved FROM attempts WHERE user_id = ? GROUP BY lab_id) a
      ON a.lab_id = l.id
    GROUP BY l.lesson_n ORDER BY l.lesson_n`, [u.id]);
  const lessonsDone = perLesson.filter((r) => r.solved === r.total).length;
  return { solvedLabs, totalLabs, lessonsDone, totalLessons: perLesson.length, perLesson };
});

// ---------- Chat con IA ----------
const LARGO_MSG = 4000;
const MAX_HIST = 24;

app.get('/api/chat/estado', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  // Se dice qué proveedor atiende: la política de privacidad lo promete. El dato
  // viene del servicio de IA, que es quien tiene las llaves desde v3.
  //
  // Y se dicen las herramientas AGRUPADAS por familia: 37 nombres en fila no le
  // dicen nada a nadie, y la familia es justo lo que explica que el agente sepa
  // de tu progreso y no del de nadie mas.
  const s = await saludIA();
  return {
    disponible: Boolean(s.ok) && (s.proveedores?.length ?? 0) > 0,
    proveedores: (s.proveedores ?? []).map((id) => ({ id, modelo: s.modelos?.[id] ?? null })),
    herramientas: catalogo().map((h) => h.nombre),
    familias: familias(),
    // VUELTAS ya no se importa de harness.js (v2 deprecado): el tope lo declara
    // quien corre el bucle, que es el servicio de Python.
    vueltasMax: s.vueltas ?? 4,
    servicio: { ok: Boolean(s.ok), error: s.error ?? null, version: s.version ?? null,
                promptSha: s.prompt_sha ?? null, violaciones: s.violaciones ?? null },
  };
});

// ---------- Puente interno: SOLO lo llama el servicio de IA ----------
//
// Aqui es donde el aislamiento se cumple de verdad. El servicio manda el nombre
// de la herramienta y los args del modelo; el userId sale de la COOKIE que el
// servicio reenvia sin abrir. Ninguna firma acepta un identificador de persona,
// asi que el modelo no tiene forma de expresar «los datos de otro».
//
// Se exige el secreto de servicio Y una sesion valida: el secreto prueba de donde
// viene la llamada, la cookie prueba de quien. Sin las dos no se ejecuta nada.
function esDelServicio(req) {
  return Boolean(IA_SECRETO) && req.headers['x-ia-secreto'] === IA_SECRETO;
}

app.get('/api/interno/catalogo', async (req, reply) => {
  if (!esDelServicio(req)) return reply.code(401).send({ error: 'no_es_el_servicio' });
  return { catalogo: catalogo() };
});

// El esquema no es decoracion: Fastify valida ANTES del handler y responde 400
// solo. Es la respuesta al hallazgo de tsgo — «se lee req.body sin forma
// declarada» — en el codigo nuevo. additionalProperties:false es lo que impide
// que llegue un campo que nadie mira.
const ESQ_HERRAMIENTA = {
  body: {
    type: 'object', required: ['nombre'], additionalProperties: false,
    properties: {
      nombre: { type: 'string', minLength: 1, maxLength: 64 },
      args: { type: 'object' },
    },
  },
};

app.post('/api/interno/herramienta', { schema: ESQ_HERRAMIENTA }, async (req, reply) => {
  if (!esDelServicio(req)) return reply.code(401).send({ error: 'no_es_el_servicio' });
  const sesion = String(req.headers['x-ia-sesion'] ?? '');
  if (!sesion) return reply.code(401).send({ error: 'sin_sesion' });
  // La cookie se valida con el MISMO camino que una peticion del navegador: no
  // hay una via de confianza distinta para el servicio.
  const claim = verify(sesion);
  if (!claim?.sub) return reply.code(401).send({ error: 'sesion_invalida' });
  const u = await get('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL', [claim.sub]);
  if (!u) return reply.code(401).send({ error: 'sesion_invalida' });
  const nombre = String(req.body?.nombre ?? '');
  const args = req.body?.args && typeof req.body.args === 'object' ? req.body.args : {};
  return ejecutar({ userId: u.id }, nombre, args);
});

const ESQ_CHAT = {
  body: {
    type: 'object', required: ['mensajes'], additionalProperties: false,
    properties: {
      mensajes: {
        type: 'array', minItems: 1, maxItems: 64,
        items: {
          type: 'object', required: ['role', 'content'], additionalProperties: false,
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string', minLength: 1, maxLength: LARGO_MSG },
          },
        },
      },
      lang: { type: 'string', enum: ['es', 'en', 'auto'] },
    },
  },
};

app.post('/api/chat', { schema: ESQ_CHAT }, async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  if (!hayIA()) {
    return reply.code(501).send({ error: 'sin_ia',
      msg: 'Falta IA_SECRETO: la API no puede hablar con el servicio de IA (ai/). Genera las claves con scripts/claves.sh.' });
  }
  const crudos = Array.isArray(req.body?.mensajes) ? req.body.mensajes : [];
  const mensajes = crudos
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
    .slice(-MAX_HIST)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, LARGO_MSG) }));
  if (!mensajes.length) return reply.code(400).send({ error: 'sin_mensaje' });
  const lang = LANGS.includes(req.body?.lang) && req.body.lang !== 'auto' ? req.body.lang : (u.lang === 'auto' ? 'es' : u.lang);

  // La cookie viaja OPACA al servicio: no se abre ni se traduce a un userId.
  // Ese es el punto — el servicio de IA no puede filtrar lo que no tiene.
  const sesion = req.cookies?.[COOKIE] ?? '';
  if (!sesion) return reply.code(401).send({ error: 'sin_sesion' });
  const r = await hablarConIA({ sesion, mensajes, lang });
  if (r.error) return reply.code(r.error === 'sin_proveedor' ? 501 : 502).send(r);
  return r;
});

// ---------- PDF ----------
app.get('/api/pdf/:lang', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  if (!u.paid) return reply.code(402).send({ error: 'sin_compra' });
  const lang = req.params.lang === 'en' ? 'en' : 'es';
  const { existsSync, createReadStream } = await import('node:fs');
  const path = new URL(`../files/curso-${lang}.pdf`, import.meta.url).pathname;
  if (!existsSync(path)) {
    return reply.code(503).send({ error: 'pdf_no_generado', msg: `Falta api/files/curso-${lang}.pdf (lo produce el build de Chrome headless).` });
  }
  reply.header('content-type', 'application/pdf');
  reply.header('content-disposition', `attachment; filename="ia-desde-cero-${lang}.pdf"`);
  return reply.send(createReadStream(path));
});

// ---------- tutor ----------
app.get('/api/tutor/cohort', async (req, reply) => {
  const u = await requireRole(req, reply, ['tutor', 'admin']); if (!u) return;
  const students = await all(`
    SELECT us.id, us.name, us.email,
      (SELECT COUNT(*)::int FROM (SELECT lab_id FROM attempts
         WHERE user_id = us.id AND correct = 1 GROUP BY lab_id) hechos) AS solved,
      (SELECT MAX(at) FROM attempts WHERE user_id = us.id) AS last_seen
    FROM users us
    WHERE us.role = 'student' AND us.deleted_at IS NULL AND (us.cohort = ? OR ?::text IS NULL)
    ORDER BY last_seen ASC NULLS LAST`, [u.cohort, u.cohort]);
  const stuck = await all(`
    SELECT lab_id, COUNT(*)::int AS tries, SUM(correct)::int AS wins
    FROM attempts GROUP BY lab_id HAVING COUNT(*) >= 2 ORDER BY tries DESC LIMIT 5`);
  return { cohort: u.cohort, students, stuck };
});

// ---------- admin ----------
app.get('/api/admin/users', async (req, reply) => {
  const u = await requireRole(req, reply, ['admin']); if (!u) return;
  return { users: await all(`SELECT id,email,name,role,paid,cohort,created_at FROM users
                             WHERE deleted_at IS NULL ORDER BY created_at DESC`) };
});

app.patch('/api/admin/users/:id/role', async (req, reply) => {
  const actor = await requireRole(req, reply, ['admin']); if (!actor) return;
  const target = await get(USER_BY_ID, [Number(req.params.id)]);
  const role = req.body?.role;
  if (!target) return reply.code(404).send({ error: 'no_existe' });
  if (!['student', 'tutor', 'admin'].includes(role)) return reply.code(400).send({ error: 'rol_invalido' });
  if (target.role === 'admin' && role !== 'admin') {
    const { c: admins } = await get("SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin'");
    if (admins <= 1) return reply.code(409).send({ error: 'ultimo_admin', msg: 'No puedes dejar la plataforma sin admins.' });
  }
  await run('UPDATE users SET role = ? WHERE id = ?', [role, target.id]);
  await run('INSERT INTO role_audit (actor_id,user_id,from_role,to_role) VALUES (?,?,?,?)',
    [actor.id, target.id, target.role, role]);
  return { user: shape(await get(USER_BY_ID, [target.id])) };
});

app.get('/api/admin/payments', async (req, reply) => {
  const u = await requireRole(req, reply, ['admin']); if (!u) return;
  return { payments: await all('SELECT * FROM payments ORDER BY at DESC LIMIT 100') };
});

// ---------- Mercado Pago ----------
// Sin credenciales no hay checkout: se responde 501, no se finge un pago.
// De dónde vuelve el pagador al terminar en Mercado Pago.
const ORIGEN = (process.env.PUBLIC_ORIGIN ?? 'http://localhost:4321').replace(/\/+$/, '');

app.post('/api/payments/mercadopago/preference', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    return reply.code(501).send({ error: 'sin_credenciales', msg: 'Falta MP_ACCESS_TOKEN. Checkout Bricks necesita también MP_PUBLIC_KEY en el frontend.' });
  }
  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ title: 'IA desde cero · Fundamentos Vol. 1', quantity: 1, unit_price: 9.99, currency_id: 'USD' }],
      payer: { email: u.email },
      metadata: { user_id: u.id },
      external_reference: String(u.id),
      // Sin back_urls el pagador queda varado en la pantalla de Mercado Pago.
      back_urls: {
        success: `${ORIGEN}/pago/gracias`,
        pending: `${ORIGEN}/pago/gracias?estado=pendiente`,
        failure: `${ORIGEN}/pago/error`,
      },
      // Mercado Pago rechaza auto_return sobre http, así que en local no se manda.
      ...(ORIGEN.startsWith('https://') ? { auto_return: 'approved' } : {}),
    }),
  });
  if (!res.ok) return reply.code(502).send({ error: 'mp_error', status: res.status, body: await res.text() });
  const pref = await res.json();
  return { preferenceId: pref.id, publicKey: process.env.MP_PUBLIC_KEY ?? null };
});

app.post('/api/payments/mercadopago/webhook', async (req, reply) => {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return reply.code(501).send({ error: 'sin_secreto' });
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const sigHeader = String(req.headers['x-signature'] ?? '');
  const reqId = String(req.headers['x-request-id'] ?? '');
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=').map((s) => s.trim())));
  const dataId = String(req.query?.['data.id'] ?? req.body?.data?.id ?? '');
  const manifest = `id:${dataId};request-id:${reqId};ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  const got = Buffer.from(String(parts.v1 ?? ''), 'hex');
  const exp = Buffer.from(expected, 'hex');
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) {
    return reply.code(401).send({ error: 'firma_invalida' });
  }
  // Firma valida: se ANOTA y se responde 200 ya. Consultar la API de Mercado Pago
  // aqui era el problema — si tarda, ellos dan timeout y reintentan, y el paid=1
  // del comprador quedaba a merced de su politica de reintentos.
  // La clave es el id del pago: su reintento no encola un segundo trabajo.
  const { nuevo } = await encola('pago.mercadopago', { dataId: String(dataId) }, String(dataId));
  return { ok: true, encolado: nuevo };
});

app.get('/api/version', async () => ({
  actual: V_ACTUAL,
  deprecadas: V_VIEJAS.map((v) => ({ version: v, prefijo: `/api/v${v}/`, estado: 'legacy-deprecado',
                                     sunset: SUNSET, golpes: golpes[v] })),
  sinVersion: { prefijo: '/api/', trata_como: V_LEGACY, estado: 'legacy-deprecado' },
  golpesLegacy,
  ia: { url: IA_URL, secreto: Boolean(IA_SECRETO) },
}));

app.get('/api/health', async () => {
  const { c } = await get('SELECT COUNT(*)::int AS c FROM labs');
  return { ok: true, labs: c, cola: await estadoCola() };
});

// ---------- Trabajos en segundo plano ----------
//
// El manejador hace lo que antes hacia el webhook, pero fuera de su respuesta y
// con reintentos. Si la API de Mercado Pago esta caida, lanza: trabajos.js lo
// reprograma con espera exponencial y el pago acaba entrando.
registra('pago.mercadopago', async ({ dataId }) => {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('sin MP_ACCESS_TOKEN');
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`mercadopago ${res.status}`);
  const pay = /** @type {any} */ (await res.json());
  const userId = pay?.metadata?.user_id ?? null;
  await run(`INSERT INTO payments (user_id,ext_id,status,amount,currency,raw) VALUES (?,?,?,?,?,?)
             ON CONFLICT (ext_id) DO UPDATE SET status = excluded.status, raw = excluded.raw`,
    [userId, String(dataId), String(pay.status), Number(pay.transaction_amount ?? 0),
     String(pay.currency_id ?? 'USD'), JSON.stringify(pay)]);
  if (pay.status === 'approved' && userId) await run('UPDATE users SET paid = 1 WHERE id = ?', [userId]);
});

// El esquema se aplica al arrancar: en Docker el backend puede subir antes que la base.
await migrate();

// El obrero arranca DESPUES de migrate(): sin la tabla jobs, su primera consulta
// fallaria y el log abriria con un error que no significa nada.
const paraObrero = obrero({ log: app.log });
for (const s of ['SIGTERM', 'SIGINT']) process.once(s, () => { paraObrero(); process.exit(0); });

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
app.listen({ port, host }).catch((e) => { app.log.error(e); process.exit(1); });
