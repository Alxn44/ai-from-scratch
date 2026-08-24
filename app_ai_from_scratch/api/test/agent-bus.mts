// Test of the agent bus: the queue, the stack and the memo. No database and no
// model, because what is checked here is the data structure, not the content:
// that the queue is FIFO, that the stack is LIFO, that the caps hold, that the
// memo tells a public fact from an own one, and that one person's session does
// not see another's.
import {
  CAPS, push, bus, top, pop, dequeue, diagnostics, enqueue,
  memo, forget, forgetAll, seed, clearQueue, viewQueue, viewStack,
} from '../src/agent-bus.ts';

let fallos = 0;
const ok = (cond: boolean, txt: string): void => { console.log(`  ${cond ? 'ok  ' : 'FALLO'} · ${txt}`); if (!cond) fallos++; };

forgetAll();

console.log('\n1) La cola es FIFO y no repite');
const a = bus(1);
enqueue(a, { tipo: 'lab', ref: '1.1', motivo: 'plan' });
enqueue(a, { tipo: 'lab', ref: '1.2', motivo: 'plan' });
const rep = enqueue(a, { tipo: 'lab', ref: '1.1', motivo: 'otra vez' });
ok(rep.ok === false && rep.razon === 'ya_estaba', 'encolar dos veces el mismo lab no lo duplica');
ok(viewQueue(a).length === 2, 'quedan dos en la cola');
ok(dequeue(a)!.ref === '1.1', 'sale primero lo que entró primero');
ok(dequeue(a)!.ref === '1.2', 'y después el segundo');
ok(dequeue(a) === null, 'cola vacía devuelve null, no revienta');
const alFrente = enqueue(a, { tipo: 'lab', ref: '9.9', frente: true });
ok(alFrente.ok && viewQueue(a)[0]!.ref === '9.9', 'se puede meter algo urgente al frente');
ok(clearQueue(a) === 1 && viewQueue(a).length === 0, 'vaciar la cola devuelve cuántos había');

console.log('\n2) Los topes se respetan');
for (let i = 0; i < CAPS.queue + 5; i++) enqueue(a, { tipo: 'tema', ref: `t${i}` });
ok(viewQueue(a).length === CAPS.queue, `la cola se queda en su tope (${CAPS.queue})`);
const llena = enqueue(a, { tipo: 'tema', ref: 'uno más' });
ok(llena.ok === false && llena.razon === 'cola_llena', 'con la cola llena lo dice en vez de tirar lo de alguien');
clearQueue(a);
const inventado = enqueue(a, { tipo: 'inventado', ref: 'x' });
ok('razon' in inventado && inventado.razon === 'tipo_invalido', 'un tipo que no existe se rechaza');

console.log('\n3) La pila es LIFO, no repite la cima y tira lo de abajo');
push(a, { tipo: 'leccion', ref: '5' });
const otra = push(a, { tipo: 'leccion', ref: '5' });
ok('repetido' in otra && otra.repetido === true && viewStack(a).length === 1, 'apilar dos veces el mismo foco no crea una rama');
push(a, { tipo: 'tema', ref: 'tokens' });
ok(top(a)!.ref === 'tokens', 'la cima es lo último que se apiló');
ok(pop(a)!.ref === 'tokens' && top(a)!.ref === '5', 'desapilar devuelve a donde estaba');
for (let i = 0; i < CAPS.stack + 4; i++) push(a, { tipo: 'tema', ref: `r${i}` });
const pila = viewStack(a);
ok(pila.length === CAPS.stack, `la pila se queda en su tope (${CAPS.stack})`);
ok(pila[0]!.ref === `r${CAPS.stack + 3}`, 'lo que se conserva es lo reciente, no lo de hace veinte mensajes');

