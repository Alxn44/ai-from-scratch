// Superficie de herramientas del agente. Es TODO lo que el modelo puede hacer
// contra la base: no hay SQL, no hay búsqueda libre, no hay parámetro de usuario.
//
// El aislamiento está aquí y no en el prompt: `ctx.userId` lo pone el servidor
// desde la cookie de sesión. Ninguna firma acepta un identificador de persona,
// así que el modelo no tiene forma de expresar «los datos de otro». Si el texto
// que escribe el usuario intenta inyectar instrucciones, lo peor que consigue es
// que el agente le devuelva sus propios datos otra vez.
//
// ------------------------------------------------------------------------------
// CÓMO ESTÁ ORGANIZADO (37 herramientas, cuatro familias)
//
//   contenido  · el curso: lecciones, textos, labs, glosario, búsqueda
//   propio     · lo de esta persona: progreso, errores, racha, ritmo, liga, acceso
//   producto   · lo que no está en ninguna tabla: precio, rutas, soporte, ajustes
//   coordinar  · la pila y la cola (ver `agent-bus.js`)
//
// POR QUÉ TANTAS. Porque son las preguntas que llegan de verdad por chat: «¿qué
// hago ahora?», «¿por qué no puedo abrir la 4?», «¿cuánto cuesta?», «¿en qué
// estoy fallando?», «¿dónde cambio el idioma?». Cada una tiene su herramienta
// para que la respuesta salga de un dato y no de la imaginación del modelo.
//
// CÓMO SE HABLAN ENTRE ELLAS. No se llaman unas a otras: se dejan trabajo en el
// bus de la sesión.
//
//   `plan_estudio` y `mis_errores` ENCOLAN labs (FIFO).
//   `cola_siguiente` saca la cabeza y la devuelve YA RESUELTA — ficha del lab,
//     intentos propios, puntero a la lección — o sea tres herramientas en una.
//   `leccion_texto`, `lab_ficha` y `cola_siguiente` APILAN el foco (LIFO); si la
//     conversación se va por una rama, `foco_volver` recupera dónde estaba.
//   `mi_panorama` SIEMBRA el memo con perfil, progreso, racha y siguiente paso:
//     si el modelo pide luego cualquiera de esos por separado, ya no toca la base.
//
// Eso es lo que hace que quepa en las 4 vueltas del harness: menos viajes, no
// menos datos.
// ------------------------------------------------------------------------------
import { all, get } from './db.js';
import { assertSinProhibidas } from './ontology.js';
import { GRADOS_LECCION, RANGO_MAX, codigoLeccion, codigoRango, logrosDe } from './logros.js';
import { METALES, MIN_LIGA, ZONA, caudal, reparteMetales, semanaActual } from './ligas.js';
import {
  COMO_FUNCIONA, GLOSARIO, MECANICAS, PRECIO, RUTAS, SOPORTE,
  enIdioma, faqPara, glosarioPara, rutasPara, terminos,
} from './producto.js';
import {
  apilar, bus, cima, desapilar, desencolar, diagnostico, encolar,
  memo, sembrar, verCola, verPila, TIPOS,
} from './agent-bus.js';

const LAB_ID = /^([1-9]|1[0-2])\.[1-3]$/;
const IDIOMAS = ['es', 'en', 'fr', 'pt'];
const LECCIONES_LIBRES = 1;   // igual que en el servidor: la 1 es la vitrina
const TOTAL_LABS = 36;

/** Deja solo las claves declaradas. Un `user_id` colado se descarta y se registra. */
function limpiar(nombre, permitidas, args) {
  const entrada = args && typeof args === 'object' ? args : {};
  const sobran = Object.keys(entrada).filter((k) => !permitidas.includes(k));
  const limpio = {};
  for (const k of permitidas) if (k in entrada) limpio[k] = entrada[k];
  return { limpio, sobran };
}

const COLS_LAB = 'id, lesson_n, idx, level, kind, prompt, payload, draft';

// ---------------------------------------------------------------------------
// Piezas que reusan varias herramientas. Ninguna acepta un id de persona: todas
// reciben el ctx que armó el servidor.
// ---------------------------------------------------------------------------

const idioma = (ctx, pedido) => (IDIOMAS.includes(pedido) ? pedido : IDIOMAS.includes(ctx?.lang) ? ctx.lang : 'es');

const yo = (ctx) => get('SELECT name, role, lang, theme, paid, cohort, created_at FROM users WHERE id = ? AND deleted_at IS NULL', [ctx.userId]);

/** La misma regla que el muro de pago del servidor, no una copia aproximada. */
const conAcceso = (u, n) => !!u?.paid || (u?.role && u.role !== 'student') || Number(n) <= LECCIONES_LIBRES;

const SQL_POR_LECCION = `
  SELECT l.lesson_n AS n, COUNT(*)::int AS total,
         SUM(CASE WHEN a.solved = 1 THEN 1 ELSE 0 END)::int AS resueltos
  FROM labs l
  LEFT JOIN (SELECT lab_id, MAX(correct) AS solved FROM attempts WHERE user_id = ? GROUP BY lab_id) a
    ON a.lab_id = l.id
  GROUP BY l.lesson_n ORDER BY l.lesson_n`;

const porLeccion = (ctx) => all(SQL_POR_LECCION, [ctx.userId]);

const cerradas = (filas) => filas.filter((r) => r.total > 0 && r.resueltos === r.total).length;

/** Labs sin resolver, en orden de curso. Lleva el candado ya calculado. */
async function pendientes(ctx, u) {
  const filas = await all(`
    SELECT l.id, l.lesson_n, l.idx, l.level, l.kind, l.draft, s.title
    FROM labs l
    JOIN lessons s ON s.n = l.lesson_n
    LEFT JOIN (SELECT lab_id, MAX(correct) AS solved FROM attempts WHERE user_id = ? GROUP BY lab_id) a
      ON a.lab_id = l.id
    WHERE COALESCE(a.solved, 0) = 0
    ORDER BY l.lesson_n, l.idx`, [ctx.userId]);
  return filas.map((l) => ({
    lab_id: l.id, leccion: l.lesson_n, titulo: l.title, idx: l.idx, level: l.level,
    kind: l.kind, borrador: !!l.draft, cerrado: !conAcceso(u, l.lesson_n),
  }));
}

/** Fechas (zona del producto) con actividad, de la más reciente a la más vieja. */
const diasActivos = (ctx) => all(
  `SELECT DISTINCT ((at AT TIME ZONE ?)::date)::text AS dia
   FROM attempts WHERE user_id = ? ORDER BY dia DESC`, [ZONA, ctx.userId]);

