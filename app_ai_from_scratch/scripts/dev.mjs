// `pnpm dev`: levanta TODO en un comando y falla ruidosamente si algo no sube.
//
// TODO = Postgres + RabbitMQ + servicio de IA (Python, 8799) + api (8787) + web (4321).
// El de IA se añadió en v3: sin él el chat responde 502 y parece un bug del chat.
//
// Los tres puertos se mueven con API_PORT / WEB_PORT / IA_PORT. Postgres y
// RabbitMQ los levanta docker compose; los tres procesos de arriba corren
// locales para tener recarga en caliente.
//
// Dos fallos NO paran el arranque, y es a propósito: el broker (los workers no
// publican, el curso entero sigue) y el servicio de IA (el chat da 502, las otras
// 11 pantallas siguen). Todo lo demás para y dice por qué.
//
// Antes esto era una cadena de shell y se rompía en los dos casos reales:
// un volumen nuevo arrancaba sin contenido, y los restos de una corrida anterior
// (api local huérfano en 8787, daemon de `astro dev` vivo) hacían que el arranque
// nuevo muriera en silencio mientras los procesos viejos seguían respondiendo.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Los puertos se pueden mover. No es un lujo: en esta máquina el 8787 lo tenía
// un proceso de otro proyecto, y sin esto `pnpm dev` no tenía salida — o mataba
// algo ajeno o no arrancaba. Con esto: `API_PORT=8791 pnpm dev`.
const API = Number(process.env.API_PORT ?? 8787);
const WEB = Number(process.env.WEB_PORT ?? 4321);
const IA = Number(process.env.IA_PORT ?? 8799);
const hay = (cmd) => spawnSync('command', ['-v', cmd], { shell: true, stdio: 'ignore' }).status === 0;

const paso = (t) => console.log(`\x1b[36m▸\x1b[0m ${t}`);
const aviso = (t) => console.log(`\x1b[33m!\x1b[0m ${t}`);

function correr(cmd, args, opciones = {}) {
  return spawnSync(cmd, args, { cwd: RAIZ, stdio: 'inherit', ...opciones });
}

/** PIDs que escuchan en loopback. Solo loopback: no toca lo que escuche en otra
 *  interfaz (una app en la IP de Tailscale, por ejemplo). */
function ocupando(puerto) {
  // Las dos pilas: la api escucha en 127.0.0.1 y el dev server de Astro en [::1].
  const pids = new Set();
  for (const host of [`tcp@127.0.0.1:${puerto}`, `tcp@[::1]:${puerto}`]) {
    const r = spawnSync('lsof', ['-ti', host, '-sTCP:LISTEN'], { encoding: 'utf8' });
    (r.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean).forEach((n) => pids.add(Number(n)));
  }
  return [...pids];
}

/** El directorio de trabajo de un PID, o null si no se puede leer. */
function cwdDe(pid) {
  const r = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
  const linea = (r.stdout ?? '').split('\n').find((l) => l.startsWith('n'));
  return linea ? linea.slice(1) : null;
}

const cmdDe = (pid) =>
  (spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '').trim();

/**
 * ¿Ese proceso es de este repositorio?
 *
 * Esto existe porque antes no existía. La versión anterior mandaba SIGTERM a
 * CUALQUIER cosa que escuchara en 8787, 4321 u 8799 en loopback, y en esta
 * máquina el 8787 lo tenía un `node` de otro proyecto: `pnpm dev` lo habría
 * matado sin decir nada. Un lanzador que limpia el terreno matando procesos que
 * no son suyos no está limpiando, está rompiendo el trabajo de al lado.
 *
 * Se decide por el cwd, no por el nombre del comando: dos proyectos con Astro
 * lanzan procesos idénticos, y lo único que los distingue es desde dónde
 * corren. Si el cwd no se puede leer, la respuesta es NO: no se mata lo que no
 * se ha podido identificar.
 */
function esNuestro(pid) {
  const cwd = cwdDe(pid);
  return !!cwd && (cwd === RAIZ || cwd.startsWith(`${RAIZ}/`));
}

// ---------- 1. dejar el terreno limpio ----------
paso('Parando contenedores api y web (van a correr locales)');
correr('docker', ['compose', 'stop', 'api', 'web'], { stdio: 'ignore' });

