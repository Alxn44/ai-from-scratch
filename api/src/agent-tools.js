// Superficie de herramientas del agente. Es TODO lo que el modelo puede hacer
// contra la base: no hay SQL, no hay búsqueda libre, no hay parámetro de usuario.
//
// El aislamiento está aquí y no en el prompt: `ctx.userId` lo pone el servidor
// desde la cookie de sesión. Ninguna firma acepta un identificador de persona,
// así que el modelo no tiene forma de expresar «los datos de otro». Si el texto
// que escribe el usuario intenta inyectar instrucciones, lo peor que consigue es
// que el agente le devuelva sus propios datos otra vez.
import { all, get } from './db.js';
import { assertSinProhibidas } from './ontology.js';

const LAB_ID = /^([1-9]|1[0-2])\.[1-3]$/;

/** Deja solo las claves declaradas. Un `user_id` colado se descarta y se registra. */
function limpiar(nombre, permitidas, args) {
  const entrada = args && typeof args === 'object' ? args : {};
  const sobran = Object.keys(entrada).filter((k) => !permitidas.includes(k));
  const limpio = {};
  for (const k of permitidas) if (k in entrada) limpio[k] = entrada[k];
  return { limpio, sobran };
}

const COLS_LAB = 'id, lesson_n, idx, level, kind, prompt, payload, draft';