/** Racha en días consecutivos. Se corta si ayer no hubo nada. */
function calculaRacha(dias) {
  if (!dias.length) return { racha: 0, mejorRacha: 0, activo: null, diasActivos: 0 };
  const d = (s) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
  const nums = dias.map(d);
  let mejor = 1, corrida = 1;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i - 1] - nums[i] === 1) { corrida++; mejor = Math.max(mejor, corrida); } else corrida = 1;
  }
  // La racha viva solo cuenta si el último día es hoy o ayer; si no, ya se cortó.
  const hoy = Math.floor(Date.now() / 86_400_000);
  let viva = 0;
  if (hoy - nums[0] <= 1) { viva = 1; for (let i = 1; i < nums.length; i++) { if (nums[i - 1] - nums[i] === 1) viva++; else break; } }
  return { racha: viva, mejorRacha: mejor, activo: dias[0], diasActivos: dias.length };
}

/** El siguiente lab recomendado. Respeta el candado y los borradores. */
async function siguientePaso(ctx, u) {
  const cola = await pendientes(ctx, u);
  const abierto = cola.find((l) => !l.cerrado && !l.borrador);
  if (abierto) {
    return {
      hay: true, lab_id: abierto.lab_id, leccion: abierto.leccion, titulo: abierto.titulo,
      nivel: abierto.level, mecanica: abierto.kind, ruta: `/leccion/${abierto.leccion}`,
      porQue: 'Es el primer lab sin resolver de la lección más baja que tienes abierta.',
    };
  }
  const cerrado = cola.find((l) => l.cerrado);
  if (cerrado) {
    return {
      hay: false, motivo: 'requiere_compra', siguienteCerrado: cerrado.leccion,
      ruta: '/pago', precio: { monto: PRECIO.monto, moneda: PRECIO.moneda },
      porQue: `Terminaste lo abierto. La lección ${cerrado.leccion} necesita la compra.`,
    };
  }
  return { hay: false, motivo: 'curso_completo', ruta: '/ligas',
           porQue: 'No queda ningún lab sin resolver: los 36 están hechos.' };
}

/** Estado de la liga de esta semana, con el puesto propio si lo hay. */
async function estadoLiga(ctx, u) {
  const [filas, semana] = await Promise.all([caudal(), semanaActual()]);
  const apuntado = await get('SELECT alias FROM ranking_optin WHERE user_id = ?', [ctx.userId]);
  const base = { zona: ZONA, semana, minimo: MIN_LIGA, metales: METALES, participantes: filas.length };
  if (!u.paid) return { ...base, activa: false, yo: null, motivo: 'requiere_compra' };
  if (!apuntado) return { ...base, activa: false, yo: null, motivo: 'sin_alias', ruta: '/ranking' };
  if (filas.length < MIN_LIGA) {
    return { ...base, activa: false, yo: null, motivo: 'cohorte_insuficiente', faltan: MIN_LIGA - filas.length };
  }
  const tabla = reparteMetales(filas);
  const mio = tabla.find((r) => r.user_id === ctx.userId) ?? null;
  return {
    ...base, activa: true,
    yo: mio ? { alias: mio.alias, metal: mio.metal, puesto: mio.puesto, caudal: mio.caudal, estado: mio.estado } : null,
  };
}

/** Texto de enseñanza de una lección, con respaldo al español. */
async function textoLeccion(n, lang) {
  const Q = 'SELECT technical, analogy, examples FROM lesson_text WHERE lesson_n = ? AND lang = ?';
  let fila = await get(Q, [n, lang]);
  let escritoEn = fila ? lang : null;
  if (!fila && lang !== 'es') { fila = await get(Q, [n, 'es']); escritoEn = fila ? 'es' : null; }
  if (fila) assertSinProhibidas('lesson_text', fila);
  return { texto: fila, escritoEn };
}

const recorta = (s, largo = 180) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > largo ? `${t.slice(0, largo - 1)}…` : t;
};

// ---------------------------------------------------------------------------
// Las herramientas.
//
//   descripcion · lo que ve el modelo. Es la única guía que tiene para elegir.
//   args        · texto declarado; «opcional ·» al frente lo vuelve no obligatorio.
//   publico     · true = contenido del curso (cachea 10 min); false = dato propio
//                 (cachea solo dentro del mismo turno).
//   cachea      · false en las que tocan la pila o la cola: mutan, no se repiten.
//   efecto      · se ejecuta siempre, incluso si la salida vino del memo. Aquí van
//                 el apilado del foco y el encolado de trabajo.
// ---------------------------------------------------------------------------

