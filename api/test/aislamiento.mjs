// Intenta sacarle a las herramientas datos de OTRO usuario. Si algo de esto pasa,
// el agente no se puede publicar.
import { all, get, run, pool } from '../src/db.js';
import { ejecutar, catalogo, familias } from '../src/agent-tools.js';
import { olvidarTodo } from '../src/agent-bus.js';

// Argumentos válidos por herramienta: sin esto, la mitad del catálogo devolvería
// «falta el argumento» y la prueba no estaría mirando nada.
const ARGS = {
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
const args = (nombre) => ({ ...(ARGS[nombre] ?? {}) });

// La cola, la pila y el memo llevan marcas de tiempo del reloj: dos llamadas
// idénticas se distinguen en los milisegundos, no en los datos. Para comparar
// salidas se congela el reloj.
const sinReloj = (s) => s.replace(/"at":\d{10,}/g, '"at":0');

let fallos = 0;
const ok = (t) => console.log('  ok   ·', t);
const mal = (t, extra) => { fallos++; console.log('  MAL  ·', t, extra ? '\n         ' + extra : ''); };

// --- preparar: la víctima deja un rastro reconocible -----------------------
const VICTIMA = 'RESPUESTA-SECRETA-DE-PAULA';
await run('DELETE FROM attempts WHERE user_id = 2');
await run('INSERT INTO attempts (user_id, lab_id, answer, correct) VALUES (2, ?, ?, 1)', ['5.1', JSON.stringify(VICTIMA)]);

const paula = await get('SELECT id, email, name, pass_hash FROM users WHERE id = 2');
const soluciones = (await all('SELECT id, solution FROM labs')).map((r) => r.solution);
const SECRETOS = [
  ['answer de otro usuario', VICTIMA],
  ['pass_hash de otro usuario', paula.pass_hash],
  ['email de otro usuario', paula.email],
  ['nombre completo de otro usuario', paula.name],
  ...soluciones.slice(0, 6).map((s, i) => [`solution del lab #${i + 1}`, s]),
];

const CTX = { userId: 1, role: 'student', lang: 'es', turno: 'T-prueba' };
const CONTAMINADO = { user_id: 2, userId: 2, id: 2, uid: 2, where: "1=1 OR user_id=2", sql: 'SELECT * FROM users' };

console.log('\n1) Ninguna salida contiene secretos de terceros ni soluciones');
const salidas = [];
for (const h of catalogo()) {
  const r = await ejecutar(CTX, h.nombre, args(h.nombre));
  salidas.push([h.nombre, JSON.stringify(r)]);
}
console.log(`   (${salidas.length} herramientas ejecutadas)`);
for (const [etiqueta, secreto] of SECRETOS) {
  const donde = salidas.filter(([, s]) => secreto && s.includes(secreto)).map(([n]) => n);
  donde.length ? mal(`${etiqueta} se filtró en: ${donde.join(', ')}`) : ok(`${etiqueta} no aparece`);
}

console.log('\n2) Colar un identificador de usuario no cambia nada');
for (const h of catalogo()) {
  // Las herramientas de coordinación mutan la cola y la pila: para comparar dos
  // llamadas hay que partir del mismo estado, así que se limpia el bus entre una
  // y otra. El memo también se va, y con él el marcador _memo.
  olvidarTodo();
  const limpio = await ejecutar(CTX, h.nombre, args(h.nombre));
  delete limpio._memo;
  olvidarTodo();
  const sucio = await ejecutar(CTX, h.nombre, { ...args(h.nombre), ...CONTAMINADO });
  const ignorado = sucio._ignorado ?? [];
  delete sucio._ignorado; delete sucio._memo;
  if (sinReloj(JSON.stringify(sucio)) !== sinReloj(JSON.stringify(limpio))) {
    mal(`${h.nombre} cambió su salida con args contaminados`, sinReloj(JSON.stringify(sucio)).slice(0, 200));
  } else if (!ignorado.length) mal(`${h.nombre} no registró los args colados`);
  else ok(`${h.nombre} ignoró ${ignorado.length} claves coladas`);
}
olvidarTodo();

console.log('\n3) Cada usuario ve solo sus intentos');
const r1 = await ejecutar({ userId: 1, role: 'student' }, 'mis_intentos', { lab_id: '5.1' });
const r2 = await ejecutar({ userId: 2, role: 'tutor' }, 'mis_intentos', { lab_id: '5.1' });
JSON.stringify(r1).includes(VICTIMA) ? mal('el usuario 1 vio el intento del usuario 2') : ok('el usuario 1 no ve los intentos del 2');
JSON.stringify(r2).includes(VICTIMA) ? ok('el usuario 2 sí ve su propio intento') : mal('el usuario 2 no ve su propio intento');

console.log('\n4) La explicación no llega antes del primer intento');
await run('DELETE FROM attempts WHERE user_id = 1 AND lab_id = ?', ['9.3']);
const sinIntento = await ejecutar(CTX, 'mis_intentos', { lab_id: '9.3' });
sinIntento.explicacion === null && sinIntento.nota ? ok('sin intentos: explicación null + aviso al modelo')
  : mal('entregó explicación sin que la persona lo intentara', JSON.stringify(sinIntento).slice(0, 160));

console.log('\n5) Guardas de entrada');
const casos = [
  ['herramienta inventada', await ejecutar(CTX, 'labs; DROP TABLE users', {}), 'herramienta_desconocida'],
  ['sin contexto', await ejecutar(null, 'mi_perfil', {}), 'sin_sesion'],
  ['userId no entero', await ejecutar({ userId: '2' }, 'mi_perfil', {}), 'sin_sesion'],
  ['lab_id con inyección', await ejecutar(CTX, 'mis_intentos', { lab_id: "5.1' OR '1'='1" }), 'lab_invalido'],
  ['leccion fuera de rango', await ejecutar(CTX, 'leccion', { n: 99 }), 'leccion_invalida'],
  ['leccion no numérica', await ejecutar(CTX, 'leccion', { n: 'DROP' }), 'leccion_invalida'],
  ['lab_ficha con inyección', await ejecutar(CTX, 'lab_ficha', { lab_id: "1.1; DROP TABLE labs" }), 'lab_invalido'],
  ['mis_pendientes fuera de rango', await ejecutar(CTX, 'mis_pendientes', { n: 0 }), 'leccion_invalida'],
  ['mi_historial con días absurdos', await ejecutar(CTX, 'mi_historial', { dias: 9999 }), 'dias_invalido'],
  ['plan_estudio con sesiones absurdas', await ejecutar(CTX, 'plan_estudio', { sesiones: 500 }), 'sesiones_invalido'],
  ['cola_encolar con tipo inventado', await ejecutar(CTX, 'cola_encolar', { tipo: 'usuarios', ref: '2' }), 'tipo_invalido'],
  ['cola_encolar con lab inválido', await ejecutar(CTX, 'cola_encolar', { tipo: 'lab', ref: "5.1' OR 1=1" }), 'lab_invalido'],
  ['foco_apilar con tipo inventado', await ejecutar(CTX, 'foco_apilar', { tipo: 'users', ref: '2' }), 'tipo_invalido'],
  ['buscar_en_curso vacío', await ejecutar(CTX, 'buscar_en_curso', { consulta: ' ' }), 'consulta_corta'],
];
for (const [etiqueta, res, esperado] of casos) {
  res.error === esperado ? ok(`${etiqueta} → ${esperado}`) : mal(`${etiqueta} devolvió ${JSON.stringify(res).slice(0, 120)}`);
}

console.log('\n6) La ontología que ve el modelo no nombra lo prohibido');
const { renderParaModelo } = await import('../src/ontology.js');
const txt = renderParaModelo();
for (const c of ['pass_hash', 'solution', 'raw', 'email', 'ext_id', 'locked_until']) {
  txt.includes(c) ? mal(`el prompt menciona la columna ${c}`) : ok(`el prompt no menciona ${c}`);
}

console.log('\n7) Ningún argumento declarado puede nombrar a otra persona');
const cat = catalogo();
const declarados = cat.flatMap((h) => Object.keys(h.argumentos).map((k) => `${h.nombre}.${k}`));
const sospechosos = declarados.filter((d) => /user|usuario|persona|correo|email|alias|id_/i.test(d.split('.')[1]));
sospechosos.length ? mal(`hay argumentos que nombran a alguien: ${sospechosos.join(', ')}`)
  : ok(`${declarados.length} argumentos declarados y ninguno acepta identificar a nadie`);
const fam = familias();
const cuenta = Object.entries(fam).map(([k, v]) => `${k}=${v.length}`).join(' ');
cat.length === Object.values(fam).flat().length
  ? ok(`las ${cat.length} herramientas están clasificadas (${cuenta})`)
  : mal('hay herramientas sin familia');

console.log('\n8) La cola de una persona no es alcanzable desde otra sesión');
olvidarTodo();
await ejecutar({ userId: 2, lang: 'es', turno: 'T-otra' }, 'cola_encolar', { tipo: 'tema', ref: 'secreto-de-paula' });
const miCola = JSON.stringify(await ejecutar(CTX, 'cola_estado', {}));
miCola.includes('secreto-de-paula') ? mal('la cola del usuario 2 se vio desde la sesión del 1')
  : ok('la cola del usuario 2 no aparece en la del 1');
const memoAjeno = JSON.stringify(await ejecutar(CTX, 'mi_progreso', {}));
memoAjeno.includes(VICTIMA) ? mal('el memo sirvió un dato de otra sesión') : ok('el memo no cruza sesiones');
olvidarTodo();

await run('DELETE FROM attempts WHERE user_id = 2');
await pool.end();
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nsin fallos');
process.exit(fallos ? 1 : 0);
