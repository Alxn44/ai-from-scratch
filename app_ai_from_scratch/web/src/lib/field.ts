// Campo de partículas de fondo. Se usa en el chat para dar aire espacial sin
// tocar la legibilidad del hilo.
//
// EL PROBLEMA, medido, no supuesto:
// .card no declara background (theme-css.ts:59), así que toda burbuja del chat es
// transparente y un canvas detrás de la página corre debajo del texto de cada
// mensaje. El texto de lectura es .p con var(--l2) = rgba(235,235,245,.62), que
// compositado sobre --bg:#000 da rgb(146,146,152). Contra negro puro eso es
// 6.79:1. Con una estrella al 35% detrás de una letra baja a 2.26:1: ilegible.
//
// EL TECHO: dentro de una burbuja, el píxel compuesto no puede pasar de 30/255.
// Va como fracción de 255 a propósito, porque el canvas es de 8 bits y solo
// importa en qué byte cae. Medido con luminancia WCAG de los dos colores ya
// cuantizados a 8 bits, que es lo que la pantalla enseña.
//
// ERA 43, Y 43 ESTABA MAL. El cálculo de arriba mide --l2, que es el color de
// .p — pero dentro de una burbuja también se pinta .s, y .s es --l3
// (theme-css.ts:71), más débil. Rehecho contra el token MÁS DÉBIL que se dibuja
// sobre el campo, que es el que manda:
//     oscuro  --l3 rgba(235,235,245,.50) sobre #000, estrella blanca
//             byte 30 -> 4.540:1  OK
//             byte 31 -> 4.489:1  rompe AA
//             byte 43 -> 4.176:1  lo que se venía sirviendo
//     papel   --l3 rgba(0,0,0,.58) sobre #F2F2F2, estrella negra
//             byte 44 -> 4.526:1  OK
//             byte 45 -> 4.480:1  rompe AA
// 30 es el mínimo de los dos, así que un solo número cubre los dos temas.
// Cuesta un 30% del brillo DENTRO de la burbuja, donde el campo debe ser
// invisible de todas formas; fuera de las burbujas no cambia nada.
//
// CÓMO SE ACOTA, y lo que NO funciona:
//  - Capar el alfa por partícula no acota nada: dos capadas que se solapan dan
//    1-(1-a)^2 = 0.315, o sea 2.61:1.
//  - 'lighten' tampoco. En los modos de mezcla separables el color toma el máximo
//    pero el canal alfa sigue acumulando (ao = as + ab(1-as)), y sobre el negro de
//    la página el ojo ve color x alfa. Medido: 76/255 a densidad 1400 -> 2.78:1.
//  - Lo que SÍ: las partículas que caen sobre una burbuja se pintan en una capa
//    aparte, y la capa ENTERA se compone con globalAlpha = techo. Sea cual sea su
//    alfa interno, la contribución final queda multiplicada por el techo.
//    Medido clavado en 44/255 con 900, 1400 y 2000 partículas, 60 fps.

const TECHO = 30 / 255;

// Reparto por capas. La profundidad sale de tamaño, alfa y velocidad; nunca de
// degradados de color. Solo el 3% de delante lleva halo, y al 10% del alfa del
// núcleo: es lo que hace que el ojo lea estrella en vez de punto.
type Capa = { peso: number; r: [number, number]; a: [number, number]; v: number; halo: number };
const CAPAS: Capa[] = [
  { peso: 0.52, r: [0.45, 0.9], a: [0.16, 0.34], v: 0.7, halo: 0 },
  { peso: 0.30, r: [0.9, 1.5], a: [0.28, 0.52], v: 1.4, halo: 0 },
  { peso: 0.15, r: [1.5, 2.4], a: [0.44, 0.80], v: 2.4, halo: 0 },
  { peso: 0.03, r: [2.2, 3.4], a: [0.62, 0.95], v: 3.6, halo: 3.4 },
];