paso('Cerrando cualquier dev server de Astro anterior');
// `astro dev` deja un daemon con PPID 1: sobrevive a que se cierre la terminal.
correr('pnpm', ['exec', 'astro', 'dev', 'stop'], { stdio: 'ignore', cwd: resolve(RAIZ, 'web') });

const VARIABLE = { api: 'API_PORT', web: 'WEB_PORT', ia: 'IA_PORT' };
const ajenos = [];

for (const [puerto, quien] of [[API, 'api'], [WEB, 'web'], [IA, 'ia']]) {
  const pids = ocupando(puerto);
  const mios = pids.filter(esNuestro);
  const otros = pids.filter((p) => !esNuestro(p));

  if (mios.length) {
    aviso(`Puerto ${puerto} (${quien}) ocupado por una corrida anterior de este repo (${mios.join(', ')}) — lo libero`);
    for (const pid of mios) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  }
  for (const pid of otros) ajenos.push({ puerto, quien, pid, cmd: cmdDe(pid) });
}

// Un puerto ocupado por otro proyecto no se libera: se dice y se para. Matarlo
// sería tirar el trabajo de al lado para arrancar el nuestro.
if (ajenos.length) {
  console.error('\n\x1b[31m✗\x1b[0m No arranco: hay puertos ocupados por procesos que NO son de este repositorio.');
  for (const { puerto, quien, pid, cmd } of ajenos) {
    console.error(`\n  puerto ${puerto} (${quien}) — PID ${pid}`);
    console.error(`    ${cmd || '(no pude leer el comando)'}`);
    console.error(`    cwd: ${cwdDe(pid) ?? '(no legible)'}`);
  }
  console.error('\nNo los mato yo: no son míos. Dos salidas, la que prefieras:');
  console.error('  · mover nuestro puerto  ->  ' + ajenos.map(({ quien, puerto }) => `${VARIABLE[quien]}=${puerto + 4}`).join(' ') + ' pnpm dev');
  console.error('  · liberar el puerto tú  ->  kill ' + ajenos.map((a) => a.pid).join(' '));
  console.error('\nSi mueves el puerto de la api, la web se entera sola: `pnpm dev` le pasa API_URL.\n');
  process.exit(1);
}

// ---------- 2. base de datos, esperando a que esté sana ----------
paso('Levantando Postgres y esperando el healthcheck');
if (correr('docker', ['compose', 'up', '-d', '--wait', 'db']).status !== 0) {
  // El mensaje anterior era «¿Esta corriendo Docker?» y mentia: la causa real de
  // este fallo fue un choque de puerto 5432 al cambiar el nombre del proyecto de
  // compose. Decir la causa equivocada cuesta media hora de buscar donde no es.
  console.error('\nNo pude levantar Postgres. Docker ya imprimio la causa arriba.');
  console.error('Las dos habituales:');
  console.error('  · el 5432 ya lo tiene otro contenedor  ->  docker ps -a | grep 5432');
  console.error('  · Docker no esta corriendo             ->  docker info');
  process.exit(1);
}

paso('Levantando Postgres de mensajes (log del chat, JSONB)');
if (correr('docker', ['compose', 'up', '-d', '--wait', 'messages-db']).status !== 0) {
  aviso('messages-db no quedó sano. El chat responde; los turnos no se guardan.');
  aviso('Causa habitual: MESSAGES_DB_PASSWORD sin definir  ->  scripts/keys.sh');
}

// El broker sí se levanta, pero su caída NO para el arranque. Mismo criterio que
// el servicio de IA: RabbitMQ es el transporte ENTRE servicios (worker de api,
// worker de ia). Las pantallas del curso no pasan por él, y `bus.ts` reporta
// fallo en vez de fingir que publicó. Pararlo todo por el broker convertiría una
// degradación en una caída.
paso('Levantando RabbitMQ (colas entre servicios)');
if (correr('docker', ['compose', 'up', '-d', '--wait', 'broker']).status !== 0) {
  aviso('El broker no quedó sano. Los workers no publicarán; api y web funcionan.');
  aviso('Causa habitual: RABBITMQ_PASSWORD sin definir  ->  scripts/keys.sh');
}

