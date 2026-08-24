// Lesson 3 · "everything it knows is in dials": the dials settle into positions.
//
// The scene: a panel of dials, every knob parked in the middle, and one by one
// each knob slides to where it ended up. No new file appears, nothing is written
// anywhere — positions moved, and that is the whole of what the model knows.
//
// From the example: the numbers the lesson prints ("0.0173, -0.4402, 1.2088…")
// become the first dials, readout and all, so the reader watches the model's own
// numbers take their place. The rest of the panel is seeded from `entrada`, so
// it is stable across replays and different between the two examples, and those
// dials carry no readout — we are not inventing values the lesson never wrote.

import {
  appear, clamp, col, decimals, decor, el, knob, lbl, line, makeScene, slide, spread,
  stageFrame, track, veil, type SceneBuilder,
} from './kit';

const DIALS = 6;
const MID = 0.5;

/** A weight lands on the panel where its size puts it: 0 in the middle, ±2 at the ends. */
const place = (v: number) => clamp(0.5 + v / 4, 0.06, 0.94);

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx);

  const known = decimals(ctx.example.salida).slice(0, DIALS);
  const seeded = spread(ctx.example.entrada, DIALS);
  const targets = Array.from({ length: DIALS }, (_, i) =>
    i < known.length ? place(known[i].value) : seeded[i]);

  const box = veil(col(9, 'border:1px solid var(--hair2);background:var(--panel);padding:12px'));
  box.append(lbl(ctx.labels.dials));

  const dials = targets.map((to, i) => {
    const row = line(10);
    const t = track(22);
    const k = knob(i < known.length);
    k.style.left = `${MID * 100}%`;
    t.root.append(k);
    const readout = veil(el('span',
      'width:66px;flex:none;text-align:right;font:500 12px/1 var(--m);'
      + 'font-variant-numeric:tabular-nums;color:var(--l2)',
      i < known.length ? known[i].raw : '·'));
    if (i >= known.length) decor(readout);
    row.append(t.root, readout);
    box.append(row);
    return { k, to, readout };
  });

  frame.stage.append(box);

  tl.at(0, frame.showAsk);
  tl.at(220, () => appear(box, motion));
  tl.each(dials, 560, 110, (d) => slide(d.k, motion, MID, d.to, 560));
  tl.each(dials, 900, 90, (d) => appear(d.readout, motion, 0, 220));
  tl.at(1620, frame.showOutcome);
});
