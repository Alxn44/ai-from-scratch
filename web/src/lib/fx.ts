// Animaciones de resultado. Todo respeta prefers-reduced-motion: sin movimiento
// el usuario ve el mismo cambio de color, solo sin recorrido.
//
// Una sola ruta de código, a propósito. Antes había GSAP con un fallback a Web
// Animations, y el fallback se perdía el pulso del borde: dos animaciones
// distintas según lo que hubiera cargado. WAA para la tarjeta y canvas para las
// partículas están en todos los navegadores que soportamos, así que no hace
// falta la bifurcación ni la dependencia.
//
// Las chispas salen del PUNTO DE LA ACCIÓN (el botón que se pulsó), no del borde
// de abajo de la tarjeta. Antes eran 14 <span> saliendo de bottom:8px con dos
// tweens lineales: da igual cuánto se afine, si el origen no es donde el usuario
// tocó, el movimiento no significa nada.

const quieto = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Los colores salen de los tokens, no cableados. En papel --ok es #0C6B3E y --l1
// es casi negro: con verde claro y blanco fijos las chispas desaparecían sobre
// blanco. Se leen al disparar, así que siguen al tema vigente.
const tok = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#30D158';
const rgb = (css: string) => {
  const d = document.createElement('span');
  d.style.color = css; document.body.append(d);
  const m = getComputedStyle(d).color.match(/[\d.]+/g);
  d.remove();
  return m ? [Number(m[0]), Number(m[1]), Number(m[2])] as const : [48, 209, 88] as const;
};

// x(t) = A · e^(-t/tau) · sin(2π f t). Un temblor sin envolvente se lee como una
// máquina; con envolvente se lee como un golpe.
function golpe(amp: number, hz: number, tau: number, ms: number, pasos = 22) {
  const k: Keyframe[] = [];
  for (let i = 0; i <= pasos; i++) {
    const t = (i / pasos) * (ms / 1000);
    const x = amp * Math.exp(-t / tau) * Math.sin(2 * Math.PI * hz * t);
    k.push({ transform: `translateX(${x.toFixed(2)}px)` });
  }
  k[k.length - 1] = { transform: 'translateX(0px)' };
  return k;
}

