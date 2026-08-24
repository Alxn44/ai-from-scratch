// Lesson 11 · "its date: its memory has a cutoff".
//
// The scene: a line of time. Left of the cutoff the dots fill in — that is what it
// read. Right of it the line goes dashed and the dots stay hollow. Then today
// drops in on the blind side, and the answer is fetched back from the last dot it
// ever saw.
//
// The scene is the same for both of lesson 11's examples because the cutoff is the
// same fact in both: the one with search still answers from the far side of the
// line, it just brings a link back. The example's own `salida` is the row
// underneath, and it says which of the two happened.

import {
  appear, decor, EASE, el, lbl, line, makeScene, scaleTo, stageFrame, veil,
  type SceneBuilder,
} from './kit';

const CUT = 0.62;          // where the cutoff stands on the line
const PAST = [0.08, 0.22, 0.36, 0.5];
const AHEAD = [0.72, 0.84];
const NOW = 0.95;

const dot = (filled: boolean, at: number) => decor(el('div',
  `position:absolute;top:11px;left:${(at * 100).toFixed(1)}%;transform:translate(-50%,-50%);`
  + `width:9px;height:9px;border:1px solid ${filled ? 'var(--ac)' : 'var(--hair)'};`
  + `background:${filled ? 'var(--ac)' : 'transparent'}`));

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx);

  const rail = veil(el('div', 'position:relative;height:22px'));
  const read = decor(el('div',
    `position:absolute;left:0;top:11px;width:${(CUT * 100).toFixed(1)}%;height:1px;background:var(--ac)`));
  const blind = decor(el('div',
    `position:absolute;left:${(CUT * 100).toFixed(1)}%;right:0;top:11px;height:0;`
    + 'border-top:1px dashed var(--hair)'));
  const cut = decor(el('div',
    `position:absolute;top:0;left:${(CUT * 100).toFixed(1)}%;transform:translateX(-50%);`
    + 'width:0;height:22px;border-left:2px solid var(--ac)'));
  const past = PAST.map((p) => veil(dot(true, p)));
  const ahead = AHEAD.map((p) => veil(dot(false, p)));
  const now = veil(decor(el('div',
    `position:absolute;top:2px;left:${(NOW * 100).toFixed(1)}%;transform:translateX(-50%);`
    + 'width:11px;height:19px;border:1px solid var(--or)')));
  // The answer travels back from today to the last thing it read.
  const leader = decor(el('div',
    `position:absolute;top:16px;left:${(PAST[PAST.length - 1] * 100).toFixed(1)}%;`
    + `width:${((NOW - PAST[PAST.length - 1]) * 100).toFixed(1)}%;height:0;`
    + 'border-top:1px dashed var(--or);transform-origin:right;transform:scaleX(0)'));
  rail.append(read, blind, cut, ...past, ...ahead, leader, now);

  const legend = veil(line(0, 'justify-content:space-between;gap:10px'));
  const cutLbl = lbl(ctx.labels.cutoff, true);
  const nowLbl = lbl(ctx.labels.today);
  nowLbl.style.color = 'var(--or)';
  legend.append(cutLbl, nowLbl);

  frame.stage.append(rail, legend);

  tl.at(0, frame.showAsk);
  tl.at(200, () => { appear(rail, motion); appear(legend, motion, 0); });
  tl.each(past, 480, 110, (d) => appear(d, motion, 0, 200));
  tl.each(ahead, 980, 110, (d) => appear(d, motion, 0, 200));
  tl.at(1300, () => {
    // Drops in vertically while keeping its own centring transform.
    now.style.opacity = '1';
    if (!motion) return;
    now.animate([
      { opacity: 0, transform: 'translateX(-50%) translateY(-8px)' },
      { opacity: 1, transform: 'translateX(-50%)' },
    ], { duration: 340, easing: EASE });
  });
  tl.at(1620, () => scaleTo(leader, motion, 1, 520));
  tl.at(2140, frame.showOutcome);
});
