// Shared primitives for the lesson example scenes.
//
// One scene per lesson concept, parameterised by that lesson's own example. The
// twelve scenes are built out of the pieces in this file so they read as one
// design system instead of twelve one-offs.
//
// Five rules live here because the project already paid for each of them:
//
// 1. EVERYDAY UI, NOT DIAGRAMS. The pieces are chat bubbles, chips, sliders,
//    list rows and dials — controls a beginner has already used. Node-and-edge
//    diagrams were rejected as "too technical for beginners", so there is no
//    node, no edge and no arrow-into-box in here.
// 2. TOKENS ONLY. Every colour is a var(--…) from theme-css.ts. A literal hex
//    would be a bug in one of the two themes (dark and paper), which is the
//    classic failure in this codebase. Text on an accent fill uses --on-ac,
//    the token theme-css.ts defines as white in both themes.
// 3. THE SCENE SAYS WHAT THE TEXT SAYS. `stageFrame` puts the example's own
//    `entrada` first and its own `salida` last, verbatim, and the stage between
//    them acts out the step from one to the other. A scene that turns off either
//    row must render that text itself — the two strings always appear somewhere,
//    because the static card rows are hidden once a scene mounts.
// 4. COMPOSITOR PROPERTIES ONLY. transform and opacity. Two scenes play per
//    lesson page; animating width/left in a loop would jank both.
// 5. REDUCED MOTION IS AN END STATE, NOT A BLANK. With motion off, `Timeline`
//    runs every beat immediately in registration order, so the reader gets the
//    finished scene instead of a frozen first frame.
//
// A scene therefore draws in two passes: create every element first (veiled),
// then register the beats. With motion off the beats run during registration, so
// a beat that touches an element created after it would throw.

import type { SceneLabels } from './labels';

export type Example = { titulo: string; entrada: string; salida: string; nota: string };
export type SceneLang = 'es' | 'en';

/** The one input every scene takes. */
export type SceneContext = {
  host: HTMLElement;
  example: Example;
  lang: SceneLang;
  labels: SceneLabels;
};

/** The one handle every scene returns. */
export type SceneHandle = { play: () => void; destroy: () => void };

export type SceneBuilder = (ctx: SceneContext) => SceneHandle;

/** One easing for the whole set, so twelve scenes move like one thing. */
export const EASE = 'cubic-bezier(.22,1,.36,1)';

/** Read per play, not once at import: the reader can change the setting mid-session. */
export const motionAllowed = () =>
  !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

// ---------------------------------------------------------------------------
// elements

/** Text always goes in as textContent: these strings are lesson content, not markup. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (css) node.setAttribute('style', css);
  if (text !== '') node.textContent = text;
  return node;
}

export const col = (gap: number, extra = '') =>
  el('div', `display:flex;flex-direction:column;gap:${gap}px;${extra}`);

export const line = (gap: number, extra = '') =>
  el('div', `display:flex;align-items:center;gap:${gap}px;${extra}`);

/** Section label, same typography as the rest of the app. */
export function lbl(text: string, accent = false): HTMLElement {
  const p = el('p', accent ? 'color:var(--ac)' : '', text);
  p.className = 'lbl';
  return p;
}

/** Decorative pieces are hidden from assistive tech: the words are in the text rows. */
export function decor<T extends HTMLElement>(node: T): T {
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/** Starts invisible but still occupies its space, so revealing it shifts nothing. */
export function veil<T extends HTMLElement>(node: T): T {
  node.style.opacity = '0';
  return node;
}

/**
 * Chat bubble. `who` picks the voice: the reader asking, or the machine answering.
 *
 * The reader's bubble is an accent BORDER on the neutral fill, not a solid accent
 * block. That is the app's own chat page (chat.astro paints `quien === 'yo'` this
 * exact way), and it is also the legible choice: measured, white on --ac in the
 * dark theme is 3.65:1, under AA for 14px body text, while this is over 15:1 in
 * both themes.
 */
export function bubble(text: string, who: 'user' | 'ai'): HTMLElement {
  const skin = who === 'user'
    ? 'background:var(--fill);color:var(--l1);border:1px solid var(--ac)'
    : 'background:var(--fill);color:var(--l1);border:1px solid var(--hair2)';
  return el('p', `margin:0;padding:9px 12px;font:400 14px/1.45 var(--f);${skin}`, text);
}

export function chip(text: string, tone: 'plain' | 'accent' | 'ghost' = 'plain'): HTMLElement {
  const skin = tone === 'accent'
    ? 'border-color:var(--ac);color:var(--l1);background:var(--fill)'
    : tone === 'ghost'
      ? 'border-color:var(--hair2);color:var(--l3)'
      : 'border-color:var(--hair);color:var(--l1)';
  return el('span',
    `display:inline-flex;align-items:center;height:30px;padding:0 10px;border:1px solid var(--hair);`
    + `font:500 14px/1 var(--m);white-space:nowrap;${skin}`, text);
}

/** Big number, tabular so a counting readout does not wobble. */
export function readout(text: string): HTMLElement {
  return el('span',
    'font:700 22px/1 var(--f);letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:var(--l1)', text);
}

/** A 4px meter with a fill that grows by scaleX. Returns both so the caller can drive it. */
export function meter(fillColor = 'var(--ac)'): { root: HTMLElement; fill: HTMLElement } {
  const root = decor(el('div', 'flex:1;min-width:40px;height:4px;background:var(--fill);overflow:hidden'));
  const fill = el('div', `height:4px;background:${fillColor};transform-origin:left;transform:scaleX(0)`);
  root.append(fill);
  return { root, fill };
}

/**
 * A track a marker slides along. The marker rests on a percentage `left`, so a
 * resize keeps it in place; the movement itself is a transform.
 */
export function track(height = 22): { root: HTMLElement; rail: HTMLElement } {
  const root = el('div', `position:relative;flex:1;min-width:60px;height:${height}px`);
  const rail = decor(el('div',
    `position:absolute;left:0;right:0;top:${Math.round(height / 2)}px;height:1px;background:var(--hair)`));
  root.append(rail);
  return { root, rail };
}

/** The slider handle from the app's own range inputs: a thin vertical bar. */
export function knob(accent = false): HTMLElement {
  return decor(el('div',
    `position:absolute;top:2px;width:3px;height:18px;left:0;transform:translateX(-50%);`
    + `background:${accent ? 'var(--ac)' : 'var(--l1)'}`));
}

// ---------------------------------------------------------------------------
// motion

/**
 * Reveals a veiled element. `dy` of 0 animates opacity only — anything already
 * wearing a transform (a knob centred with translateX(-50%), a chip parked at an
 * offset) would jump sideways if the keyframes overwrote it.
 */
export function appear(node: HTMLElement, motion: boolean, dy = 7, ms = 300) {
  node.style.opacity = '1';
  if (!motion) return;
  const frames: Keyframe[] = dy === 0
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }];
  node.animate(frames, { duration: ms, easing: EASE });
}

