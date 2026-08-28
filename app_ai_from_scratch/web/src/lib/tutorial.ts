// Tutorial — intro.js-shaped spotlight on the REAL controls, with Trazo
// demonstrating the usage (click, type, toggle). Named "tutorial" on purpose:
// the overlay tour was a welcome; this one teaches how each thing is used.
//
// One page at a time. Cookie `tutorial_v1` is a comma list of page keys so a
// student who already saw the panel still gets the lesson page once.
// Reduced motion: no walk, the hole just appears.
import { gsap } from 'gsap';
import { cookies } from './prefs';
import { montarActor, trazoCSS, trazoGlow, trazoMira, trazoQuieto } from './trazo';

export const COOKIE_TUTORIAL = 'tutorial_v1';
const MAX_AGE = 60 * 60 * 24 * 365;

export type Forma = 'click' | 'type' | 'toggle' | 'mira' | 'lleva';

export type PasoTut = {
  sel: string;
  k: string;
  t: string;
  b: string;
  forma: Forma;
};

export type TutorialCopy = {
  aria: string;
  skip: string;
  next: string;
  done: string;
};

function leido(): Set<string> {
  const m = typeof document === 'undefined' ? null : document.cookie.match(/(?:^|; )tutorial_v1=([^;]*)/);
  if (!m) return new Set();
  try { return new Set(decodeURIComponent(m[1]).split(',').filter(Boolean)); }
  catch { return new Set(); }
}

function escribe(pages: Set<string>): void {
  document.cookie = `${COOKIE_TUTORIAL}=${encodeURIComponent([...pages].join(','))}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
}

export function tutorialHecho(page: string, request?: Request): boolean {
  if (request) {
    const v = cookies(request)[COOKIE_TUTORIAL] ?? '';
    return v.split(',').includes(page);
  }
  return leido().has(page);
}

export function writeTutorialHecho(page: string): void {
  const s = leido();
  s.add(page);
  escribe(s);
}

function css(): void {
  if (document.getElementById('tutorial-css')) return;
  const s = document.createElement('style');
  s.id = 'tutorial-css';
  s.textContent = `
#tutorial-root{position:fixed;inset:0;z-index:210;pointer-events:none}
#tutorial-root .tut-hueco{position:absolute;border:1px solid rgba(255,255,255,.42);border-radius:8px;
  box-shadow:0 0 0 9999px rgba(8,10,18,.82);pointer-events:none;transition:left .28s,top .28s,width .28s,height .28s}
#tutorial-root .tut-ui{position:absolute;z-index:2;pointer-events:auto;width:min(340px,calc(100vw - 32px));
  background:var(--panel);color:var(--l1);border:1px solid var(--hair);
  padding:16px 18px;display:flex;flex-direction:column;gap:10px}
#tutorial-root .tut-ui .eb{color:var(--ac)}
#tutorial-root .tut-ui .p,#tutorial-root .tut-ui .s{color:var(--l2)}
#tutorial-root .tut-skip,#tutorial-root .tut-next{min-height:44px;padding:10px 14px;border:1px solid var(--hair);
  background:var(--panel);color:var(--l1);font:600 10px/1 var(--m);letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
