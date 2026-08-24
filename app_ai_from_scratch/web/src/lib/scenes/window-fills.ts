// Lesson 8 · "its memory is a table that fills up": items pile in and the oldest
// falls off.
//
// The scene: a window with room for six rows. What you told it goes in first, the
// messages that come after stack on top of it, and when the window is full the
// first row is pushed out the top and turns up below, struck through.
//
// From the example: the number of messages is the lesson's own — "3 questions
// later" keeps the first row inside the window, "400 messages later" pushes it
// out. Same scene, opposite ending, and both endings are the lesson's sentence.
//
// The dropped row lives below the window from the start, veiled, so revealing it
// moves no layout. The row that leaves keeps its slot (a transform does not
// reflow), so the window never changes height either.

import {
  appear, col, decor, el, firstInt, lbl, line, makeScene, readout, stageFrame,
  veil, type SceneBuilder,
} from './kit';

const CAP = 6;

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx);

  const asked = firstInt(ctx.example.entrada) ?? 1;
  const overflows = asked > CAP - 1;
  const landing = Math.min(asked, CAP - 1);   // how many rows pile on top of yours

  const head = veil(line(9));
  const count = readout(`1 / ${CAP}`);
  head.append(count, lbl(ctx.labels.window));

  const box = veil(col(6, 'overflow:hidden;border:1px solid var(--hair2);'
    + 'background:var(--panel);padding:10px'));

  const mine = line(9, 'border:1px solid var(--ac);padding:7px 9px;background:var(--fill)');
  // Both copies of the ask are decorative: the row inside the window and the
  // struck-through row below it are the same sentence the ask bubble already read.
  const mineText = decor(el('p', 'flex:1;min-width:0;margin:0;font:400 13px/1.35 var(--f);color:var(--l1)',
    ctx.example.entrada));
  const mineMark = veil(decor(el('span', 'font:600 13px/1 var(--m);color:var(--ok)', '✓')));
  mine.append(mineText, mineMark);
  box.append(mine);

  const later = Array.from({ length: landing }, (_, i) => {
    const row = veil(line(9, 'border:1px solid var(--hair2);padding:9px'));
    row.append(decor(el('div', `height:6px;background:var(--fill);flex:1;max-width:${88 - i * 9}%`)));
    box.append(row);
    return row;
  });

  const dropped = veil(decor(line(9, 'padding:2px')));
  dropped.append(
    decor(el('span', 'font:600 13px/1 var(--m);color:var(--or)', '↓')),
    el('p', 'flex:1;min-width:0;margin:0;font:400 13px/1.35 var(--f);color:var(--l3);'
      + 'text-decoration:line-through', ctx.example.entrada),
  );

  frame.stage.append(head, box, dropped);

  tl.at(0, frame.showAsk);
  tl.at(200, () => { appear(head, motion, 0); appear(box, motion); });
  tl.each(later, 560, 170, (row, i) => {
    appear(row, motion);
    count.textContent = `${i + 2} / ${CAP}`;
  });

  const after = 560 + later.length * 170 + 180;
  if (overflows) {
    tl.at(after, () => {
      // Pushed out the top by everything that came after it, then struck through
      // below: the same row, now outside the window.
      mine.style.transform = 'translateY(-26px)';
      if (motion) {
        mine.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(-26px)', opacity: 0 }],
          { duration: 460, easing: 'cubic-bezier(.4,0,1,1)' });
      }
      mine.style.opacity = '0';
      mine.style.borderColor = 'var(--hair2)';
    });
    tl.at(after + 380, () => appear(dropped, motion, 0));
  } else {
    tl.at(after, () => appear(mineMark, motion, 0, 220));
  }
  tl.at(after + 700, frame.showOutcome);
});
