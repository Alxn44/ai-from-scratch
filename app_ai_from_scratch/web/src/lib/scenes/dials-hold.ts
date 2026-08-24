// Lesson 4 · "it does not learn from you": the message arrives and the dials do
// not move.
//
// The scene: the same dial panel as lesson 3, already settled, with a dashed tick
// under every knob marking where it stands. Your message sweeps across the panel
// and every knob is still on its tick — the counter says nothing changed.
//
// From the example: the dial positions are seeded from `entrada`, so the panel is
// the same on every replay and different for each example, and the reader can see
// that the knob and its "before" tick are the same point. The reused panel is the
// point of the lesson: it is the same panel as lesson 3, and your typing does not
// touch it.

import {
  appear, col, decor, el, knob, lbl, line, makeScene, readout, spread, stageFrame,
  sweep, track, veil, type SceneBuilder,
} from './kit';

const DIALS = 6;

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx);
  const at = spread(ctx.example.entrada, DIALS);

  const box = veil(col(9, 'position:relative;overflow:hidden;'
    + 'border:1px solid var(--hair2);background:var(--panel);padding:12px'));
  box.append(lbl(ctx.labels.dials));

  const marks = at.map((f) => {
    const row = line(10);
    const t = track(22);
    // The dashed tick is where the knob stood before your message arrived. It is
    // drawn under the knob, at the same percentage, so "did not move" is visible
    // rather than asserted.
    const tick = decor(el('div',
      `position:absolute;top:0;left:${(f * 100).toFixed(2)}%;transform:translateX(-50%);`
      + 'width:0;height:22px;border-left:1px dashed var(--hair)'));
    const k = knob();
    k.style.left = `${(f * 100).toFixed(2)}%`;
    t.root.append(tick, k);
    const mark = veil(decor(el('span',
      'width:66px;flex:none;text-align:right;font:600 13px/1 var(--m);color:var(--l3)', '=')));
    row.append(t.root, mark);
    box.append(row);
    return mark;
  });

  const tally = veil(line(9));
  tally.append(readout(`0 / ${DIALS}`), lbl(ctx.labels.unchanged));

  frame.stage.append(box, tally);

  tl.at(0, frame.showAsk);
  tl.at(220, () => appear(box, motion));
  tl.at(620, () => sweep(box, motion));
  tl.each(marks, 900, 80, (m) => {
    m.style.color = 'var(--ok)';
    appear(m, motion, 0, 200);
  });
  tl.at(1480, () => appear(tally, motion, 0));
  tl.at(1740, frame.showOutcome);
});
