// Insignias: trofeos, estrellas y medallas de liga.
//
// POR QUÉ NO SE VEÍAN PREMIUM, medido: la pantalla tenía 36 degradados y ninguno
// con gradientUnits="userSpaceOnUse". El valor por omisión es objectBoundingBox,
// que reinicia el degradado en la caja de CADA forma: doce objetos con doce luces
// propias. El ojo lee eso como pegatinas. Un solo campo de luz en coordenadas de
// usuario, muestreado por todas las formas, es lo que lo convierte en metal.
//
// Y el metal necesita CINCO paradas, no dos. Un sólido de revolución tiene una
// rampa horizontal (el giro: borde oscuro, realce, medio, borde oscuro) y una
// rampa vertical de valor (arriba recibe luz, abajo recoge sombra). Con dos
// paradas sale plástico por muchas horas que le eches.
//
// Las cuatro siluetas se distinguen a 16 px por PROPORCIÓN y gesto, no por
// detalle: a ese tamaño el detalle es papilla y solo queda el contorno.
//   copa     1 : 1.15  cuenco ancho, pie estrecho
//   gema     1.25 : 1  rombo tallado, todo angulo
//
// Aqui hubo una corona de laurel y se cayo. Dos intentos: la silueta sola leia
// como herradura, y con hojas encima leia como herradura con pelos. Una gema
// tallada hace el mismo trabajo (ancha, angular, distinta de las otras tres) y
// encima el facetado ya estaba resuelto en la estrella.
//   obelisco 0.55 : 1  columna alta que se afila
//   escudo   1 : 1.05  bloque ancho de hombros rectos

export type Metal = 'bronce' | 'plata' | 'oro' | 'platino';
export type Forma = 'copa' | 'gema' | 'obelisco' | 'escudo';

/** Las ligas solo tienen tres metales. Platino es de rango, no de liga. */
export type MetalLiga = Extract<Metal, 'bronce' | 'plata' | 'oro'>;

// Cinco paradas por metal: sombra de borde, realce de giro, especular, medio,
// sombra opuesta. Sacadas de fotografía de metal, no de aclarar/oscurecer un hex.
const METALES: Record<Metal, [string, string, string, string, string]> = {
  bronce:  ['#3E2210', '#8A4E23', '#F0B274', '#B4712F', '#4A2914'],
  plata:   ['#343A42', '#8B95A2', '#FFFFFF', '#A8B2BE', '#3D444D'],
  oro:     ['#4A2E00', '#C08512', '#FFE9A6', '#D9A02A', '#573700'],
  platino: ['#2E3742', '#93A6BC', '#FFFFFF', '#B9CBDD', '#3A4655'],
};

// El campo de luz. Mismos números en cada insignia, así que dos trofeos puestos
// uno al lado del otro comparten la dirección de la luz.
const CAJA = { w: 100, h: 120 };

function defs(id: string, metal: Metal): string {
  const m = METALES[metal];
  return `<defs>
    <linearGradient id="${id}-giro" gradientUnits="userSpaceOnUse" x1="18" y1="0" x2="86" y2="0">
      <stop offset="0" stop-color="${m[0]}"/>
      <stop offset=".26" stop-color="${m[1]}"/>
      <stop offset=".44" stop-color="${m[2]}"/>
      <stop offset=".62" stop-color="${m[3]}"/>
      <stop offset="1" stop-color="${m[4]}"/>
    </linearGradient>
    <linearGradient id="${id}-valor" gradientUnits="userSpaceOnUse" x1="0" y1="6" x2="0" y2="114">
      <stop offset="0" stop-color="#fff" stop-opacity=".26"/>
      <stop offset=".34" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".72" stop-color="#000" stop-opacity=".16"/>
      <stop offset="1" stop-color="#000" stop-opacity=".42"/>
    </linearGradient>
    <radialGradient id="${id}-espec" gradientUnits="userSpaceOnUse" cx="38" cy="26" r="30">
      <stop offset="0" stop-color="#fff" stop-opacity=".72"/>
      <stop offset=".5" stop-color="#fff" stop-opacity=".12"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>`;
}

// Cada silueta es un solo trazado cerrado: a 16 px lo que sobrevive es esto.
const SILUETAS: Record<Forma, { d: string; sombra: string }> = {
  copa: {
    d: 'M26 18 H74 V34 C74 52 66 62 56 66 V84 H70 V96 H30 V84 H44 V66 C34 62 26 52 26 34 Z',
    sombra: 'M56 66 V84 H70 V96 H50 V66 Z',
  },
  gema: {
    d: 'M32 22 L68 22 L86 48 L50 104 L14 48 Z',
    sombra: 'M68 22 L86 48 L50 104 Z',
  },
  obelisco: {
    d: 'M50 10 L64 34 V88 H70 V102 H30 V88 H36 V34 Z',
    sombra: 'M50 10 L64 34 V88 H70 V102 H50 Z',
  },
  escudo: {
    d: 'M20 16 H80 V54 C80 80 66 96 50 104 C34 96 20 80 20 54 Z',
    sombra: 'M50 104 C66 96 80 80 80 54 V16 H50 Z',
  },
};

