// Behaviour of the 37 tools: that they answer with data rather than an error, that
// the queue and the stack really talk to each other (one tool enqueues, another
// consumes) and that the memo saves queries without serving stale own data.
//
// Isolation is tested separately (`test/isolation.mts`). Here what is tested is
// that this is USEFUL, which is the other half: a safe surface that answers
// nothing cannot ship either.
import { get, pool, run } from '../src/db.ts';
import { catalog, run as runTool, families } from '../src/tools/index.ts';
import type { Ctx, ToolResult } from '../src/tools/index.ts';
import { bus, forgetAll, viewQueue } from '../src/agent-bus.ts';

let fallos = 0;
const ok = (cond: boolean, txt: string, extra?: unknown): void => {
  console.log(`  ${cond ? 'ok  ' : 'FALLO'} · ${txt}${!cond && extra ? `\n         ${String(extra).slice(0, 220)}` : ''}`);
  if (!cond) fallos++;
};

const YO = await get<{ id: number }>("SELECT id FROM users WHERE email = 'ricardo@velez.co'");
const ctx = (turn = 'T1', lang = 'es'): Ctx => ({ userId: YO!.id, lang, turn });
// The shapes the assertions below read. Declaring them is the whole point of the
// migration: `plan.plan[0].lab_id` written with the wrong column name is now a
// compile error, instead of an `undefined` that quietly makes the check pass.
// Only the fields actually asserted on are listed; the rest of each answer still
// arrives, it is just not typed here.
interface Focus { tipo: string; ref: string; nota?: string | null; motivo?: string | null }
interface PlanResult { plan: { orden: number; lab_id: string; leccion: number }[]; encolados: number }
interface QueueStateResult { enCola: number; foco: Focus | null }
interface NextResult { item: Focus; lab: { lesson_n: number }; mis: unknown; leccion: unknown; quedanEnCola: number }
interface BackResult { cerrado: Focus; vuelvoA: Focus | null; ruta: string | null }
interface MistakesResult { atascados: number; labs: { lab_id: string; misRespuestasMalas: unknown[] }[] }
interface DiagResult { memo: { consultasAhorradas: number } }
interface PriceResult { precio: { monto: number }; garantiaDias: number }
interface SearchResult { resultados: { leccion: number }[] }
interface PrivacyResult { deTi: { intentosGuardados: number } }
interface LessonTextResult { idioma: string; tecnica: string; analogia: string; nota?: string | null }
interface GlossaryResult { hallado: boolean; nota?: string | null }

function llamar<T = ToolResult>(name: string, args: Record<string, unknown> = {},
                                turn = 'T1', lang = 'es'): Promise<T & ToolResult> {
  return runTool(ctx(turn, lang), name, args) as Promise<T & ToolResult>;
}

// Estado de partida conocido: un lab resuelto, otro fallado y nada más.
await run('DELETE FROM attempts WHERE user_id = ?', [YO!.id]);
await run('INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES (?,?,?,1)', [YO!.id, '1.1', '"buena"']);
await run('INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES (?,?,?,0)', [YO!.id, '2.1', '"mala"']);
await run('INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES (?,?,?,0)', [YO!.id, '2.1', '"otra mala"']);
forgetAll();

console.log('\n1) El catálogo está completo y clasificado');
const cat = catalog();
const fam = families();
ok(cat.length === 37, `hay 37 herramientas (hay ${cat.length})`);
ok(fam.contenido!.length === 7 && fam.propio!.length === 16 && fam.producto!.length === 7 && fam.coordinar!.length === 7,
  'las cuatro familias tienen 7 · 16 · 7 · 7',
  Object.entries(fam).map(([k, v]) => `${k}=${v.length}`).join(' '));
ok(cat.every((h) => !!h.descripcion && h.descripcion.length > 20), 'toda herramienta se describe con algo más que su nombre');
ok(new Set(cat.map((h) => h.nombre)).size === cat.length, 'no hay nombres repetidos');

