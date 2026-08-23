// Ligas semanales: bronce, plata, oro.
//
// El endpoint y el cron usan ESTE modulo. Antes la logica vivia dentro de
// server.js y el cron habria tenido que llamarse por HTTP con credenciales de
// admin, o duplicar el SQL. Duplicar el reparto de metales es garantizar que un
// dia la tabla que ves y la tabla que se cierra no coincidan.
//
// Decisiones tomadas, no heredadas:
//  · ZONA: America/Bogota para todo el mundo. Una sola zona declarada, porque con
//    la de cada cual dos personas ven cierres distintos y la tabla no compara.
//  · MINIMO DE COHORTE: por debajo de MIN_LIGA nadie tiene liga. Una liga de dos
//    es una competicion falsa; es mas honesto decir que aun no hay.
//  · SOLO PAGO Y APUNTADO: hace falta ranking_optin (el alias es lo unico publico)
//    y paid=1. Competir por un ascenso que no puedes usar es una mala experiencia.
//  · TERMINAL: quien acabo los 36 labs no genera caudal y bajaria por haber
//    terminado. Pasa a 'salon' y conserva su metal.
import { all, get, run } from './db.js';

export const ZONA_LIGA = 'America/Bogota';
export const MIN_LIGA = 5;
export const METALES = ['bronce', 'plata', 'oro'];
const ORDEN = { bronce: 1, plata: 2, oro: 3 };

// Caudal de la semana en curso: labs resueltos por PRIMERA vez dentro de ella.
// El MIN(at) por (user_id, lab_id) es lo que hace imposible inflarlo repitiendo:
// volver a resolver un lab viejo no mueve su MIN(at) de la semana original, asi
// que la consulta no admite la trampa. No hay que detectarla.
//
// Va con $1 literal en vez de ? porque la zona se reusa tres veces y dollars()
// numeraria tres parametros distintos. dollars() solo toca los ?.
//
// El `total` sale de una CTE agregada y NO de una subconsulta correlacionada.
// Con `(SELECT COUNT(*) FROM primera q WHERE q.user_id = o.user_id)` el planner
// mete un SubPlan que reescanea `primera` una vez por usuario: O(U x P). Medido
// con 11 usuarios y 74 primeras veces daba `loops=9` sobre 74 filas — invisible
// hoy y cuadratico manana. Agregando `totales` una sola vez y uniendo, cada CTE
// Scan queda en loops=1: O(U + P).
//
//   antes:   Execution 1.314 ms | Planning 2.194 ms | SubPlan 2, loops=9
//   despues: Execution 0.603 ms | Planning 1.090 ms | sin SubPlan
//   (docker compose exec db, dataset de desarrollo; scripts/medir.sh lo repite)
const SQL_CAUDAL = `
  WITH primera AS (
    SELECT user_id, lab_id, MIN(at) AS cuando
    FROM attempts WHERE correct = 1
    GROUP BY user_id, lab_id
  ), totales AS (
    SELECT user_id, COUNT(*)::int AS total FROM primera GROUP BY user_id
  ), sem AS (
    SELECT date_trunc('week', (now() AT TIME ZONE $1)) AS lunes
  )
  SELECT o.user_id, o.alias,
         COUNT(p.lab_id)::int AS caudal,
         COALESCE(t.total, 0) AS total
  FROM ranking_optin o
  JOIN users us ON us.id = o.user_id AND us.paid = 1
  LEFT JOIN totales t ON t.user_id = o.user_id
  LEFT JOIN primera p ON p.user_id = o.user_id
       AND (p.cuando AT TIME ZONE $1) >= (SELECT lunes FROM sem)
  GROUP BY o.user_id, o.alias, t.total
  ORDER BY caudal DESC, o.alias ASC`;

const SQL_SEMANA = `
  SELECT date_trunc('week', (now() AT TIME ZONE $1))::date AS lunes,
         (date_trunc('week', (now() AT TIME ZONE $1)) + interval '7 days')::date AS cierra`;

// El metal sale del TERCIO en que caes, no de un umbral fijo de labs. Con umbral
// fijo, una semana floja deja la liga de oro vacia y la de bronce llena.
export function reparteMetales(filas) {
  const n = filas.length;
  const corte1 = Math.ceil(n / 3), corte2 = Math.ceil((n * 2) / 3);
  return filas.map((f, i) => ({
    ...f,
    metal: f.total >= 36 ? 'oro' : i < corte1 ? 'oro' : i < corte2 ? 'plata' : 'bronce',
    estado: f.total >= 36 ? 'salon' : 'activo',
    puesto: i + 1,
  }));
}

