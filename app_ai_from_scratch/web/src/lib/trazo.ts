// Trazo on stage. The still SVG in the AI panel stays still on purpose
// (cat.ts): a mascot that fidgets while you read competes with the lesson.
// This module is the opposite moment — he WALKS IN CARRYING the thing.
// Toasts, unlock cards and the first-visit tour all go through here so
// the gait, the hold point and the look-at-pointer are one implementation.
import { gsap } from 'gsap';
import { gato, gatoCSS } from './cat';

const ID = 'trazo';
const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export type Entrega = {
  cargo: HTMLElement;
  dest?: HTMLElement | null;
  holdMs?: number;
  size?: number;
};

let cola: Promise<void> = Promise.resolve();
let cssOn = false;

function css() {
  if (cssOn) return;
  cssOn = true;
  const s = document.createElement('style');
  s.id = 'trazo-css-stage';
  s.textContent = gatoCSS(ID) + `
#trazo-actor{position:fixed;left:0;top:0;z-index:120;pointer-events:none;will-change:transform}
#trazo-actor .trazo-cuerpo{position:relative;filter:drop-shadow(0 10px 14px rgba(0,0,0,.35))}
#trazo-actor .trazo-hold{position:absolute;left:6%;top:-8%;transform-origin:left bottom;pointer-events:none}
#trazo-actor .trazo-hold > *{box-shadow:0 8px 22px rgba(0,0,0,.28)}
#trazo-glow{position:absolute;left:50%;bottom:4%;width:160%;height:70%;transform:translate(-50%,0);pointer-events:none}
#trazo-tour{position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;justify-content:flex-start;background:rgba(8,10,18,.88)}
#trazo-tour canvas{position:absolute;inset:0;width:100%;height:100%}
#trazo-tour .tour-ui{position:relative;z-index:1;display:flex;flex-direction:column;gap:14px;align-items:center;text-align:center;
  padding:64px 28px 0;max-width:560px;margin:0 auto;pointer-events:none;color:#F4F6FB}
#trazo-tour .tour-ui > *{pointer-events:auto}
#trazo-tour .tour-ui .p,#trazo-tour .tour-ui .s{color:rgba(244,246,251,.78)}
#trazo-tour .tour-skip,#trazo-tour .tour-next{min-height:44px;height:auto;padding:12px 14px;border:1px solid rgba(255,255,255,.28);
  background:transparent;color:#F4F6FB;font:600 10px/1 var(--m);letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
#trazo-tour .tour-next{background:#3355FF;border-color:#3355FF;color:#fff}
#trazo-tour .tour-skip{position:absolute;top:calc(12px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right));z-index:3;background:rgba(8,10,18,.72)}
@media (max-width:720px){
  #trazo-tour .tour-ui{padding:72px 18px 0}
  #trazo-tour .tour-ui .h1{font-size:26px!important}
  #trazo-tour .tour-drop{width:min(280px,calc(100vw - 32px))!important}
}
#trazo-tour .tour-skip:hover{color:#fff}
#trazo-tour .tour-drop{position:absolute;z-index:2;pointer-events:auto;cursor:pointer}
@media (prefers-reduced-motion: reduce){
  #trazo-actor .trazo-cuerpo{filter:none}
}`;
  document.head.append(s);
}

function g() {
  const G = (window as any).gsap ?? gsap;
  return G as typeof gsap;
}

/** Tiny WebGL spotlight that follows Trazo's feet. Falls back to nothing. */
function glow(host: HTMLElement, follow: () => { x: number; y: number }): () => void {
  const c = document.createElement('canvas');
  c.id = 'trazo-glow';
  c.setAttribute('aria-hidden', 'true');
  host.prepend(c);
  const gl = c.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true });
  if (!gl) { c.remove(); return () => {}; }
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, `attribute vec2 a; void main(){ gl_Position = vec4(a,0,1); }`);
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, `precision mediump float;
uniform float u_t; uniform vec2 u_res; uniform vec2 u_spot;
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float d = distance(uv, u_spot);
  float spot = smoothstep(.55, .0, d);
  float g = fract(sin(dot(uv * 140.0 + u_t, vec2(12.9898,78.233))) * 43758.5453);
  float a = spot * .42 + g * .05 * spot;
  gl_FragColor = vec4(0.18, 0.32, 0.95, a);
}`);
  gl.compileShader(fs);
  const p = gl.createProgram()!;
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { c.remove(); return () => {}; }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
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
    const w = host.clientWidth || 160, h = host.clientHeight || 120;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; gl.viewport(0, 0, w, h); }
    const f = follow();
    const r = host.getBoundingClientRect();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uT, (now - t0) / 1000);
    gl.uniform2f(uR, w, h);
    gl.uniform2f(uS, (f.x - r.left) / Math.max(1, r.width), 1 - (f.y - r.top) / Math.max(1, r.height));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => { live = false; cancelAnimationFrame(raf); c.remove(); };
}

