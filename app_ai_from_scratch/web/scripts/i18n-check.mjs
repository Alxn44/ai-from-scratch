// Comprueba que el árbol de cadenas de 'es' y 'en' tenga exactamente las mismas
// rutas. Sin esto la deriva es silenciosa: la página en inglés renderiza undefined.
import { STR } from '../src/lib/i18n.ts';

const rutas = (o, base = '') => {
  const out = [];
  for (const [k, v] of Object.entries(o)) {
    const p = base ? `${base}.${k}` : k;
    if (Array.isArray(v)) {
      out.push(`${p}.length=${v.length}`);
      v.forEach((x) => (x && typeof x === 'object' ? out.push(...rutas(x, `${p}[*]`)) : null));
    } else if (v && typeof v === 'object') out.push(...rutas(v, p));
    else out.push(p);
  }
  return [...new Set(out)];
};

const es = new Set(rutas(STR.es));
const en = new Set(rutas(STR.en));
const faltanEn = [...es].filter((k) => !en.has(k));
const faltanEs = [...en].filter((k) => !es.has(k));
const vacias = [];
const scan = (o, base) => {
  for (const [k, v] of Object.entries(o)) {
    const p = `${base}.${k}`;
    if (Array.isArray(v)) v.forEach((x) => (x && typeof x === 'object' ? scan(x, `${p}[*]`) : null));
    else if (v && typeof v === 'object') scan(v, p);
    else if (typeof v === 'string' && !v.trim()) vacias.push(p);
  }
};
scan(STR.es, 'es'); scan(STR.en, 'en');

console.log(`claves es=${es.size} en=${en.size}`);
if (faltanEn.length) console.error(`faltan en 'en': ${faltanEn.join(', ')}`);
if (faltanEs.length) console.error(`faltan en 'es': ${faltanEs.join(', ')}`);
if (vacias.length) console.error(`vacías: ${vacias.join(', ')}`);
if (faltanEn.length || faltanEs.length || vacias.length) process.exit(1);
console.log('i18n: sin deriva');