// El tallado de la gema: corona (mesa y dos biseles) y pabellon (cuatro caras
// que convergen en la punta). Las caras alternan entre rampas del MISMO campo de
// luz, igual que la estrella: un relleno liso no lee como piedra.
function tallado(id: string, metal: Metal): string {
  const m = METALES[metal];
  const p = (d: string, f: string, o = 1) => `<path d="${d}" fill="${f}" opacity="${o}"/>`;
  return [
    p('M32 22 L68 22 L64 48 L36 48 Z', `url(#${id}-giro)`),
    p('M32 22 L36 48 L14 48 Z', m[1], 0.85),
    p('M68 22 L86 48 L64 48 Z', m[0], 0.7),
    p('M14 48 L36 48 L50 104 Z', m[1], 0.6),
    p('M36 48 L50 48 L50 104 Z', `url(#${id}-giro)`),
    p('M50 48 L64 48 L50 104 Z', m[0], 0.55),
    p('M64 48 L86 48 L50 104 Z', m[1], 0.75),
    `<path d="M14 48 H86" stroke="${m[2]}" stroke-opacity=".45" stroke-width="1"/>`,
  ].join('');
}

/**
 * Un trofeo. `px` es el lado mayor en píxeles CSS.
 * `id` tiene que ser único en el documento: los degradados se referencian por id.
 */
export function trofeo(forma: Forma, metal: Metal, id: string, px = 96): string {
  const s = SILUETAS[forma];
  const alto = px, ancho = Math.round((px * CAJA.w) / CAJA.h);
  return `<svg viewBox="0 0 ${CAJA.w} ${CAJA.h}" width="${ancho}" height="${alto}" role="img" aria-hidden="true" style="overflow:visible;display:block">
    ${defs(id, metal)}
    <path d="${s.d}" fill="url(#${id}-giro)"/>
    <path d="${s.sombra}" fill="#000" opacity=".2"/>
    <path d="${s.d}" fill="url(#${id}-valor)"/>
    <path d="${s.d}" fill="url(#${id}-espec)"/>
    ${forma === 'gema' ? tallado(id, metal) : ''}
    <path d="${s.d}" fill="none" stroke="${METALES[metal][2]}" stroke-opacity=".38" stroke-width="1.1"/>
  </svg>`;
}

// Estrella de CINCO puntas. La de seis se descartó por un motivo concreto: a 96 px
// dos triángulos superpuestos se leen como estrella de David, y esto va en la
// pantalla de logros de un curso, no en un contexto religioso.
// Radio interior 0.382 del exterior (recíproco de phi²): es la única razón con la
// que las puntas salen afiladas sin quedar de aguja.
function trazoEstrella(cx: number, cy: number, R: number, puntas = 5): string {
  const r = R * 0.382;
  const p: string[] = [];
  for (let i = 0; i < puntas * 2; i++) {
    const rad = i % 2 ? r : R;
    const a = (-90 + i * (180 / puntas)) * (Math.PI / 180);
    p.push(`${(cx + Math.cos(a) * rad).toFixed(2)},${(cy + Math.sin(a) * rad).toFixed(2)}`);
  }
  return `M${p.join(' L')} Z`;
}

/**
 * Estrella de mérito. FACETADA, no plana: cada punta tiene una arista del centro
 * a la punta, así que son diez triángulos, no un contorno relleno. Los pares
 * miran a un lado y los impares al otro, y cada grupo muestrea su propia rampa
 * del MISMO campo de luz. Eso es lo que separa una estrella forjada de un emoji:
 * una rampa sola da un plano de color por muchas paradas que lleve.
 *
 * `llena` = ganada; vacía = hueco por ganar, dibujado con el mismo contorno para
 * que el sitio quede reservado y no salte el layout al ganarla.
 */