// ---------- 3. el artefacto de la ontologia ----------
//
// api/src/ontology.ts LANZA al importarse si falta este archivo (linea 33): sin
// la lista de columnas prohibidas, la guardia no protege nada y arrancar seria
// peor que parar. Lo genera Python, asi que en un clon nuevo hay que generarlo
// antes de tocar la api — si no, la api muere al importar y `pnpm dev` mata todo
// con un error que no dice por que.
const ONTO = resolve(RAIZ, 'api/src/ontologia.json');
const conUv = hay('uv');
if (!existsSync(ONTO)) {
  if (!conUv) {
    console.error('\nFalta api/src/ontologia.json y lo genera Python (ai/).');
    console.error('Instala uv (https://docs.astral.sh/uv/) y repite, o copia el archivo de otra maquina.');
    console.error('Sin el, la API no arranca: es la lista de columnas que nunca pueden salir.');
    process.exit(1);
  }
  paso('Generando api/src/ontologia.json (no estaba)');
  if (correr('uv', ['--directory', 'ai', 'run', 'ai-export']).status !== 0) {
    console.error('\nEl exportador falló. Si es por una violación de aislamiento, arréglala antes de seguir.');
    process.exit(1);
  }
}

// ---------- 4. esquema ----------
// El esquema ya no lo crea el servidor al arrancar. Lo crearon veinte DDL
// idempotentes dentro de migrate(), que no sabe expresar un rename ni un cambio
// de tipo, no guarda historial y no detecta que alguien alteró la base a mano.
// Ahora manda Prisma (api/prisma/migrations) y aplicarlo es un paso aparte:
// con dos instancias, dos procesos corriendo DDL a la vez es una carrera.
paso('Aplicando migraciones de esquema (Prisma)');
if (correr('pnpm', ['--dir', 'api', 'db:deploy']).status !== 0) {
  console.error('\nLas migraciones fallaron. El servidor no arranca contra un esquema sin aplicar: paro aquí.');
  console.error('Mira el estado con: pnpm --dir api db:status');
  process.exit(1);
}

// Deriva: ¿la base coincide con lo que dicen las migraciones? Sale 2 si no.
// Es un aviso, no un fallo: en local es normal estar probando un ALTER a mano,
// y enterarse es justo lo que las veinte DDL idempotentes nunca podían decir.
const deriva = correr('pnpm', ['--dir', 'api', 'db:drift'], { stdio: 'ignore' }).status;
if (deriva === 2) {
  aviso('La base NO coincide con prisma/migrations. Genera una migración con: pnpm --dir api db:migrate');
}

// ---------- 5. contenido ----------
paso('Sembrando (idempotente: actualiza lecciones y labs, no borra intentos)');
if (correr('pnpm', ['--dir', 'api', 'seed']).status !== 0) {
  console.error('\nLa siembra falló. Sin contenido no hay curso: paro aquí.');
  process.exit(1);
}

// ---------- 6. los tres procesos ----------
const hijos = [];
let cerrando = false;

/** ¿Hay algo sirviendo en ese puerto? Sin dependencias: una conexión TCP. */
function sirve(puerto, msTotal = 12000) {
  const fin = Date.now() + msTotal;
  return new Promise((resolve) => {
    const probar = () => {
      const s = connect({ host: 'localhost', port: puerto, autoSelectFamily: true });
      s.setTimeout(700);
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', reintentar);
      s.on('timeout', reintentar);
      function reintentar() {
        s.destroy();
        if (Date.now() > fin) return resolve(false);
        setTimeout(probar, 350);
      }
    };
    probar();
  });
}

