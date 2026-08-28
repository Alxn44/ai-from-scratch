// First visit to /panel with zero labs: Trazo walks the three pieces of the
// course in, one by one, and you can click him or the cards. Cookie so it
// never plays twice on this device. Reduced motion: static cards, no walk.
import { gsap } from 'gsap';
import { cookies } from './prefs';
import { montarActor, trazoCSS, trazoGlow, trazoMira, trazoQuieto } from './trazo';

export const COOKIE_TOUR = 'trazo_tour';
const MAX_AGE = 60 * 60 * 24 * 365;

export function tourHecho(request: Request): boolean {
  return cookies(request)[COOKIE_TOUR] === '1';
}

export function writeTourHecho(): void {
  document.cookie = `${COOKIE_TOUR}=1; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
}

export type TourCopy = {
  aria: string;
  skip: string;
  next: string;
  hola: string;
  holaB: string;
  pasos: { k: string; t: string; b: string; href: string }[];
  listo: string;
  ir: string;
};

type Paso = TourCopy['pasos'][number];

function shader(canvas: HTMLCanvasElement, spot: () => { x: number; y: number }): () => void {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false });
  if (!gl) return () => {};
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, `attribute vec2 a; void main(){ gl_Position=vec4(a,0,1); }`);
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, `precision mediump float;
uniform float u_t; uniform vec2 u_res; uniform vec2 u_spot;
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float d = distance(uv, u_spot);
  float spot = smoothstep(.72, .05, d);
  float floor = smoothstep(.18, .0, uv.y) * .35;
  float g = fract(sin(dot(uv * vec2(210.0, 170.0) + u_t * 4.0, vec2(12.9898,78.233))) * 43758.5453);
  vec3 blue = vec3(0.12, 0.28, 0.92);
  vec3 ink = vec3(0.04, 0.045, 0.07);
  vec3 col = mix(ink, blue, spot * .55 + floor);
  float a = 0.92 + g * 0.04;
  gl_FragColor = vec4(col, a);
}`);
  gl.compileShader(fs);
  const p = gl.createProgram()!;
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return () => {};
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(p);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const uT = gl.getUniformLocation(p, 'u_t');
  const uR = gl.getUniformLocation(p, 'u_res');
  const uS = gl.getUniformLocation(p, 'u_spot');
  let raf = 0, live = true, t0 = performance.now();
  const draw = (now: number) => {
    if (!live) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    const s = spot();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uT, (now - t0) / 1000);
    gl.uniform2f(uR, w, h);
    gl.uniform2f(uS, s.x / Math.max(1, w), 1 - s.y / Math.max(1, h));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => { live = false; cancelAnimationFrame(raf); };
}

function carta(paso: Paso): HTMLElement {
  const el = document.createElement('a');
  el.href = paso.href;
  el.className = 'card tour-drop';
  el.setAttribute('style', 'display:flex;flex-direction:column;gap:8px;width:min(280px,72vw);padding:16px 18px;text-decoration:none;color:var(--l1)');
  const k = document.createElement('p');
  k.className = 'eb';
  k.style.color = 'var(--ac)';
  k.textContent = paso.k;
  const t = document.createElement('div');
  t.className = 'h3';
  t.textContent = paso.t;
  const b = document.createElement('p');
  b.className = 's';
  b.style.color = 'var(--l2)';
  b.textContent = paso.b;
  el.append(k, t, b);
  return el;
}

export function abrirTour(copy: TourCopy, nombre: string): () => void {
  if (document.getElementById('trazo-tour')) return () => {};
  trazoCSS();
  const quieto = trazoQuieto();
  const root = document.createElement('div');
  root.id = 'trazo-tour';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', copy.aria);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const ui = document.createElement('div');
  ui.className = 'tour-ui';
  const h = document.createElement('h2');
  h.className = 'h1';
  h.style.fontSize = '34px';
  h.textContent = copy.hola.replace('{n}', nombre);
  const p = document.createElement('p');
  p.className = 'p';
  p.textContent = copy.holaB;
  const row = document.createElement('div');
  row.setAttribute('style', 'display:flex;gap:10px;flex-wrap:wrap;align-items:center');
  const next = document.createElement('button');
  next.className = 'tour-next';
  next.type = 'button';
  next.textContent = copy.next;
  const skip = document.createElement('button');
  skip.className = 'tour-skip';
  skip.type = 'button';
  skip.textContent = copy.skip;
  row.append(next);
  ui.append(h, p, row);
  root.append(canvas, skip, ui);
  document.body.append(root);
  document.documentElement.style.overflow = 'hidden';

  const size = Math.min(128, Math.round(window.innerWidth * 0.22));
  const cat = montarActor(size, 'anda');
  cat.style.zIndex = '201';
  cat.style.pointerEvents = 'auto';
  cat.style.cursor = 'pointer';
  cat.setAttribute('tabindex', '0');
  cat.setAttribute('role', 'button');
  cat.setAttribute('aria-label', copy.next);
  const stopMira = trazoMira(cat, true);
  const stopGlow = trazoGlow(cat, () => {
    const r = cat.getBoundingClientRect();
    return { x: r.left + r.width * 0.4, y: r.bottom - 6 };
  });
  const stopFloor = shader(canvas, () => {
    const r = cat.getBoundingClientRect();
    return { x: r.left + r.width * 0.4, y: r.bottom - 10 };
  });

  const gs = (window as any).gsap ?? gsap;
  gs.set(cat, { x: -size - 40, y: window.innerHeight - size - 18 });
  const hold = cat.querySelector('.trazo-hold') as HTMLElement;
  let i = 0;
  const dropped: HTMLElement[] = [];
  let live = true;

  const cierra = () => {
    if (!live) return;
    live = false;
    writeTourHecho();
    document.documentElement.style.overflow = '';
    stopMira(); stopGlow(); stopFloor();
    gs.to(root, { opacity: 0, duration: quieto ? 0 : 0.35, onComplete: () => { root.remove(); cat.remove(); } });
    if (quieto) { root.remove(); cat.remove(); }
  };

  const suelta = (paso: Paso, n: number) => {
    const card = carta(paso);
    hold.append(card);
    gs.set(hold, { scale: 0.55, x: 12, y: 6, rotation: -10 });
    const narrow = window.innerWidth < 720;
    const gap = narrow ? 0 : Math.min(248, window.innerWidth * 0.26);
    const x = narrow
      ? Math.max(16, (window.innerWidth - Math.min(280, window.innerWidth - 32)) / 2)
      : Math.max(24, (window.innerWidth - copy.pasos.length * gap) / 2) + n * gap;
    const y = narrow
      ? Math.max(168, window.innerHeight * 0.36) + n * 92
      : Math.max(200, window.innerHeight * 0.42);
    const tl = gs.timeline();
    tl.to(cat, { x: Math.min(x + 70, window.innerWidth - size - 24), duration: quieto ? 0 : 0.85, ease: 'power2.out' }, 0)
      .to(hold, { scale: 1, x: 0, y: -16, rotation: 0, duration: quieto ? 0 : 0.32, ease: 'back.out(1.7)' }, 0.55)
      .add(() => {
        root.append(card);
        dropped.push(card);
        gs.set(card, { left: x, top: y });
        gs.fromTo(card, { y: 18, opacity: 0.4 }, { y: 0, opacity: 1, duration: quieto ? 0 : 0.35, ease: 'power3.out' });
        hold.innerHTML = '';
      });
    return tl;
  };

  const habla = (paso: Paso | null, fin = false) => {
    h.textContent = fin ? copy.listo : (paso ? paso.t : copy.hola.replace('{n}', nombre));
    p.textContent = fin ? copy.holaB : (paso ? paso.b : copy.holaB);
    next.textContent = fin ? copy.ir : copy.next;
  };

  const adelante = () => {
    if (!live) return;
    if (i < copy.pasos.length) {
      const paso = copy.pasos[i];
      habla(paso);
      suelta(paso, i);
      i += 1;
      if (i === copy.pasos.length) {
        cat.classList.remove('trazo-anda');
        next.textContent = copy.ir;
      }
      return;
    }
    location.assign(copy.pasos[0]?.href ?? '/leccion/1');
    cierra();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') salir();
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); adelante(); }
  };
  const salir = () => { window.removeEventListener('keydown', onKey); cierra(); };
  skip.addEventListener('click', salir);
  next.addEventListener('click', adelante);
  cat.addEventListener('click', adelante);
  cat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); adelante(); }
  });
  window.addEventListener('keydown', onKey);
  gs.to(cat, { x: 36, duration: quieto ? 0 : 0.9, ease: 'power2.out', onComplete: () => adelante() });
  return salir;
}
