// Tries to get another user's data out of the tools. If any of this happens, the
// agent cannot ship.
import { all, get, run, pool } from '../src/db.ts';
import type { UserRow } from '../src/db.ts';
import { run as runTool, catalog, families, setLogger } from '../src/tools/index.ts';
import type { Ctx, ToolResult } from '../src/tools/index.ts';
import { forgetAll } from '../src/agent-bus.ts';

// Valid arguments per tool: without this, half the catalog would answer «missing
// argument» and the test would be looking at nothing.
const ARGS: Record<string, Record<string, unknown>> = {
  leccion: { n: 5 },
  leccion_texto: { n: 5 },
  requisitos_leccion: { n: 7 },
  mis_intentos: { lab_id: '5.1' },
  lab_ficha: { lab_id: '5.1' },
  mis_pendientes: { n: 5 },
  mi_historial: { dias: 30 },
  buscar_en_curso: { consulta: 'tokens' },
  glosario: { termino: 'token' },
  donde_encuentro: { consulta: 'descargar el pdf' },
  soporte: { tema: 'no puedo entrar' },
  plan_estudio: { sesiones: 3 },
  cola_encolar: { tipo: 'lab', ref: '5.1', motivo: 'prueba' },
  foco_apilar: { tipo: 'leccion', ref: '5', nota: 'prueba' },
};
const args = (name: string): Record<string, unknown> => ({ ...(ARGS[name] ?? {}) });

// The queue, the stack and the memo carry clock timestamps: two identical calls
// differ in the milliseconds, not in the data. To compare outputs the clock is
// frozen.
const withoutClock = (s: string): string => s.replace(/"at":\d{10,}/g, '"at":0');

let fallos = 0;
const ok = (t: string): void => console.log('  ok   ·', t);
const mal = (t: string, extra?: string): void => {
  fallos++; console.log('  MAL  ·', t, extra ? '\n         ' + extra : '');
};

// --- prepare: the victim leaves a recognisable trail ------------------------
const VICTIMA = 'RESPUESTA-SECRETA-DE-PAULA';
await run('DELETE FROM attempts WHERE user_id = 2');
await run('INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES (2, ?, ?, 1)', ['5.1', JSON.stringify(VICTIMA)]);

const paula = await get<Pick<UserRow, 'id' | 'email' | 'name' | 'pass_hash'>>(
  'SELECT id, email, name, pass_hash FROM users WHERE id = 2');
const solutions = (await all<{ id: string; solution: string }>('SELECT id, solution FROM labs')).map((r) => r.solution);
const SECRETOS: [string, string][] = [
  ['answer de otro usuario', VICTIMA],
  ['pass_hash de otro usuario', paula!.pass_hash],
  ['email de otro usuario', paula!.email],
  ['nombre completo de otro usuario', paula!.name],
  ...solutions.slice(0, 6).map((s, i): [string, string] => [`solution del lab #${i + 1}`, s]),
];

const CTX: Ctx = { userId: 1, role: 'student', lang: 'es', turn: 'T-prueba' };
const CONTAMINADO = { user_id: 2, userId: 2, id: 2, uid: 2, where: "1=1 OR user_id=2", sql: 'SELECT * FROM users' };

console.log('\n1) Ninguna salida contiene secretos de terceros ni soluciones');
const salidas: [string, string][] = [];
for (const h of catalog()) {
  const r = await runTool(CTX, h.nombre, args(h.nombre));
  salidas.push([h.nombre, JSON.stringify(r)]);
}
console.log(`   (${salidas.length} herramientas ejecutadas)`);
for (const [etiqueta, secreto] of SECRETOS) {
  const donde = salidas.filter(([, s]) => secreto && s.includes(secreto)).map(([n]) => n);
  donde.length ? mal(`${etiqueta} se filtró en: ${donde.join(', ')}`) : ok(`${etiqueta} no aparece`);
}

