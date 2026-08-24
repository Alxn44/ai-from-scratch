// Lesson 10 · "its danger: it invents, confidently".
//
// The scene: the answer types itself out fast and smooth, a confident tick lands
// on it — and then the tick turns into the stamp: sounds ≠ true. The fluency is
// the trap, so the fluency has to be the thing the reader watches happen.
//
// This scene speaks the `salida` itself, in the answer bubble, so the frame's
// outcome row is switched off — the lesson's words are on stage, typed, instead
// of repeated underneath.
//
// It plays the same way for both of lesson 10's examples, including the one about
// heading it off, because the stamp is the reason you check a source at all. The
// scene never claims which of the two happened; it shows why the question comes up.

import {
  appear, decor, el, fade, line, makeScene, stageFrame, veil, wordsOf,
  type SceneBuilder,
} from './kit';

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx, { outcome: false });

  const say = veil(el('p',
    'margin:0;padding:9px 12px;border:1px solid var(--hair2);border-left:2px solid var(--ac);'
    + 'background:var(--fill);font:400 14px/1.5 var(--f);color:var(--l1)'));
  const words = wordsOf(ctx.example.salida).map((w, i) => veil(el('span', '', (i ? ' ' : '') + w)));
  say.append(...words);

  // The tick carries no words on purpose: it is the machine's confidence, and
  // the only honest caption for it is the stamp that replaces it.
  const tick = veil(line(8));
  tick.append(decor(el('span', 'font:600 15px/1 var(--m);color:var(--ok)', '✓')));

  // The label already carries the ≠; a second one in front of it just stutters.
  const stamp = veil(line(8, 'border-top:1px dashed var(--or);padding-top:9px'));
  stamp.append(el('span', 'font:600 14px/1.3 var(--m);color:var(--or)', ctx.labels.soundsNotTrue));

  frame.stage.append(say, tick, stamp);

  tl.at(0, frame.showAsk);
  tl.at(200, () => appear(say, motion));
  // Fast and even: this is the confident voice, not a hesitant one.
  tl.each(words, 380, 60, (w) => appear(w, motion, 0, 160));
  const done = 380 + words.length * 60 + 120;
  tl.at(done, () => appear(tick, motion, 0, 220));
  tl.at(done + 620, () => {
    fade(tick, motion, 0.25, 240);
    appear(stamp, motion, 0, 280);
  });
});