const HERRAMIENTAS = {
  curso_indice: {
    descripcion: 'Las 12 lecciones con su título, su número ancla y cuántos labs tiene cada una.',
    args: {},
    async fn() {
      const filas = await all(`SELECT n, eyebrow, title, summary, math, math_cap,
                                      (technical <> '') AS tiene_tecnico
                               FROM lessons ORDER BY n`);
      return { lecciones: filas };
    },
  },

  leccion: {
    descripcion: 'El contenido completo de una lección y el enunciado de sus tres labs. Nunca trae las respuestas.',
    args: { n: 'entero 1..12' },
    async fn(ctx, { n }) {
      const num = Number(n);
      if (!Number.isInteger(num) || num < 1 || num > 12) return { error: 'leccion_invalida' };
      const leccion = await get('SELECT n, eyebrow, title, summary, math, math_cap, technical, analogy FROM lessons WHERE n = ?', [num]);
      if (!leccion) return { error: 'no_existe' };
      const labs = await all(`SELECT ${COLS_LAB} FROM labs WHERE lesson_n = ? ORDER BY idx`, [num]);
      labs.forEach((l) => assertSinProhibidas('labs', l));
      return { leccion, labs };
    },
  },

  mi_progreso: {
    descripcion: 'Cuántas lecciones y labs lleva resueltos la persona de esta sesión, lección por lección.',
    args: {},
    async fn(ctx) {
      const porLeccion = await all(`
        SELECT l.lesson_n AS n, COUNT(*)::int AS total,
               SUM(CASE WHEN a.solved = 1 THEN 1 ELSE 0 END)::int AS resueltos
        FROM labs l
        LEFT JOIN (SELECT lab_id, MAX(correct) AS solved FROM attempts WHERE user_id = ? GROUP BY lab_id) a
          ON a.lab_id = l.id
        GROUP BY l.lesson_n ORDER BY l.lesson_n`, [ctx.userId]);
      const labs = porLeccion.reduce((s, r) => s + r.resueltos, 0);
      return { labsResueltos: labs, totalLabs: 36, leccionesCerradas: porLeccion.filter((r) => r.resueltos === r.total).length, porLeccion };
    },
  },

  mis_intentos: {
    descripcion: 'Los intentos de la persona de esta sesión en un lab, con lo que respondió. La explicación solo llega si ya lo intentó.',
    args: { lab_id: 'texto como «5.2»' },
    async fn(ctx, { lab_id }) {
      const id = String(lab_id ?? '');
      if (!LAB_ID.test(id)) return { error: 'lab_invalido' };
      const intentos = await all(
        'SELECT lab_id, answer, correct, at FROM attempts WHERE user_id = ? AND lab_id = ? ORDER BY at',
        [ctx.userId, id]);
      const lab = await get(`SELECT ${COLS_LAB} FROM labs WHERE id = ?`, [id]);
      if (!lab) return { error: 'no_existe' };
      assertSinProhibidas('labs', lab);
      // La explicación se comporta igual que en la interfaz: aparece cuando ya
      // hubo un intento, no antes. Sin intentos no hay nada que explicar.
      const conExplicacion = intentos.length > 0
        ? (await get('SELECT explanation FROM labs WHERE id = ?', [id])).explanation
        : null;
      return {
        lab, intentos, resuelto: intentos.some((i) => i.correct === 1),
        explicacion: conExplicacion,
        nota: conExplicacion ? undefined : 'Esta persona todavía no ha intentado este lab: no le des la explicación ni la respuesta.',
      };
    },
  },

  mi_perfil: {
    descripcion: 'Nombre de pila, rol, idioma y si compró el curso. Solo de la sesión actual.',
    args: {},
    async fn(ctx) {
      const u = await get('SELECT name, role, lang, paid, cohort, created_at FROM users WHERE id = ? AND deleted_at IS NULL', [ctx.userId]);
      if (!u) return { error: 'sin_sesion' };
      return {
        nombre: String(u.name).split(' ')[0],
        rol: u.role, idioma: u.lang, pagado: !!u.paid,
        cohorte: u.cohort, desde: u.created_at,
      };
    },
  },

  ranking_publico: {
    descripcion: 'Alias y avance de quienes aceptaron aparecer, más la posición propia. Nunca nombres ni correos.',
    args: {},
    async fn(ctx) {
      // Solo alias: el mapeo alias -> nombre/correo no lo expone ninguna herramienta,
      // así que «quién es kata.mono» no tiene respuesta por este camino.
      const tabla = await all(`
        SELECT o.alias, COUNT(DISTINCT hechas.lesson_n)::int AS lecciones
        FROM ranking_optin o
        LEFT JOIN (
          SELECT a.user_id, l.lesson_n
          FROM labs l
          JOIN attempts a ON a.lab_id = l.id AND a.correct = 1
          GROUP BY a.user_id, l.lesson_n
          HAVING COUNT(DISTINCT a.lab_id) = (SELECT COUNT(*) FROM labs x WHERE x.lesson_n = l.lesson_n)
        ) hechas ON hechas.user_id = o.user_id
        GROUP BY o.alias, o.joined_at
        ORDER BY lecciones DESC, o.joined_at ASC
        LIMIT 20`);
      const mio = await get('SELECT alias FROM ranking_optin WHERE user_id = ?', [ctx.userId]);
      return {
        disponible: true,
        apuntado: !!mio,
        miAlias: mio?.alias ?? null,
        miPuesto: mio ? (tabla.findIndex((r) => r.alias === mio.alias) + 1) || null : null,
        tabla,
      };
    },
  },

  mis_logros: {
    descripcion: 'El rango de la persona de esta sesión. Un rango cada dos lecciones cerradas.',
    args: {},
    async fn(ctx) {
      const RANGOS = ['Iniciado', 'Lector de Señales', 'Operador', 'Domador de Perillas', 'Cartógrafo', 'Mano Firme'];
      const filas = await all(`
        SELECT l.lesson_n AS n, COUNT(*)::int AS total,
               SUM(CASE WHEN a.solved = 1 THEN 1 ELSE 0 END)::int AS resueltos
        FROM labs l
        LEFT JOIN (SELECT lab_id, MAX(correct) AS solved FROM attempts WHERE user_id = ? GROUP BY lab_id) a
          ON a.lab_id = l.id
        GROUP BY l.lesson_n`, [ctx.userId]);
      const cerradas = filas.filter((r) => r.resueltos === r.total).length;
      const idx = Math.min(6, Math.ceil(cerradas / 2));
      return {
        leccionesCerradas: cerradas,
        rango: idx === 0 ? null : RANGOS[idx - 1],
        siguiente: idx >= 6 ? null : RANGOS[idx],
        faltanParaSiguiente: idx >= 6 ? 0 : (idx + 1) * 2 - cerradas,
      };
    },
  },
};

/** Lo que se le declara al modelo: nombre, descripción y argumentos. Sin usuario. */
export function catalogo() {
  return Object.entries(HERRAMIENTAS).map(([nombre, h]) => ({
    nombre, descripcion: h.descripcion, argumentos: h.args,
  }));
}

/**
 * Ejecuta una herramienta. `ctx` lo arma el servidor desde la cookie; lo que
 * venga del modelo solo puede influir en `args`, y solo en las claves declaradas.
 */
export async function ejecutar(ctx, nombre, args) {
  const h = HERRAMIENTAS[nombre];
  if (!h) return { error: 'herramienta_desconocida', nombre };
  if (!ctx || !Number.isInteger(ctx.userId)) return { error: 'sin_sesion' };
  const { limpio, sobran } = limpiar(nombre, Object.keys(h.args), args);
  const salida = await h.fn(ctx, limpio);
  // Si el modelo intentó colar un identificador, queda registrado y se ignora.
  return sobran.length ? { ...salida, _ignorado: sobran } : salida;
}