console.log('\n2) Colar un identificador de usuario no cambia nada');
for (const h of catalog()) {
  // The coordination tools mutate the queue and the stack: to compare two calls
  // they have to start from the same state, so the bus is cleared between one and
  // the other. The memo goes with it, and with it the _memo marker.
  forgetAll();
  const limpio = await runTool(CTX, h.nombre, args(h.nombre));
  delete limpio._memo;
  forgetAll();
  // The rejected key names must reach the OPERATOR'S LOG, not the model.
  //
  // This assertion used to read them back out of the tool's own response, where
  // they travelled as `_ignorado`. That put the list on the attacker's side of
  // the conversation — the model could relay «I stripped user_id, userId, uid»
  // verbatim, confirming exactly which names were being probed — while the server
  // logged nothing, so an isolation probe left no trace an operator could see.
  // The contract now runs the other way, and the test follows it.
  const registrado: Record<string, unknown>[] = [];
  setLogger((datos) => registrado.push(datos));
  const sucio = await runTool(CTX, h.nombre, { ...args(h.nombre), ...CONTAMINADO });
  setLogger(() => {});
  delete sucio._memo;
  const anotado = registrado.filter((d) => d.herramienta === h.nombre)
    .flatMap((d) => (d.sobran as string[] | undefined) ?? []);
  if (withoutClock(JSON.stringify(sucio)) !== withoutClock(JSON.stringify(limpio))) {
    mal(`${h.nombre} cambió su salida con args contaminados`, withoutClock(JSON.stringify(sucio)).slice(0, 200));
  } else if ('_ignorado' in sucio) {
    mal(`${h.nombre} le devolvió al modelo la lista de claves rechazadas`);
  } else if (!anotado.length) {
    mal(`${h.nombre} descartó los args colados sin dejar constancia en el log`);
  } else ok(`${h.nombre} descartó ${anotado.length} claves y las registró`);
}
forgetAll();

console.log('\n3) Cada usuario ve solo sus intentos');
const r1 = await runTool({ userId: 1, role: 'student' }, 'mis_intentos', { lab_id: '5.1' });
const r2 = await runTool({ userId: 2, role: 'tutor' }, 'mis_intentos', { lab_id: '5.1' });
JSON.stringify(r1).includes(VICTIMA) ? mal('el usuario 1 vio el intento del usuario 2') : ok('el usuario 1 no ve los intentos del 2');
JSON.stringify(r2).includes(VICTIMA) ? ok('el usuario 2 sí ve su propio intento') : mal('el usuario 2 no ve su propio intento');

console.log('\n4) La explicación no llega antes del primer intento');
await run('DELETE FROM attempts WHERE user_id = 1 AND lab_id = ?', ['9.3']);
const sinIntento = await runTool(CTX, 'mis_intentos', { lab_id: '9.3' });
sinIntento.explicacion === null && sinIntento.nota ? ok('sin intentos: explicación null + aviso al modelo')
  : mal('entregó explicación sin que la persona lo intentara', JSON.stringify(sinIntento).slice(0, 160));

console.log('\n5) Guardas de entrada');
const casos: [string, ToolResult, string][] = [
  ['herramienta inventada', await runTool(CTX, 'labs; DROP TABLE users', {}), 'herramienta_desconocida'],
  ['sin contexto', await runTool(null, 'mi_perfil', {}), 'sin_sesion'],
  ['userId no entero', await runTool({ userId: '2' as unknown as number }, 'mi_perfil', {}), 'sin_sesion'],
  ['lab_id con inyección', await runTool(CTX, 'mis_intentos', { lab_id: "5.1' OR '1'='1" }), 'lab_invalido'],
  ['leccion fuera de rango', await runTool(CTX, 'leccion', { n: 99 }), 'leccion_invalida'],
  ['leccion no numérica', await runTool(CTX, 'leccion', { n: 'DROP' }), 'leccion_invalida'],
  ['lab_ficha con inyección', await runTool(CTX, 'lab_ficha', { lab_id: "1.1; DROP TABLE labs" }), 'lab_invalido'],
  ['mis_pendientes fuera de rango', await runTool(CTX, 'mis_pendientes', { n: 0 }), 'leccion_invalida'],
  ['mi_historial con días absurdos', await runTool(CTX, 'mi_historial', { dias: 9999 }), 'dias_invalido'],
  ['plan_estudio con sesiones absurdas', await runTool(CTX, 'plan_estudio', { sesiones: 500 }), 'sesiones_invalido'],
  ['cola_encolar con tipo inventado', await runTool(CTX, 'cola_encolar', { tipo: 'usuarios', ref: '2' }), 'tipo_invalido'],
  ['cola_encolar con lab inválido', await runTool(CTX, 'cola_encolar', { tipo: 'lab', ref: "5.1' OR 1=1" }), 'lab_invalido'],
  ['foco_apilar con tipo inventado', await runTool(CTX, 'foco_apilar', { tipo: 'users', ref: '2' }), 'tipo_invalido'],
  ['buscar_en_curso vacío', await runTool(CTX, 'buscar_en_curso', { consulta: ' ' }), 'consulta_corta'],
];
for (const [etiqueta, res, esperado] of casos) {
  res.error === esperado ? ok(`${etiqueta} → ${esperado}`) : mal(`${etiqueta} devolvió ${JSON.stringify(res).slice(0, 120)}`);
}

