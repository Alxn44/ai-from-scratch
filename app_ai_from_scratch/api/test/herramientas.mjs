// Comportamiento de las 37 herramientas: que respondan con datos y no con un
// error, que la cola y la pila se hablen de verdad (una herramienta encola, otra
// consume) y que el memo ahorre consultas sin servir un dato propio caducado.
//
// El aislamiento se prueba aparte (`test/aislamiento.mjs`). Aquí se prueba que
// esto SIRVE, que es la otra mitad: una superficie segura que no responde nada
// tampoco se puede publicar.
import { get, pool, run } from '../src/db.js';
import { catalogo, ejecutar, familias } from '../src/agent-tools.js';
import { bus, olvidarTodo, verCola } from '../src/agent-bus.js';

let fallos = 0;
const ok = (cond, txt, extra) => {
  console.log(`  ${cond ? 'ok  ' : 'FALLO'} · ${txt}${!cond && extra ? `\n         ${String(extra).slice(0, 220)}` : ''}`);
  if (!cond) fallos++;
};

const YO = await get("SELECT id FROM users WHERE email = 'ricardo@velez.co'");
const ctx = (turno = 'T1') => ({ userId: YO.id, lang: 'es', turno });
const llamar = (nombre, args = {}, turno = 'T1') => ejecutar(ctx(turno), nombre, args);

// Estado de partida conocido: un lab resuelto, otro fallado y nada más.
await run('DELETE FROM attempts WHERE user_id = ?', [YO.id]);
await run('INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES (?,?,?,1)', [YO.id, '1.1', '"buena"']);
await run('INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES (?,?,?,0)', [YO.id, '2.1', '"mala"']);
await run('INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES (?,?,?,0)', [YO.id, '2.1', '"otra mala"']);
olvidarTodo();

console.log('\n1) El catálogo está completo y clasificado');
const cat = catalogo();
const fam = familias();
ok(cat.length === 37, `hay 37 herramientas (hay ${cat.length})`);
ok(fam.contenido.length === 7 && fam.propio.length === 16 && fam.producto.length === 7 && fam.coordinar.length === 7,
  'las cuatro familias tienen 7 · 16 · 7 · 7',
  Object.entries(fam).map(([k, v]) => `${k}=${v.length}`).join(' '));
ok(cat.every((h) => h.descripcion && h.descripcion.length > 20), 'toda herramienta se describe con algo más que su nombre');
ok(new Set(cat.map((h) => h.nombre)).size === cat.length, 'no hay nombres repetidos');

console.log('\n2) Las 37 responden con datos, no con un error');
const ARGS = {
  leccion: { n: 5 }, leccion_texto: { n: 5 }, requisitos_leccion: { n: 7 },
  mis_intentos: { lab_id: '2.1' }, lab_ficha: { lab_id: '2.1' },
  mis_pendientes: { n: 2 }, mi_historial: { dias: 7 },
  buscar_en_curso: { consulta: 'tokens' }, glosario: { termino: 'contexto' },
  donde_encuentro: { consulta: 'cambiar el idioma' }, soporte: { tema: 'olvidé la contraseña' },
  plan_estudio: { sesiones: 3 }, cola_encolar: { tipo: 'tema', ref: 'temperatura' },
  foco_apilar: { tipo: 'leccion', ref: '9' },
};
let vacias = 0;
for (const h of cat) {
  const r = await llamar(h.nombre, ARGS[h.nombre] ?? {});
  if (r?.error) { ok(false, `${h.nombre} devolvió error`, JSON.stringify(r)); continue; }
  if (Object.keys(r).filter((k) => !k.startsWith('_')).length === 0) vacias++;
}
ok(vacias === 0, 'ninguna devuelve un objeto vacío');
olvidarTodo();

