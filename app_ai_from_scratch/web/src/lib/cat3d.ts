// Conito en 3D. Sustituye a la marcha plana de cat.ts (`pose:'anda'`), que se
// leia como un titere. Cada defecto tiene aqui su arreglo, comentado donde vive.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUE SIGNIFICA "3D" AQUI, Y QUE NO
//
// No es una malla con luces. Es 3D de verdad en lo que importa para esta
// mascota: el rig son CAPAS HTML separadas a distintas Z dentro de un contenedor
// con `perspective` y `preserve-3d`. Las patas de cerca y las de lejos tienen
// PARALAJE real, el balanceo del cuerpo las separa de verdad, la cabeza gira en
// perspectiva y darse la vuelta es un `rotateY` sobre el eje del animal.
//
// Tuvo que ser asi y no un solo SVG: **SVG no soporta transformaciones 3D**. Un
// <g> con translateZ o preserve-3d se ignora. Por eso cada capa es su propio
// <div> con su propio <svg> del mismo viewBox, y lo 3D vive en los divs.
//
// Lo que NO se hizo, a proposito: cargar three.js y un modelo. Son ~150 KB gzip
// en un sitio que sirve una Raspberry Pi 4B de 2 GB, para una mascota que sale
// en cada toast; una malla generada por codigo (capsulas y esferas) se ve PEOR
// que este vector; y el smoking tiene una restriccion dura documentada en cat.ts
// — negro con blanco en los DOS temas — que un modelo con luz real rompe.
//
// ─────────────────────────────────────────────────────────────────────────────
// EL RIG NO SE MUEVE SOLO: MIDE
//
// Decision central. Quien coloca a Conito en la pagina es quien lo llamo (GSAP
// en trazo.ts, en el tour y en el tutorial). El rig LEE cuanto se ha movido su
// propio elemento cada fotograma y de ahi saca la velocidad de suelo.
//
// Eso arregla el patinaje EN LOS TRES SITIOS A LA VEZ y sin tocarlos: da igual
// quien empuje ni con que curva, la cadencia siempre sale del desplazamiento
// real. El bug viejo era justo lo contrario — el cuerpo con `power2.out` de
// GSAP (0.92 s) y las patas con un keyframe CSS fijo de `.92s linear infinite`.
// Dos relojes distintos: la velocidad del cuerpo bajaba a cero y la de las patas
// no, asi que las almohadillas resbalaban. Es el motivo numero uno por el que
// cualquier caminata se lee como falsa.
//
// ─────────────────────────────────────────────────────────────────────────────
// LA PATA ESTA CLAVADA POR CONSTRUCCION, NO POR AJUSTE
//
// Con la fase adelantada por la velocidad —  fase += (v / zancada) * dt  — la
// almohadilla en apoyo se mueve hacia atras en el marco del cuerpo a exactamente
// -v. Comprobacion: el apoyo dura APOYO del ciclo y recorre A = APOYO*Z
// unidades, en un tiempo APOYO*T con T = Z/v. Velocidad local = -A/(APOYO*T) =
// -(APOYO*Z)/(APOYO*Z/v) = -v. Velocidad en el mundo = v + (-v) = 0.
//
// No es un numero a ojo, es una identidad. Mientras la fase la mande la
// velocidad, esto no puede patinar.
//
// El vuelo es un Hermite cubico que empalma con las tangentes del apoyo en los
// dos extremos, asi que la curva es C¹ y no hay tiron ni al despegar ni al
// aterrizar. Y sale gratis un detalle que un gato hace de verdad: como la
// tangente de salida es negativa, la pata sigue un pelo hacia atras despues de
// levantarse, antes de lanzarse adelante.
//
// ─────────────────────────────────────────────────────────────────────────────
// LA PATA TIENE TRES HUESOS, QUE ES LO QUE SE VE
//
// Un gato es DIGITIGRADO: pisa con los dedos, y lo que parece "una rodilla al
// reves" es el CORVEJON — el tobillo, alto. La trasera va cadera → babilla →
// corvejon → almohadilla, con el metatarso largo y casi vertical. Sin ese
// segmento el dibujo es un perro. Lo viejo era UNA barra rigida colgando de la
// cadera: un pendulo, o sea un titere.
//
// Se resuelve con IK de dos barras hasta el corvejon (forma cerrada, ley del
// coseno) y el metatarso rigido colgando. La delantera igual, pero el codo dobla
// al reves — de ahi el signo de `codo` en `ik()`.
//
// ─────────────────────────────────────────────────────────────────────────────
// LA COLA ES FISICA, NO UN FOTOGRAMA
//
// Cadena de cuatro segmentos, cada uno persiguiendo al anterior con resorte y
// amortiguacion. La aceleracion del cuerpo y la velocidad de giro se inyectan en
// la raiz, asi que la cola LATIGA sola al arrancar, al frenar y al girar. Atada
// a un seno fijo se lee como juguete de cuerda; esto es lo unico del rig que
// nadie mira a proposito y todo el mundo nota.
//
// ─────────────────────────────────────────────────────────────────────────────
// LOS GESTOS SON POISSON, NO METRONOMO
//
// Parpadeo, oreja, cola, cambio de peso. A intervalo fijo el cerebro encuentra
// el bucle en dos ciclos y se acabo la ilusion — que es lo que pasaba con los
// `animation: ... infinite`. Cada gesto tiene una MEDIA y se reprograma con
// -media*ln(1-u): un proceso de Poisson, nunca cae dos veces en el mismo sitio.