/** Acierto: el borde salta a verde, la tarjeta respira y suben chispas. */
export function exito(card: HTMLElement, origen?: Element | null) {
  card.style.borderColor = 'var(--ok)';
  if (quieto()) return;
  card.animate(
    [{ transform: 'scale(.994)' }, { transform: 'scale(1.004)' }, { transform: 'scale(1)' }],
    { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' },
  );
  const [r, g, bl] = rgb(tok('--ok'));
  card.animate(
    [{ boxShadow: `0 0 0 0 rgba(${r},${g},${bl},.45)` }, { boxShadow: `0 0 0 15px rgba(${r},${g},${bl},0)` }],
    { duration: 760, easing: 'cubic-bezier(.22,1,.36,1)' },
  );
  chispas(card, origen, 'ok');
}

/** Fallo: temblor corto y pulso rojo. Nada de bloquear ni castigar. */
export function fallo(card: HTMLElement) {
  card.style.borderColor = 'var(--rd)';
  if (quieto()) return;
  card.animate(golpe(8, 11, 0.11, 430), { duration: 430, easing: 'linear' });
  const [r, g, bl] = rgb(tok('--rd'));
  card.animate(
    [{ boxShadow: `0 0 0 0 rgba(${r},${g},${bl},.4)` }, { boxShadow: `0 0 0 13px rgba(${r},${g},${bl},0)` }],
    { duration: 600, easing: 'cubic-bezier(.22,1,.36,1)' },
  );
}

type Chispa = {
  x: number; y: number; vx: number; vy: number;
  r: number; vida: number; t: number; giro: number; vg: number; cuadro: boolean; blanca: boolean;
};

const G = 1100;    // px/s², caída
const ROCE = 1.9;  // 1/s, el aire frena; sin esto las chispas salen disparadas y planas

// La capa NO se monta en la tarjeta. Medido: con el lienzo pegado a la tarjeta el
// estallido moría a los 300 ms porque el botón está a ~20 px del borde de abajo y
// overflow lo recortaba. Va fija sobre el viewport, en una región acotada
// alrededor del punto del clic: sin recorte y sin un búfer de pantalla completa.
const ANCHO = 460, ALTO = 400, BASE = 0.78;   // el origen al 78% de la altura

function chispas(card: HTMLElement, origen: Element | null | undefined, tono: 'ok') {
  const ref = (origen ?? card).getBoundingClientRect();
  if (!ref.width) return;
  const px = ref.left + ref.width / 2;
  const py = ref.top + ref.height * 0.3;

  const c = document.createElement('canvas');
  c.dataset.fx = tono;
  c.setAttribute('style', `position:fixed;left:${Math.round(px - ANCHO / 2)}px;top:${Math.round(py - ALTO * BASE)}px;`
    + `width:${ANCHO}px;height:${ALTO}px;pointer-events:none;z-index:60`);
  c.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = ANCHO * dpr; c.height = ALTO * dpr;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  document.body.append(c);

  const ox = ANCHO / 2, oy = ALTO * BASE;
  const [cr, cg, cb] = rgb(tok('--ok'));
  const acento = `rgb(${cr},${cg},${cb})`;
  const contra = tok('--l1') || '#fff';   // blanco en oscuro, casi negro en papel

  const ps: Chispa[] = [];
  for (let i = 0; i < 26; i++) {
    // cono hacia arriba: -155° a -25°. Repartido, no aleatorio puro, para que no
    // se apelotonen en un lado.
    const a = (-155 + (i / 25) * 130 + (Math.random() - 0.5) * 14) * (Math.PI / 180);
    const v = 260 + Math.random() * 330;
    ps.push({
      x: ox + (Math.random() - 0.5) * 10, y: oy + (Math.random() - 0.5) * 6,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      r: 1.7 + Math.random() * 2.6,
      vida: 0.62 + Math.random() * 0.46, t: 0,
      giro: Math.random() * 6.283, vg: (Math.random() - 0.5) * 14,
      cuadro: i % 3 === 0, blanca: i % 5 === 0,
    });
  }

  // un solo anillo. Varios se leen como plantilla; uno se lee como impacto.
  const anillo = { t: 0, vida: 0.5 };
  let raf = 0, prev = 0;

  const paso = (ms: number) => {
    const dt = prev ? Math.min(0.048, (ms - prev) / 1000) : 0.016;
    prev = ms;
    ctx.clearRect(0, 0, ANCHO, ALTO);
    const f = Math.exp(-ROCE * dt);
    let vivas = 0;

    if (anillo.t < anillo.vida) {
      anillo.t += dt;
      const u = anillo.t / anillo.vida;
      ctx.beginPath();
      ctx.arc(ox, oy, 6 + u * 46, 0, 6.283185307179586);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${((1 - u) * 0.5).toFixed(3)})`;
      ctx.lineWidth = 1.4 * (1 - u * 0.6);
      ctx.stroke();
      vivas++;
    }

    for (const p of ps) {
      p.t += dt;
      if (p.t >= p.vida) continue;
      vivas++;
      p.vx *= f;
      p.vy = p.vy * f + G * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.giro += p.vg * dt;
      const u = p.t / p.vida;
      const a = u < 0.12 ? u / 0.12 : Math.pow(1 - (u - 0.12) / 0.88, 1.6);
      const r = p.r * (1 - u * 0.55);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, a)) * 0.92;
      ctx.fillStyle = p.blanca ? contra : acento;
      if (p.cuadro) {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.giro);
        ctx.fillRect(-r, -r * 0.7, r * 2, r * 1.4);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, 6.283185307179586);
        ctx.fill();
      }
      ctx.restore();
    }

    if (!vivas || document.hidden) { c.remove(); raf = 0; return; }
    raf = requestAnimationFrame(paso);
  };
  raf = requestAnimationFrame(paso);
  // red de seguridad: si la pestaña se va y vuelve, nada queda pintado encima
  setTimeout(() => { if (raf) cancelAnimationFrame(raf); c.remove(); }, 2000);
}