export function estrella(llena: boolean, id: string, px = 34): string {
  const cx = 50, cy = 52, R = 42, r = R * 0.382;
  const pt = (i: number, rad: number) => {
    const a = (-90 + i * 36) * (Math.PI / 180);
    return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad] as const;
  };
  // contorno: alterna exterior e interior cada 36°
  const borde = Array.from({ length: 10 }, (_, i) => pt(i, i % 2 ? r : R))
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ') + ' Z';

  if (!llena) {
    return `<svg viewBox="0 0 100 104" width="${px}" height="${px}" role="img" aria-hidden="true" style="display:block">
      <path d="${borde}" fill="none" stroke="var(--hair)" stroke-width="3"/>
    </svg>`;
  }

  // las diez facetas: por cada punta, la mitad izquierda y la derecha
  const caras: string[] = [];
  for (let k = 0; k < 5; k++) {
    const O = pt(k * 2, R);
    const Iprev = pt((k * 2 + 9) % 10, r);
    const Inext = pt(k * 2 + 1, r);
    caras.push(`<path d="M${cx},${cy} L${Iprev[0].toFixed(2)},${Iprev[1].toFixed(2)} L${O[0].toFixed(2)},${O[1].toFixed(2)} Z" fill="url(#${id}-cara)"/>`);
    caras.push(`<path d="M${cx},${cy} L${O[0].toFixed(2)},${O[1].toFixed(2)} L${Inext[0].toFixed(2)},${Inext[1].toFixed(2)} Z" fill="url(#${id}-canto)"/>`);
  }
  const m = METALES.oro;
  return `<svg viewBox="0 0 100 104" width="${px}" height="${px}" role="img" aria-hidden="true" style="display:block">
    <defs>
      <linearGradient id="${id}-cara" gradientUnits="userSpaceOnUse" x1="8" y1="8" x2="92" y2="96">
        <stop offset="0" stop-color="${m[2]}"/>
        <stop offset=".42" stop-color="${m[3]}"/>
        <stop offset=".78" stop-color="${m[1]}"/>
        <stop offset="1" stop-color="${m[4]}"/>
      </linearGradient>
      <linearGradient id="${id}-canto" gradientUnits="userSpaceOnUse" x1="8" y1="8" x2="92" y2="96">
        <stop offset="0" stop-color="${m[3]}"/>
        <stop offset=".38" stop-color="${m[1]}"/>
        <stop offset=".74" stop-color="${m[4]}"/>
        <stop offset="1" stop-color="${m[0]}"/>
      </linearGradient>
      <radialGradient id="${id}-br" gradientUnits="userSpaceOnUse" cx="34" cy="28" r="30">
        <stop offset="0" stop-color="#fff" stop-opacity=".5"/>
        <stop offset=".55" stop-color="#fff" stop-opacity=".08"/>
        <stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    ${caras.join('')}
    <path d="${borde}" fill="url(#${id}-br)"/>
    <path d="${borde}" fill="none" stroke="${m[2]}" stroke-opacity=".45" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`;
}

/**
 * Medalla de liga: disco con cinta. Bronce, plata y oro tienen que distinguirse
 * de un vistazo, así que además del metal cambia el número de muescas del canto
 * (3 / 6 / 12): color solo no basta para quien no distingue bien los tonos.
 */
export function medalla(metal: Metal, id: string, px = 72): string {
  const m = METALES[metal];
  const muescas = metal === 'bronce' ? 3 : metal === 'plata' ? 6 : 12;
  const dientes = Array.from({ length: muescas }, (_, i) => {
    const a = (i * 360) / muescas - 90;
    const rad = (a * Math.PI) / 180;
    const x = 50 + Math.cos(rad) * 41, y = 62 + Math.sin(rad) * 41;
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.6" fill="${m[0]}" opacity=".8"/>`;
  }).join('');
  return `<svg viewBox="0 0 100 110" width="${px}" height="${Math.round(px * 1.1)}" role="img" aria-hidden="true" style="display:block">
    ${defs(id, metal)}
    <path d="M32 4 L46 44 H54 L68 4 H56 L50 26 L44 4 Z" fill="${m[3]}" opacity=".9"/>
    <circle cx="50" cy="62" r="41" fill="url(#${id}-giro)"/>
    ${dientes}
    <circle cx="50" cy="62" r="41" fill="url(#${id}-valor)"/>
    <circle cx="50" cy="62" r="41" fill="url(#${id}-espec)"/>
    <circle cx="50" cy="62" r="30" fill="none" stroke="${m[0]}" stroke-opacity=".45" stroke-width="1.6"/>
    <circle cx="50" cy="62" r="41" fill="none" stroke="${m[2]}" stroke-opacity=".4" stroke-width="1.2"/>
  </svg>`;
}

/**
 * Tinta de TEXTO por metal, una por tema. No sale de METALES a proposito: el
 * especular de plata y platino es blanco puro y el de oro es #FFE9A6, que sobre
 * papel dan 1.1:1 y 1.3:1 — ilegibles. Y el medio (#A8B2BE, #D9A02A) da 3.0:1 y
 * 3.2:1, que tampoco pasa AA para un texto de 10px.
 *
 * Los tonos de papel estan calculados contra #FFF: bronce 6.6:1, plata 7.1:1,
 * oro 5.7:1, platino 6.7:1. Los de oscuro contra #000: el mas bajo es oro con
 * 8.9:1. Solo se usan en texto y en bordes; el metal de la insignia sigue
 * saliendo de METALES, que es fotografia de metal y no tiene que leerse.
 */
export const TINTA: Record<Metal, { osc: string; papel: string }> = {
  bronce:  { osc: '#F0B274', papel: '#8A4E23' },
  plata:   { osc: '#A8B2BE', papel: '#4E5866' },
  oro:     { osc: '#D9A02A', papel: '#8A5E00' },
  platino: { osc: '#B9CBDD', papel: '#4A5C72' },
};

/** Los doce rangos reparten los cuatro metales de tres en tres. */
export const RANGO_METAL = (n: number): Metal =>
  n <= 3 ? 'bronce' : n <= 6 ? 'plata' : n <= 9 ? 'oro' : 'platino';

/** Y las cuatro siluetas rotan, así que dos rangos vecinos nunca son la misma. */
export const RANGO_FORMA = (n: number): Forma =>
  (['copa', 'gema', 'obelisco', 'escudo'] as const)[(n - 1) % 4];