#tutorial-root .tut-next{background:var(--ac-solid,#3355FF);border-color:var(--ac-solid,#3355FF);color:#fff}
#tutorial-root .tut-skip{position:fixed;top:calc(12px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right));z-index:3;pointer-events:auto}
#tutorial-root .tut-anillo{position:absolute;border:2px solid #3355FF;border-radius:10px;pointer-events:none}
#tutorial-root .tut-caret{position:absolute;width:2px;height:18px;background:#3355FF;pointer-events:none}
@media (prefers-reduced-motion: reduce){
  #tutorial-root .tut-hueco{transition:none}
}`;
  document.head.append(s);
}

function target(sel: string): HTMLElement | null {
  try { return document.querySelector(sel); }
  catch { return null; }
}

function formaAnim(el: HTMLElement, forma: Forma, ghost: HTMLElement, quieto: boolean): gsap.core.Timeline {
  const r = el.getBoundingClientRect();
  const tl = gsap.timeline();
  ghost.innerHTML = '';
  ghost.style.left = `${r.left}px`;
  ghost.style.top = `${r.top}px`;
  ghost.style.width = `${r.width}px`;
  ghost.style.height = `${r.height}px`;
  if (quieto) return tl;
  if (forma === 'click') {
    for (let i = 0; i < 3; i++) {
      const ring = document.createElement('div');
      ring.className = 'tut-anillo';
      ring.style.inset = '-6px';
      ghost.append(ring);
      tl.fromTo(ring, { scale: 0.86, opacity: 0.9 }, { scale: 1.18, opacity: 0, duration: 0.55, ease: 'power2.out' }, i * 0.18);
    }
  } else if (forma === 'toggle') {
    const knob = document.createElement('div');
    knob.style.cssText = 'position:absolute;width:18px;height:18px;border-radius:9px;background:#3355FF;top:50%;left:8px;transform:translateY(-50%)';
    ghost.append(knob);
    tl.to(knob, { x: Math.max(12, r.width - 34), duration: 0.42, ease: 'power2.inOut' })
      .to(knob, { x: 0, duration: 0.32, ease: 'power2.inOut' }, '+=0.12');
  } else if (forma === 'type') {
    const caret = document.createElement('div');
    caret.className = 'tut-caret';
    caret.style.left = '12px';
    caret.style.top = `${Math.max(8, (r.height - 18) / 2)}px`;
    ghost.append(caret);
    tl.fromTo(caret, { opacity: 1 }, { opacity: 0.15, duration: 0.28, yoyo: true, repeat: 5, ease: 'none' });
  } else {
    tl.fromTo(ghost, { opacity: 0.2 }, { opacity: 0.55, duration: 0.4, yoyo: true, repeat: 1 });
  }
  return tl;
}

declare global {
  interface Window { abrirTutorial?: (page?: string) => void }
}

export function abrirTutorial(page: string, pasos: PasoTut[], copy: TutorialCopy): () => void {
  if (document.getElementById('tutorial-root')) return () => {};
  // Por VISIBILIDAD y no por existencia: querySelector encuentra igual un
  // elemento con display:none, y entonces getBoundingClientRect devuelve ceros y
  // el foco se planta en la esquina 0,0. Le pasaba ya al paso chat-2, cuyo .seg
  // vivia dentro de .app-head-tools{display:none} por debajo de 900 px.
  const vivos = pasos.filter((p) => {
    const el = target(p.sel);
    return !!el && (el as HTMLElement).getClientRects().length > 0;
  });
  if (!vivos.length) { writeTutorialHecho(page); return () => {}; }

  css();
  trazoCSS();
  const quieto = trazoQuieto();
  const root = document.createElement('div');
  root.id = 'tutorial-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', copy.aria);

  const hueco = document.createElement('div');
  hueco.className = 'tut-hueco';
  const ghost = document.createElement('div');
  ghost.style.cssText = 'position:absolute;pointer-events:none;z-index:1';
  const ui = document.createElement('div');
  ui.className = 'tut-ui';
  const k = document.createElement('p');
  k.className = 'eb';
  const h = document.createElement('div');
  h.className = 'h3';
  const p = document.createElement('p');
  p.className = 's';
  const next = document.createElement('button');
  next.className = 'tut-next';
  next.type = 'button';
  next.textContent = copy.next;
  ui.append(k, h, p, next);
  const skip = document.createElement('button');
  skip.className = 'tut-skip';
  skip.type = 'button';
  skip.textContent = copy.skip;
  root.append(hueco, ghost, ui, skip);
  document.body.append(root);
  document.documentElement.style.overflow = 'hidden';

  const size = Math.min(96, Math.round(window.innerWidth * 0.18));
  const cat = montarActor(size, 'carga');
  cat.style.zIndex = '212';
  const stopMira = trazoMira(cat, true);
  const stopGlow = trazoGlow(cat, () => {
    const r = cat.getBoundingClientRect();
    return { x: r.left + r.width * 0.4, y: r.bottom - 6 };
  });
  const gs = (window as any).gsap ?? gsap;
  gs.set(cat, { x: -size - 24, y: window.innerHeight - size - 16 });

  let i = 0;
  let live = true;
  let anim: gsap.core.Timeline | null = null;

  const cierra = () => {
    if (!live) return;
    live = false;
    writeTutorialHecho(page);
    document.documentElement.style.overflow = '';
    anim?.kill();
    stopMira(); stopGlow();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', colocar);
    gs.to(root, { opacity: 0, duration: quieto ? 0 : 0.28, onComplete: () => { root.remove(); cat.remove(); } });
    if (quieto) { root.remove(); cat.remove(); }
  };

  const colocar = () => {
    const paso = vivos[i];
    if (!paso || !live) return;
    const el = target(paso.sel);
    if (!el) { adelante(); return; }
    el.scrollIntoView({ block: 'center', behavior: quieto ? 'auto' : 'smooth' });
    const r = el.getBoundingClientRect();
    const pad = 8;
    hueco.style.left = `${r.left - pad}px`;
    hueco.style.top = `${r.top - pad}px`;
    hueco.style.width = `${r.width + pad * 2}px`;
    hueco.style.height = `${r.height + pad * 2}px`;
    const below = r.bottom + 16 + 180 < window.innerHeight;
    ui.style.left = `${Math.min(Math.max(16, r.left), window.innerWidth - 356)}px`;
    ui.style.top = below ? `${r.bottom + 14}px` : `${Math.max(56, r.top - 170)}px`;
    k.textContent = paso.k;
    h.textContent = paso.t;
    p.textContent = paso.b;
    next.textContent = i === vivos.length - 1 ? copy.done : copy.next;
    const catX = Math.max(8, r.left - size - 8);
    const catY = Math.min(window.innerHeight - size - 12, Math.max(8, r.bottom - size + 8));
    gs.to(cat, { x: catX, y: catY, duration: quieto ? 0 : 0.55, ease: 'power2.out' });
    anim?.kill();
    anim = formaAnim(el, paso.forma, ghost, quieto);
  };

  const adelante = () => {
    if (!live) return;
    if (i < vivos.length - 1) { i += 1; colocar(); return; }
    cierra();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cierra();
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); adelante(); }
  };

  skip.addEventListener('click', cierra);
  next.addEventListener('click', adelante);
  cat.addEventListener('click', adelante);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', colocar);
  colocar();
  return cierra;
}

const FORMAS: Record<string, Forma[]> = {
  panel: ['click', 'mira', 'click', 'toggle'],
  leccion: ['mira', 'mira', 'click', 'click'],
  chat: ['click', 'toggle', 'type'],
  pago: ['click', 'click', 'click'],
};

export function pasosDe(page: string, T: Record<string, string>): PasoTut[] {
  const formas = FORMAS[page] ?? [];
  return formas.map((forma, i) => {
    const n = i + 1;
    return {
      sel: `[data-tut="${page}-${n}"]`,
      k: T[`k${n}`] ?? '',
      t: T[`t${n}`] ?? '',
      b: T[`b${n}`] ?? '',
      forma,
    };
  });
}