console.log('\n6) El guardia de columnas prohibidas falla CERRADO');
// WHAT WAS HERE: renderForModel() from v2, asserting that the model's prompt did
// not name pass_hash. That prompt no longer exists — the AI service emits it
// (GET /ontologia/prompt) — so this section was checking a document nobody
// serves and reporting green for it. The third time in this repository a guard
// has gone dark while looking like a guarantee.
//
// The real prompt IS checked, and more strictly, on the Python side:
// ai/tests/test_render.py::test_the_ontology_block_does_not_name_what_is_forbidden
// and ::test_not_even_the_whole_prompt_names_a_qualified_column, both
// parametrised over BOTH languages and also checking qualified names.
//
// WHAT IS CHECKED INSTEAD is the half that lives in Node and was tested nowhere
// in this suite: that forbiddenColumns() THROWS for an undeclared table instead
// of answering [], and that assertNoForbidden() throws on a row carrying one.
const { forbiddenColumns, assertNoForbidden } = await import('../src/ontology.ts');
try {
  forbiddenColumns('tabla_que_nadie_declaro');
  mal('forbiddenColumns aprobó una tabla que nadie declaró');
} catch (e) {
  String(e).includes('not declared')
    ? ok('forbiddenColumns lanza para una tabla no declarada, en vez de devolver []')
    : mal('forbiddenColumns lanzó sin decir por qué', String(e).slice(0, 120));
}
try {
  assertNoForbidden('users', { name: 'Ana', pass_hash: 'no-importa' });
  mal('assertNoForbidden dejó pasar users.pass_hash');
} catch { ok('assertNoForbidden lanza cuando la fila trae pass_hash'); }
try {
  assertNoForbidden('users', { name: 'Ana', role: 'student' });
  ok('assertNoForbidden deja pasar una fila limpia');
} catch (e) { mal('assertNoForbidden rechazó una fila limpia', String(e).slice(0, 120)); }
for (const t of ['labs', 'payments', 'reset_tokens']) {
  forbiddenColumns(t).length > 0
    ? ok(`${t} declara ${forbiddenColumns(t).length} columna(s) prohibida(s)`)
    : mal(`${t} no declara ninguna columna prohibida`);
}

console.log('\n7) Ningún argumento declarado puede nombrar a otra persona');
const cat = catalog();
const declarados = cat.flatMap((h) => Object.keys(h.argumentos).map((k) => `${h.nombre}.${k}`));
const sospechosos = declarados.filter((d) => /user|usuario|persona|correo|email|alias|id_/i.test(d.split('.')[1]!));
sospechosos.length ? mal(`hay argumentos que nombran a alguien: ${sospechosos.join(', ')}`)
  : ok(`${declarados.length} argumentos declarados y ninguno acepta identificar a nadie`);
const fam = families();
const cuenta = Object.entries(fam).map(([k, v]) => `${k}=${v.length}`).join(' ');
cat.length === Object.values(fam).flat().length
  ? ok(`las ${cat.length} herramientas están clasificadas (${cuenta})`)
  : mal('hay herramientas sin familia');

console.log('\n8) La cola de una persona no es alcanzable desde otra sesión');
forgetAll();
await runTool({ userId: 2, lang: 'es', turn: 'T-otra' }, 'cola_encolar', { tipo: 'tema', ref: 'secreto-de-paula' });
const miCola = JSON.stringify(await runTool(CTX, 'cola_estado', {}));
miCola.includes('secreto-de-paula') ? mal('la cola del usuario 2 se vio desde la sesión del 1')
  : ok('la cola del usuario 2 no aparece en la del 1');
const memoAjeno = JSON.stringify(await runTool(CTX, 'mi_progreso', {}));
memoAjeno.includes(VICTIMA) ? mal('el memo sirvió un dato de otra sesión') : ok('el memo no cruza sesiones');
forgetAll();

await run('DELETE FROM attempts WHERE user_id = 2');
await pool.end();
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nsin fallos');
process.exit(fallos ? 1 : 0);
