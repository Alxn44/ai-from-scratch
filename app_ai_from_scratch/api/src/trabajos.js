// Cola de trabajos. Postgres como cola, no RabbitMQ — y la razon esta medida.
//
// EL TRABAJO QUE DE VERDAD NO PUEDE SER SINCRONO
//
// Uno solo hoy: el webhook de Mercado Pago. Antes de este modulo, el manejador
// verificaba la firma y ENTONCES llamaba a la API de Mercado Pago y escribia dos
// veces en la base, todo antes de responder 200. Dos consecuencias reales:
//
//   · Si su API tarda, MP da timeout en el webhook y REINTENTA. La base es
//     idempotente por el ON CONFLICT, asi que no salen filas duplicadas, pero el
//     `paid = 1` del comprador queda al albur de la politica de reintentos de un
//     tercero.
//   · Si el fetch falla, respondemos 500 y el evento se pierde salvo que MP
//     insista. Una confirmacion de pago no puede depender de eso.
//
// La forma correcta: verificar la firma, ANOTAR el evento, responder 200 en
// milisegundos, y procesar aparte con reintentos.
//
// POR QUE NO RABBITMQ (todavia)
//
// Un broker resuelve fan-out entre servicios, throughput alto y consumidores en
// varias maquinas. Hoy hay un trabajo, un consumidor y un pago de USD 9.99 por
// persona. Anadir RabbitMQ seria un contenedor mas, un protocolo mas, una cola
// de mensajes muertos que vigilar y un modo de fallo nuevo (broker caido =
// pagos sin procesar) para mover un mensaje cada cierto tiempo.
//
// `FOR UPDATE SKIP LOCKED` da semantica de cola de verdad — un trabajo lo toma
// exactamente un obrero, incluso con varios procesos — sobre una base que YA
// esta desplegada y respaldada. Es la misma tecnica que usan pgmq, Oban y
// Solid Queue; no es un apano.
//
// CUANDO CAMBIAR A RABBITMQ (condiciones, no opiniones)
//
//   1. Mas de ~50 trabajos por segundo sostenidos, o
//   2. un consumidor que NO es este proceso (un servicio de correo, un
//      generador de PDF en otra maquina), o
//   3. hace falta fan-out: un evento con varios interesados distintos.
//
// Mientras no se cumpla ninguna, la cola en Postgres es mas barata y falla en
// menos sitios. El cambio esta preparado: encola() y el bucle de obrero son la
// unica frontera; un driver de RabbitMQ reemplaza tomaLote() y termina() sin
// tocar quien encola ni quien ejecuta.
import { all, get, run } from './db.js';

// Lo MINIMO que el obrero necesita de un log. No es `Console`: pedir Console
// obliga a cualquier doble de prueba a implementar 21 metodos que nadie llama, y
// entonces las pruebas pasan un `any` y el tipo deja de proteger.
/** @typedef {{ warn?: (...a: any[]) => void, error?: (...a: any[]) => void }} Log */

// `throw` acepta cualquier cosa, no solo Error: una libreria que lanza una cadena
// deja `e.message` en undefined y el log diria «reintento: undefined». Esto saca
// texto de lo que sea.
const mensaje = (e) => (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e));

/** Manejadores por tipo. Se registran desde fuera para no acoplar la cola al dominio. */
const MANEJADORES = new Map();

/** @param {string} tipo @param {(datos: any) => Promise<void>} fn */
export function registra(tipo, fn) { MANEJADORES.set(tipo, fn); }

export const MAX_INTENTOS = 6;
// Espera exponencial con techo: 2s, 8s, 32s, 128s, 512s, 1024s. Un pago que
// falla por una caida de la pasarela se reintenta media hora larga; mas alla de
// eso el problema no es transitorio y hace falta mirarlo a mano.
export const espera = (intentos) => Math.min(1024, 2 * 4 ** Math.max(0, intentos - 1));

/**
 * Encola un trabajo. `clave` lo hace idempotente: encolar dos veces la misma
 * clave no crea dos trabajos. Para un webhook la clave es el id del pago, asi
 * que el reintento de Mercado Pago no duplica trabajo.
 */
