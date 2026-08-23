// Bus del agente: una cola, una pila y un memo por sesión.
//
// POR QUÉ EXISTE. Con 37 herramientas el problema deja de ser «qué puede hacer»
// y pasa a ser «cuántas vueltas gasta en hacerlo». El tope del harness son 4
// vueltas de modelo; una pregunta corriente («¿qué hago ahora?») podía costar
// cinco llamadas: perfil, progreso, lecciones, intentos, liga. Este módulo es lo
// que hace que esas cinco quepan en una:
//
//   COLA (FIFO) — el plan de estudio. `plan_estudio` y `mis_errores` la llenan;
//     `cola_siguiente` saca la cabeza YA RESUELTA (ficha del lab + intentos
//     propios + puntero a la lección). Una herramienta produce trabajo, otra lo
//     consume: el modelo no vuelve a preguntar «¿y qué seguía?».
//
//   PILA (LIFO) — el foco. Abrir una lección o un lab apila dónde estaba la
//     persona. Si la conversación se va por una rama («espera, ¿qué es un
//     token?»), `foco_volver` devuelve el marco anterior sin releer nada.
//
//   MEMO — caché de resultados dentro de la sesión. Lo público (lecciones,
//     enunciados, glosario) vive TTL_PUBLICO; lo propio SOLO dentro del mismo
//     turno, porque entre dos mensajes la persona puede haber resuelto un lab en
//     otra pestaña y un progreso viejo sería una mentira.
//
// AISLAMIENTO. El bus se indexa por `userId`, que lo pone el servidor desde la
// cookie. No hay función que acepte el id de otra persona, así que la cola de
// alguien no es alcanzable desde la sesión de nadie más. Es memoria del proceso:
// si se reinicia, se pierde el plan y no pasa nada — se vuelve a pedir. Por eso
// no hay tabla nueva: nada de esto es un dato del que responder.

const TTL_SESION = 30 * 60_000;   // media hora sin hablar y la sesión se olvida
const TTL_PUBLICO = 10 * 60_000;  // el contenido del curso cambia con un despliegue
const MAX_SESIONES = 400;         // techo de memoria: se echa la más vieja
const TOPE_COLA = 32;
const TOPE_PILA = 16;
const TOPE_MEMO = 96;

const TIPOS = ['lab', 'leccion', 'tema'];

const sesiones = new Map();

const ahora = () => Date.now();

/** Quita sesiones caducadas y, si aún sobran, la que lleva más tiempo sin usarse. */
function podar() {
  const t = ahora();
  for (const [k, s] of sesiones) if (t - s.visto > TTL_SESION) sesiones.delete(k);
  while (sesiones.size > MAX_SESIONES) {
    let viejo = null;
    for (const [k, s] of sesiones) if (!viejo || s.visto < sesiones.get(viejo).visto) viejo = k;
    sesiones.delete(viejo);
  }
}

/**
 * El bus de esta sesión. `userId` viene del servidor; un id que no sea entero no
 * tiene bus, igual que no tiene herramientas.
 */
export function bus(userId) {
  if (!Number.isInteger(userId)) return null;
  podar();
  let s = sesiones.get(userId);
  if (!s) {
    s = { cola: [], pila: [], memo: new Map(), stats: { hits: 0, misses: 0, encolados: 0, servidos: 0 }, visto: ahora() };
    sesiones.set(userId, s);
  }
  s.visto = ahora();
  return s;
}

/** Borra el bus de una sesión. Lo usan las pruebas y el cierre de sesión. */
export function olvidar(userId) {
  sesiones.delete(userId);
}

/** Solo para pruebas: deja el módulo como recién cargado. */
export function olvidarTodo() {
  sesiones.clear();
}

const clave = (tipo, ref) => `${tipo}:${String(ref)}`;

/**
 * Encola trabajo. Devuelve qué pasó en vez de lanzar: el modelo tiene que poder
 * leer «ya estaba» o «la cola está llena» y seguir.
 */
export function encolar(b, { tipo, ref, motivo = null, frente = false }) {
  if (!b) return { ok: false, razon: 'sin_sesion' };
  if (!TIPOS.includes(tipo)) return { ok: false, razon: 'tipo_invalido', tipos: TIPOS };
  const k = clave(tipo, ref);
  if (b.cola.some((i) => i.clave === k)) return { ok: false, razon: 'ya_estaba', clave: k, largo: b.cola.length };
  if (b.cola.length >= TOPE_COLA) return { ok: false, razon: 'cola_llena', tope: TOPE_COLA };
  const item = { clave: k, tipo, ref: String(ref), motivo, at: ahora() };
  frente ? b.cola.unshift(item) : b.cola.push(item);
  b.stats.encolados++;
  return { ok: true, item, largo: b.cola.length };
}

