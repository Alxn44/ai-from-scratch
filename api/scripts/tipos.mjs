// Chequeo de tipos de la API con tsgo (el compilador de TS 7 escrito en Go).
//
// La API es JavaScript y no se compila: esto es SOLO analisis. `checkJs` le da a
// los .js el mismo analisis que a TypeScript sin escribir una linea de TS.
//
// POR QUE HAY UN BASELINE Y NO CERO: 60 de los 61 mensajes son la misma cosa —
// `req.body` y `await res.json()` se leen sin forma declarada, asi que su tipo es
// `unknown` o `{}`. No son bugs: son la marca de donde entra dato externo sin
// validar. El arreglo de verdad es poner esquema JSON a cada ruta (Fastify valida
// solo, como ya hacen /api/chat y /api/interno/herramienta). Eso es trabajo por
// ruta, no un flag.
//
// Lo que este script impide es que el numero SUBA sin que nadie lo note. Un
// informe de 61 que nadie mira no protege nada; un informe que falla en 62 si.
//
//   node scripts/tipos.mjs            comprueba contra el baseline
//   node scripts/tipos.mjs --fijar    reescribe el baseline (con intencion)
//   node scripts/tipos.mjs --lista    imprime todos los mensajes
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const RAIZ = new URL('..', import.meta.url).pathname;
const BASE = `${RAIZ}scripts/tipos-baseline.json`;
const args = process.argv.slice(2);

let salida = '';
try {
  salida = execFileSync(`${RAIZ}node_modules/.bin/tsgo`, ['-p', 'tsconfig.json'],
                        { cwd: RAIZ, encoding: 'utf8' });
} catch (e) {
  // tsgo sale != 0 cuando hay mensajes: eso es lo normal aqui, no un fallo.
  salida = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  if (!salida.trim()) { console.error('tsgo no produjo salida:', e.message); process.exit(2); }
}

const lineas = salida.split('\n').filter((l) => / error TS\d+:/.test(l));
const porArchivo = {};
for (const l of lineas) {
  const f = l.split('(')[0];
  porArchivo[f] = (porArchivo[f] ?? 0) + 1;
}

if (args.includes('--lista')) { console.log(lineas.join('\n')); }

if (args.includes('--fijar')) {
  writeFileSync(BASE, `${JSON.stringify({ total: lineas.length, porArchivo }, null, 2)}\n`);
  console.log(`baseline fijado: ${lineas.length} mensajes`);
  process.exit(0);
}

let base;
try { base = JSON.parse(readFileSync(BASE, 'utf8')); }
catch { console.log(`sin baseline; fijalo con --fijar (ahora hay ${lineas.length})`); process.exit(1); }

if (lineas.length > base.total) {
  console.error(`tipos: SUBIO de ${base.total} a ${lineas.length}`);
  const nuevos = Object.entries(porArchivo)
    .filter(([f, n]) => n > (base.porArchivo[f] ?? 0))
    .map(([f, n]) => `  ${f}: ${base.porArchivo[f] ?? 0} -> ${n}`);
  console.error(nuevos.join('\n'));
  console.error('\nmira los mensajes con: node scripts/tipos.mjs --lista');
  process.exit(1);
}
if (lineas.length < base.total) {
  console.log(`tipos: BAJO de ${base.total} a ${lineas.length} — fijalo con --fijar`);
  process.exit(0);
}
console.log(`tipos: ${lineas.length} mensajes, igual que el baseline`);
