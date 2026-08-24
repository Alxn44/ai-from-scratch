// Lesson 6 · "it writes by guessing the next one": candidates get weighted, one
// wins, the text grows.
//
// The scene: the candidates line up with their scores, the bars fill, the highest
// one lights up, and then the sentence grows word by word and takes that winner
// on the end.
//
// From the example: the candidates and their scores are the lesson's own —
// "hot 31 · good 22 · nice 14 · cold 9" is read straight out of `salida`, so the
// bars are the numbers the reader is about to read, not invented weights. When a
// `salida` carries no scores (lesson 6's second example just carries on with the
// sentence) there are no bars: the fragment in quotes grows on its own, which is
// the same idea with the weighing left off screen.

import {
  appear, col, decor, el, lbl, line, makeScene, meter, quoted, scaleTo, scorePairs,
  stageFrame, veil, wordsOf, type SceneBuilder,
} from './kit';

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx);
  const { entrada, salida } = ctx.example;

  // One stray number is not a score board: it takes two to be a weighing.
  const found = scorePairs(salida);
  const pairs = found.length >= 2 ? found.slice(0, 5) : [];
  const winner = pairs.length ? pairs.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const top = Math.max(1, ...pairs.map((p) => p.value));
  const base = wordsOf(pairs.length ? (quoted(entrada) ?? entrada) : (quoted(salida) ?? salida));

  // No scores in the text means no score board at all: the growing sentence is
  // the whole scene, rather than an empty box above it.
  const bars = veil(col(7));
  if (pairs.length) bars.append(lbl(ctx.labels.next));
  const rows = pairs.map((p) => {
    const row = line(10);
    const name = el('span', 'width:88px;flex:none;font:400 13px/1.2 var(--f);color:var(--l2)', p.word);
    const bar = meter(p === winner ? 'var(--ac)' : 'var(--l3)');
    const value = el('span',
      'width:32px;flex:none;text-align:right;font:500 12px/1 var(--m);'
      + 'font-variant-numeric:tabular-nums;color:var(--l3)', String(p.value));
    row.append(name, bar.root, value);
    bars.append(row);
    return { fill: bar.fill, k: p.value / top, value, win: p === winner };
  });

  // --panel, not --fill: the winner is marked in --ac, and accent on the grey
  // fill measured 4.35:1 in paper. On the panel it is 5.8:1. Measured, not guessed.
  const say = veil(el('p',
    'margin:0;padding:9px 12px;border:1px solid var(--hair2);background:var(--panel);'
    + 'font:400 14px/1.5 var(--f);color:var(--l1)'));
  const words = base.map((w, i) => veil(el('span', '', (i ? ' ' : '') + w)));
  const tail = winner ? veil(el('span', 'color:var(--ac);font-weight:600', ` ${winner.word}`)) : null;
  const caret = decor(el('span',
    'display:inline-block;width:7px;height:14px;margin-left:3px;vertical-align:-2px;background:var(--ac)'));
  say.append(...words);
  if (tail) say.append(tail);
  say.append(caret);

  if (rows.length) frame.stage.append(bars);
  frame.stage.append(say);

  tl.at(0, frame.showAsk);
  if (rows.length) {
    tl.at(220, () => appear(bars, motion));
    tl.each(rows, 460, 90, (r) => scaleTo(r.fill, motion, r.k, 520));
    tl.at(1080, () => rows.forEach((r) => { if (r.win) r.value.style.color = 'var(--ac)'; }));
  }
  const start = rows.length ? 1240 : 260;
  tl.at(start - 120, () => appear(say, motion));
  tl.each(words, start, 110, (w) => appear(w, motion, 0, 200));
  const after = start + words.length * 110 + 160;
  if (tail) tl.at(after, () => appear(tail, motion, 0, 260));
  tl.at(after + 220, () => { caret.style.opacity = '0'; });
  tl.at(after + 320, frame.showOutcome);
});