export async function encola(tipo, datos, clave = null) {
  const r = await run(
    `INSERT INTO jobs (tipo, clave, datos, corre_en)
     VALUES (?,?,?, now())
     ON CONFLICT (tipo, clave) DO NOTHING`,
    [tipo, clave ?? `${tipo}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
     JSON.stringify(datos ?? {})]);
  return { nuevo: (r?.rowCount ?? 0) > 0 };
}

/**
 * Toma hasta `n` trabajos vencidos y los marca en curso EN LA MISMA consulta.
 *
 * SKIP LOCKED es lo que hace esto una cola: dos obreros que corran a la vez no
 * se pelean por el mismo trabajo — el segundo salta las filas bloqueadas en vez
 * de esperar. Sin SKIP LOCKED, con dos procesos, uno se queda bloqueado detras
 * del otro y la cola se serializa sin que nada avise.
 *
 * SOLO SE TOMAN LOS TIPOS QUE ESTE PROCESO SABE EJECUTAR. No es un detalle: sin
 * el filtro, en un despliegue rodado la instancia VIEJA toma un trabajo de un
 * tipo nuevo, no encuentra manejador y lo mata — matando trabajo que la
 * instancia nueva si sabria hacer. Lo encontro una prueba: el obrero del
 * servidor en marcha se estaba comiendo los trabajos `test.*` de api/test/cola.mjs.
 *
 * Un tipo sin manejador en NINGUN proceso se queda pendiente, y estadoCola() lo
 * cuenta como huerfano para que no sea invisible.
 */
export async function tomaLote(n = 5, tipos = [...MANEJADORES.keys()]) {
  if (!tipos.length) return [];
  return all(
    `UPDATE jobs SET estado = 'curso', intentos = intentos + 1, tomado_en = now()
     WHERE id IN (
       SELECT id FROM jobs
       WHERE estado = 'pendiente' AND corre_en <= now() AND tipo = ANY(?)
       ORDER BY corre_en
       LIMIT ?
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, tipo, clave, datos, intentos`, [tipos, n]);
}

async function termina(id) {
  await run(`UPDATE jobs SET estado = 'hecho', acabado_en = now(), error = NULL WHERE id = ?`, [id]);
}

async function reprograma(id, intentos, error) {
  const msg = String(mensaje(error) ?? error).slice(0, 500);
  if (intentos >= MAX_INTENTOS) {
    // No se borra: un trabajo muerto que desaparece es un pago perdido sin
    // rastro. Se queda en 'muerto' para poder verlo y reintentarlo a mano.
    await run(`UPDATE jobs SET estado = 'muerto', error = ?, acabado_en = now() WHERE id = ?`, [msg, id]);
    return { muerto: true };
  }
  const s = espera(intentos);
  await run(
    `UPDATE jobs SET estado = 'pendiente', error = ?, corre_en = now() + (? * interval '1 second')
     WHERE id = ?`, [msg, s, id]);
  return { muerto: false, enSegundos: s };
}

/**
 * Corre un lote. Devuelve el recuento; no lanza: un trabajo malo no tumba al obrero.
 * @param {number} [n]
 * @param {Log} [log]
 */
export async function corre(n = 5, log = console) {
  const lote = await tomaLote(n);
  let hechos = 0, fallos = 0, muertos = 0;
  for (const j of lote) {
    const fn = MANEJADORES.get(j.tipo);
    if (!fn) {
      // Con el filtro de tomaLote esto no deberia pasar. Si pasa, alguien
      // desregistro un tipo entre tomar y ejecutar: se devuelve a pendiente en
      // vez de matarlo, porque el trabajo sigue siendo valido.
      await run(`UPDATE jobs SET estado = 'pendiente', intentos = intentos - 1 WHERE id = ?`, [j.id]);
      continue;
    }
    try {
      const datos = typeof j.datos === 'string' ? JSON.parse(j.datos) : j.datos;
      await fn(datos ?? {});
      await termina(j.id);
      hechos++;
    } catch (e) {
      const r = await reprograma(j.id, j.intentos, e);
      if (r.muerto) { muertos++; log.error?.({ trabajo: j.id, tipo: j.tipo }, `trabajo muerto: ${mensaje(e)}`); }
      else { fallos++; log.warn?.({ trabajo: j.id, tipo: j.tipo, enSegundos: r.enSegundos }, `reintento: ${mensaje(e)}`); }
    }
  }
  return { tomados: lote.length, hechos, fallos, muertos };
}

/**
 * Bucle de obrero. Sondeo cada `msVacio` cuando no hay nada.
 *
 * Sondear no es elegante y es lo correcto aqui: a un trabajo cada varias horas,
 * un LISTEN/NOTIFY anade una conexion dedicada y un camino de reconexion para
 * ahorrar una consulta que cuesta menos de un milisegundo. Cuando el volumen lo
 * pida, este es el sitio donde se cambia.
 *
 * @param {{msVacio?: number, msLleno?: number, lote?: number, log?: Log}} [opciones]
 * @returns {() => void} funcion para pararlo
 */
export function obrero({ msVacio = 5000, msLleno = 200, lote = 5, log = console } = {}) {
  let vivo = true;
  let reloj = null;
  const tic = async () => {
    if (!vivo) return;
    let r = { tomados: 0 };
    try { r = await corre(lote, log); }
    catch (e) { log.error?.(`obrero: ${mensaje(e)}`); }
    if (!vivo) return;
    reloj = setTimeout(tic, r.tomados ? msLleno : msVacio);
    reloj.unref?.();   // no impide que el proceso termine
  };
  tic();
  return () => { vivo = false; if (reloj) clearTimeout(reloj); };
}

/** Para /api/health y para saber si algo se esta acumulando. */
export async function estadoCola() {
  const filas = await all(`SELECT estado, COUNT(*)::int AS n FROM jobs GROUP BY estado`);
  const viejo = await get(
    `SELECT EXTRACT(EPOCH FROM (now() - MIN(corre_en)))::int AS s
     FROM jobs WHERE estado = 'pendiente' AND corre_en <= now()`);
  const tipos = [...MANEJADORES.keys()];
  // Huerfanos: pendientes de un tipo que ESTE proceso no sabe ejecutar. Con una
  // sola instancia es un error de programacion; con varias puede ser normal un
  // rato durante un despliegue. En cualquier caso tiene que ser visible: un
  // trabajo que nadie toma y nadie cuenta es un trabajo perdido en silencio.
  const huer = tipos.length
    ? await all(`SELECT tipo, COUNT(*)::int AS n FROM jobs
                 WHERE estado = 'pendiente' AND NOT (tipo = ANY(?)) GROUP BY tipo`, [tipos])
    : await all(`SELECT tipo, COUNT(*)::int AS n FROM jobs WHERE estado = 'pendiente' GROUP BY tipo`);
  return {
    por: Object.fromEntries(filas.map((f) => [f.estado, f.n])),
    esperaMax: viejo?.s ?? 0,
    manejadores: tipos,
    huerfanos: Object.fromEntries(huer.map((f) => [f.tipo, f.n])),
  };
}