console.log('\n2) Las 37 responden con datos, no con un error');
const ARGS: Record<string, Record<string, unknown>> = {
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
forgetAll();

console.log('\n3) La cola: una herramienta encola, otra consume (FIFO)');
const plan = await llamar<PlanResult>('plan_estudio', { sesiones: 3 });
ok(plan.plan.length === 3 && plan.encolados === 3, 'plan_estudio deja tres labs en la cola', JSON.stringify(plan).slice(0, 200));
const estado = await llamar<QueueStateResult>('cola_estado');
ok(estado.enCola === 3, 'cola_estado ve los tres sin sacarlos');
const primero = await llamar<NextResult>('cola_siguiente');
ok(primero.item.ref === plan.plan[0].lab_id, `sale el primero del plan (${plan.plan[0].lab_id})`);
ok(!!primero.lab && !!primero.mis && !!primero.leccion,
  'y sale resuelto: ficha del lab + intentos propios + lección, en una sola llamada');
ok(primero.quedanEnCola === 2, 'quedan dos en la cola');
ok(!JSON.stringify(primero).includes('solution'), 'lo que sale de la cola no lleva la solución');

console.log('\n4) La pila: lo que se consume pasa a ser el foco, y se puede volver');
const foco = (await llamar<QueueStateResult>('cola_estado')).foco;
ok(foco?.ref === primero.item.ref, 'el lab que salió de la cola quedó como foco');
await llamar('leccion_texto', { n: 11 });
ok((await llamar<QueueStateResult>('cola_estado')).foco?.ref === '11', 'irse a otra lección apila una rama nueva');
const volver = await llamar<BackResult>('foco_volver');
ok(volver.cerrado.ref === '11' && volver.vuelvoA?.ref === primero.item.ref,
  'foco_volver cierra la rama y devuelve al lab de antes', JSON.stringify(volver).slice(0, 200));
ok(volver.ruta === `/leccion/${primero.lab.lesson_n}`, 'y trae la ruta a la que llevar a la persona');

console.log('\n5) mis_errores encola lo atascado');
forgetAll();
const err = await llamar<MistakesResult>('mis_errores');
ok(err.atascados === 1 && err.labs[0].lab_id === '2.1', 've el lab intentado y no resuelto');
ok(err.labs[0].misRespuestasMalas.length === 2, 'con las dos respuestas malas que dio');
ok(!JSON.stringify(err).includes('solution'), 'sin la solución del lab');
ok(viewQueue(bus(YO!.id)).some((i) => i.ref === '2.1' && i.motivo === 'atascado'), 'y lo deja en la cola marcado como atascado');

console.log('\n6) El memo ahorra consultas y caduca lo propio en el turno siguiente');
forgetAll();
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
forgetAll();
const pan = await llamar('mi_panorama', {}, 'C');
ok(!!pan.perfil && !!pan.progreso && !!pan.racha && !!pan.siguiente && !!pan.liga,
  'trae perfil, progreso, racha, siguiente paso y liga');
const despues = await Promise.all([
  llamar('mi_perfil', {}, 'C'), llamar('mi_progreso', {}, 'C'),
  llamar('mi_racha', {}, 'C'), llamar('mi_siguiente_paso', {}, 'C'),
]);
ok(despues.every((r) => r._memo === true), 'las cuatro por separado salen de la caché, sin tocar la base');
const diag = await llamar<DiagResult>('bus_diagnostico', {}, 'C');
ok(diag.memo.consultasAhorradas >= 4, `el diagnóstico cuenta las consultas ahorradas (${diag.memo.consultasAhorradas})`);

console.log('\n8) Lo que responde de verdad a lo que se pregunta por chat');
const paso = await llamar('mi_siguiente_paso', {}, 'D');
ok(paso.hay && paso.lab_id === '1.2', `«¿qué hago ahora?» → el 1.2 (dijo ${paso.lab_id})`);
const acceso = await llamar('mi_acceso', {}, 'D');
ok(Array.isArray(acceso.abiertas) && acceso.abiertas.includes(1), '«¿por qué no puedo abrir la 4?» → lista de abiertas y cerradas');
const precio = await llamar<PriceResult>('precio_y_compra', {}, 'D');
ok(precio.precio.monto === 9.99 && precio.garantiaDias === 14, '«¿cuánto cuesta?» → 9.99 USD y 14 días de garantía');
const donde = await llamar('donde_encuentro', { consulta: 'descargar el pdf' }, 'D');
ok(donde.rutas[0]?.ruta === '/perfil', '«¿dónde descargo el pdf?» → /perfil');
const sop = await llamar('soporte', { tema: 'pagué y sigue cerrado' }, 'D');
ok(sop.respuestas[0]?.id === 'pague_sigue_cerrado', '«pagué y sigue cerrado» → la respuesta frecuente que toca');
const glos = await llamar('glosario', { termino: 'temperatura' }, 'D');
ok(glos.entradas[0]?.leccion === 9, '«¿qué es la temperatura?» → lección 9');
const busca = await llamar<SearchResult>('buscar_en_curso', { consulta: 'inventa cosas que suenan bien' }, 'D');
ok(busca.resultados.some((r) => r.leccion === 10), '«inventa cosas» → lección 10', JSON.stringify(busca.resultados).slice(0, 200));
const falta = await llamar('logros_faltantes', {}, 'D');
ok(falta.siguientes[0]?.teFaltan >= 1, '«¿qué me falta para el siguiente logro?» → qué hacer exactamente');
const ritmo = await llamar('mi_ritmo', {}, 'D');
ok(ritmo.faltan === 35 && ritmo.totalLabs === 36, '«¿cuánto me queda?» → 35 de 36');
const priv = await llamar<PrivacyResult>('mis_datos_y_privacidad', {}, 'D');
ok(priv.deTi.intentosGuardados === 3 && !JSON.stringify(priv).includes('@'),
  '«¿qué sabes de mí?» → conteos, y ni un correo');

console.log('\n9) El texto de la lección respeta el idioma y no se inventa nada');
const en = await llamar<LessonTextResult>('leccion_texto', { n: 4 }, 'E', 'en');
ok(en.idioma === 'en' && /[A-Za-z]/.test(en.tecnica), 'con la sesión en inglés llega el texto en inglés');
const otraVez = await llamar<LessonTextResult>('leccion_texto', { n: 4 }, 'E', 'es');
ok(otraVez.idioma === 'es', 'la caché del contenido no cruza idiomas: el mismo texto en español sale en español');
const fr = await llamar<LessonTextResult>('leccion_texto', { n: 4 }, 'E', 'fr');
ok(fr.idioma === 'es' && !!fr.nota, 'sin francés cae al español y lo avisa en la nota');
const nada = await llamar<GlossaryResult>('glosario', { termino: 'blockchain' }, 'E');
ok(nada.hallado === false && !!nada.nota, 'un término que no es del curso se dice, no se atribuye a una lección');

console.log('\n10) La liga y la tabla no cruzan personas');
const liga = await llamar('mi_liga', {}, 'F');
ok(!!liga.explicacion, 'mi_liga explica por qué está o no está en liga');
const tabla = await llamar('ligas_tabla', {}, 'F');
ok(!JSON.stringify(tabla).includes('user_id'), 'la tabla de la liga no lleva ningún user_id');

await run('DELETE FROM attempts WHERE user_id = ?', [YO!.id]);
await pool.end();
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nsin fallos');
process.exit(fallos ? 1 : 0);