export function fade(node: HTMLElement, motion: boolean, to: number, ms = 260) {
  const from = node.style.opacity === '' ? '1' : node.style.opacity;
  node.style.opacity = String(to);
  if (!motion) return;
  node.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: EASE });
}

/** Grows a meter fill to `k` (0..1) from wherever it stands. */
export function scaleTo(node: HTMLElement, motion: boolean, k: number, ms = 460) {
  const from = node.style.transform || 'scaleX(0)';
  const to = `scaleX(${k.toFixed(4)})`;
  node.style.transform = to;
  if (!motion) return;
  node.animate([{ transform: from }, { transform: to }], { duration: ms, easing: EASE });
}

/**
 * Moves a marker from fraction `from` to fraction `to` of its track. It lands on
 * a percentage (resize-proof) and travels on a transform (compositor-only); the
 * one layout read is the track width, taken once per beat.
 */
export function slide(marker: HTMLElement, motion: boolean, from: number, to: number, ms = 520) {
  marker.style.left = `${(to * 100).toFixed(2)}%`;
  if (!motion) return;
  const w = marker.parentElement?.clientWidth ?? 0;
  if (!w) return;
  const dx = (from - to) * w;
  marker.animate(
    [{ transform: `translateX(calc(-50% + ${dx.toFixed(1)}px))` }, { transform: 'translateX(-50%)' }],
    { duration: ms, easing: EASE },
  );
}

export function pulse(node: HTMLElement, motion: boolean, ms = 420) {
  if (!motion) return;
  node.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }],
    { duration: ms, easing: EASE },
  );
}

/**
 * A light crossing a panel left to right. translateX percentages are relative to
 * the element's own width, and this overlay is exactly as wide as the panel, so
 * the sweep needs no measurement. Pure decoration: with motion off it is skipped
 * and the end state still tells the whole story.
 */
export function sweep(host: HTMLElement, motion: boolean, ms = 620) {
  if (!motion) return;
  const light = decor(el('div',
    'position:absolute;inset:0;pointer-events:none;opacity:.28;'
    + 'background:linear-gradient(90deg,transparent,var(--ac),transparent)'));
  host.append(light);
  const a = light.animate(
    [{ transform: 'translateX(-100%)' }, { transform: 'translateX(100%)' }],
    { duration: ms, easing: 'linear' },
  );
  a.onfinish = () => light.remove();
  a.oncancel = () => light.remove();
}

/**
 * Beats on a clock. Registration order is chronological order, which is what
 * makes the motion-off path correct: every beat runs at once, in order, and the
 * reader lands on the finished scene.
 */
export class Timeline {
  readonly motion: boolean;
  private queued: { ms: number; beat: () => void }[] = [];
  private timers: number[] = [];
  private live = false;

  constructor(motion: boolean) {
    this.motion = motion;
  }

  at(ms: number, beat: () => void): this {
    if (!this.motion) { beat(); return this; }
    this.queued.push({ ms, beat });
    return this;
  }

  /** One beat per item, `every` ms apart, starting at `from`. */
  each<T>(items: T[], from: number, every: number, beat: (item: T, i: number) => void): this {
    items.forEach((item, i) => this.at(from + i * every, () => beat(item, i)));
    return this;
  }

