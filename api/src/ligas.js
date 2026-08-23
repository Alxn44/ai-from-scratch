// Ligas semanales, en un módulo aparte porque ahora hay dos consumidores: la ruta
// `/api/ligas` y las herramientas del agente. Si el caudal se calculara dos veces,
// el chat y la pantalla acabarían diciendo cosas distintas de la misma semana.
//
// Las decisiones (zona única, mínimo de cohorte, metal por tercios, estado
// terminal) están documentadas en `db.js`, sobre la tabla `league_week`.
import { all, get } from './db.js';

export const ZONA = 'America/Bogota';
export const MIN_LIGA = 5;
export const METALES = ['bronce', 'plata', 'oro'];

// Caudal de la semana en curso: labs resueltos por PRIMERA vez dentro de ella.
// El MIN(at) por (user_id, lab_id) es lo que hace imposible inflarlo repitiendo.
// Nota: aquí va $1 literal en vez de ? porque la zona se reusa tres veces y
// dollars() numeraría tres parámetros distintos. dollars() solo toca los ?.
const SQL_CAUDAL = `
  WITH primera AS (
    SELECT user_id, lab_id, MIN(at) AS cuando
    FROM attempts WHERE correct = 1
    GROUP BY user_id, lab_id
  ), sem AS (
    SELECT date_trunc('week', (now() AT TIME ZONE $1)) AS lunes
  )
  SELECT o.user_id, o.alias,
         COUNT(p.lab_id)::int AS caudal,
         (SELECT COUNT(*)::int FROM primera q WHERE q.user_id = o.user_id) AS total
  FROM ranking_optin o
  JOIN users us ON us.id = o.user_id AND us.paid = 1
  LEFT JOIN primera p ON p.user_id = o.user_id
       AND (p.cuando AT TIME ZONE $1) >= (SELECT lunes FROM sem)
  GROUP BY o.user_id, o.alias
  ORDER BY caudal DESC, o.alias ASC`;

/** Filas con user_id: solo para uso interno del servidor. */
export const caudal = () => all(SQL_CAUDAL, [ZONA]);

export const semanaActual = () => get(
  `SELECT date_trunc('week', (now() AT TIME ZONE $1))::date AS lunes,
          (date_trunc('week', (now() AT TIME ZONE $1)) + interval '7 days')::date AS cierra`,
  [ZONA]);

// El metal sale del TERCIO en que caes, no de un umbral fijo de labs. Con umbral
// fijo, una semana floja deja la liga de oro vacía y la de bronce llena.
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
