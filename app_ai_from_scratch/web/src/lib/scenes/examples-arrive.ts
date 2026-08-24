// Lesson 1 · "it learns by seeing examples".
//
// The scene: labelled examples land in a list, one after another, and once they
// are all in, the mark they share lights up and a pattern strip fills. That is
// the lesson's sentence acted out — nobody wrote the rule, the rule showed up
// after enough examples.
//
// From the example: `entrada` is the first item in the list, so the reader sees
// the actual thing being fed in. The repeats are deliberately blank rows: the
// lesson says "a hundred thousand times" and inventing a count would be a
// number we made up.

import {
  appear, col, decor, el, line, makeScene, meter, scaleTo, stageFrame, veil,
  type SceneBuilder,
} from './kit';

const ROWS = 3;

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx);
  const list = col(7);

  const rows = Array.from({ length: ROWS }, (_, i) => {
    const root = veil(line(10, 'border:1px solid var(--hair2);padding:8px 10px'));
    const thumb = decor(el('div',
      'width:22px;height:22px;flex:none;border:1px solid var(--hair);background:var(--fill)'));
    // The first row repeats the ask bubble on purpose — that is the example being
    // fed in — so it is marked decorative: a screen reader has already read it.
    const body = i === 0
      ? decor(el('p', 'flex:1;min-width:0;margin:0;font:400 13px/1.4 var(--f);color:var(--l1)', ctx.example.entrada))
      : decor(el('div', `flex:1;height:6px;background:var(--fill);max-width:${i === 1 ? 72 : 48}%`));
    const mark = veil(decor(el('span', 'font:600 13px/1 var(--m);color:var(--l3)', '✓')));
    root.append(thumb, body, mark);
    list.append(root);
    return { root, mark };
  });

  // The strip is the pattern: nothing names it, because the lesson's own
  // `salida` names it one row below.
  const pattern = veil(line(10));
  const bar = meter();
  pattern.append(decor(el('div', 'width:22px;height:22px;flex:none;border:1px solid var(--ac)')), bar.root);

  frame.stage.append(list, pattern);

  tl.at(0, frame.showAsk);
  tl.each(rows, 240, 220, (r) => appear(r.root, motion));
  tl.each(rows, 940, 90, (r) => {
    r.mark.style.color = 'var(--ac)';
    appear(r.mark, motion, 0, 200);
  });
  tl.at(1300, () => { appear(pattern, motion); scaleTo(bar.fill, motion, 1, 620); });
  tl.at(1820, frame.showOutcome);
});