console.log('\n3) La cola: una herramienta encola, otra consume (FIFO)');
const plan = await llamar('plan_estudio', { sesiones: 3 });
ok(plan.plan.length === 3 && plan.encolados === 3, 'plan_estudio deja tres labs en la cola', JSON.stringify(plan).slice(0, 200));
const estado = await llamar('cola_estado');
ok(estado.enCola === 3, 'cola_estado ve los tres sin sacarlos');
const primero = await llamar('cola_siguiente');
ok(primero.item.ref === plan.plan[0].lab_id, `sale el primero del plan (${plan.plan[0].lab_id})`);
ok(!!primero.lab && !!primero.mis && !!primero.leccion,
  'y sale resuelto: ficha del lab + intentos propios + lección, en una sola llamada');
ok(primero.quedanEnCola === 2, 'quedan dos en la cola');
ok(!JSON.stringify(primero).includes('solution'), 'lo que sale de la cola no lleva la solución');

console.log('\n4) La pila: lo que se consume pasa a ser el foco, y se puede volver');
const foco = (await llamar('cola_estado')).foco;
ok(foco?.ref === primero.item.ref, 'el lab que salió de la cola quedó como foco');
await llamar('leccion_texto', { n: 11 });
ok((await llamar('cola_estado')).foco?.ref === '11', 'irse a otra lección apila una rama nueva');
const volver = await llamar('foco_volver');
ok(volver.cerrado.ref === '11' && volver.vuelvoA?.ref === primero.item.ref,
  'foco_volver cierra la rama y devuelve al lab de antes', JSON.stringify(volver).slice(0, 200));
ok(volver.ruta === `/leccion/${primero.lab.lesson_n}`, 'y trae la ruta a la que llevar a la persona');

console.log('\n5) mis_errores encola lo atascado');
olvidarTodo();
const err = await llamar('mis_errores');
ok(err.atascados === 1 && err.labs[0].lab_id === '2.1', 've el lab intentado y no resuelto');
ok(err.labs[0].misRespuestasMalas.length === 2, 'con las dos respuestas malas que dio');
ok(!JSON.stringify(err).includes('solution'), 'sin la solución del lab');
ok(verCola(bus(YO.id)).some((i) => i.ref === '2.1' && i.motivo === 'atascado'), 'y lo deja en la cola marcado como atascado');

console.log('\n6) El memo ahorra consultas y caduca lo propio en el turno siguiente');
olvidarTodo();
const p1 = await llamar('mi_progreso', {}, 'A');
const p2 = await llamar('mi_progreso', {}, 'A');
ok(!p1._memo && p2._memo === true, 'la segunda llamada del mismo turno sale de la caché');
const p3 = await llamar('mi_progreso', {}, 'B');
ok(!p3._memo, 'en el turno siguiente se vuelve a consultar la base');
const l1 = await llamar('leccion', { n: 3 }, 'A');
const l2 = await llamar('leccion', { n: 3 }, 'B');
ok(!l1._memo && l2._memo === true, 'el contenido del curso sí se reusa entre turnos');
const c1 = await llamar('cola_estado', {}, 'A');
ok(!c1._memo, 'la cola nunca se cachea: cambia dentro del mismo turno');

console.log('\n7) mi_panorama siembra el memo: cuatro preguntas por el precio de una');
olvidarTodo();
const pan = await llamar('mi_panorama', {}, 'C');
ok(!!pan.perfil && !!pan.progreso && !!pan.racha && !!pan.siguiente && !!pan.liga,
  'trae perfil, progreso, racha, siguiente paso y liga');
const despues = await Promise.all([
  llamar('mi_perfil', {}, 'C'), llamar('mi_progreso', {}, 'C'),
  llamar('mi_racha', {}, 'C'), llamar('mi_siguiente_paso', {}, 'C'),
]);
ok(despues.every((r) => r._memo === true), 'las cuatro por separado salen de la caché, sin tocar la base');
const diag = await llamar('bus_diagnostico', {}, 'C');
ok(diag.memo.consultasAhorradas >= 4, `el diagnóstico cuenta las consultas ahorradas (${diag.memo.consultasAhorradas})`);