const HERRAMIENTAS = {

  // ---------------------------------------------------------------- contenido
  curso_indice: {
    familia: 'contenido', publico: true,
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
    familia: 'contenido', publico: true,
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

  leccion_texto: {
    familia: 'contenido', publico: true,
    descripcion: 'La explicación técnica, la analogía y los dos ejemplos resueltos de una lección, en el idioma de la sesión. Es con lo que hay que enseñar antes de mandar al lab.',
    args: { n: 'entero 1..12', idioma: 'opcional · «es» o «en»; por defecto el de la sesión' },
    async fn(ctx, { n, idioma: pedido }) {
      const num = Number(n);
      if (!Number.isInteger(num) || num < 1 || num > 12) return { error: 'leccion_invalida' };
      const lang = idioma(ctx, pedido);
      const cabeza = await get('SELECT n, eyebrow, title, summary, math, math_cap FROM lessons WHERE n = ?', [num]);
      if (!cabeza) return { error: 'no_existe' };
      const { texto, escritoEn } = await textoLeccion(num, lang);
      if (!texto) return { leccion: cabeza, texto: null, nota: 'Esta lección todavía no tiene texto escrito: no lo inventes.' };
      return {
        leccion: cabeza, idioma: escritoEn, pedido: lang,
        tecnica: texto.technical, analogia: texto.analogy, ejemplos: texto.examples,
        nota: escritoEn === lang ? undefined : `No hay texto en «${lang}»: va el español. Puedes traducirlo al responder.`,
      };
    },
    // Enseñar una lección es entrar en ella: queda el foco por si la conversación
    // se va por una rama y hay que volver.
    efecto(ctx, { n }, salida) {
      if (!salida?.error) apilar(bus(ctx.userId), { tipo: 'leccion', ref: Number(n), nota: 'texto de la lección' });
    },
  },

  buscar_en_curso: {
    familia: 'contenido', publico: true,
    descripcion: 'Busca una palabra o una idea en las 12 lecciones y en los enunciados de los labs, y dice en qué lección está. Úsala antes de responder de memoria.',
    args: { consulta: 'texto libre: «tokens», «por qué inventa cosas»' },
    async fn(ctx, { consulta }) {
      const q = String(consulta ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (q.length < 2) return { error: 'consulta_corta' };
      const palabras = q.split(/\s+/).filter((w) => w.length > 2).slice(0, 6);
      if (!palabras.length) return { error: 'consulta_corta' };
      const lang = idioma(ctx, null);
      const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const cuenta = (texto) => palabras.reduce((p, w) => p + (norm(texto).includes(w) ? 1 : 0), 0);

      const lecciones = await all('SELECT n, eyebrow, title, summary, math_cap, technical, analogy FROM lessons ORDER BY n');
      const textos = await all('SELECT lesson_n, technical, analogy FROM lesson_text WHERE lang = ?', [lang]);
      const labs = await all('SELECT id, lesson_n, prompt FROM labs ORDER BY lesson_n, idx');

      const hits = [];
      for (const l of lecciones) {
        const donde = [
          ['titulo', `${l.eyebrow} ${l.title} ${l.summary} ${l.math_cap}`],
          ['tecnica', l.technical], ['analogia', l.analogy],
        ];
        for (const [campo, texto] of donde) {
          const p = cuenta(texto);
          if (p) hits.push({ leccion: l.n, titulo: l.title, donde: campo, fragmento: recorta(texto), ruta: `/leccion/${l.n}`, p });
        }
      }
      for (const t of textos) {
        for (const [campo, texto] of [['tecnica_' + lang, t.technical], ['analogia_' + lang, t.analogy]]) {
          const p = cuenta(texto);
          if (p) hits.push({ leccion: t.lesson_n, donde: campo, fragmento: recorta(texto), ruta: `/leccion/${t.lesson_n}`, p });
        }
      }
      for (const l of labs) {
        const p = cuenta(l.prompt);
        if (p) hits.push({ leccion: l.lesson_n, lab_id: l.id, donde: 'enunciado', fragmento: recorta(l.prompt), ruta: `/leccion/${l.lesson_n}`, p });
      }
      hits.sort((a, b) => b.p - a.p || a.leccion - b.leccion);
      return {
        consulta: q, encontrados: hits.length,
        resultados: hits.slice(0, 6).map(({ p, ...h }) => h),
        glosario: glosarioPara(q, lang),
        nota: hits.length ? undefined : 'No aparece en el curso. Dilo así en vez de improvisar una lección que no existe.',
      };
    },
  },

  glosario: {
    familia: 'contenido', publico: true,
    descripcion: 'Qué significa un término del curso (token, perilla, temperatura, contexto…) y en qué lección se explica. Sin argumento devuelve la lista de términos.',
    args: { termino: 'opcional · una palabra o expresión' },
    async fn(ctx, { termino }) {
      const lang = idioma(ctx, null);
      const q = String(termino ?? '').trim();
      if (!q) return { terminos: terminos(), total: GLOSARIO.length };
      const halla = glosarioPara(q, lang, 4);
      if (!halla.length) return { termino: q, hallado: false, terminos: terminos(),
        nota: 'No es un término del curso. Puedes explicarlo aparte, pero no lo atribuyas a una lección.' };
      return { termino: q, hallado: true, entradas: halla.map((g) => ({ ...g, ruta: `/leccion/${g.leccion}` })) };
    },
  },

  lab_ficha: {
    familia: 'contenido', publico: false,
    descripcion: 'Un lab suelto: enunciado, nivel, cómo se responde su mecánica y si esta persona ya lo resolvió. Nunca la solución.',
    args: { lab_id: 'texto como «5.2»' },
    async fn(ctx, { lab_id }) {
      const id = String(lab_id ?? '');
      if (!LAB_ID.test(id)) return { error: 'lab_invalido' };
      const lab = await get(`SELECT ${COLS_LAB} FROM labs WHERE id = ?`, [id]);
      if (!lab) return { error: 'no_existe' };
      assertSinProhibidas('labs', lab);
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      const mio = await get('SELECT COUNT(*)::int AS intentos, MAX(correct)::int AS mejor FROM attempts WHERE user_id = ? AND lab_id = ?', [ctx.userId, id]);
      const lang = idioma(ctx, null);
      return {
        lab, mecanica: enIdioma(MECANICAS[lab.kind], lang) ?? null,
        borrador: !!lab.draft, cerrado: !conAcceso(u, lab.lesson_n),
        ruta: `/leccion/${lab.lesson_n}`,
        mis: { intentos: mio?.intentos ?? 0, resuelto: mio?.mejor === 1 },
      };
    },
    efecto(ctx, { lab_id }, salida) {
      if (!salida?.error) apilar(bus(ctx.userId), { tipo: 'lab', ref: String(lab_id), nota: 'ficha del lab' });
    },
  },

  requisitos_leccion: {
    familia: 'contenido', publico: false,
    descripcion: 'Si esta persona puede saltar a una lección: qué debería traer entendido, cómo va en la anterior y si tiene la lección abierta.',
    args: { n: 'entero 1..12' },
    async fn(ctx, { n }) {
      const num = Number(n);
      if (!Number.isInteger(num) || num < 1 || num > 12) return { error: 'leccion_invalida' };
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      const filas = await porLeccion(ctx);
      const previas = filas.filter((r) => r.n < num);
      const flojas = previas.filter((r) => r.resueltos < r.total).map((r) => ({ leccion: r.n, resueltos: r.resueltos, total: r.total }));
      const anterior = num > 1
        ? await get('SELECT n, title, summary FROM lessons WHERE n = ?', [num - 1])
        : null;
      const esta = await get('SELECT n, eyebrow, title, summary FROM lessons WHERE n = ?', [num]);
      return {
        leccion: esta, anterior, abierta: conAcceso(u, num),
        libres: LECCIONES_LIBRES,
        previasSinCerrar: flojas,
        veredicto: !conAcceso(u, num) ? 'cerrada_por_compra'
          : flojas.length ? 'se_puede_pero_hay_huecos' : 'lista',
        porQue: flojas.length
          ? 'El curso es acumulativo: cada lección usa el vocabulario de la anterior.'
          : 'No hay lecciones anteriores sin cerrar.',
      };
    },
  },

  // ------------------------------------------------------------------- propio
  mi_panorama: {
    familia: 'propio', publico: false,
    descripcion: 'TODO el estado de esta persona de una sola vez: perfil, progreso, racha, siguiente paso, liga y qué tiene en la cola. Empieza por aquí: ahorra cuatro llamadas.',
    args: {},
    async fn(ctx) {
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      const [filas, dias, liga] = await Promise.all([porLeccion(ctx), diasActivos(ctx), estadoLiga(ctx, u)]);
      const paso = await siguientePaso(ctx, u);
      const labs = filas.reduce((s, r) => s + r.resueltos, 0);
      const perfil = {
        nombre: String(u.name).split(' ')[0], rol: u.role, idioma: u.lang,
        pagado: !!u.paid, cohorte: u.cohort, desde: u.created_at,
      };
      const progreso = { labsResueltos: labs, totalLabs: TOTAL_LABS, leccionesCerradas: cerradas(filas), porLeccion: filas };
      const fechas = dias.map((r) => r.dia);
      const racha = { ...calculaRacha(fechas), zona: ZONA, ultimosDias: fechas.slice(0, 14) };
      const b = bus(ctx.userId);
      return {
        perfil, progreso, racha, siguiente: paso,
        liga: { activa: liga.activa, yo: liga.yo, motivo: liga.motivo ?? null, semana: liga.semana },
        cola: { largo: verCola(b).length, siguienteEnCola: verCola(b)[0] ?? null },
        foco: cima(b),
      };
    },
    // Siembra el memo: si el modelo pide después el perfil, el progreso, la racha
    // o el siguiente paso por separado, ya no vuelve a la base en este turno.
    efecto(ctx, args, salida) {
      if (salida?.error) return;
      const b = bus(ctx.userId);
      const t = { publico: false, turno: ctx.turno };
      sembrar(b, llave('mi_perfil', {}, ctx), salida.perfil, t);
      sembrar(b, llave('mi_progreso', {}, ctx), salida.progreso, t);
      sembrar(b, llave('mi_racha', {}, ctx), salida.racha, t);
      sembrar(b, llave('mi_siguiente_paso', {}, ctx), salida.siguiente, t);
    },
  },

  mi_progreso: {
    familia: 'propio', publico: false,
    descripcion: 'Cuántas lecciones y labs lleva resueltos la persona de esta sesión, lección por lección.',
    args: {},
    async fn(ctx) {
      const filas = await porLeccion(ctx);
      return {
        labsResueltos: filas.reduce((s, r) => s + r.resueltos, 0), totalLabs: TOTAL_LABS,
        leccionesCerradas: cerradas(filas), porLeccion: filas,
      };
    },
  },

  mis_intentos: {
    familia: 'propio', publico: false,
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
    familia: 'propio', publico: false,
    descripcion: 'Nombre de pila, rol, idioma y si compró el curso. Solo de la sesión actual.',
    args: {},
    async fn(ctx) {
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      return {
        nombre: String(u.name).split(' ')[0],
        rol: u.role, idioma: u.lang, pagado: !!u.paid,
        cohorte: u.cohort, desde: u.created_at,
      };
    },
  },

  mi_siguiente_paso: {
    familia: 'propio', publico: false,
    descripcion: 'Qué lab concreto sigue ahora, respetando candados y borradores. La respuesta a «¿qué hago?». Deja el lab en la cola.',
    args: {},
    async fn(ctx) {
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      return siguientePaso(ctx, u);
    },
    efecto(ctx, args, salida) {
      if (salida?.hay) encolar(bus(ctx.userId), { tipo: 'lab', ref: salida.lab_id, motivo: 'siguiente_paso' });
    },
  },

  mis_pendientes: {
    familia: 'propio', publico: false,
    descripcion: 'Los labs que le faltan, en orden de curso, marcando los que están cerrados por compra. Opcionalmente los de una sola lección.',
    args: { n: 'opcional · entero 1..12 para filtrar por lección' },
    async fn(ctx, { n }) {
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      const num = n === undefined || n === null || n === '' ? null : Number(n);
      if (num !== null && (!Number.isInteger(num) || num < 1 || num > 12)) return { error: 'leccion_invalida' };
      const todos = await pendientes(ctx, u);
      const lista = num === null ? todos : todos.filter((l) => l.leccion === num);
      return {
        leccion: num, pendientes: lista.length,
        abiertos: lista.filter((l) => !l.cerrado && !l.borrador).length,
        cerrados: lista.filter((l) => l.cerrado).length,
        labs: lista.slice(0, 20),
      };
    },
  },

  mis_errores: {
    familia: 'propio', publico: false,
    descripcion: 'Los labs que intentó y no ha resuelto, con lo que respondió y qué mecánica se le atraviesa. Aquí está el patrón del error. Los deja en la cola.',
    args: {},
    async fn(ctx) {
      const fallidos = await all(`
        SELECT a.lab_id, COUNT(*)::int AS intentos, MAX(a.at) AS ultimo, l.lesson_n, l.level, l.kind, l.prompt
        FROM attempts a JOIN labs l ON l.id = a.lab_id
        WHERE a.user_id = ?
        GROUP BY a.lab_id, l.lesson_n, l.level, l.kind, l.prompt
        HAVING MAX(a.correct) = 0
        ORDER BY MAX(a.at) DESC`, [ctx.userId]);
      if (!fallidos.length) return { atascados: 0, labs: [], porMecanica: [], nota: 'No hay labs intentados sin resolver.' };
      const malas = await all(
        'SELECT lab_id, answer, at FROM attempts WHERE user_id = ? AND correct = 0 ORDER BY at DESC', [ctx.userId]);
      const porLab = new Map();
      for (const m of malas) {
        const xs = porLab.get(m.lab_id) ?? [];
        if (xs.length < 3) { xs.push({ respuesta: m.answer, at: m.at }); porLab.set(m.lab_id, xs); }
      }
      const mec = new Map();
      for (const f of fallidos) mec.set(f.kind, (mec.get(f.kind) ?? 0) + 1);
      const lang = idioma(ctx, null);
      return {
        atascados: fallidos.length,
        labs: fallidos.slice(0, 8).map((f) => ({
          lab_id: f.lab_id, leccion: f.lesson_n, nivel: f.level, mecanica: f.kind,
          comoSeResponde: enIdioma(MECANICAS[f.kind], lang) ?? null,
          enunciado: recorta(f.prompt), intentos: f.intentos, ultimo: f.ultimo,
          misRespuestasMalas: porLab.get(f.lab_id) ?? [],
        })),
        porMecanica: [...mec].map(([mecanica, labs]) => ({ mecanica, labs })).sort((a, b) => b.labs - a.labs),
        nota: 'Da una pista que apunte a la lección. No la solución.',
      };
    },
    efecto(ctx, args, salida) {
      const b = bus(ctx.userId);
      for (const l of salida?.labs ?? []) encolar(b, { tipo: 'lab', ref: l.lab_id, motivo: 'atascado' });
    },
  },

  mi_racha: {
    familia: 'propio', publico: false,
    descripcion: 'Días seguidos con actividad, mejor racha y cuándo fue la última vez. Sirve para «llevas dos semanas sin abrirlo».',
    args: {},
    async fn(ctx) {
      const dias = (await diasActivos(ctx)).map((r) => r.dia);
      const r = calculaRacha(dias);
      return { ...r, zona: ZONA, ultimosDias: dias.slice(0, 14) };
    },
  },

  mi_ritmo: {
    familia: 'propio', publico: false,
    descripcion: 'Cuántos labs resuelve por semana y, a ese ritmo, cuánto le falta para terminar los 36. Responde «¿cuánto me queda?».',
    args: {},
    async fn(ctx) {
      const semanas = await all(`
        SELECT to_char(date_trunc('week', (p.cuando AT TIME ZONE ?)), 'YYYY-MM-DD') AS semana,
               COUNT(*)::int AS labs
        FROM (SELECT lab_id, MIN(at) AS cuando FROM attempts WHERE user_id = ? AND correct = 1 GROUP BY lab_id) p
        GROUP BY 1 ORDER BY 1 DESC LIMIT 6`, [ZONA, ctx.userId]);
      // El total se cuenta aparte: sumar las seis semanas de la lista diría que a
      // quien empezó hace un año le faltan labs que ya resolvió.
      const total = await get(
        'SELECT COUNT(DISTINCT lab_id)::int AS c FROM attempts WHERE user_id = ? AND correct = 1', [ctx.userId]);
      const hechos = total?.c ?? 0;
      const ultimas = semanas.slice(0, 4);
      const media = ultimas.length ? ultimas.reduce((s, r) => s + r.labs, 0) / ultimas.length : 0;
      const faltan = Math.max(0, TOTAL_LABS - hechos);
      return {
        resueltos: hechos, faltan, totalLabs: TOTAL_LABS,
        porSemana: semanas, mediaUltimas4: Number(media.toFixed(1)),
        semanasEstimadas: media > 0 ? Math.ceil(faltan / media) : null,
        nota: media > 0 ? undefined : 'Sin semanas con aciertos no hay ritmo que proyectar: no inventes una fecha.',
      };
    },
  },

  mi_historial: {
    familia: 'propio', publico: false,
    descripcion: 'Los últimos intentos con su fecha: qué tocó y si acertó. Responde «¿qué hice ayer?».',
    args: { dias: 'opcional · entero 1..30, por defecto 7' },
    async fn(ctx, { dias }) {
      const d = dias === undefined || dias === null || dias === '' ? 7 : Number(dias);
      if (!Number.isInteger(d) || d < 1 || d > 30) return { error: 'dias_invalido' };
      const filas = await all(`
        SELECT a.lab_id, a.correct, a.at, l.lesson_n
        FROM attempts a JOIN labs l ON l.id = a.lab_id
        WHERE a.user_id = ? AND a.at >= now() - (? || ' days')::interval
        ORDER BY a.at DESC LIMIT 40`, [ctx.userId, d]);
      return {
        dias: d, intentos: filas.length,
        aciertos: filas.filter((f) => f.correct === 1).length,
        eventos: filas.map((f) => ({ lab_id: f.lab_id, leccion: f.lesson_n, acerto: f.correct === 1, at: f.at })),
        nota: filas.length ? undefined : `Sin actividad en los últimos ${d} días.`,
      };
    },
  },

  mi_acceso: {
    familia: 'propio', publico: false,
    descripcion: 'Qué tiene abierto y qué no, y por qué. La respuesta a «¿por qué no puedo abrir la lección 4?».',
    args: {},
    async fn(ctx) {
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      const lecciones = await all('SELECT n, title FROM lessons ORDER BY n');
      const abiertas = lecciones.filter((l) => conAcceso(u, l.n)).map((l) => l.n);
      const bloqueadas = lecciones.filter((l) => !conAcceso(u, l.n)).map((l) => l.n);
      return {
        pagado: !!u.paid, rol: u.role, leccionesLibres: LECCIONES_LIBRES,
        abiertas, cerradas: bloqueadas,
        porQue: u.paid ? 'La compra está confirmada: están abiertas las 12.'
          : bloqueadas.length ? `Sin compra están abiertas la ${LECCIONES_LIBRES} y sus 3 labs; el resto devuelve «requiere compra».`
          : 'El rol de esta cuenta abre todo el curso sin compra.',
        precio: u.paid ? null : { monto: PRECIO.monto, moneda: PRECIO.moneda, garantiaDias: PRECIO.garantiaDias, ruta: '/pago' },
      };
    },
  },

  mis_logros: {
    familia: 'propio', publico: false,
    descripcion: 'El rango de la persona de esta sesión. Un rango por cada lección cerrada.',
    args: {},
    async fn(ctx) {
      const filas = await porLeccion(ctx);
      const cerr = cerradas(filas);
      const ganados = await all('SELECT code, kind, lesson_n, earned_at FROM achievements WHERE user_id = ? ORDER BY earned_at DESC LIMIT 8', [ctx.userId]);
      ganados.forEach((g) => assertSinProhibidas('achievements', g));
      return {
        leccionesCerradas: cerr,
        rango: Math.min(cerr, RANGO_MAX),
        rangoMax: RANGO_MAX,
        faltanParaSiguiente: cerr >= RANGO_MAX ? 0 : 1,
        ultimos: ganados,
        ruta: '/logros',
      };
    },
  },

  logros_faltantes: {
    familia: 'propio', publico: false,
    descripcion: 'Qué logros le faltan y qué hay que hacer exactamente para cada uno. Responde «¿qué me falta para el siguiente?».',
    args: {},
    async fn(ctx) {
      const filas = await porLeccion(ctx);
      const deberia = logrosDe(filas.map((r) => ({ n: r.n, solved: r.resueltos, total: r.total })));
      const tiene = new Set((await all('SELECT code FROM achievements WHERE user_id = ?', [ctx.userId])).map((r) => r.code));
      const faltan = [];
      for (const r of filas) {
        for (let i = 0; i < GRADOS_LECCION.length; i++) {
          const code = codigoLeccion(r.n, GRADOS_LECCION[i]);
          if (r.resueltos < i + 1) faltan.push({ code, kind: 'leccion', leccion: r.n, comoSeGana: `resolver ${i + 1} de los ${r.total} labs de la lección ${r.n}`, teFaltan: i + 1 - r.resueltos });
        }
      }
      const cerr = cerradas(filas);
      for (let nivel = cerr + 1; nivel <= RANGO_MAX; nivel++) {
        faltan.push({ code: codigoRango(nivel), kind: 'rango', comoSeGana: `cerrar ${nivel} lecciones completas`, teFaltan: nivel - cerr });
      }
      return {
        ganados: tiene.size, alcanzados: deberia.length, faltan: faltan.length,
        siguientes: faltan.sort((a, b) => a.teFaltan - b.teFaltan).slice(0, 6),
        ruta: '/logros',
      };
    },
  },

  mi_liga: {
    familia: 'propio', publico: false,
    descripcion: 'Su liga de esta semana: metal, puesto, caudal y cuándo cierra. Si no está en liga, dice exactamente qué falta.',
    args: {},
    async fn(ctx) {
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      const e = await estadoLiga(ctx, u);
      const explica = {
        requiere_compra: 'La liga es para quien compró: sin compra no hay ascenso que usar.',
        sin_alias: 'Hace falta apuntarse al ranking con un alias. El alias es lo único público.',
        cohorte_insuficiente: `Por debajo de ${MIN_LIGA} personas no hay liga: una liga de dos no compara nada.`,
      };
      return { ...e, explicacion: e.motivo ? explica[e.motivo] : 'Mide el caudal de la semana: labs resueltos por primera vez, lunes a domingo.', ruta: '/ligas' };
    },
  },

  ligas_tabla: {
    familia: 'propio', publico: false,
    descripcion: 'La tabla de la liga semanal: alias, metal, puesto y caudal de quienes aceptaron aparecer. Nunca nombres ni correos.',
    args: {},
    async fn(ctx) {
      const [filas, semana] = await Promise.all([caudal(), semanaActual()]);
      if (filas.length < MIN_LIGA) {
        return { activa: false, motivo: 'cohorte_insuficiente', minimo: MIN_LIGA, participantes: filas.length, semana, tabla: [] };
      }
      // El user_id no sale nunca: el alias es lo único público de otra persona.
      const tabla = reparteMetales(filas).map(({ user_id, ...r }) => r);
      const mio = await get('SELECT alias FROM ranking_optin WHERE user_id = ?', [ctx.userId]);
      return {
        activa: true, semana, zona: ZONA, metales: METALES, participantes: tabla.length,
        tabla: tabla.slice(0, 30), miAlias: mio?.alias ?? null, ruta: '/ligas',
      };
    },
  },

  ranking_publico: {
    familia: 'propio', publico: false,
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

  // ----------------------------------------------------------------- producto
  como_funciona: {
    familia: 'producto', publico: true,
    descripcion: 'Cómo funciona la plataforma: lecciones, labs, logros, ranking y ligas. Para «¿qué es esto?» y «¿cómo se usa?».',
    args: {},
    async fn(ctx) {
      const lang = idioma(ctx, null);
      return {
        pasos: enIdioma(COMO_FUNCIONA, lang),
        cifras: { lecciones: 12, labs: TOTAL_LABS, logros: 48, rangos: RANGO_MAX, leccionesLibres: LECCIONES_LIBRES },
        rutas: RUTAS.slice(0, 6).map((r) => ({ ruta: r.ruta, que: enIdioma(r.que, lang) })),
      };
    },
  },

  donde_encuentro: {
    familia: 'producto', publico: true,
    descripcion: 'En qué página de la plataforma se hace algo. Para «¿dónde cambio el idioma?», «¿dónde veo mi puesto?». Devuelve la ruta exacta.',
    args: { consulta: 'texto libre: «cambiar el tema», «descargar el pdf»' },
    async fn(ctx, { consulta }) {
      const lang = idioma(ctx, null);
      const q = String(consulta ?? '');
      const halla = rutasPara(q, lang, 3);
      if (halla.length) return { consulta: q, rutas: halla };
      return {
        consulta: q, rutas: [],
        todas: RUTAS.map((r) => ({ ruta: r.ruta, que: enIdioma(r.que, lang) })),
        nota: 'No hay una página para eso. Ofrece la lista en vez de inventar una ruta.',
      };
    },
  },

  precio_y_compra: {
    familia: 'producto', publico: false,
    descripcion: 'Cuánto cuesta, qué incluye, la garantía y si esta persona ya lo compró. El precio sale del mismo sitio que el checkout.',
    args: {},
    async fn(ctx) {
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      const lang = idioma(ctx, null);
      return {
        yaComprado: !!u.paid,
        precio: { monto: PRECIO.monto, moneda: PRECIO.moneda, tipo: PRECIO.tipo },
        garantiaDias: PRECIO.garantiaDias,
        pasarela: PRECIO.pasarela,
        incluye: enIdioma(PRECIO.incluye, lang),
        leccionesLibres: PRECIO.leccionesLibres,
        ruta: u.paid ? '/curso' : '/pago',
        nota: u.paid ? 'Ya compró: no le ofrezcas comprar otra vez.' : undefined,
      };
    },
  },

  mis_datos_y_privacidad: {
    familia: 'producto', publico: false,
    descripcion: 'Qué guarda la plataforma de esta persona, qué puede ver el agente y cómo borrar la cuenta. Para «¿qué sabes de mí?».',
    args: {},
    async fn(ctx) {
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      const n = await get('SELECT COUNT(*)::int AS intentos FROM attempts WHERE user_id = ?', [ctx.userId]);
      const logros = await get('SELECT COUNT(*)::int AS c FROM achievements WHERE user_id = ?', [ctx.userId]);
      const alias = await get('SELECT alias FROM ranking_optin WHERE user_id = ?', [ctx.userId]);
      return {
        deTi: {
          nombreDePila: String(u.name).split(' ')[0], rol: u.role, idioma: u.lang, tema: u.theme,
          pagado: !!u.paid, cuentaDesde: u.created_at, intentosGuardados: n?.intentos ?? 0,
          logros: logros?.c ?? 0, aliasPublico: alias?.alias ?? null,
        },
        loQueElAgenteNoVe: ['el correo', 'la contraseña', 'los datos del pago', 'los datos de cualquier otra persona'],
        loQuePuedeVerOtraPersona: alias?.alias
          ? ['tu alias y tu avance en el ranking y la liga']
          : ['nada: no estás apuntado al ranking'],
        chat: 'El texto de esta conversación se manda al proveedor de IA que atiende el modo IA. El modo normal no sale del servidor.',
        borrado: { ruta: '/perfil', comoEs: 'Pide tu contraseña. El correo queda libre y tus intentos se conservan sin nombre.' },
        rutas: ['/privacidad', '/perfil'],
      };
    },
  },

  descargar_pdf: {
    familia: 'producto', publico: false,
    descripcion: 'Si esta persona puede descargar el PDF del curso, en qué idiomas y desde dónde.',
    args: {},
    async fn(ctx) {
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      return {
        puede: !!u.paid, idiomas: ['es', 'en'], ruta: '/perfil',
        porQue: u.paid ? 'La compra incluye el PDF.' : 'El PDF va con la compra: sin ella la descarga responde «requiere compra».',
        nota: 'Si el archivo todavía no está generado, la descarga responde 503 y lo dice; no prometas un archivo que no está.',
      };
    },
  },

  soporte: {
    familia: 'producto', publico: true,
    descripcion: 'Qué hacer cuando algo no funciona: responde el problema frecuente que casa y, si no, cómo escribirle a una persona.',
    args: { tema: 'opcional · el problema en palabras de la persona' },
    async fn(ctx, { tema }) {
      const lang = idioma(ctx, null);
      const q = String(tema ?? '');
      const halla = q ? faqPara(q, lang, 3) : [];
      return {
        tema: q || null,
        respuestas: halla,
        humano: { ruta: SOPORTE.ruta, que: enIdioma(SOPORTE.que, lang), antesDeEscribir: enIdioma(SOPORTE.antesDeEscribir, lang) },
        nota: halla.length ? undefined : 'No hay una respuesta frecuente para esto: manda a /soporte en vez de improvisar una solución técnica.',
      };
    },
  },

  ajustes: {
    familia: 'producto', publico: false,
    descripcion: 'Idioma y tema que tiene puestos, qué valores existen y dónde se cambian.',
    args: {},
    async fn(ctx) {
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      return {
        idioma: u.lang, tema: u.theme,
        idiomasDisponibles: ['es', 'en', 'fr', 'pt', 'auto'],
        temasDisponibles: ['dark', 'paper', 'auto'],
        queSignificaAuto: '«auto» sigue al dispositivo: el idioma del navegador y prefers-color-scheme.',
        ruta: '/ajustes',
        nota: 'fr y pt están aceptados en el API; si falta el diccionario, la interfaz cae al español y lo avisa.',
      };
    },
  },

  // --------------------------------------------------------------- coordinar
  plan_estudio: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Arma un plan con los siguientes labs en orden y lo deja en la cola. Después, cada `cola_siguiente` entrega uno ya resuelto con su contexto.',
    args: { sesiones: 'opcional · entero 1..12, cuántos labs planear; por defecto 5' },
    async fn(ctx, { sesiones }) {
      const u = await yo(ctx);
      if (!u) return { error: 'sin_sesion' };
      const cuantos = sesiones === undefined || sesiones === null || sesiones === '' ? 5 : Number(sesiones);
      if (!Number.isInteger(cuantos) || cuantos < 1 || cuantos > 12) return { error: 'sesiones_invalido' };
      const faltan = await pendientes(ctx, u);
      const plan = faltan.filter((l) => !l.cerrado && !l.borrador).slice(0, cuantos);
      const b = bus(ctx.userId);
      const encolados = plan.map((l) => encolar(b, { tipo: 'lab', ref: l.lab_id, motivo: 'plan' }));
      const bloqueados = faltan.filter((l) => l.cerrado).length;
      return {
        plan: plan.map((l, i) => ({ orden: i + 1, lab_id: l.lab_id, leccion: l.leccion, titulo: l.titulo, nivel: l.level, mecanica: l.kind })),
        encolados: encolados.filter((e) => e.ok).length,
        yaEstaban: encolados.filter((e) => e.razon === 'ya_estaba').length,
        enCola: verCola(b).length,
        cerradosPorCompra: bloqueados,
        comoSeGasta: 'Llama `cola_siguiente` para recibir el primero con su ficha, sus intentos y su lección. No hace falta pedir cada cosa aparte.',
        nota: plan.length ? undefined : 'No hay labs abiertos sin resolver para planear.',
      };
    },
  },

  cola_siguiente: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Saca lo primero de la cola y lo devuelve YA RESUELTO: ficha del lab, intentos propios, explicación si ya lo intentó y la lección de donde sale. Una llamada en vez de tres.',
    args: {},
    async fn(ctx) {
      const b = bus(ctx.userId);
      const item = desencolar(b);
      if (!item) return { vacia: true, nota: 'La cola está vacía. `plan_estudio` o `mis_errores` la llenan.' };
      const lang = idioma(ctx, null);
      if (item.tipo === 'lab') {
        const lab = await get(`SELECT ${COLS_LAB} FROM labs WHERE id = ?`, [item.ref]);
        if (!lab) return { item, error: 'no_existe' };
        assertSinProhibidas('labs', lab);
        const intentos = await all('SELECT answer, correct, at FROM attempts WHERE user_id = ? AND lab_id = ? ORDER BY at', [ctx.userId, item.ref]);
        const explicacion = intentos.length
          ? (await get('SELECT explanation FROM labs WHERE id = ?', [item.ref])).explanation
          : null;
        const { texto, escritoEn } = await textoLeccion(lab.lesson_n, lang);
        return {
          item, lab, mecanica: enIdioma(MECANICAS[lab.kind], lang) ?? null,
          mis: { intentos: intentos.length, resuelto: intentos.some((i) => i.correct === 1), ultimos: intentos.slice(-3) },
          explicacion,
          leccion: texto ? { n: lab.lesson_n, idioma: escritoEn, tecnica: recorta(texto.technical, 400), analogia: recorta(texto.analogy, 300) } : null,
          ruta: `/leccion/${lab.lesson_n}`,
          quedanEnCola: verCola(b).length,
          nota: explicacion ? undefined : 'Sin intentos previos: no hay explicación que dar, solo una pista.',
        };
      }
      if (item.tipo === 'leccion') {
        const n = Number(item.ref);
        const cabeza = await get('SELECT n, eyebrow, title, summary, math, math_cap FROM lessons WHERE n = ?', [n]);
        const { texto, escritoEn } = await textoLeccion(n, lang);
        return { item, leccion: cabeza, idioma: escritoEn, tecnica: texto?.technical ?? null, analogia: texto?.analogy ?? null,
                 ejemplos: texto?.examples ?? null, ruta: `/leccion/${n}`, quedanEnCola: verCola(b).length };
      }
      return { item, glosario: glosarioPara(item.ref, lang), quedanEnCola: verCola(b).length };
    },
    // Lo que se saca de la cola pasa a ser el foco: `foco_volver` regresa a lo
    // que se estaba mirando antes.
    efecto(ctx, args, salida) {
      if (salida?.item && !salida.error) {
        apilar(bus(ctx.userId), { tipo: salida.item.tipo, ref: salida.item.ref, nota: salida.item.motivo ?? 'de la cola' });
      }
    },
  },

  cola_estado: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Qué hay pendiente en la cola de estudio y cuál es el foco actual, sin sacar nada.',
    args: {},
    async fn(ctx) {
      const b = bus(ctx.userId);
      const cola = verCola(b);
      return {
        enCola: cola.length, cola: cola.slice(0, 12),
        foco: cima(b), pila: verPila(b).slice(0, 6),
        nota: cola.length ? 'Usa `cola_siguiente` para gastar el primero con todo su contexto.' : 'Vacía: `plan_estudio` o `mis_errores` la llenan.',
      };
    },
  },

  cola_encolar: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Deja algo pendiente para más tarde en la cola: un lab, una lección o un tema que salió en la conversación.',
    args: { tipo: '«lab», «leccion» o «tema»', ref: 'el lab («5.2»), la lección («7») o el tema («tokens»)', motivo: 'opcional · por qué queda pendiente' },
    async fn(ctx, { tipo, ref, motivo }) {
      const b = bus(ctx.userId);
      if (!TIPOS.includes(String(tipo))) return { error: 'tipo_invalido', tipos: TIPOS };
      if (String(tipo) === 'lab' && !LAB_ID.test(String(ref))) return { error: 'lab_invalido' };
      if (String(tipo) === 'leccion' && !(Number(ref) >= 1 && Number(ref) <= 12)) return { error: 'leccion_invalida' };
      const r = encolar(b, { tipo: String(tipo), ref: String(ref).slice(0, 60), motivo: motivo ? String(motivo).slice(0, 120) : null });
      return { ...r, enCola: verCola(b).length };
    },
  },

  foco_apilar: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Guarda dónde está la persona antes de irte por una rama de la conversación. Después `foco_volver` regresa aquí.',
    args: { tipo: '«lab», «leccion» o «tema»', ref: 'el lab, la lección o el tema', nota: 'opcional · qué se estaba haciendo' },
    async fn(ctx, { tipo, ref, nota }) {
      if (!TIPOS.includes(String(tipo))) return { error: 'tipo_invalido', tipos: TIPOS };
      const b = bus(ctx.userId);
      const r = apilar(b, { tipo: String(tipo), ref: String(ref).slice(0, 60), nota: nota ? String(nota).slice(0, 120) : null });
      return { ...r, pila: verPila(b).slice(0, 6) };
    },
  },

  foco_volver: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Cierra la rama actual y devuelve a dónde estaba la persona antes. Para «volvamos a lo que estábamos».',
    args: {},
    async fn(ctx) {
      const b = bus(ctx.userId);
      const cerrado = desapilar(b);
      const vuelvoA = cima(b);
      if (!cerrado) return { vacia: true, nota: 'No hay foco guardado: nada que cerrar.' };
      return {
        cerrado, vuelvoA,
        ruta: vuelvoA ? (vuelvoA.tipo === 'lab' ? `/leccion/${String(vuelvoA.ref).split('.')[0]}` : vuelvoA.tipo === 'leccion' ? `/leccion/${vuelvoA.ref}` : null) : null,
        nota: vuelvoA ? undefined : 'Era el último marco: no queda nada abajo.',
      };
    },
  },

  bus_diagnostico: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Cómo va la coordinación de esta sesión: largo de la cola, alto de la pila y cuántas consultas ahorró la caché. Para explicar de dónde salió un dato.',
    args: {},
    async fn(ctx) {
      return { ...diagnostico(bus(ctx.userId)), turno: ctx.turno ? 'sí' : 'no', herramientas: Object.keys(HERRAMIENTAS).length };
    },
  },
};

