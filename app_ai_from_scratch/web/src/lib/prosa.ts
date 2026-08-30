// La respuesta del tutor, pintada como PROSA y no como salida de terminal.
//
// Hasta ahora una respuesta entera caía en un solo <p> con white-space:pre-wrap
// (chat.astro y AiPanel.astro). Eso convierte cualquier contestación de más de
// dos frases en un ladrillo gris, y es literalmente lo que el rediseño pide
// arreglar en su primera frase.
//
// ─────────────────────────────────────────────────────────────────────────────
// SÍ HAY MARKDOWN, Y ESTE FICHERO LO SUPO A LA MALA
//
// La primera versión de este archivo llevaba un comentario largo explicando por
// qué NO hacía falta entender markdown: que el prompt del tutor
// (ai/src/course_ai/ontology/render.py) prohíbe emoji, pide «el menor numero de
// tokens posible» y para una lista pide «un guion», así que un parser de `**`
// sería código muerto desde el primer día.
//
// Se midió contra el servidor de verdad, con la pregunta «Dame tres pasos para
// empezar el curso», y volvió esto, literal:
//
//     1. **Lee la Lección 1.** Abre «Aprende viendo ejemplos» y estudia…
//     2. **Resuelve el lab 1.1.** Es tu primer ejercicio…
//     3. **Continúa con los labs 1.2 y 1.3.** Completa la lección uno…
//
// Asteriscos y numeración, servidos a la cara del alumno. El prompt NO prohíbe
// markdown — no lo menciona — y un modelo entrenado en markdown lo escribe solo.
// La maqueta del handoff, que enseñaba negritas y un bloque numerado, no era
// relleno de diseño: era lo que el modelo hace de verdad.
//
// La lección: un prompt es una PETICIÓN, no un contrato. Lo que llega se pinta,
// y lo que llega es esto:
//   1. párrafos separados por una línea en blanco,
//   2. listas por guion, pegadas a la frase que las presenta,
//   3. listas numeradas «1.» / «1)», que el modelo separa con línea en blanco,
//   4. **negrita** dentro de cualquiera de las anteriores.
//
// Endurecer el prompt sería otra petición, no una garantía, y además mueve el
// `prompt_sha` del artefacto de ontología. Aquí se pinta lo que hay.
//
// ─────────────────────────────────────────────────────────────────────────────
// TODO LO QUE ENTRA ES SALIDA DE MODELO, O SEA NO CONFIABLE
//
// Se escapa SIEMPRE, y ANTES de mirar los asteriscos. En ese orden un `<b>` que
// venga del modelo ya es `&lt;b&gt;` cuando se busca `**`, así que la única
// etiqueta que puede acabar en el HTML es la que pone este fichero.

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]!);

/** Una línea de lista: guion/raya, viñeta `*`, o «1.» / «1)». */
const ES_ITEM = /^\s*(?:[-–—*]\s+|\d{1,2}[.)]\s+)/;
/** Lo mismo, para arrancarlo del texto del item. */
const MARCA = /^\s*(?:[-–—*]\s+|\d{1,2}[.)]\s+)/;

/**
 * Negrita. Se aplica DESPUÉS de escapar, sobre texto ya inerte. La forma de
 * función en el reemplazo evita que un `$&` dentro de la negrita se lea como
 * patrón de sustitución.
 */
export const enLinea = (s: string) =>
  esc(s).replace(/\*\*(?!\s)([^*]+?)\*\*/g, (_, t: string) => `<strong>${t}</strong>`);

export type Bloque =
  | { tipo: 'parrafo'; lineas: string[] }
  | { tipo: 'lista'; items: string[] };

/**
 * Parte el texto en bloques. Público para poder probarlo sin pasar por el DOM:
 * la decisión de qué es un párrafo y qué es una lista es la parte con reglas, y
 * el HTML de después es plantilla.
 *
 * Recorre LÍNEAS, no bloques separados por hueco, porque las dos formas que
 * manda el modelo son incompatibles con partir primero por línea en blanco:
 *
 *     Te faltan tres:        <- lista pegada a su frase, sin hueco
 *     - Lab 1.3
 *     - Lab 2.1
 *
 *     1. **Lee la lección.**  <- lista numerada, CON hueco entre items
 *
 *     2. **Resuelve el lab.**
 *
 * Un hueco entre dos items no rompe la lista; una línea que no es item, sí.
 */