/** Saca la cabeza. FIFO: lo que se encoló primero se estudia primero. */
export function desencolar(b) {
  if (!b || !b.cola.length) return null;
  const item = b.cola.shift();
  b.stats.servidos++;
  return item;
}

export function verCola(b) {
  return b ? b.cola.map(({ clave, ...i }) => i) : [];
}

export function vaciarCola(b) {
  const n = b ? b.cola.length : 0;
  if (b) b.cola = [];
  return n;
}

/**
 * Apila el foco. Repetir el marco de arriba no apila nada: entrar dos veces a la
 * misma lección no es una rama de la conversación.
 */
export function apilar(b, { tipo, ref, nota = null }) {
  if (!b) return { ok: false, razon: 'sin_sesion' };
  if (!TIPOS.includes(tipo)) return { ok: false, razon: 'tipo_invalido', tipos: TIPOS };
  const marco = { tipo, ref: String(ref), nota, at: ahora() };
  const arriba = b.pila[b.pila.length - 1];
  if (arriba && arriba.tipo === marco.tipo && arriba.ref === marco.ref) {
    return { ok: true, repetido: true, alto: b.pila.length, foco: arriba };
  }
  b.pila.push(marco);
  // Al llenarse se cae el marco de ABAJO: en una conversación importa lo último,
  // no de dónde se venía hace veinte mensajes.
  if (b.pila.length > TOPE_PILA) b.pila.shift();
  return { ok: true, alto: b.pila.length, foco: marco };
}

export function desapilar(b) {
  if (!b || !b.pila.length) return null;
  return b.pila.pop();
}

export function cima(b) {
  return b && b.pila.length ? b.pila[b.pila.length - 1] : null;
}

export function verPila(b) {
  return b ? [...b.pila].reverse() : [];
}

/**
 * Memoiza el resultado de una herramienta.
 *
 * `publico` decide la validez: el contenido del curso vale TTL_PUBLICO; un dato
 * propio vale solo dentro del mismo `turno`, y sin turno no se cachea. Así el
 * mismo mensaje no consulta dos veces la misma fila, y el mensaje siguiente
 * vuelve a mirar la base por si la persona resolvió algo mientras hablaba.
 */
export async function memo(b, llave, { publico = false, turno = null }, fn) {
  if (!b) return { valor: await fn(), cacheado: false };
  const e = b.memo.get(llave);
  const vigente = e && (publico ? ahora() - e.at < TTL_PUBLICO : turno && e.turno === turno);
  if (vigente) {
    b.stats.hits++;
    return { valor: e.valor, cacheado: true };
  }
  const valor = await fn();
  b.stats.misses++;
  // No se cachea un error: un fallo transitorio no debe quedarse pegado al turno.
  if (!(valor && valor.error) && (publico || turno)) {
    b.memo.set(llave, { valor, at: ahora(), turno, publico });
    if (b.memo.size > TOPE_MEMO) b.memo.delete(b.memo.keys().next().value);
  }
  return { valor, cacheado: false };
}

/** Siembra el memo con algo ya calculado (lo usan las herramientas combo). */
export function sembrar(b, llave, valor, { publico = false, turno = null }) {
  if (!b || (valor && valor.error) || (!publico && !turno)) return false;
  b.memo.set(llave, { valor, at: ahora(), turno, publico });
  if (b.memo.size > TOPE_MEMO) b.memo.delete(b.memo.keys().next().value);
  return true;
}

/** Lo que se le puede contar al modelo (y a la traza) sobre su propio bus. */
export function diagnostico(b) {
  if (!b) return { disponible: false };
  const { hits, misses, encolados, servidos } = b.stats;
  return {
    disponible: true,
    cola: { largo: b.cola.length, tope: TOPE_COLA, encolados, servidos },
    pila: { alto: b.pila.length, tope: TOPE_PILA, foco: cima(b) },
    memo: { entradas: b.memo.size, tope: TOPE_MEMO, aciertos: hits, fallos: misses,
            consultasAhorradas: hits },
    ttl: { sesionMin: TTL_SESION / 60_000, publicoMin: TTL_PUBLICO / 60_000 },
  };
}

export const TOPES = { cola: TOPE_COLA, pila: TOPE_PILA, memo: TOPE_MEMO, sesiones: MAX_SESIONES };
export { TIPOS };
