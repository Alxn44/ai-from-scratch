// Lesson 7 · "the formula for a good ask": three slots fill — what + who for + how.
//
// The scene: three empty slots, then each one takes the piece of the request that
// belongs to it. A request that named all three fills all three. A vague request
// fills nothing, and the three dashed empty slots ARE the lesson: you said no
// what, no who for, no how.
//
// From the example: the slots are read out of the request itself. A lesson that
// writes "Write 5 lines (how) for a customer who already bought from us (who for)"
// is naming its own slots, in its own language, so the labels need no translating
// here. With no parentheses in `entrada` the slots keep the formula's default
// labels and stay empty.

import {
  appear, col, el, lbl, makeScene, parenSlots, stageFrame, veil,
  type SceneBuilder,
} from './kit';

const EMPTY = '—';

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx);
  const { labels } = ctx;

  const named = parenSlots(ctx.example.entrada).slice(0, 3);
  const slots = named.length
    ? named
    : [labels.what, labels.whoFor, labels.how].map((label) => ({ label, text: '' }));

  const rows = slots.map((s) => {
    const root = veil(col(5));
    const boxCss = 'min-height:38px;display:flex;align-items:center;padding:7px 11px;'
      + 'font:400 13px/1.4 var(--f)';
    const box = s.text
      ? el('div', `${boxCss};border:1px solid var(--hair);background:var(--fill);color:var(--l1)`)
      : el('div', `${boxCss};border:1px dashed var(--hair);color:var(--l3)`, EMPTY);
    const value = s.text ? veil(el('span', '', s.text)) : null;
    if (value) box.append(value);
    root.append(lbl(s.label), box);
    return { root, box, value };
  });

  const grid = col(9);
  grid.append(...rows.map((r) => r.root));
  frame.stage.append(grid);

  tl.at(0, frame.showAsk);
  tl.each(rows, 240, 120, (r) => appear(r.root, motion));
  tl.each(rows, 760, 260, (r) => {
    if (!r.value) return;                       // a slot the request never filled
    r.box.style.borderColor = 'var(--ac)';
    appear(r.value, motion, 0, 240);
  });
  tl.at(760 + rows.length * 260 + 160, frame.showOutcome);
});