const BLANCO = '#F8F9FB';    // fijo: la mancha del smoking no gira con el tema
const CUERPO = '#191A1F';    // tinta propia, no --bg y no negro puro
const LINEA = 'var(--l2)';
const OJO = '#F2C14E';       // fijo: el ojo del gato no gira con el tema
const OJO_HOND = '#C9922B';

// ── Canon de proporcion, en unidades del lienzo ──────────────────────────────
// Lienzo 104x96, suelo en y=88, el gato mira hacia +x. Sale del canon de perfil
// de cat.ts y se conserva para que no cambie de especie al reescalarlo.
// El lienzo se recorta a 88 de alto y el suelo sube a 80. NO es cosmetico: con
// el suelo en 88 y el vientre en 65 quedaban 23 unidades de pata al aire contra
// 33 de cuerpo — proporcion 0.7, que es un ciervo. Un gato esta en 0.45, y esas
// 15 unidades es lo que se ve de sus patas. Es la medida que decide la especie.
const VB = { w: 104, h: 88 };
const SUELO = 80;

const HOMBRO = { x: 64, y: 55 };
const CADERA = { x: 26, y: 57 };
const CUELLO = { x: 70, y: 41 };     // pivote de la cabeza

// Huesos. Delantera: humero + radio + metacarpo. Trasera: femur + tibia +
// metatarso (el largo, el del corvejon).
// Los huesos se acortan con el suelo. La suma tiene que pasarse un poco del
// alcance (hombro/cadera al suelo) para que la pata SIEMPRE este algo doblada:
// estirada del todo el acos de ik() entra en la singularidad. Delantera 27
// sobre 25 de alcance (93%), trasera 28 sobre 23 (82%), que es el angulo que
// dibuja el corvejon.
const DEL = { l1: 11, l2: 10, lm: 6 };
const TRA = { l1: 11, l2: 10, lm: 7 };

const NEUTRO_DEL = 63;      // reposo de la almohadilla en el marco del cuerpo
const NEUTRO_TRA = 27;

// LA ZANCADA ES LA MEDIDA QUE DELATA LA ESPECIE. Un gato avanza mas o menos el
// largo de su tronco por zancada; el tronco aqui va de la cadera (x=26) al
// hombro (x=64), 38 unidades. Estuvo en 23 y se medio: a la velocidad a la que
// GSAP lo trae daban 18 zancadas por segundo — un raton. Un gato hace dos.
const ZANCADA = 28;         // unidades de suelo por ciclo, a paso de crucero
const APOYO = 0.74;         // fraccion del ciclo con la pata en el suelo.
                            // 4 patas a un cuarto de ciclo => 4*0.74 = 2.96
                            // apoyos simultaneos, o sea TRES casi siempre: eso
                            // es caminar. Con 0.62 daria 2.48, que es un TROTE.
const ALZA = 4;             // cuanto sube la almohadilla en el vuelo. Un gato la
                            // lleva baja; 4 sobre una pata de 25 se ve sin exagerar.
// Velocidad de referencia: un gato camina a poco mas de un largo de cuerpo por
// segundo, y el cuerpo ocupa ~0.82 del lienzo. De ahi el 1.0.
const CRUCERO = 1.0;        // anchos de lienzo por segundo

// Secuencia lateral: posterior izq → anterior izq → posterior der → anterior der.
const PATAS = [
  { id: 'tI', tras: true,  cerca: true,  desfase: 0.00 },
  { id: 'dI', tras: false, cerca: true,  desfase: 0.25 },
  { id: 'tD', tras: true,  cerca: false, desfase: 0.50 },
  { id: 'dD', tras: false, cerca: false, desfase: 0.75 },
] as const;

export type Gesto = 'parpadeo' | 'parpadeoLento' | 'oreja' | 'cola' | 'peso';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** Proximo disparo de un proceso de Poisson de media `media` segundos. */
const poisson = (media: number) => -media * Math.log(1 - Math.random());

/**
 * IK de dos barras, forma cerrada. Devuelve la articulacion intermedia.
 * `codo` = +1 / -1 elige de que lado dobla, y es lo unico que distingue un codo
 * de gato de una babilla de gato.
 */
function ik(ax: number, ay: number, bx: number, by: number, l1: number, l2: number, codo: number) {
  const dx = bx - ax, dy = by - ay;
  // Se recorta a un pelo del estirado completo: en la singularidad el acos sale
  // NaN, el transform queda invalido y la pata desaparece.
  const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const th = Math.atan2(dy, dx) + codo * a;
  return { x: ax + Math.cos(th) * l1, y: ay + Math.sin(th) * l1 };
}

/**
 * Almohadilla en el marco del cuerpo para una fase dada. Apoyo LINEAL — un pie
 * apoyado no acelera — y vuelo con Hermite cubico que empalma las tangentes del
 * apoyo en los dos extremos.
 */
