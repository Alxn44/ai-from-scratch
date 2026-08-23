// Prueba del bus del agente: la cola, la pila y el memo. Sin base y sin modelo,
// porque lo que se comprueba aquí es la estructura de datos, no el contenido:
// que la cola sea FIFO, que la pila sea LIFO, que los topes se respeten, que el
// memo distinga un dato público de un dato propio y que la sesión de una persona
// no vea la de otra.
import {
  TOPES, apilar, bus, cima, desapilar, desencolar, diagnostico, encolar,
  memo, olvidar, olvidarTodo, sembrar, vaciarCola, verCola, verPila,
} from '../src/agent-bus.js';

let fallos = 0;
const ok = (cond, txt) => { console.log(`  ${cond ? 'ok  ' : 'FALLO'} · ${txt}`); if (!cond) fallos++; };

olvidarTodo();

console.log('\n1) La cola es FIFO y no repite');
const a = bus(1);
encolar(a, { tipo: 'lab', ref: '1.1', motivo: 'plan' });
encolar(a, { tipo: 'lab', ref: '1.2', motivo: 'plan' });
const rep = encolar(a, { tipo: 'lab', ref: '1.1', motivo: 'otra vez' });
ok(rep.ok === false && rep.razon === 'ya_estaba', 'encolar dos veces el mismo lab no lo duplica');
ok(verCola(a).length === 2, 'quedan dos en la cola');
ok(desencolar(a).ref === '1.1', 'sale primero lo que entró primero');
ok(desencolar(a).ref === '1.2', 'y después el segundo');
ok(desencolar(a) === null, 'cola vacía devuelve null, no revienta');
const alFrente = encolar(a, { tipo: 'lab', ref: '9.9', frente: true });
ok(alFrente.ok && verCola(a)[0].ref === '9.9', 'se puede meter algo urgente al frente');
ok(vaciarCola(a) === 1 && verCola(a).length === 0, 'vaciar la cola devuelve cuántos había');

console.log('\n2) Los topes se respetan');
for (let i = 0; i < TOPES.cola + 5; i++) encolar(a, { tipo: 'tema', ref: `t${i}` });
ok(verCola(a).length === TOPES.cola, `la cola se queda en su tope (${TOPES.cola})`);
const llena = encolar(a, { tipo: 'tema', ref: 'uno más' });
ok(llena.ok === false && llena.razon === 'cola_llena', 'con la cola llena lo dice en vez de tirar lo de alguien');
vaciarCola(a);
ok(encolar(a, { tipo: 'inventado', ref: 'x' }).razon === 'tipo_invalido', 'un tipo que no existe se rechaza');

console.log('\n3) La pila es LIFO, no repite la cima y tira lo de abajo');
apilar(a, { tipo: 'leccion', ref: '5' });
const otra = apilar(a, { tipo: 'leccion', ref: '5' });
ok(otra.repetido === true && verPila(a).length === 1, 'apilar dos veces el mismo foco no crea una rama');
apilar(a, { tipo: 'tema', ref: 'tokens' });
ok(cima(a).ref === 'tokens', 'la cima es lo último que se apiló');
ok(desapilar(a).ref === 'tokens' && cima(a).ref === '5', 'desapilar devuelve a donde estaba');
for (let i = 0; i < TOPES.pila + 4; i++) apilar(a, { tipo: 'tema', ref: `r${i}` });
const pila = verPila(a);
ok(pila.length === TOPES.pila, `la pila se queda en su tope (${TOPES.pila})`);
ok(pila[0].ref === `r${TOPES.pila + 3}`, 'lo que se conserva es lo reciente, no lo de hace veinte mensajes');

console.log('\n4) El memo distingue lo público de lo propio');
olvidarTodo();
const b = bus(2);
let corridas = 0;
const traer = async () => { corridas++; return { dato: 'lección 5' }; };
await memo(b, 'leccion{n:5}', { publico: true, turno: 'T1' }, traer);
const segundo = await memo(b, 'leccion{n:5}', { publico: true, turno: 'T2' }, traer);
ok(corridas === 1 && segundo.cacheado, 'un dato público se reusa incluso en otro turno');

corridas = 0;
await memo(b, 'mi_progreso{}', { publico: false, turno: 'T1' }, traer);
const mismoTurno = await memo(b, 'mi_progreso{}', { publico: false, turno: 'T1' }, traer);
ok(corridas === 1 && mismoTurno.cacheado, 'un dato propio se reusa dentro del mismo turno');
const otroTurno = await memo(b, 'mi_progreso{}', { publico: false, turno: 'T2' }, traer);
ok(corridas === 2 && !otroTurno.cacheado, 'en el turno siguiente se vuelve a consultar: pudo resolver un lab entre mensajes');

corridas = 0;
const sinTurno = await memo(b, 'mi_perfil{}', { publico: false, turno: null }, traer);
await memo(b, 'mi_perfil{}', { publico: false, turno: null }, traer);
ok(corridas === 2 && !sinTurno.cacheado, 'sin turno no se cachea nada propio');

corridas = 0;
const malo = async () => { corridas++; return { error: 'no_existe' }; };
await memo(b, 'malo{}', { publico: true, turno: 'T1' }, malo);
await memo(b, 'malo{}', { publico: true, turno: 'T1' }, malo);
ok(corridas === 2, 'un error no se queda cacheado');

ok(sembrar(b, 'sembrado{}', { x: 1 }, { publico: false, turno: 'T1' }) === true, 'se puede sembrar el memo con algo ya calculado');
const cosechado = await memo(b, 'sembrado{}', { publico: false, turno: 'T1' }, traer);
ok(cosechado.cacheado && cosechado.valor.x === 1, 'lo sembrado se sirve sin volver a la base');
ok(sembrar(b, 'nada{}', { error: 'x' }, { publico: true }) === false, 'no se siembra un error');

console.log('\n5) Cada sesión tiene su bus y nadie ve el de otro');
olvidarTodo();
const uno = bus(1), dos = bus(2);
encolar(uno, { tipo: 'lab', ref: '1.1', motivo: 'de la persona 1' });
apilar(uno, { tipo: 'leccion', ref: '1' });
ok(verCola(dos).length === 0 && verPila(dos).length === 0, 'la cola y la pila de la persona 2 están vacías');
ok(JSON.stringify(verCola(dos)) !== JSON.stringify(verCola(uno)), 'no comparten estructura');
ok(bus('1') === null && bus(null) === null, 'un userId que no es entero no tiene bus');
ok(encolar(null, { tipo: 'lab', ref: '1.1' }).razon === 'sin_sesion', 'sin bus no se encola nada');
olvidar(1);
ok(verCola(bus(1)).length === 0, 'olvidar una sesión la deja limpia');

console.log('\n6) El diagnóstico cuenta lo que pasó');
olvidarTodo();
const c = bus(3);
await memo(c, 'x{}', { publico: true }, async () => ({ a: 1 }));
await memo(c, 'x{}', { publico: true }, async () => ({ a: 1 }));
encolar(c, { tipo: 'lab', ref: '2.1' });
desencolar(c);
const d = diagnostico(c);
ok(d.memo.aciertos === 1 && d.memo.fallos === 1, 'cuenta un acierto y un fallo de caché');
ok(d.cola.encolados === 1 && d.cola.servidos === 1, 'cuenta lo encolado y lo servido');
ok(diagnostico(null).disponible === false, 'sin bus el diagnóstico lo dice en vez de fallar');

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nsin fallos');
process.exit(fallos ? 1 : 0);