function actor(size: number, pose: 'carga' | 'saluda' | 'sentado' = 'carga'): HTMLElement {
  css();
  const el = document.createElement('div');
  el.id = 'trazo-actor';
  el.className = pose === 'carga' ? 'trazo-anda' : '';
  el.setAttribute('aria-hidden', 'true');
  const cuerpo = document.createElement('div');
  cuerpo.className = 'trazo-cuerpo';
  cuerpo.innerHTML = gato(size, pose, ID);
  const hold = document.createElement('div');
  hold.className = 'trazo-hold';
  el.append(cuerpo, hold);
  document.body.append(el);
  return el;
}

function mira(el: HTMLElement, on: boolean): () => void {
  const cabeza = el.querySelector<HTMLElement>(`.${ID}-cabeza`);
  if (!cabeza || !on || reduce()) return () => {};
  const go = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width * 0.36, cy = r.top + r.height * 0.36;
    const dx = (e.clientX - cx) / 40, dy = (e.clientY - cy) / 60;
    cabeza.style.transform = `rotate(${Math.max(-14, Math.min(14, dx))}deg) translateY(${Math.max(-3, Math.min(3, dy))}px)`;
  };
  window.addEventListener('pointermove', go, { passive: true });
  return () => { window.removeEventListener('pointermove', go); cabeza.style.transform = ''; };
}

function pie(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width * 0.42, y: r.bottom - 8 };
}

/**
 * Trazo walks in from the right carrying `cargo`, sets it down in `dest`
 * (or leaves it where he stands), sits, and walks off. One at a time.
 */
export function trazoEntregar(job: Entrega): Promise<void> {
  const run = () => entregarUno(job);
  cola = cola.then(run, run);
  return cola;
}

async function entregarUno(job: Entrega): Promise<void> {
  const dest = job.dest ?? document.getElementById('toasts');
  const size = job.size ?? 112;
  // The tour owns Trazo. A toast that walked in over the tour would be two
  // cats with the same id, so we plant the card and wait.
  // Phone: the walk covers the form. Plant the card and skip the gait.
  if (reduce() || document.getElementById('trazo-tour') || window.innerWidth < 720) {
    dest?.append(job.cargo);
    return;
  }
  const el = actor(size, 'carga');
  const hold = el.querySelector('.trazo-hold') as HTMLElement;
  const cargo = job.cargo;
  cargo.style.width = cargo.style.width || (cargo.classList.contains('toast') ? '280px' : '');
  cargo.style.transformOrigin = 'left bottom';
  hold.append(cargo);
  const stopGlow = glow(el, () => pie(el));
  const stopMira = mira(el, true);
  const gs = g();
  const endX = dest
    ? Math.max(16, window.innerWidth - (dest.getBoundingClientRect().width || 372) - size - 36)
    : window.innerWidth - size - 32;
  const endY = dest
    ? Math.max(8, window.innerHeight - dest.getBoundingClientRect().height - size - 28)
    : window.innerHeight - size - 24;
  gs.set(el, { x: window.innerWidth + 24, y: window.innerHeight - size - 18, rotation: 0 });
  gs.set(hold, { scale: 0.52, y: 8, x: 10, rotation: -8 });
  await gs.to(el, { x: endX, y: endY, duration: 0.92, ease: 'power2.out' });
  el.classList.remove('trazo-anda');
  const svg = el.querySelector('svg');
  if (svg) svg.setAttribute('data-gato', 'saluda');
  await gs.to(hold, { scale: 1, x: size * 0.08, y: -12, rotation: 0, duration: 0.38, ease: 'back.out(1.6)' });
  if (dest) {
    const slot = cargo.getBoundingClientRect();
    dest.append(cargo);
    const to = dest.getBoundingClientRect();
    gs.set(cargo, { x: slot.left - to.left, y: slot.top - to.top });
    await gs.to(cargo, { x: 0, y: 0, duration: 0.42, ease: 'power3.out' });
  }
  await gs.to(el, { y: endY + 6, duration: 0.22, ease: 'sine.inOut', yoyo: true, repeat: 1 });
  if (job.holdMs) await new Promise((r) => setTimeout(r, job.holdMs));
  el.classList.add('trazo-anda');
  await gs.to(el, { x: window.innerWidth + 40, duration: 0.7, ease: 'power2.in' });
  stopGlow(); stopMira(); el.remove();
}

/** Trazo walks in with a speech bubble. Used when a lesson closes. */
export function trazoDice(texto: string, ms = 4200): () => void {
  const globo = document.createElement('div');
  globo.className = 'card';
  globo.setAttribute('style', 'background:var(--bg);max-width:230px;padding:11px 13px;pointer-events:none');
  const p = document.createElement('p');
  p.className = 's';
  p.style.color = 'var(--l1)';
  p.textContent = texto;
  globo.append(p);
  let dead = false;
  void trazoEntregar({ cargo: globo, dest: null, holdMs: Math.max(800, ms - 1800), size: 96 });
  return () => { dead = true; globo.remove(); void dead; };
}

export { actor as montarActor, mira as trazoMira, glow as trazoGlow, css as trazoCSS, reduce as trazoQuieto, g as trazoGsap };
