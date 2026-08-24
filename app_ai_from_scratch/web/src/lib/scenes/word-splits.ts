// Lesson 5 · "it reads in pieces: tokens": the word splits into chips.
//
// The scene: the word arrives whole, then the seams show, then the pieces pull
// apart. Same word, now in the pieces the model actually reads.
//
// From the example: the pieces are the ones the lesson wrote — "2 tokens: Cart +
// agena" becomes two chips, Cart and agena. A `salida` with no colon (lesson 5's
// other example is "1 token") has no pieces to split, so the word stays one chip
// and the scene says exactly that: nothing to cut.
//
// The whole word sits absolutely on top of the chip row rather than above it, so
// the swap changes no layout at all — only opacity and transform move.

import {
  appear, chip, decor, el, fade, line, makeScene, piecesAfterColon, stageFrame, veil,
  type SceneBuilder,
} from './kit';

const GAP = 8;
const H = 30;

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx);

  const pieces = piecesAfterColon(ctx.example.salida) ?? [ctx.example.entrada];
  const stack = el('div', 'position:relative;align-self:flex-start;max-width:100%');

  const chips = veil(line(GAP, 'flex-wrap:wrap'));
  const parts = pieces.map((p, i) => {
    const c = chip(p, 'accent');
    // The chips start touching, so the split reads as one word coming apart
    // instead of a row of chips fading in.
    c.style.transform = `translateX(${-GAP * i}px)`;
    chips.append(c);
    return c;
  });

  // The pieces spell the same word: the whole-word pill is the visual "before",
  // and marked decorative so it is not read twice.
  const whole = veil(decor(el('span',
    `position:absolute;left:0;top:0;display:inline-flex;align-items:center;height:${H}px;padding:0 10px;`
    + 'border:1px solid var(--hair);background:var(--bg);font:500 14px/1 var(--m);'
    + 'color:var(--l1);white-space:nowrap',
    pieces.join(''))));

  stack.append(chips, whole);
  frame.stage.append(stack);

  tl.at(0, frame.showAsk);
  tl.at(240, () => appear(whole, motion, 0));
  tl.at(880, () => { appear(chips, motion, 0, 240); fade(whole, motion, 0, 240); });
  tl.each(parts, 1140, 70, (c) => {
    const from = c.style.transform;
    c.style.transform = 'none';
    if (!motion) return;
    c.animate([{ transform: from }, { transform: 'none' }],
      { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
  });
  tl.at(1660, frame.showOutcome);
});