function pisada(fase: number, neutro: number, Z: number) {
  const A = APOYO * Z;                       // excursion del apoyo
  if (fase < APOYO) return { x: neutro + A / 2 - (fase / APOYO) * A, y: SUELO };
  const h = 1 - APOYO;
  const w = (fase - APOYO) / h;
  const m = (-A / APOYO) * h;                // misma tangente a la entrada y a la salida
  const w2 = w * w, w3 = w2 * w;
  const x = (2 * w3 - 3 * w2 + 1) * (-A / 2) + (w3 - 2 * w2 + w) * m
          + (-2 * w3 + 3 * w2) * (A / 2) + (w3 - w2) * m;
  // sin^0.7: sube rapido y se aplana arriba. Un gato levanta poco y deprisa.
  return { x: neutro + x, y: SUELO - ALZA * Math.pow(Math.sin(Math.PI * w), 0.7) };
}

// ── Dibujo ───────────────────────────────────────────────────────────────────

/**
 * Un hueso: barra ahusada de (0,0) hacia abajo, largo L. Rota sobre (0,0).
 * El circulo del extremo NO es adorno: sin el, dos barras articuladas dejan una
 * muesca en la union y la pata se lee como dos palos atados, no como un miembro.
 */
const hueso = (L: number, g0: number, g1: number, borde: string) =>
  `<path d="M${-g0} 0 L${g0} 0 L${g1} ${L} L${-g1} ${L} Z"
    fill="${CUERPO}" stroke="${borde}" stroke-width="1.3" stroke-linejoin="round"/>
   <circle cx="0" cy="0" r="${g0 - 0.15}" fill="${CUERPO}"/>`;

function pataSVG(id: string, tras: boolean, cerca: boolean) {
  const B = tras ? TRA : DEL;
  // La capa de lejos ya la oscurece el CSS (filter), asi que la tinta es la
  // misma en las cuatro. Antes se escribia a mano un #0E1014, y al girar el rig
  // la pata "de lejos" seguia oscura estando delante.
  const borde = LINEA;
  return `<g class="${id}">
    <g class="${id}-a">${hueso(B.l1, 5.0, 4.0, borde)}</g>
    <g class="${id}-b">${hueso(B.l2, 4.0, 3.1, borde)}</g>
    <g class="${id}-c">${hueso(B.lm, 3.1, 2.8, borde)}
      <path d="M-3.0 ${B.lm - 1.4} h6.0 a2.3 2.3 0 0 1 0 4.6 h-6.0 a2.3 2.3 0 0 1 0 -4.6 z"
        fill="${BLANCO}" stroke="${borde}" stroke-width="1.05"/>
    </g>
  </g>`;
}

const capaSVG = (px: number, dentro: string, clase: string) =>
  `<div class="c3d-capa ${clase}"><svg viewBox="0 0 ${VB.w} ${VB.h}" width="${px}"
    height="${(px * VB.h) / VB.w}" style="display:block;overflow:visible">${dentro}</svg></div>`;

/** Hoja de estilo del rig. Se inyecta una vez por documento. */
function conitoCSS(): string {
  return `
.c3d{position:fixed;left:0;top:0;z-index:120;pointer-events:none;
  perspective:760px;perspective-origin:50% 62%;will-change:transform}
.c3d-rig{position:absolute;left:0;top:0;transform-style:preserve-3d;will-change:transform}
.c3d-capa{position:absolute;left:0;top:0}
/* La profundidad. Las de lejos van oscurecidas: es sombreado por distancia, y
   se intercambia solo si el rig gira — cosa que una tinta escrita a mano no hacia. */
.c3d-lejos{transform:translateZ(-8px);filter:brightness(.5) saturate(.8)}
.c3d-cola{transform:translateZ(-5px);filter:brightness(.88)}
.c3d-torso{transform:translateZ(0)}
.c3d-cabeza{transform:translateZ(3px)}
/* z NEGATIVA a proposito: las patas van DETRAS del torso. En un gato de perfil
   el humero y el femur estan dentro de la silueta y solo asoma la parte baja.
   Delante del cuerpo se veia el muslo entero: una mesa, no un gato. Sigue
   delante de las de lejos (-8), asi que el paralaje entre pares no se pierde. */
.c3d-cerca{transform:translateZ(-1px)}
/* El contacto con el suelo. Sin el, el gato flota por muy bien que camine, y con
   el sobra la luz azul de WebGL que habia antes — dos tratamientos de suelo
   peleandose era parte de lo que se sentia irreal.
   VA EN var(--hair), NO en negro: el tema por defecto es fondo #000, y una
   sombra negra sobre negro no existe. --hair es rgba(84,84,88,.46) en oscuro,
   o sea un charco de luz, y rgba(0,0,0,.22) en papel, o sea una sombra. El
   mismo gradiente lee como contacto en los dos temas sin ramas. */
.c3d-sombra{position:absolute;pointer-events:none;border-radius:50%;
  background:radial-gradient(ellipse at 50% 50%,var(--hair),transparent 72%)}
.c3d-hold{position:absolute;transform-origin:left bottom;pointer-events:none}
.c3d-hold > *{box-shadow:0 8px 22px rgba(0,0,0,.28)}
@media (prefers-reduced-motion: reduce){.c3d{display:none}}`;
}

// ── El rig ───────────────────────────────────────────────────────────────────

export type Conito = ReturnType<typeof montarConito>;