/** Nombres agrupados por familia. Lo usan el front y la documentación. */
export function familias() {
  const out = {};
  for (const [nombre, h] of Object.entries(HERRAMIENTAS)) (out[h.familia] ??= []).push(nombre);
  return out;
}

/** Lo que se le declara al modelo: nombre, descripción y argumentos. Sin usuario. */
export function catalogo() {
  return Object.entries(HERRAMIENTAS).map(([nombre, h]) => ({
    nombre, descripcion: h.descripcion, argumentos: h.args, familia: h.familia,
  }));
}

/**
 * Llave del memo: la herramienta, el idioma de la sesión y sus argumentos ya
 * limpios. El idioma va dentro porque media docena de herramientas responden
 * texto traducido: sin él, pedir la lección 4 en inglés y luego en español
 * devolvería la inglesa dos veces.
 */
const llave = (nombre, limpio, ctx) =>
  `${nombre}|${idioma(ctx, limpio?.idioma)}|${JSON.stringify(limpio, Object.keys(limpio).sort())}`;

/**
 * Ejecuta una herramienta. `ctx` lo arma el servidor desde la cookie; lo que
 * venga del modelo solo puede influir en `args`, y solo en las claves declaradas.
 *
 * El memo es transparente: si la misma herramienta con los mismos argumentos ya
 * se resolvió (y sigue vigente), no se vuelve a consultar la base y la salida
 * lleva `_memo: true`. Los efectos —apilar, encolar— corren igual, porque son
 * parte de la conversación y no del dato.
 */
