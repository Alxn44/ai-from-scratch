// Catálogo de logros. Los códigos viven aquí (el servidor decide qué se ganó);
// los nombres visibles viven en el i18n del front, así el mismo logro se lee en
// español y en inglés sin duplicar la lógica.
//
// Dos familias:
//   leccion  — tres grados por lección, por labs resueltos (1, 2, 3).
//   rango    — un grado global por cada lección cerrada (12 en total).

export const GRADOS_LECCION = ['aprendiz', 'oficiante', 'maestro'];

/** Código de un logro de lección: l07.maestro */
export const codigoLeccion = (n, grado) => `l${String(n).padStart(2, '0')}.${grado}`;
/** Código de un rango global: rango.05 */
export const codigoRango = (nivel) => `rango.${String(nivel).padStart(2, '0')}`;

export const RANGO_MAX = 12;

/**
 * Qué logros corresponden a un estado de progreso.
 * @param {{n:number, solved:number, total:number}[]} lecciones
 * @returns {{code:string, kind:string, lesson_n:number|null}[]}
 */
export function logrosDe(lecciones) {
  const out = [];
  let cerradas = 0;
  for (const l of lecciones) {
    for (let i = 0; i < GRADOS_LECCION.length; i++) {
      if (l.solved >= i + 1) out.push({ code: codigoLeccion(l.n, GRADOS_LECCION[i]), kind: 'leccion', lesson_n: l.n });
    }
    if (l.total > 0 && l.solved === l.total) cerradas++;
  }
  for (let nivel = 1; nivel <= Math.min(cerradas, RANGO_MAX); nivel++) {
    out.push({ code: codigoRango(nivel), kind: 'rango', lesson_n: null });
  }
  return out;
}

/** Nivel de rango actual (0..12) a partir de los códigos ya ganados. */
export function nivelRango(codigos) {
  let max = 0;
  for (const c of codigos) {
    if (!c.startsWith('rango.')) continue;
    const n = Number(c.slice(6));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}