console.log('\n8) Lo que responde de verdad a lo que se pregunta por chat');
const paso = await llamar('mi_siguiente_paso', {}, 'D');
ok(paso.hay && paso.lab_id === '1.2', `«¿qué hago ahora?» → el 1.2 (dijo ${paso.lab_id})`);
const acceso = await llamar('mi_acceso', {}, 'D');
ok(Array.isArray(acceso.abiertas) && acceso.abiertas.includes(1), '«¿por qué no puedo abrir la 4?» → lista de abiertas y cerradas');
const precio = await llamar('precio_y_compra', {}, 'D');
ok(precio.precio.monto === 9.99 && precio.garantiaDias === 14, '«¿cuánto cuesta?» → 9.99 USD y 14 días de garantía');
const donde = await llamar('donde_encuentro', { consulta: 'descargar el pdf' }, 'D');
ok(donde.rutas[0]?.ruta === '/perfil', '«¿dónde descargo el pdf?» → /perfil');
const sop = await llamar('soporte', { tema: 'pagué y sigue cerrado' }, 'D');
ok(sop.respuestas[0]?.id === 'pague_sigue_cerrado', '«pagué y sigue cerrado» → la respuesta frecuente que toca');
const glos = await llamar('glosario', { termino: 'temperatura' }, 'D');
ok(glos.entradas[0]?.leccion === 9, '«¿qué es la temperatura?» → lección 9');
const busca = await llamar('buscar_en_curso', { consulta: 'inventa cosas que suenan bien' }, 'D');
ok(busca.resultados.some((r) => r.leccion === 10), '«inventa cosas» → lección 10', JSON.stringify(busca.resultados).slice(0, 200));
const falta = await llamar('logros_faltantes', {}, 'D');
ok(falta.siguientes[0]?.teFaltan >= 1, '«¿qué me falta para el siguiente logro?» → qué hacer exactamente');
const ritmo = await llamar('mi_ritmo', {}, 'D');
ok(ritmo.faltan === 35 && ritmo.totalLabs === 36, '«¿cuánto me queda?» → 35 de 36');
const priv = await llamar('mis_datos_y_privacidad', {}, 'D');
ok(priv.deTi.intentosGuardados === 3 && !JSON.stringify(priv).includes('@'),
  '«¿qué sabes de mí?» → conteos, y ni un correo');

console.log('\n9) El texto de la lección respeta el idioma y no se inventa nada');
const en = await ejecutar({ userId: YO.id, lang: 'en', turno: 'E' }, 'leccion_texto', { n: 4 });
ok(en.idioma === 'en' && /[A-Za-z]/.test(en.tecnica), 'con la sesión en inglés llega el texto en inglés');
const otraVez = await ejecutar({ userId: YO.id, lang: 'es', turno: 'E' }, 'leccion_texto', { n: 4 });
ok(otraVez.idioma === 'es', 'la caché del contenido no cruza idiomas: el mismo texto en español sale en español');
const fr = await ejecutar({ userId: YO.id, lang: 'fr', turno: 'E' }, 'leccion_texto', { n: 4 });
ok(fr.idioma === 'es' && fr.nota, 'sin francés cae al español y lo avisa en la nota');
const nada = await llamar('glosario', { termino: 'blockchain' }, 'E');
ok(nada.hallado === false && nada.nota, 'un término que no es del curso se dice, no se atribuye a una lección');

console.log('\n10) La liga y la tabla no cruzan personas');
const liga = await llamar('mi_liga', {}, 'F');
ok(!!liga.explicacion, 'mi_liga explica por qué está o no está en liga');
const tabla = await llamar('ligas_tabla', {}, 'F');
ok(!JSON.stringify(tabla).includes('user_id'), 'la tabla de la liga no lleva ningún user_id');

await run('DELETE FROM attempts WHERE user_id = ?', [YO.id]);
await pool.end();
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nsin fallos');
process.exit(fallos ? 1 : 0);