export async function ejecutar(ctx, nombre, args) {
  const h = HERRAMIENTAS[nombre];
  if (!h) return { error: 'herramienta_desconocida', nombre };
  if (!ctx || !Number.isInteger(ctx.userId)) return { error: 'sin_sesion' };
  const { limpio, sobran } = limpiar(nombre, Object.keys(h.args), args);
  const b = bus(ctx.userId);

  let salida, cacheado = false;
  if (h.cachea === false) {
    salida = await h.fn(ctx, limpio);
  } else {
    const r = await memo(b, llave(nombre, limpio, ctx), { publico: !!h.publico, turno: ctx.turno ?? null },
      () => h.fn(ctx, limpio));
    salida = r.valor; cacheado = r.cacheado;
  }

  // El efecto corre siempre, también sobre una salida cacheada: apilar el foco no
  // es un dato que se pueda reusar, es algo que pasó en la conversación.
  if (h.efecto) h.efecto(ctx, limpio, salida);

  // Nada muta la salida guardada en el memo: siempre se devuelve una copia
  // superficial nueva con los marcadores.
  const marcas = {};
  if (cacheado) marcas._memo = true;
  // Si el modelo intentó colar un identificador, queda registrado y se ignora.
  if (sobran.length) marcas._ignorado = sobran;
  return Object.keys(marcas).length ? { ...salida, ...marcas } : salida;
}