type Part = {
  x: number; y: number; r: number; halo: number; a0: number;
  vx: number; vy: number; fase: number; hz: number; az: boolean;
};
type Caja = { x0: number; y0: number; x1: number; y1: number };

// Siembra determinista: dos cargas dan el mismo cielo. Con Math.random no se
// pueden comparar dos capturas ni reproducir un informe de bug.
const prng = (semilla: number) => {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const claro = () => {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'paper') return true;
  if (t === 'auto') return window.matchMedia('(prefers-color-scheme: light)').matches;
  return false;
};

// La tinta del campo, por tema. En papel NO se apaga: se invierte.
//
// Antes `pintar()` hacía `if (claro()) return`, con el motivo «sobre #F2F2F2 el
// espacio no existe». Es verdad como metáfora y falso como pantalla: lo que
// queda es un vacío plano justo donde el tema oscuro tiene textura. El rediseño
// del chat pide el campo en los dos temas, «puntos oscuros y azules a las mismas
// opacidades sobre crema», y el techo de contraste de arriba ya está medido para
// ese caso. Los azules son los --ac de cada tema (theme-css.ts:17 y :7), no dos
// azules inventados aquí.
// `k` es el factor de alfa del tema. NO es un ajuste a ojo: «las mismas
// opacidades» del handoff describe una maqueta de 46 puntos en degradados CSS,
// y aqui hay 900 particulas en un canvas. A igual alfa, tinta oscura sobre
// crema pesa MAS que tinta clara sobre negro, y la diferencia se mide.
//
// Metrica: |L(punto compuesto) - L(fondo)| en luminancia WCAG, promediada sobre
// los alfa reales de las cuatro CAPAS de abajo y ponderada por su peso.
//     oscuro (blanco sobre #000)   0.14080
//     papel  (negro sobre #F2F2F2) 0.53843  -> 3.82x mas pesado
// Con k=0.21 el papel queda en 0.1393, o sea el mismo peso visual que el tema
// oscuro. Sin esto los puntos no se leen como estrellas sino como suciedad.
type Tinta = { base: string; az: string; k: number };
const OSCURO: Tinta = { base: '255,255,255', az: '10,132,255', k: 1 };
const PAPEL: Tinta = { base: '0,0,0', az: '10,90,214', k: 0.21 };

export type OpcionesCampo = {
  /** Cuántas partículas. 900 llena una columna de chat sin pesar. */
  densidad?: number;
  /** Devuelve los elementos cuyo texto hay que proteger. Se vuelve a llamar en cada medición. */
  protegidos?: () => Element[];
};

export type Campo = {
  destruir(): void;
  remedir(): void;
  densidad(n: number): number;
  pausado(): boolean;
};

/**
 * Monta el campo dentro de `host`. `host` recibe position:relative si no la tiene;
 * el canvas queda de primer hijo con z-index 0, así que el contenido debe ir en
 * elementos con position:relative para quedar encima.
 */
