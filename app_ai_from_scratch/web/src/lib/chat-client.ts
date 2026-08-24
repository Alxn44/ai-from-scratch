// Cliente del chat. Dos modos y una sola caja de mensajes.
//
//  normal → resuelve local con los datos que ya trajo la página. Cero costo,
//           respuesta instantánea, funciona sin llaves de proveedor.
//  IA     → POST /api/chat: el harness razona y usa herramientas. La traza que
//           devuelve el servidor se pinta tal cual: qué modelo, qué herramientas.
type Fila = { n: number; total: number; solved: number };
type Datos = {
  nombre: string;
  progreso: { solvedLabs: number; totalLabs: number; lessonsDone: number; totalLessons: number; perLesson: Fila[] };
  lecciones: { n: number; title: string; solved: number; total: number; locked: boolean }[];
  logros: { nivel: number; total: number };
  ranking: { alias: string | null; puesto: number | null; cuantos: number };
  txt: Record<string, any>;
};

const fill = (s: string, v: Record<string, string | number>) =>
  Object.entries(v).reduce((a, [k, x]) => a.replaceAll(`{${k}}`, String(x)), s ?? '');

type Resp = { texto: string; ir?: string; irTxt?: string };

/** Intención por palabras clave, en los dos idiomas. Sin modelo, sin costo. */
export function responderLocal(q: string, d: Datos): Resp {
  const T = d.txt;
  const s = q.toLowerCase().trim();
  const tiene = (...ws: string[]) => ws.some((w) => s.includes(w));
  const p = d.progreso;

  const mLeccion = s.match(/(?:lecci[oó]n|lesson)\s*(\d{1,2})/);
  if (mLeccion) {
    const n = Number(mLeccion[1]);
    const l = d.lecciones.find((x) => x.n === n);
    if (l) return { texto: fill(T.rLeccion, { n, t: l.title, s: l.solved, v: l.total }),
      ir: `/leccion/${n}`, irTxt: fill(T.verLeccion, { n }) };
  }
  if (tiene('progreso', 'progress', 'avance', 'cómo voy', 'como voy', 'how am i')) {
    return { texto: fill(T.rProgreso, { a: p.lessonsDone, b: p.totalLessons, c: p.solvedLabs, d: p.totalLabs }), ir: '/curso', irTxt: T.irA };
  }
  if (tiene('sigue', 'siguiente', 'next', 'qué hago', 'que hago')) {
    const l = d.lecciones.find((x) => !x.locked && x.solved < x.total);
    if (!l) return { texto: T.rSiguienteTodo, ir: '/curso', irTxt: T.irA };
    return { texto: fill(T.rSiguiente, { n: l.n, t: l.title, f: l.total - l.solved }),
      ir: `/leccion/${l.n}`, irTxt: fill(T.verLeccion, { n: l.n }) };
  }
  if (tiene('logro', 'rango', 'achiev', 'rank name', 'camino', 'path')) {
    if (!d.logros.total) return { texto: T.rLogrosCero, ir: '/logros', irTxt: T.irA };
    return { texto: fill(T.rLogros, { r: T.rangos[d.logros.nivel - 1] ?? T.sinRango, n: d.logros.total }), ir: '/logros', irTxt: T.irA };
  }
  if (tiene('ranking', 'puesto', 'leaderboard', 'position')) {
    if (!d.ranking.alias) return { texto: T.rRankingFuera, ir: '/ranking', irTxt: T.irA };
    return { texto: fill(T.rRanking, { a: d.ranking.alias, p: d.ranking.puesto ?? '—', n: d.ranking.cuantos }), ir: '/ranking', irTxt: T.irA };
  }
  if (tiene('ayuda', 'help', 'qué puedes', 'que puedes', 'what can you')) {
    return { texto: T.rAyuda };
  }
  if (tiene('pdf', 'descargar', 'download')) {
    return { texto: T.rAyuda, ir: '/perfil', irTxt: T.irA };
  }
  return { texto: `${T.rNoEntiendo} ${T.rNoEntiendoB}` };
}

// `memo: true` = ese dato ya estaba en la sesión y no se volvió a consultar.
export type Traza = { paso: string; proveedor?: string; modelo?: string; nombre?: string; ms?: number; ok?: boolean; memo?: boolean; herramientas?: string[]; error?: string; vuelta?: number };

export async function preguntarIA(historial: { role: 'user' | 'assistant'; content: string }[], lang: string) {
  const res = await fetch('/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mensajes: historial, lang }),
  });
  const d = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...d } as RespuestaIA;
}

/**
 * What POST /api/chat answers with. The 429 fields are part of it.
 *
 * `limite`, `esperaS` and `tope` are the sliding-window brake's payload
 * (api/src/server.ts, `interface Brake`), whose comment says "keys read by
 * web/src/lib/chat-client.ts". They were not declared here, so nothing read them:
 * a rate-limited caller saw the Spanish `msg` and had no idea how long to wait,
 * which is exactly the shape that makes a client retry into a limiter. Declared,
 * the panel can wait the amount of time the server asked for.
 */
export interface RespuestaIA {
  ok: boolean;
  status: number;
  respuesta?: string;
  proveedor?: string;
  modelo?: string;
  traza?: Traza[];
  /** sin_ia | sin_proveedor | demasiadas_preguntas | sin_mensaje | sin_sesion */
  error?: string;
  msg?: string;
  /** minuto | dia | dia_global — which of the three ceilings was hit. */
  limite?: string;
  /** Seconds to wait. Same number the `retry-after` header carries. */
  esperaS?: number;
  tope?: number;
}