console.log('\n4) El memo distingue lo público de lo propio');
forgetAll();
const b = bus(2);
let corridas = 0;
const traer = async (): Promise<Record<string, unknown>> => { corridas++; return { dato: 'lección 5' }; };
await memo(b, 'leccion{n:5}', { public: true, turn: 'T1' }, traer);
const segundo = await memo(b, 'leccion{n:5}', { public: true, turn: 'T2' }, traer);
ok(corridas === 1 && segundo.cached, 'un dato público se reusa incluso en otro turno');

corridas = 0;
await memo(b, 'mi_progreso{}', { public: false, turn: 'T1' }, traer);
const mismoTurno = await memo(b, 'mi_progreso{}', { public: false, turn: 'T1' }, traer);
ok(corridas === 1 && mismoTurno.cached, 'un dato propio se reusa dentro del mismo turno');
const otroTurno = await memo(b, 'mi_progreso{}', { public: false, turn: 'T2' }, traer);
ok(corridas === 2 && !otroTurno.cached, 'en el turno siguiente se vuelve a consultar: pudo resolver un lab entre mensajes');

corridas = 0;
const sinTurno = await memo(b, 'mi_perfil{}', { public: false, turn: null }, traer);
await memo(b, 'mi_perfil{}', { public: false, turn: null }, traer);
ok(corridas === 2 && !sinTurno.cached, 'sin turno no se cachea nada propio');

corridas = 0;
const malo = async (): Promise<Record<string, unknown>> => { corridas++; return { error: 'no_existe' }; };
await memo(b, 'malo{}', { public: true, turn: 'T1' }, malo);
await memo(b, 'malo{}', { public: true, turn: 'T1' }, malo);
ok(corridas === 2, 'un error no se queda cacheado');

ok(seed(b, 'sembrado{}', { x: 1 }, { public: false, turn: 'T1' }) === true, 'se puede sembrar el memo con algo ya calculado');
const cosechado = await memo(b, 'sembrado{}', { public: false, turn: 'T1' }, traer);
ok(cosechado.cached && (cosechado.value as { x: number }).x === 1, 'lo sembrado se sirve sin volver a la base');
ok(seed(b, 'nada{}', { error: 'x' }, { public: true }) === false, 'no se siembra un error');

console.log('\n5) Cada sesión tiene su bus y nadie ve el de otro');
forgetAll();
const uno = bus(1), dos = bus(2);
enqueue(uno, { tipo: 'lab', ref: '1.1', motivo: 'de la persona 1' });
push(uno, { tipo: 'leccion', ref: '1' });
ok(viewQueue(dos).length === 0 && viewStack(dos).length === 0, 'la cola y la pila de la persona 2 están vacías');
ok(JSON.stringify(viewQueue(dos)) !== JSON.stringify(viewQueue(uno)), 'no comparten estructura');
ok(bus('1') === null && bus(null) === null, 'un userId que no es entero no tiene bus');
const sinBus = enqueue(null, { tipo: 'lab', ref: '1.1' });
ok('razon' in sinBus && sinBus.razon === 'sin_sesion', 'sin bus no se encola nada');
forget(1);
ok(viewQueue(bus(1)).length === 0, 'olvidar una sesión la deja limpia');

console.log('\n6) El diagnóstico cuenta lo que pasó');
forgetAll();
const c = bus(3);
await memo(c, 'x{}', { public: true }, async () => ({ a: 1 }));
await memo(c, 'x{}', { public: true }, async () => ({ a: 1 }));
enqueue(c, { tipo: 'lab', ref: '2.1' });
dequeue(c);
const d = diagnostics(c);
if (!d.disponible) throw new Error('el bus 3 no tiene diagnóstico');
ok(d.memo.aciertos === 1 && d.memo.fallos === 1, 'cuenta un acierto y un fallo de caché');
ok(d.cola.encolados === 1 && d.cola.servidos === 1, 'cuenta lo encolado y lo servido');
ok(diagnostics(null).disponible === false, 'sin bus el diagnóstico lo dice en vez de fallar');

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nsin fallos');
process.exit(fallos ? 1 : 0);
