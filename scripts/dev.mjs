// `pnpm dev`: levanta TODO en un comando y falla ruidosamente si algo no sube.
//
// Antes esto era una cadena de shell y se rompía en los dos casos reales:
// un volumen nuevo arrancaba sin contenido, y los restos de una corrida anterior
// (api local huérfano en 8787, daemon de `astro dev` vivo) hacían que el arranque
// nuevo muriera en silencio mientras los procesos viejos seguían respondiendo.
import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 8787, WEB = 4321;

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

for (const [puerto, quien] of [[API, 'api'], [WEB, 'web']]) {
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

// ---------- 3. contenido ----------
paso('Sembrando (idempotente: actualiza lecciones y labs, no borra intentos)');
if (correr('pnpm', ['--dir', 'api', 'seed']).status !== 0) {
  console.error('\nLa siembra falló. Sin contenido no hay curso: paro aquí.');
  process.exit(1);
}

// ---------- 4. los dos procesos ----------
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

function lanzar(nombre, dir, color) {
  const p = spawn('pnpm', ['--dir', dir, 'dev'], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
  const marca = `\x1b[${color}m[${nombre}]\x1b[0m `;
  const pintar = (buf) => String(buf).split('\n').filter(Boolean).forEach((l) => console.log(marca + l));
  p.stdout.on('data', pintar);
  p.stderr.on('data', pintar);
  p.on('exit', async (code) => {
    if (cerrando) return;
    const puerto = nombre === 'api' ? API : WEB;
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
  for (const puerto of [API, WEB]) {
    for (const pid of ocupando(puerto)) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  }
  process.exit(codigo);
}

process.on('SIGINT', () => cerrar(0));
process.on('SIGTERM', () => cerrar(0));

paso(`Arrancando api (127.0.0.1:${API}) y web (localhost:${WEB})`);
lanzar('api', 'api', '35');
lanzar('web', 'web', '34');

const [apiOk, webOk] = await Promise.all([sirve(API), sirve(WEB)]);
if (!apiOk || !webOk) {
  console.error(`\nNo levantó todo: api ${apiOk ? 'ok' : 'CAÍDA'}, web ${webOk ? 'ok' : 'CAÍDA'}.`);
  cerrar(1);
}
console.log('\n  \x1b[32m✓\x1b[0m api y web respondiendo');
console.log('  Web:  http://localhost:4321/login   ricardo@velez.co / Curso2026*');
console.log('  API:  http://localhost:8787/api/health');
console.log('  Ctrl-C cierra los dos y el daemon de Astro.\n');