  start() {
    if (this.live) return;
    this.live = true;
    for (const q of this.queued) this.timers.push(window.setTimeout(q.beat, q.ms));
  }

  cancel() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.queued = [];
    this.live = false;
  }
}

/**
 * The shape every scene shares: draw once into the "before" state, hand back a
 * handle. Drawing at build time (not at play time) keeps the card's height from
 * jumping when the scene finally plays, because veiled elements still take up
 * their space. With motion off the draw already produces the end state, so
 * `play()` has nothing left to do.
 */
export function makeScene(ctx: SceneContext, draw: (tl: Timeline, motion: boolean) => void): SceneHandle {
  let tl = new Timeline(motionAllowed());
  const build = () => {
    tl.cancel();
    ctx.host.textContent = '';
    tl = new Timeline(motionAllowed());
    draw(tl, tl.motion);
  };
  build();
  let played = false;
  return {
    play() {
      if (played) build();   // a replay starts from the "before" state again
      played = true;
      tl.start();
    },
    destroy() {
      tl.cancel();
      ctx.host.textContent = '';
    },
  };
}

/**
 * The fixed anatomy: the ask on top, the stage in the middle, the outcome at the
 * bottom. Both text rows carry the example's own words, verbatim.
 *
 * A scene that renders one of those strings itself (typed into a composer, spoken
 * by a bubble) turns that row off — and then owes the reader that text on stage.
 */
export type Frame = {
  root: HTMLElement;
  stage: HTMLElement;
  showAsk: () => void;
  showOutcome: () => void;
};

export function stageFrame(ctx: SceneContext, opts: { ask?: boolean; outcome?: boolean } = {}): Frame {
  const { example, labels } = ctx;
  const root = col(13);
  const stage = col(10);

  let ask: HTMLElement | null = null;
  if (opts.ask !== false) {
    ask = veil(col(5));
    ask.append(lbl(labels.ask), bubble(example.entrada, 'user'));
    root.append(ask);
  }

  root.append(stage);

  let out: HTMLElement | null = null;
  if (opts.outcome !== false) {
    out = veil(col(5, 'border-top:1px solid var(--hair2);padding-top:10px'));
    const text = el('p', 'font:400 14px/1.45 var(--f);color:var(--l1);margin:0', example.salida);
    out.append(lbl(labels.happens, true), text);
    root.append(out);
  }

  ctx.host.append(root);
  return {
    root,
    stage,
    showAsk: () => { if (ask) appear(ask, motionAllowed()); },
    showOutcome: () => { if (out) appear(out, motionAllowed()); },
  };
}

// ---------------------------------------------------------------------------
// reading the example
//
// Every scene is driven by the two strings the lesson wrote. These helpers pull
// out the shapes those strings actually use, and every one of them can return
// nothing — the scenes fall back to something complete when they do.

/** First whole number in the text: "400 messages later" -> 400. */
export function firstInt(s: string): number | null {
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** Signed decimals, kept with the text that produced them: "-0.4402" -> both. */
export function decimals(s: string): { raw: string; value: number }[] {
  const out: { raw: string; value: number }[] = [];
  for (const m of s.matchAll(/-?\d+[.,]\d+/g)) {
    out.push({ raw: m[0], value: Number(m[0].replace(',', '.')) });
  }
  return out;
}

/** "hot 31 · good 22 · cold 9" -> the four scored candidates. */
export function scorePairs(s: string): { word: string; value: number }[] {
  const out: { word: string; value: number }[] = [];
  for (const m of s.matchAll(/([\p{L}’'-]+)\s+(\d{1,3})(?!\s*[.,]\d)/gu)) {
    out.push({ word: m[1], value: Number(m[2]) });
  }
  return out;
}

/**
 * The slots a request names out loud: "…5 lines (how) for a customer (who for)".
 * The label comes from the lesson's own parenthesis, so it is already translated.
 */
export function parenSlots(s: string): { text: string; label: string }[] {
  const out: { text: string; label: string }[] = [];
  for (const m of s.matchAll(/([^()]+?)\s*\(([^()]{1,24})\)/g)) {
    const text = m[1].trim();
    if (text) out.push({ text, label: m[2].trim() });
  }
  return out;
}

/** "2 tokens: Cart + agena" -> ["Cart", "agena"]. No colon, no pieces. */
export function piecesAfterColon(s: string): string[] | null {
  const i = s.indexOf(':');
  if (i < 0) return null;
  const parts = s.slice(i + 1).split(/[+·|]/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}

/** The fragment inside the quotes the lesson used, whichever pair it used. */
export function quoted(s: string): string | null {
  const m = s.match(/[«“"']([^«»“”"']{2,})[»”"']/);
  return m ? m[1].trim() : null;
}

export const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean);

/** Stable per string, so a dial panel looks the same on every replay. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** `count` stable fractions in 0.08..0.92, seeded by the string. */
export function spread(seed: string, count: number): number[] {
  let s = hash(seed) || 1;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out.push(0.08 + ((s >>> 8) % 1000) / 1000 * 0.84);
  }
  return out;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