// --- API que consume agent-tools.js (viene de la rama de las 37 herramientas) ---
//
// Se resuelve el add/add asi: se conserva ESTA implementacion (tiene el arreglo
// medido de la consulta, O(U+P) en vez de O(UxP), y la ventana de ascenso) y se
// exponen los tres nombres que la otra rama definia por su cuenta. Envoltorios
// sobre el MISMO SQL: dos copias del reparto de caudal es garantizar que un dia
// la tabla que ves y la que se cierra no coincidan.

/** Alias historico. La otra rama llamaba ZONA a lo que aqui es ZONA_LIGA. */
export const ZONA = ZONA_LIGA;

/** Caudal crudo de la semana, sin repartir metales. */
export const caudal = () => all(SQL_CAUDAL, [ZONA_LIGA]);

/** Lunes de la semana en curso y cuando cierra. */
export const semanaActual = () => get(SQL_SEMANA, [ZONA_LIGA]);

/** Estado de la semana en curso. `userId` marca cual es "yo" y si subio de liga. */
export async function estadoLigas(userId) {
  const filas = await all(SQL_CAUDAL, [ZONA_LIGA]);
  const semana = await get(SQL_SEMANA, [ZONA_LIGA]);
  if (filas.length < MIN_LIGA) {
    return { activa: false, faltan: MIN_LIGA - filas.length, minimo: MIN_LIGA,
             zona: ZONA_LIGA, semana, tabla: [], yo: null };
  }
  const tabla = reparteMetales(filas);
  const mio = tabla.find((r) => r.user_id === userId) ?? null;

  // Ascenso: se compara con la ULTIMA semana CERRADA, no con la anterior por
  // fecha. Si el cron no corrio una semana, comparar con "la semana pasada" daria
  // null y el ascenso se perderia; con la ultima cerrada el dato sigue siendo
  // cierto, solo mas viejo.
  let subida = null;
  if (mio) {
    // El `week < lunes de esta semana` es obligatorio. Sin el, la ultima semana
    // cerrada puede ser LA ACTUAL (el cron ya corrio), y entonces te comparas
    // contra ti mismo de hace unas horas: si mejoras despues del cierre,
    // reportaria un ascenso que no ocurrio. Verificado: con el cron ya pasado,
    // sin este filtro `subida` salia comparando oro contra oro.
    // Todos los parametros como $n literales, ninguno como ?. Mezclarlos es una
    // trampa: dollars() (db.js:10) numera SOLO los ?, asi que un `?` mas un `$2`
    // literal funciona por casualidad mientras el orden coincida, y el dia que
    // alguien meta otro ? delante la numeracion colisiona sin dar error.
    const prev = await get(
      `SELECT metal, week FROM league_week
       WHERE user_id = $1 AND cerrada = 1
         AND week < date_trunc('week', (now() AT TIME ZONE $2))::date
       ORDER BY week DESC LIMIT 1`, [userId, ZONA_LIGA]);
    if (prev && ORDEN[mio.metal] > ORDEN[prev.metal]) {
      subida = { de: prev.metal, a: mio.metal, semana: prev.week };
    }
  }

  // El user_id no sale: el alias es lo unico publico de otra persona.
  const publica = tabla.map(({ user_id, ...r }) => r);
  return {
    activa: true, zona: ZONA_LIGA, semana, minimo: MIN_LIGA, metales: METALES,
    tabla: publica,
    yo: mio ? { alias: mio.alias, metal: mio.metal, puesto: mio.puesto,
                caudal: mio.caudal, estado: mio.estado, subida } : null,
  };
}

/**
 * Cierra la semana en curso. IDEMPOTENTE: la PK (user_id, week) con DO NOTHING
 * deja reintentar sin duplicar ni alterar, asi que el cron puede fallar y
 * reintentar sin que nadie mire nada a mano.
 */
export async function cerrarSemana() {
  const filas = await all(SQL_CAUDAL, [ZONA_LIGA]);
  if (filas.length < MIN_LIGA) {
    return { cerradas: 0, saltadas: 0, motivo: 'cohorte_insuficiente', minimo: MIN_LIGA, total: filas.length };
  }
  const tabla = reparteMetales(filas);
  const sem = await get(SQL_SEMANA, [ZONA_LIGA]);
  let n = 0;
  for (const r of tabla) {
    const res = await run(
      `INSERT INTO league_week (user_id, week, metal, caudal, puesto, estado, cerrada)
       VALUES (?,?,?,?,?,?,1) ON CONFLICT (user_id, week) DO NOTHING`,
      [r.user_id, sem.lunes, r.metal, r.caudal, r.puesto, r.estado]);
    n += res?.rowCount ?? 0;
  }
  return { cerradas: n, saltadas: tabla.length - n, semana: sem.lunes, total: tabla.length };
}