function lanzar(nombre, dir, color, cmd = null, env = {}) {
  const [bin, ...args] = cmd ?? ['pnpm', '--dir', dir, 'dev'];
  const p = spawn(bin, args, { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const marca = `\x1b[${color}m[${nombre}]\x1b[0m `;
  const pintar = (buf) => String(buf).split('\n').filter(Boolean).forEach((l) => console.log(marca + l));
  p.stdout.on('data', pintar);
  p.stderr.on('data', pintar);
  p.on('exit', async (code) => {
    if (cerrando) return;
    const puerto = { api: API, web: WEB, ia: IA }[nombre];
    if (code === 0 && (await sirve(puerto, 8000))) {
      // `astro dev` delega en un daemon y termina con 0. No es una caída.
      console.log(`${marca}corriendo en segundo plano (puerto ${puerto}). Logs: pnpm --dir ${dir} exec astro dev logs`);
      return;
    }
    // Si de verdad se cayó, se cae todo: media aplicación viva responde y engaña.
    console.error(`\n${marca}salió con código ${code} y el puerto ${puerto} no responde. Cierro el resto.`);
    cerrar(code || 1);
  });
  hijos.push(p);
  return p;
}

function cerrar(codigo) {
  if (cerrando) return;
  cerrando = true;
  for (const h of hijos) { try { h.kill('SIGTERM'); } catch {} }
  correr('pnpm', ['exec', 'astro', 'dev', 'stop'], { stdio: 'ignore', cwd: resolve(RAIZ, 'web') });
  // Barrido final por puerto, pero SOLO lo nuestro. Esto antes mataba cualquier
  // cosa que ocupara los tres puertos al salir: si otro proyecto había tomado uno
  // mientras corríamos, Ctrl-C se lo llevaba por delante.
  for (const puerto of [API, WEB, IA]) {
    for (const pid of ocupando(puerto)) {
      if (esNuestro(pid)) { try { process.kill(pid, 'SIGTERM'); } catch {} }
    }
  }
  process.exit(codigo);
}

process.on('SIGINT', () => cerrar(0));
process.on('SIGTERM', () => cerrar(0));

// El servicio de IA arranca PRIMERO: si la api sube antes, la primera petición de
// chat da 502 y parece un bug del chat cuando es una carrera de arranque.
//
// Sin uv NO se bloquea todo el curso: 11 de las 12 pantallas no necesitan IA. Se
// avisa y se sigue, y el chat responde con su error propio en vez de fingir.
let iaOk = false;
if (conUv) {
  paso(`Arrancando el servicio de IA (127.0.0.1:${IA})`);
  correr('uv', ['--directory', 'ai', 'sync', '-q', '--extra', 'dev'], { stdio: 'ignore' });
  // --env-file es obligatorio: uvicorn NO lee ai/.env por su cuenta. Sin esto el
  // servicio arranca, /salud responde 200, y el chat da 502 con
  // «IA_SECRETO sin configurar en el servicio» — un fallo que parece del chat.
  // (En Docker las variables llegan por `environment:` y no hay archivo, de ahí
  // el existsSync.)
  const envIA = resolve(RAIZ, 'ai/.env');
  lanzar('ia', 'ai', '36',
         ['uv', '--directory', 'ai', 'run', 'python', '-m', 'uvicorn', 'course_ai.app:app',
          '--host', '127.0.0.1', '--port', String(IA),
          ...(existsSync(envIA) ? ['--env-file', envIA] : [])]);
  iaOk = await sirve(IA);
  if (!iaOk) aviso(`El servicio de IA no respondió en ${IA}. El chat dará 502; el resto funciona.`);
} else {
  aviso('Sin uv: no arranco el servicio de IA. El chat responderá 502 y el resto funciona.');
}

// Los puertos se PASAN, no se asumen. La api lee PORT, y la web tiene que
// apuntar a donde quedó la api: si se mueve uno y no el otro, la web arranca y
// cada petición muere en ECONNREFUSED, que desde el navegador parece un fallo de
// la api y no de la configuración.
paso('Arrancando el almacén de mensajes (127.0.0.1:8786)');
if (existsSync(resolve(RAIZ, 'messages/package.json')) && existsSync(resolve(RAIZ, 'messages/.env'))) {
  const p = spawn('pnpm', ['--dir', 'messages', 'dev'], {
    cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
  });
  const marca = '\x1b[33m[messages]\x1b[0m ';
  const pintar = (buf) => String(buf).split('\n').filter(Boolean).forEach((l) => console.log(marca + l));
  p.stdout.on('data', pintar);
  p.stderr.on('data', pintar);
  p.on('exit', (code) => {
    if (!cerrando) aviso(`messages salió con código ${code}. El chat responde; los turnos no se guardan.`);
  });
  hijos.push(p);
} else {
  aviso('Sin messages/.env: los turnos de chat no se guardan.  ->  scripts/keys.sh');
}

paso(`Arrancando api (127.0.0.1:${API}) y web (localhost:${WEB})`);
lanzar('api', 'api', '35', null, { PORT: String(API) });
lanzar('web', 'web', '34', ['pnpm', '--dir', 'web', 'exec', 'astro', 'dev', '--port', String(WEB)],
       { API_URL: `http://127.0.0.1:${API}` });

const [apiOk, webOk] = await Promise.all([sirve(API), sirve(WEB)]);
if (!apiOk || !webOk) {
  console.error(`\nNo levantó todo: api ${apiOk ? 'ok' : 'CAÍDA'}, web ${webOk ? 'ok' : 'CAÍDA'}.`);
  cerrar(1);
}

// El secreto tiene que ser el MISMO en api/.env y ai/.env. Si difieren, el
// servicio devuelve 401, la api lo traduce a 502, y desde el navegador eso parece
// un bug del chat. Se comprueba comparando los archivos y no por HTTP: /salud no
// pide secreto (no probaría nada) y /agente/turno pide sesión, así que ninguna
// ruta sirve para verificarlo desde aquí.
function leeEnv(ruta, clave) {
  if (!existsSync(ruta)) return null;
  const l = readFileSync(ruta, 'utf8').split('\n').find((x) => x.startsWith(`${clave}=`));
  return l ? l.slice(clave.length + 1).trim() : null;
}
let notaIA = iaOk ? 'ok' : 'no';
if (iaOk) {
  const sApi = leeEnv(resolve(RAIZ, 'api/.env'), 'IA_SECRETO');
  const sIa = leeEnv(resolve(RAIZ, 'ai/.env'), 'IA_SECRETO');
  if (!sApi || !sIa) {
    notaIA = 'arriba, pero falta IA_SECRETO en un .env';
    aviso(`Falta IA_SECRETO en ${!sApi ? 'api/.env' : 'ai/.env'}. Genéralo con scripts/keys.sh.`);
  } else if (sApi !== sIa) {
    notaIA = 'arriba, pero los secretos NO coinciden';
    aviso('IA_SECRETO distinto en api/.env y ai/.env: el chat dará 502. Iguálalos.');
  } else {
    const salud = await fetch(`http://127.0.0.1:${IA}/salud`).then((r) => r.json()).catch(() => null);
    // Comparar los .env NO basta: el proceso puede no haberlos cargado. Esta
    // primera versión daba verde mientras el chat devolvía 502 porque uvicorn
    // arrancó sin --env-file. `secreto_configurado` lo lee del entorno DEL
    // PROCESO, que es lo único que importa.
    if (salud && salud.secreto_configurado === false) {
      notaIA = 'arriba, pero el proceso no cargó IA_SECRETO';
      aviso('El servicio arrancó sin IA_SECRETO en su entorno: el chat dará 502.');
    } else if (!salud) {
      notaIA = 'arriba, pero /salud no respondió';
    } else {
      notaIA = salud.proveedores?.length
        ? `ok · ${salud.proveedores.join(', ')}`
        : 'ok, sin llave de modelo (el chat dirá sin_proveedor)';
      if (salud.violaciones) aviso(`El grafo declara ${salud.violaciones} violación(es) de aislamiento.`);
    }
  }
}

console.log('\n  \x1b[32m✓\x1b[0m api y web respondiendo');
console.log(`  IA:   ${notaIA}`);
// This line used to print the seeded admin password in the clear. It is the last
// thing `pnpm dev` says, so it lived in terminal scrollback, in tmux history and
// in every `pnpm dev > dev.log` a person ever redirected. The password is never
// ours to print anyway: api/src/seed.ts only creates the demo accounts when
// SEED_DEMO_USERS=1, and it takes the value from SEED_DEMO_PASSWORD — the
// operator already typed it. Say the email, point at where the password came
// from, print neither it nor its length.
if (process.env.SEED_DEMO_USERS === '1') {
  console.log(`  Web:  http://localhost:${WEB}/login   ricardo@velez.co`);
  console.log('        clave: la que pusiste en SEED_DEMO_PASSWORD (no se imprime)');
} else {
  console.log(`  Web:  http://localhost:${WEB}/login`);
  console.log('        sin usuarios demo. Para sembrarlos: SEED_DEMO_USERS=1 y');
  console.log('        SEED_DEMO_PASSWORD=<10+ caracteres> en el entorno, y repite `pnpm dev`');
}
console.log(`  API:  http://localhost:${API}/api/health`);
console.log('  Ctrl-C cierra los tres y el daemon de Astro.\n');