/**
 * Monta el rig y lo devuelve. `el` es un elemento `position:fixed` que MUEVE
 * QUIEN LLAMA (con GSAP, como el actor de antes). El rig mide ese movimiento y
 * de ahi saca la marcha; ver la nota de cabecera.
 *
 * El bucle se apaga solo cuando `el` sale del documento, asi que un `el.remove()`
 * suelto no deja un requestAnimationFrame huerfano corriendo para siempre.
 */
export function montarConito(px = 112) {
  if (!document.getElementById('c3d-css')) {
    const s = document.createElement('style');
    s.id = 'c3d-css';
    s.textContent = conitoCSS();
    document.head.append(s);
  }

  const k = px / VB.w;                 // unidades del lienzo → px
  const alto = (px * VB.h) / VB.w;

  const el = document.createElement('div');
  el.className = 'c3d';
  el.setAttribute('aria-hidden', 'true');
  el.style.width = `${px}px`;
  el.style.height = `${alto}px`;

  const sombra = document.createElement('div');
  sombra.className = 'c3d-sombra';
  sombra.style.width = `${px * 0.6}px`;
  sombra.style.height = `${px * 0.12}px`;
  sombra.style.left = `${px * 0.14}px`;
  sombra.style.top = `${SUELO * k - px * 0.05}px`;

  const rig = document.createElement('div');
  rig.className = 'c3d-rig';
  rig.style.width = `${px}px`;
  rig.style.height = `${alto}px`;

  const hold = document.createElement('div');
  hold.className = 'c3d-hold trazo-hold';
  hold.style.left = '6%';
  hold.style.top = '-8%';

  // Mas hondo que el de perfilAnda (que moria en y=62): baja a y=67 para cubrir
  // el nacimiento de las cuatro patas. Un gato de perfil tiene el vientre bajo,
  // y ese es justo el rasgo que lo separa de un perro de patas largas.
  const tronco = 'M16 64 C9 56 11 41 22 37 C35 32 58 31 70 37 C77 41 79 55 73 65 '
               + 'C64 68 34 68 16 64 Z';
  const pechera = 'M58 40 C66 42 71 48 71 54 C71 61 66 65 59 65 L50 64 C48 55 51 44 58 40 Z';
  const vientre = 'M50 64.5 L30 63.4 C26 62.6 24 61 25 59.2 C33 62.4 42 63.6 50 63 Z';
  const cara = 'M62 28 C62 20 68 14 76 14 C84 14 89 20 89 28 C89 36 84 41 76 41 C68 41 62 36 62 28 Z';

  rig.innerHTML =
    capaSVG(px, PATAS.filter((p) => !p.cerca).map((p) => pataSVG(p.id, p.tras, false)).join(''), 'c3d-lejos')
    + capaSVG(px, '<g class="cola"></g>', 'c3d-cola')
    + capaSVG(px, `<g class="torso">
        <path d="${tronco}" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="${pechera}" fill="${BLANCO}" opacity=".95"/>
        <path d="${vientre}" fill="${BLANCO}" opacity=".9"/>
      </g>`, 'c3d-torso')
    + capaSVG(px, `<g class="cabeza">
        <g class="orejaI"><path d="M65 19 L62 4 L75 11 Z" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M66.5 16.5 L64.5 7.5 L71.5 11.5 Z" fill="${LINEA}" opacity=".35"/></g>
        <g class="orejaD"><path d="M84 18 L89 5 L78 10 Z" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M83.6 15.5 L86.5 8 L80.5 11 Z" fill="${LINEA}" opacity=".35"/></g>
        <path d="${cara}" fill="${CUERPO}" stroke="${LINEA}" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="M82.6 31.6 C86.4 31 89.2 31.8 89.5 33.4 C88.9 37.6 86.4 40.2 82.4 40.2
          C80.8 37.6 80.9 33.6 82.6 31.6 Z" fill="${BLANCO}" opacity=".95"/>
        <g class="ojo">
          <ellipse cx="79" cy="26" rx="3.4" ry="3.9" fill="${OJO}"/>
          <ellipse cx="79" cy="26" rx="3.4" ry="3.9" fill="none" stroke="${OJO_HOND}" stroke-width=".9"/>
          <ellipse cx="79" cy="26" rx="1" ry="3" fill="${CUERPO}"/>
          <circle cx="80.4" cy="24.4" r=".95" fill="${BLANCO}" opacity=".92"/>
        </g>
        <path d="M89.6 33.2 l-1.9 1.6 h3.6 Z" fill="${LINEA}"/>
        <path d="M89.4 34.8 v1.6 M89.4 36.4 C88 37.5 86.6 37.2 86 36.1"
          fill="none" stroke="${LINEA}" stroke-width="1.05" stroke-linecap="round"/>
        <g stroke="${LINEA}" stroke-width=".9" stroke-linecap="round" opacity=".7">
          <path d="M88 34 L98 31"/><path d="M88.5 36.5 L98 37"/>
        </g>
      </g>`, 'c3d-cabeza')
    + capaSVG(px, PATAS.filter((p) => p.cerca).map((p) => pataSVG(p.id, p.tras, true)).join(''), 'c3d-cerca');

  el.append(sombra, rig, hold);

  const q = <T extends Element>(s: string) => rig.querySelector<T>(s)!;
  const N = {
    torso: q<SVGGElement>('.torso'),
    cabeza: q<SVGGElement>('.cabeza'),
    capaCabeza: rig.querySelector<HTMLElement>('.c3d-cabeza')!,
    capaLejos: rig.querySelector<HTMLElement>('.c3d-lejos')!,
    capaCerca: rig.querySelector<HTMLElement>('.c3d-cerca')!,
    ojo: q<SVGGElement>('.ojo'),
    orejaI: q<SVGGElement>('.orejaI'),
    orejaD: q<SVGGElement>('.orejaD'),
    cola: q<SVGGElement>('.cola'),
    patas: Object.fromEntries(PATAS.map((p) => [p.id, {
      a: q<SVGGElement>(`.${p.id}-a`), b: q<SVGGElement>(`.${p.id}-b`), c: q<SVGGElement>(`.${p.id}-c`),
    }])) as Record<string, { a: SVGGElement; b: SVGGElement; c: SVGGElement }>,
  };

  // ── Estado ────────────────────────────────────────────────────────────────
  const S = {
    xAnt: NaN, v: 0, acel: 0,
    giro: 0, giroObj: 0,
    fase: 0,
    // El tipo va escrito: con `as const` en PATAS, inferirlo de `p.desfase`
    // congela `fase` en la union literal 0|0.25|0.5|0.75 y no se puede avanzar.
    patas: PATAS.map((p) => ({
      fase: p.desfase as number, Z: ZANCADA,
      x: (p.tras ? NEUTRO_TRA : NEUTRO_DEL) as number, y: SUELO as number,
    })),
    sent: 0, sentObj: 0,
    parp: 1, parpDur: 0.12,
    oreja: 0, orejaLado: 1,
    peso: 0,
    miraY: 0, miraX: 0, miraOn: false,
    puntero: { x: 0, y: 0 },
    colaTh: [-1.15, -0.42, -0.30, -0.26], colaW: [0, 0, 0, 0],
    prox: { parpadeo: 1.2, oreja: 3, cola: 4, peso: 6 },
  };
  // El reposo de la cola. OJO CON EL SIGNO: el segmento i apunta a
  // pi + suma(REPOSO[0..i]), y sin(pi+a) = -sin(a) — o sea que un angulo
  // NEGATIVO manda la cola hacia +y, que en pantalla es HACIA ABAJO. Con los
  // valores negativos la cola salia bajo la barriga y no se veia ni una.
  // Positivos = sube y se arquea sobre el lomo, que es la cola de un gato que
  // camina tranquilo.
  const REPOSO = [1.02, 0.20, 0.15, 0.11];

  // ── Bucle ─────────────────────────────────────────────────────────────────
  let raf = 0, t0 = performance.now(), vivo = true;

  function paso(dt: number) {
    // AQUI se mide. Una lectura de rect por fotograma, de un solo elemento fijo.
    const x = el.getBoundingClientRect().left;
    const vBruta = Number.isNaN(S.xAnt) ? 0 : (x - S.xAnt) / dt;
    S.xAnt = x;
    const vAnt = S.v;
    // Paso bajo: el delta crudo entre fotogramas tiembla. Y un tope duro, porque
    // un gs.set() que teletransporta el elemento daria una velocidad absurda y
    // la fase saltaria medio ciclo de golpe.
    S.v = lerp(S.v, clamp(vBruta, -px * 9, px * 9), Math.min(1, dt * 18));
    S.acel = (S.v - vAnt) / Math.max(dt, 1e-4);

    const rapidez = Math.abs(S.v);
    const andando = rapidez > px * 0.06 && S.sentObj < 0.5;

    // El rumbo. Se gira hacia donde se va, siempre y en todas partes: esto es lo
    // que arregla el moonwalk de la salida, donde antes solo se interpolaba x.
    if (rapidez > px * 0.25) S.giroObj = S.v > 0 ? 0 : 180;
    const dG = ((S.giroObj - S.giro + 540) % 360) - 180;
    // Mas rapido cerca de los 90 grados, que es donde un plano se ve de canto y
    // no hay nada bonito que enseñar.
    S.giro += clamp(dG, -1, 1) * (200 + 420 * (1 - Math.abs(Math.cos((S.giro * Math.PI) / 180)))) * dt;

    // La zancada se acorta al ir despacio, como un gato de verdad. Se congela al
    // apoyar: cambiarla a media pisada arrastraria la almohadilla.
    // Crece con la velocidad SIN techo en ZANCADA: un cuadrupedo que corre alarga
    // el paso, no solo lo acelera. Si se capa, al ir rapido salen pasitos de
    // juguete. Tope 1.8x para que no se abra de patas.
    const Zobj = ZANCADA * clamp(0.55 + 0.75 * (rapidez / (px * CRUCERO)), 0.55, 1.8);
    if (andando) S.fase = (S.fase + (rapidez / (Zobj * k)) * dt) % 1;

    S.sent += clamp(S.sentObj - S.sent, -dt * 2.2, dt * 2.2);
    const sent = S.sent * S.sent * (3 - 2 * S.sent);          // smoothstep

    for (let i = 0; i < 4; i++) {
      const e = S.patas[i], cfg = PATAS[i];
      const ant = e.fase;
      if (andando) {
        e.fase = (S.fase + cfg.desfase) % 1;
        if (ant >= APOYO && e.fase < APOYO) e.Z = Zobj;      // apoya: fija Z
      }
      // SENTARSE es sobre todo donde van las almohadillas. La trasera se mete
      // ADELANTE bajo el cuerpo (la grupa baja al suelo y el corvejon se dobla);
      // la delantera se recoge un pelo bajo el pecho y se queda recta. Puesto el
      // objetivo, la IK dibuja la postura sola.
      const neutro = (cfg.tras ? NEUTRO_TRA : NEUTRO_DEL) + (cfg.tras ? sent * 9 : -sent * 3);
      const p = andando ? pisada(e.fase, neutro, e.Z) : { x: neutro, y: SUELO };
      // Al parar, las cuatro vuelven al reposo con suavidad. El rig viejo las
      // dejaba CONGELADAS en el aire: quitaba la clase .trazo-anda y ponia
      // data-gato="saluda" sobre un SVG de perfil, atributo que no redibuja
      // nada — solo mataba los selectores CSS.
      const a = andando ? 1 : Math.min(1, dt * 6.5);
      e.x = lerp(e.x, p.x, a);
      e.y = lerp(e.y, p.y, a);
    }

    // Vaiven: dos hundidas por zancada, una por cada par de apoyos. La amplitud
    // va con la velocidad, asi que a paso lento casi no bota.
    const amp = 1.8 * Math.min(1, rapidez / (px * CRUCERO));
    const bob = andando ? -amp * (0.5 - 0.5 * Math.cos(4 * Math.PI * S.fase)) : 0;
    const cabeceo = andando ? 1.7 * Math.sin(2 * Math.PI * S.fase) : 0;
    // El balanceo es lo que separa las capas: en perspectiva las patas de cerca
    // y las de lejos dejan de estar alineadas. Ahi es donde se ve que hay 3D.
    const balanceo = andando ? 2.6 * Math.sin(2 * Math.PI * S.fase + Math.PI / 2) : 0;

    // ── Gestos, en Poisson ──────────────────────────────────────────────────
    for (const g of ['parpadeo', 'oreja', 'cola', 'peso'] as const) {
      S.prox[g] -= dt;
      if (S.prox[g] > 0) continue;
      if (g === 'parpadeo') {
        // Uno de cada seis es un parpadeo LENTO: el gesto con el que un gato
        // dice que se fia de ti. Es el detalle que la gente lee como "vivo".
        S.parpDur = Math.random() < 0.17 ? 0.62 : 0.12;
        S.parp = 0;
        S.prox.parpadeo = poisson(3.6) + 0.9;
      } else if (g === 'oreja') {
        S.oreja = 1; S.orejaLado = Math.random() < 0.5 ? 1 : -1;
        S.prox.oreja = poisson(5.5) + 1.2;
      } else if (g === 'cola') {
        S.colaW[0] += rnd(-9, 9);       // impulso a la raiz; el latigo lo hace el resorte
        S.prox.cola = poisson(4.5) + 1;
      } else {
        S.peso = rnd(-1, 1);
        S.prox.peso = poisson(7) + 2;
      }
    }
    S.parp = Math.min(1, S.parp + dt / S.parpDur);
    S.oreja = Math.max(0, S.oreja - dt * 4.5);
    S.peso = lerp(S.peso, 0, dt * 1.6);

    // La mirada. La cabeza gira en Y de verdad, y es la capa donde mas se nota
    // el 3D: el hocico se acerca y las orejas se cruzan en perspectiva.
    const mY = S.miraOn ? clamp((S.puntero.x - (x + CUELLO.x * k)) / 7, -34, 34) : 0;
    const rTop = S.miraOn ? el.getBoundingClientRect().top : 0;
    const mX = S.miraOn ? clamp((S.puntero.y - (rTop + CUELLO.y * k)) / 11, -16, 16) : 0;
    S.miraY = lerp(S.miraY, mY, Math.min(1, dt * 6));
    S.miraX = lerp(S.miraX, mX, Math.min(1, dt * 6));

    // ── Cola: cadena de resortes ────────────────────────────────────────────
    // La raiz recibe el cabeceo, la aceleracion del cuerpo y la velocidad de
    // giro. De ahi para abajo cada segmento persigue al anterior. Nadie escribio
    // el latigo: sale del sistema.
    const raiz = REPOSO[0] - cabeceo * 0.012 + S.acel / (px * 26)
               + (dG / 260) - sent * 0.55;
    for (let i = 0; i < 4; i++) {
      const obj = i === 0 ? raiz : S.colaTh[i - 1] + REPOSO[i];
      S.colaW[i] = clamp(S.colaW[i] + (190 * (obj - S.colaTh[i]) - 17 * S.colaW[i]) * dt, -46, 46);
      S.colaTh[i] += S.colaW[i] * dt;
    }

    pinta(bob, cabeceo, balanceo, sent);
  }

  function pinta(bob: number, cabeceo: number, balanceo: number, sent: number) {
    // SENTARSE, con la geometria despejada y no a ojo. La grupa baja 15 y el
    // cuerpo se endereza: hocico arriba (el signo estaba al reves y lo sentaba
    // de morros). El PICADO no puede ser cualquiera — el giro pivota en la
    // cadera, asi que el hombro sube 38*sin(a) + 13*cos(a). Con 30 grados subia
    // a y=47.5 y la pata delantera, que mide 27, no llegaba al suelo (80): 32.5
    // de alcance. El gato flotaba. Con 22 grados el hombro se queda en 54.9,
    // alcance 25.1 sobre 27 de pata — el mismo 93% que de pie, que es
    // justamente lo que hace un gato al sentarse: estira el codo, no se estira
    // el hueso.
    const cy = bob + sent * 15 + S.peso * 0.5;
    const cRot = cabeceo - sent * 22;
    const T = `translate(0 ${cy.toFixed(2)}) rotate(${cRot.toFixed(2)} ${CADERA.x} ${CADERA.y})`;
    N.torso.setAttribute('transform', T);

    // Patas por IK. El ancla se mueve con el cuerpo; la almohadilla NO — esta
    // clavada en el suelo. Esa diferencia es toda la marcha.
    const r = (cRot * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
    const conCuerpo = (p: { x: number; y: number }) => {
      const dx = p.x - CADERA.x, dy = p.y - CADERA.y + cy;
      return { x: CADERA.x + dx * cs - dy * sn, y: CADERA.y + dx * sn + dy * cs };
    };
    const ang = (ax: number, ay: number, bx: number, by: number) =>
      (Math.atan2(by - ay, bx - ax) * 180) / Math.PI - 90;    // los huesos miran a +y

    for (let i = 0; i < 4; i++) {
      const cfg = PATAS[i], e = S.patas[i], B = cfg.tras ? TRA : DEL;
      const anc = conCuerpo(cfg.tras ? CADERA : HOMBRO);
      // El metatarso cuelga casi vertical desde la almohadilla: ahi esta el
      // corvejon, y sin el esto es un perro.
      // Sentado, el gato apoya el METATARSO ENTERO en el suelo — se sienta sobre
      // los corvejones. De pie va casi vertical (0.2); sentado se tumba (1.0).
      const inc = cfg.tras ? lerp(0.2, 1.0, sent) : -0.1;
      const tob = { x: e.x - Math.sin(inc) * B.lm, y: e.y - Math.cos(inc) * B.lm };
      // La trasera dobla hacia delante (babilla), la delantera hacia atras (codo).
      const med = ik(anc.x, anc.y, tob.x, tob.y, B.l1, B.l2, cfg.tras ? 1 : -1);
      const n = N.patas[cfg.id];
      n.a.setAttribute('transform', `translate(${anc.x.toFixed(2)} ${anc.y.toFixed(2)}) rotate(${ang(anc.x, anc.y, med.x, med.y).toFixed(2)})`);
      n.b.setAttribute('transform', `translate(${med.x.toFixed(2)} ${med.y.toFixed(2)}) rotate(${ang(med.x, med.y, tob.x, tob.y).toFixed(2)})`);
      n.c.setAttribute('transform', `translate(${tob.x.toFixed(2)} ${tob.y.toFixed(2)}) rotate(${ang(tob.x, tob.y, e.x, e.y).toFixed(2)})`);
    }

    // Cabeza: HEREDA la transformacion del cuerpo (`T`) y encima pone la suya.
    // La contrafase del vaiven es lo que hace un gato para no botar la mirada —
    // el cuerpo sube y la cabeza se queda — y al sentarse deshace la mayor parte
    // del enderezado, porque un gato sentado mira al frente, no al techo.
    N.cabeza.setAttribute('transform',
      `${T} translate(0 ${(-bob * 0.55).toFixed(2)}) `
      + `rotate(${(-cabeceo * 0.5 + sent * 24).toFixed(2)} ${CUELLO.x} ${CUELLO.y})`);
    N.capaCabeza.style.transformOrigin = `${CUELLO.x * k}px ${CUELLO.y * k}px`;
    N.capaCabeza.style.transform =
      `translateZ(3px) rotateY(${S.miraY.toFixed(2)}deg) rotateX(${(-S.miraX).toFixed(2)}deg)`;
    const ab = Math.max(0.08, S.parp > 0.5 ? 1 : S.parp * 2);
    N.ojo.setAttribute('transform', `translate(0 ${(26 * (1 - ab)).toFixed(2)}) scale(1 ${ab.toFixed(3)})`);
    N.orejaI.setAttribute('transform', `rotate(${(S.orejaLado > 0 ? S.oreja * 15 : 0).toFixed(2)} 68 18)`);
    N.orejaD.setAttribute('transform', `rotate(${(S.orejaLado < 0 ? S.oreja * -15 : 0).toFixed(2)} 84 16)`);

    // Cola: la cadena, con el mechon blanco en la punta. La raiz pasa por la
    // MISMA transformacion del cuerpo que las caderas, no solo por el
    // desplazamiento vertical: si no, al enderezarse el gato la cola se le
    // quedaba clavada en el aire.
    const raizCola = conCuerpo({ x: 17, y: 44 });
    let tx = raizCola.x, ty = raizCola.y, ac = 0, d = `M${tx.toFixed(2)} ${ty.toFixed(2)}`;
    for (let i = 0; i < 4; i++) {
      ac += S.colaTh[i];
      tx += Math.cos(Math.PI + ac) * 11.5;
      ty += Math.sin(Math.PI + ac) * 11.5;
      d += ` L${tx.toFixed(2)} ${ty.toFixed(2)}`;
    }
    N.cola.innerHTML =
      `<path d="${d}" fill="none" stroke="${LINEA}" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round"/>
       <path d="${d}" fill="none" stroke="${CUERPO}" stroke-width="3.9" stroke-linecap="round" stroke-linejoin="round"/>
       <circle cx="${tx.toFixed(2)}" cy="${ty.toFixed(2)}" r="2.7" fill="${BLANCO}" stroke="${LINEA}" stroke-width="1.05"/>`;

    // El rig completo en 3D. UN PLANO A 90 GRADOS SE VE DE CANTO: ancho cero, y
    // ninguna transformacion lo arregla — el scaleX se aplica antes de la
    // rotacion, asi que escalar una proyeccion nula sigue dando cero. El gato
    // desaparecia dos fotogramas al darse la vuelta.
    //
    // Asi que la banda (78, 102) NO SE PINTA: se salta al borde mas cercano. El
    // ojo lee un giro rapido, que es lo que es, en vez de un parpadeo en negro.
    // La entrega ya no gira (sale por el lado contrario, ver trazo.ts), pero el
    // tour y el tutorial mueven al gato a los dos lados y esto es su red.
    let m = ((S.giro % 360) + 360) % 360;
    if (m > 78 && m < 102) m = m < 90 ? 78 : 102;
    else if (m > 258 && m < 282) m = m < 270 ? 258 : 282;
    const canto = Math.abs(Math.cos((m * Math.PI) / 180));
    rig.style.transform = `rotateY(${m.toFixed(2)}deg) rotateX(${balanceo.toFixed(2)}deg)`;
    // Pasados los 90° la capa "de lejos" queda delante. Se intercambia el
    // oscurecido para que la profundidad siga siendo cierta.
    const vuelto = m > 90 && m < 270;
    N.capaLejos.style.filter = vuelto ? 'brightness(1) saturate(1)' : '';
    N.capaCerca.style.filter = vuelto ? 'brightness(.5) saturate(.8)' : '';

    // La sombra se estrecha y aclara cuando el cuerpo sube: es el contacto.
    const h = 1 - cy / 6;
    sombra.style.opacity = String(clamp(0.5 * h, 0.16, 0.6));
    sombra.style.transform = `scale(${clamp(h, 0.82, 1.1).toFixed(3)})`;
  }

  const tic = (now: number) => {
    // El bucle se apaga solo si el elemento ya no esta en el documento. Los tres
    // sitios que lo usan hacen `cat.remove()` a secas.
    if (!vivo || !el.isConnected) { vivo = false; return; }
    // TECHO Y SUELO. El techo es por la pestaña dormida: dt gigante => rig roto.
    // El SUELO es por dos cosas medidas, no supuestas:
    //   - dt === 0 (dos rAF con la misma marca) hacia (x - xAnt)/dt = 0/0 = NaN,
    //     y de ahi el NaN entraba en v -> acel -> raiz de la cola -> el atributo
    //     d del path. La consola escupia «<path> attribute d: Expected number,
    //     "M17.00 44.00 LNaN NaN…"» en TODOS los cuadros, y las pupilas salian
    //     con cx="NaN". Una vez dentro, el NaN no sale solo: se guarda en S.
    //   - dt NEGATIVO. vive() pone t0 = performance.now() y el primer rAF llega
    //     con la marca de INICIO del cuadro, que puede ser anterior. Con dt < 0
    //     la fase va hacia atras y los lerp extrapolan al reves.
    const dt = Math.min(1 / 30, Math.max(1e-4, (now - t0) / 1000));
    t0 = now;
    paso(dt);
    raf = requestAnimationFrame(tic);
  };

  const onPuntero = (e: PointerEvent) => { S.puntero.x = e.clientX; S.puntero.y = e.clientY; };

  return {
    el,
    hold,
    /** Arranca el bucle. Se llama despues de meter `el` en el documento. */
    vive() {
      if (raf) return;
      vivo = true; t0 = performance.now(); S.xAnt = NaN;
      raf = requestAnimationFrame(tic);
    },
    /** Rumbo inmediato, sin girar a la vista. 0 mira a la derecha, 180 a la izquierda. */
    rumbo(grados: number) { S.giro = grados; S.giroObj = grados; },
    mirar(on: boolean) {
      S.miraOn = on;
      if (on) window.addEventListener('pointermove', onPuntero, { passive: true });
      else window.removeEventListener('pointermove', onPuntero);
    },
    sentarse(on = true) { S.sentObj = on ? 1 : 0; },
    gesto(g: Gesto) {
      if (g === 'parpadeo' || g === 'parpadeoLento') { S.parpDur = g === 'parpadeoLento' ? 0.62 : 0.12; S.parp = 0; }
      else if (g === 'oreja') { S.oreja = 1; S.orejaLado = Math.random() < 0.5 ? 1 : -1; }
      else if (g === 'cola') S.colaW[0] += rnd(10, 16);
      else S.peso = rnd(-1, 1);
    },
    destruir() {
      vivo = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPuntero);
      el.remove();
    },
  };
}
