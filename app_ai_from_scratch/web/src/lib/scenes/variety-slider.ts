// Lesson 9 · "its dial: serious or creative, you choose": one slider changes how
// varied the answers are.
//
// The scene: ten runs of the same request, drawn as ten tiles, and one slider
// above them. Cold, the ten tiles are identical. Push the dial and some of them
// come out different. One control, one consequence.
//
// From the example: the lesson counts its own runs — "the same answer 10 out of
// 10" and "4 in 10 options odd". The rule this scene reads them by: with a 10 in
// the text, a second number smaller than 10 is how many of the ten came out
// different, and a 10 on its own means none did. That is what puts the knob at
// the cold end for one example and past the middle for the other. If neither
// number is there the knob parks mid-scale with a few tiles varied, so the reader
// still sees the dial's effect rather than an empty box.

import {
  appear, clamp, decor, el, knob, lbl, line, makeScene, scaleTo, slide, spread,
  stageFrame, track, veil, type SceneBuilder,
} from './kit';

const RUNS = 10;
const COLD = 0.1;

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx);

  const odd = oddOfTen(ctx.example.salida);
  const park = odd === 0 ? COLD : clamp(0.46 + odd * 0.045, 0.46, 0.92);
  const widths = spread(ctx.example.salida, RUNS);

  const dial = veil(line(10));
  const t = track(22);
  const k = knob(true);
  k.style.left = `${COLD * 100}%`;
  t.root.append(k);
  dial.append(lbl(ctx.labels.same), t.root, lbl(ctx.labels.varied));

  const grid = veil(el('div', 'display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px'));
  const tiles = Array.from({ length: RUNS }, (_, i) => {
    const cell = decor(el('div',
      'height:26px;border:1px solid var(--hair2);background:var(--fill);display:flex;align-items:center;padding:0 4px'));
    const bar = el('div', 'height:4px;width:100%;background:var(--l3);transform-origin:left;transform:scaleX(.6)');
    cell.append(bar);
    grid.append(cell);
    return { cell, bar, k: 0.3 + widths[i] * 0.7, varied: i < odd };
  });

  frame.stage.append(dial, grid);

  tl.at(0, frame.showAsk);
  tl.at(200, () => { appear(dial, motion, 0); appear(grid, motion); });
  tl.at(700, () => slide(k, motion, COLD, park, 620));
  tl.each(tiles.filter((x) => x.varied), 1120, 90, (x) => {
    x.cell.style.borderColor = 'var(--ac)';
    x.bar.style.background = 'var(--ac)';
    scaleTo(x.bar, motion, x.k, 420);
  });
  tl.at(1120 + odd * 90 + 320, frame.showOutcome);
});

/**
 * How many of ten runs came out different, read off the lesson's own count.
 * "10 out of 10 the same" -> none; "4 in 10 odd" -> four; nothing countable -> 3,
 * enough for the dial to visibly do something.
 */
function oddOfTen(s: string): number {
  const ns = [...s.matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (!ns.includes(RUNS)) return ns.length ? clamp(ns[0], 1, RUNS - 1) : 3;
  const other = ns.find((n) => n !== RUNS);
  return other === undefined ? 0 : clamp(other, 1, RUNS - 1);
}