export function bloques(texto: string): Bloque[] {
  // \r\n antes de partir: un modelo detrás de un proxy los ha devuelto, y
  // entonces cada línea acaba con un \r invisible que rompe la comparación.
  const crudo = texto.replace(/\r\n?/g, '\n').trim();
  if (!crudo) return [];

  const out: Bloque[] = [];
  let parrafo: string[] = [];
  let items: string[] = [];

  const cierraParrafo = () => {
    if (parrafo.length) out.push({ tipo: 'parrafo', lineas: parrafo });
    parrafo = [];
  };
  const cierraLista = () => {
    // Un guion suelto al final de una frase no es una lista: es un guion. Se
    // exigen dos para no convertir «— y ya está» en un bloque de un elemento.
    if (items.length >= 2) out.push({ tipo: 'lista', items });
    else if (items.length === 1) out.push({ tipo: 'parrafo', lineas: items });
    items = [];
  };

  for (const bruta of crudo.split('\n')) {
    const linea = bruta.replace(/[ \t]+$/, '');
    if (!linea.trim()) {
      // Una línea en blanco cierra el párrafo. NO cierra la lista: el modelo
      // separa los items numerados con hueco y siguen siendo una lista.
      cierraParrafo();
      continue;
    }
    if (ES_ITEM.test(linea)) {
      cierraParrafo();
      items.push(linea.replace(MARCA, ''));
      continue;
    }
    cierraLista();
    parrafo.push(linea);
  }
  cierraParrafo();
  cierraLista();
  return out;
}

/**
 * HTML de la respuesta, con la anatomía de la maqueta 1a: párrafos sueltos, sin
 * caja, y las listas en un bloque con filo de acento a la izquierda y el índice
 * en monoespaciada.
 *
 * El índice lo pone la lista, no el modelo: si el modelo escribió «1.» ya se le
 * quitó, así que una respuesta que empiece a contar en 3 se pinta 01, 02, 03 y
 * no hereda su despiste. Es también lo que hace que un guion y un «1.» se vean
 * igual, que es el punto de tener una sola anatomía.
 *
 * Los tokens son los del producto (--l2, --ac, --panel, --m), no los hex del
 * handoff: la app iOS usa las fuentes del sistema y el chat tiene que seguir
 * pareciéndose al resto de la plataforma.
 */
export function prosa(texto: string): string {
  const bs = bloques(texto);
  if (!bs.length) return '';
  return bs.map((b) => {
    if (b.tipo === 'parrafo') {
      // Los saltos sueltos dentro de un párrafo se respetan: si el modelo cortó
      // ahí, cortó por algo. Lo que NO se respeta es el bloque entero como un
      // pre, que es lo que hacía white-space:pre-wrap.
      return `<p class="pr-p">${b.lineas.map(enLinea).join('<br>')}</p>`;
    }
    const filas = b.items.map((it, i) =>
      `<div class="pr-fila"><span class="pr-n">${String(i + 1).padStart(2, '0')}</span>`
      + `<div>${enLinea(it)}</div></div>`).join('');
    return `<div class="pr-lista">${filas}</div>`;
  }).join('');
}

/** Hoja de estilo de la prosa. Se inyecta una vez por documento. */
export function prosaCSS(): string {
  return `
.pr{display:flex;flex-direction:column;gap:13px;font:400 15px/1.62 var(--f);color:var(--l2)}
.pr-p{margin:0}
/* La negrita del modelo. Sube a --l1 en vez de engordar: sobre --l2 un 600 casi
   no se distingue, y el contraste sí. */
.pr strong{font-weight:600;color:var(--l1)}
/* El bloque de lista: filo de acento a la izquierda y fondo de panel, la misma
   anatomía que ya usan las tarjetas destacadas del producto. */
.pr-lista{display:flex;flex-direction:column;gap:9px;padding:15px 17px;
  background:var(--panel);border-left:2px solid var(--ac)}
.pr-fila{display:flex;gap:11px}
.pr-n{flex:none;font:600 12px/1 var(--m);color:var(--ac);margin-top:4px;
  font-variant-numeric:tabular-nums}`;
}
