// Lesson 2 · "it plays hot and cold": a guess closes on the target and the error
// shrinks.
//
// The scene: a target sits on a track, the guess starts far from it, and each hop
// moves the guess closer while the error readout drops and the orange gap bar
// pulls in toward the target.
//
// From the example: the error the lesson states is the error the scene ends on.
// `firstInt(salida)` picks it up — 94 on the first try, 4 after thousands of
// examples — so the same scene tells two different stories: a guess that barely
// moved, and a guess that landed. The readout starts at 100 (the whole track is
// wrong) and the middle values are the descent between those two honest ends,
// not claims about a real training run.

import {
  appear, clamp, firstInt, knob, line, lbl, makeScene, readout, scaleTo, slide, stageFrame, track, veil,
  decor, el, type SceneBuilder,
} from './kit';

const TARGET = 0.82;   // where the right answer sits on the track
const START = 0.06;    // where the first guess sits

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx);

  const final = clamp(firstInt(ctx.example.salida) ?? 4, 0, 100);
  // A high error means the guess barely moved: one hop and it stops far out. A
  // low error means it closed in, so it takes the descent in three.
  const hops = final >= 60
    ? [final]
    : [Math.round(final + (100 - final) * 0.55), Math.round(final + (100 - final) * 0.18), final];

  const head = veil(line(9));
  const num = readout('100');
  head.append(num, lbl(ctx.labels.error));

  const t = track(24);
  // The gap bar spans exactly the guess's travel, so its left edge and the guess
  // marker are the same point on the track at every hop.
  const gapWrap = decor(el('div',
    `position:absolute;left:${(START * 100).toFixed(1)}%;top:11px;`
    + `width:${((TARGET - START) * 100).toFixed(1)}%;height:3px;overflow:hidden`));
  const gap = el('div', 'height:3px;background:var(--or);transform-origin:right;transform:scaleX(1)');
  gapWrap.append(gap);
  const target = decor(el('div',
    `position:absolute;top:1px;left:${(TARGET * 100).toFixed(1)}%;transform:translateX(-50%);`
    + 'width:12px;height:20px;border:1px solid var(--ac)'));
  const guess = knob();
  guess.style.left = `${(START * 100).toFixed(1)}%`;
  const trackBox = veil(t.root);
  t.root.append(gapWrap, target, guess);

  frame.stage.append(head, trackBox);

  tl.at(0, frame.showAsk);
  tl.at(240, () => { appear(head, motion, 0); appear(trackBox, motion); });

  let at = 620, from = START;
  for (const err of hops) {
    const to = TARGET - (TARGET - START) * (err / 100);
    const shown = err, prev = from;
    tl.at(at, () => {
      num.textContent = String(shown);
      slide(guess, motion, prev, to, 520);
      scaleTo(gap, motion, shown / 100, 520);
      gap.style.background = shown <= 10 ? 'var(--ok)' : 'var(--or)';
    });
    from = to;
    at += 620;
  }

  tl.at(at + 120, frame.showOutcome);
});