export function montarCampo(host: HTMLElement, opts: OpcionesCampo = {}): Campo {
  const lienzo = document.createElement('canvas');
  lienzo.setAttribute(
    'style',
    'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0',
  );
  lienzo.setAttribute('aria-hidden', 'true');
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.prepend(lienzo);

  const off = document.createElement('canvas');
  let ctx: CanvasRenderingContext2D | null = null;
  let octx: CanvasRenderingContext2D | null = null;
  let w = 0, h = 0, dpr = 1;
  let parts: Part[] = [];
  let zonas: Caja[] | null = null;
  let raf = 0, ultimo = 0, t = 0;
  let pausado = true, visible = true;
  let aforo = Math.max(0, Math.round(opts.densidad ?? 900));

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let quieto = reduce.matches;

  const sembrar = () => {
    const rnd = prng(20260821);
    const out: Part[] = [];
    let i = 0;
    for (const c of CAPAS) {
      const n = Math.round(aforo * c.peso);
      for (let k = 0; k < n; k++, i++) {
        out.push({
          x: rnd() * w, y: rnd() * h,
          r: c.r[0] + rnd() * (c.r[1] - c.r[0]),
          halo: c.halo,
          a0: c.a[0] + rnd() * (c.a[1] - c.a[0]),
          vx: (0.06 + rnd() * 0.1) * c.v,
          vy: (-0.03 - rnd() * 0.05) * c.v,
          // el centelleo va por índice: determinista y nunca en fase
          fase: ((i % 97) / 97) * Math.PI * 2,
          hz: 0.18 + (i % 13) * 0.021,
          az: i % 9 === 4,   // una de cada nueve toma el azul de la casa
        });
      }
    }
    parts = out;
  };

  // Las cajas se guardan SIN inflar: el margen no puede ser una constante porque
  // depende del alcance de dibujo de cada partícula, y las de delante llevan halo
  // de r*3.4, hasta 11.6px.
  const remedir = () => {
    const rc = lienzo.getBoundingClientRect();
    if (!rc.width) { zonas = null; return; }
    const cajas: Caja[] = [];
    for (const el of opts.protegidos?.() ?? []) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      cajas.push({
        x0: r.left - rc.left, y0: r.top - rc.top,
        x1: r.right - rc.left, y1: r.bottom - rc.top,
      });
    }
    zonas = cajas.length ? cajas : null;
  };

  // Falla CERRADA: si aún no se han medido las burbujas, se capa todo. Cuando no
  // se sabe dónde está el texto, la respuesta conservadora es la única correcta.
  const enZona = (p: Part) => {
    if (!zonas) return true;
    const d = (p.halo ? p.r * p.halo : p.r) + 1;
    for (let i = 0; i < zonas.length; i++) {
      const z = zonas[i];
      if (p.x > z.x0 - d && p.x < z.x1 + d && p.y > z.y0 - d && p.y < z.y1 + d) return true;
    }
    return false;
  };

  const bbox = () => {
    if (!zonas || !zonas.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const z of zonas) {
      if (z.x0 < x0) x0 = z.x0;
      if (z.y0 < y0) y0 = z.y0;
      if (z.x1 > x1) x1 = z.x1;
      if (z.y1 > y1) y1 = z.y1;
    }
    const m = 14;
    return {
      x: Math.max(0, x0 - m), y: Math.max(0, y0 - m),
      w: Math.min(w, x1 + m) - Math.max(0, x0 - m),
      h: Math.min(h, y1 + m) - Math.max(0, y0 - m),
    };
  };

  const dimensionar = () => {
    const r = lienzo.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(r.width * dpr), bh = Math.round(r.height * dpr);
    if (lienzo.width !== bw || lienzo.height !== bh) {
      lienzo.width = bw; lienzo.height = bh;
      off.width = bw; off.height = bh;
      ctx = lienzo.getContext('2d');
      octx = off.getContext('2d');
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = r.width; h = r.height;
      sembrar();
    }
    remedir();
    return true;
  };

  // La tinta se lee UNA vez por fotograma, en pintar(), y se pasa aquí. Leer
  // data-theme por partícula son 900 lecturas del DOM por cuadro.
  const tinta = (cx: CanvasRenderingContext2D, p: Part, a0: number, t: Tinta) => {
    const c = p.az ? t.az : t.base;
    const a = a0 * t.k;
    if (p.halo && a > 0.06) {
      cx.beginPath();
      cx.arc(p.x, p.y, p.r * p.halo, 0, 6.283185307179586);
      cx.fillStyle = `rgba(${c},${(a * 0.1).toFixed(4)})`;
      cx.fill();
    }
    cx.beginPath();
    cx.arc(p.x, p.y, p.r, 0, 6.283185307179586);
    cx.fillStyle = `rgba(${c},${a.toFixed(4)})`;
    cx.fill();
  };

  const pintar = () => {
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const k = claro() ? PAPEL : OSCURO;
    const dentro: [Part, number][] = [], fuera: [Part, number][] = [];
    for (const p of parts) {
      let a = p.a0;
      if (!quieto) a *= 0.72 + 0.28 * Math.sin(t * p.hz + p.fase);
      if (a <= 0.004) continue;
      // a la capa van normalizadas: un valor natural de 0.35 llega a 1 y la capa
      // lo devuelve al techo al componerse. Sin esto quedarían casi invisibles.
      if (enZona(p)) dentro.push([p, Math.min(1, a / 0.35)]);
      else fuera.push([p, a]);
    }
    for (const [p, a] of fuera) tinta(ctx, p, a, k);
    if (dentro.length && octx) {
      const bb = bbox();
      if (bb && bb.w > 0 && bb.h > 0) {
        octx.clearRect(bb.x, bb.y, bb.w, bb.h);
        for (const [p, a] of dentro) tinta(octx, p, a, k);
        ctx.save();
        ctx.globalAlpha = TECHO;
        ctx.drawImage(
          off,
          Math.floor(bb.x * dpr), Math.floor(bb.y * dpr),
          Math.ceil(bb.w * dpr), Math.ceil(bb.h * dpr),
          Math.floor(bb.x), Math.floor(bb.y), Math.ceil(bb.w), Math.ceil(bb.h),
        );
        ctx.restore();
      }
    }
  };

  const paso = (ms: number) => {
    raf = 0;
    if (pausado) return;
    const dt = ultimo ? Math.min(48, ms - ultimo) : 16;
    ultimo = ms;
    t += dt / 1000;
    for (const p of parts) {
      p.x += (p.vx * dt) / 16;
      p.y += (p.vy * dt) / 16;
      if (p.x > w + 4) p.x = -4;
      if (p.x < -4) p.x = w + 4;
      if (p.y < -4) p.y = h + 4;
      if (p.y > h + 4) p.y = -4;
    }
    pintar();
    raf = requestAnimationFrame(paso);
  };

  const parar = () => {
    pausado = true;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  const arrancar = () => {
    if (quieto || !visible || document.hidden) return parar();
    if (pausado) { pausado = false; ultimo = 0; raf = requestAnimationFrame(paso); }
  };

  const onVis = () => (document.hidden ? parar() : arrancar());
  const onRes = () => { if (dimensionar()) pintar(); };
  const onMq = () => { quieto = reduce.matches; if (quieto) { parar(); pintar(); } else arrancar(); };

  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('resize', onRes);
  reduce.addEventListener('change', onMq);

  // El tema se cambia poniendo data-theme en <html>: hay que reaccionar.
  const moTema = new MutationObserver(() => {
    arrancar();
    pintar();   // repinta ya, sin esperar al siguiente cuadro: la tinta cambió
  });
  moTema.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Las burbujas del chat se añaden en tiempo de ejecución (chat-client hace
  // hilo.append), así que las zonas se vuelven a medir cuando el hilo cambia.
  // Sin esto, un mensaje nuevo queda sin proteger.
  let pend = 0;
  const rehacer = () => {
    if (pend) return;
    pend = requestAnimationFrame(() => { pend = 0; remedir(); pintar(); });
  };
  const moHilo = new MutationObserver(rehacer);
  const ro = new ResizeObserver(rehacer);
  moHilo.observe(host, { childList: true, subtree: true });
  ro.observe(host);

  let io: IntersectionObserver | null = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((e) => {
      visible = e.some((x) => x.isIntersecting);
      if (visible) arrancar(); else parar();
    }, { threshold: 0 });
    io.observe(lienzo);
  }

  requestAnimationFrame(() => {
    if (dimensionar()) { pintar(); if (!quieto) arrancar(); }
  });

  return {
    destruir() {
      parar();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onRes);
      reduce.removeEventListener('change', onMq);
      moTema.disconnect(); moHilo.disconnect(); ro.disconnect(); io?.disconnect();
      lienzo.remove();
    },
    remedir() { remedir(); pintar(); },
    densidad(n: number) {
      aforo = Math.max(0, Math.round(n));
      sembrar(); pintar();
      return parts.length;
    },
    pausado() { return pausado; },
  };
}
