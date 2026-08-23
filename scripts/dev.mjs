// `pnpm dev`: levanta TODO en un comando y falla ruidosamente si algo no sube.
//
// TODO = Postgres + servicio de IA (Python, 8799) + api (8787) + web (4321).
// El de IA se añadió en v3: sin él el chat responde 502 y parece un bug del chat.
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
const API = 8787, WEB = 4321, IA = 8799;
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

// ---------- 1. dejar el terreno limpio ----------
paso('Parando contenedores api y web (van a correr locales)');
correr('docker', ['compose', 'stop', 'api', 'web'], { stdio: 'ignore' });

paso('Cerrando cualquier dev server de Astro anterior');
// `astro dev` deja un daemon con PPID 1: sobrevive a que se cierre la terminal.
correr('pnpm', ['exec', 'astro', 'dev', 'stop'], { stdio: 'ignore', cwd: resolve(RAIZ, 'web') });

for (const [puerto, quien] of [[API, 'api'], [WEB, 'web'], [IA, 'ia']]) {
  const pids = ocupando(puerto);
  if (pids.length) {
    aviso(`Puerto ${puerto} (${quien}) ocupado por ${pids.join(', ')} — lo libero`);
    for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  }
}

// ---------- 2. base de datos, esperando a que esté sana ----------
paso('Levantando Postgres y esperando el healthcheck');
if (correr('docker', ['compose', 'up', '-d', '--wait', 'db']).status !== 0) {
  console.error('\nNo pude levantar Postgres. ¿Está corriendo Docker?');
  process.exit(1);
}

// ---------- 3. el artefacto de la ontologia ----------
//
// api/src/ontology.js LANZA al importarse si falta este archivo (linea 33): sin
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
  if (correr('uv', ['--directory', 'ai', 'run', 'ia-exporta']).status !== 0) {
    console.error('\nEl exportador falló. Si es por una violación de aislamiento, arréglala antes de seguir.');
    process.exit(1);
  }
}

// ---------- 4. contenido ----------
paso('Sembrando (idempotente: actualiza lecciones y labs, no borra intentos)');
if (correr('pnpm', ['--dir', 'api', 'seed']).status !== 0) {
  console.error('\nLa siembra falló. Sin contenido no hay curso: paro aquí.');
  process.exit(1);
}

// ---------- 5. los tres procesos ----------
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

function lanzar(nombre, dir, color, cmd = null) {
  const [bin, ...args] = cmd ?? ['pnpm', '--dir', dir, 'dev'];
  const p = spawn(bin, args, { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
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
  for (const puerto of [API, WEB, IA]) {
    for (const pid of ocupando(puerto)) { try { process.kill(pid, 'SIGTERM'); } catch {} }
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
         ['uv', '--directory', 'ai', 'run', 'uvicorn', 'ia.app:app',
          '--host', '127.0.0.1', '--port', String(IA),
          ...(existsSync(envIA) ? ['--env-file', envIA] : [])]);
  iaOk = await sirve(IA);
  if (!iaOk) aviso(`El servicio de IA no respondió en ${IA}. El chat dará 502; el resto funciona.`);
} else {
  aviso('Sin uv: no arranco el servicio de IA. El chat responderá 502 y el resto funciona.');
}

paso(`Arrancando api (127.0.0.1:${API}) y web (localhost:${WEB})`);
lanzar('api', 'api', '35');
lanzar('web', 'web', '34');

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
    aviso(`Falta IA_SECRETO en ${!sApi ? 'api/.env' : 'ai/.env'}. Genéralo con scripts/claves.sh.`);
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
console.log('  Web:  http://localhost:4321/login   ricardo@velez.co / Curso2026*');
console.log('  API:  http://localhost:8787/api/health');
console.log('  Ctrl-C cierra los tres y el daemon de Astro.\n');
