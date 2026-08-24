// Lesson 12 · "start today: copy, paste, done".
//
// The scene: an empty compose box, the request typing itself in, the send button
// firing, and the answer already on its way back. Nothing to install, nothing to
// learn first — the whole of getting started is this one box.
//
// The request is typed into the composer instead of sitting in an ask bubble, so
// the frame's ask row is switched off: the `entrada` appears once, being written.
// The `salida` stays in the outcome row, which is what comes back.

import {
  appear, decor, EASE, el, fade, line, makeScene, pulse, stageFrame, veil, wordsOf,
  type SceneBuilder,
} from './kit';

export const scene: SceneBuilder = (ctx) => makeScene(ctx, (tl, motion) => {
  const frame = stageFrame(ctx, { ask: false });

  const composer = veil(el('div',
    'display:flex;align-items:flex-end;gap:9px;border:1px solid var(--hair);'
    + 'background:var(--fill);padding:9px 10px'));
  const field = el('p', 'flex:1;min-width:0;margin:0;font:400 14px/1.45 var(--f);color:var(--l1)');
  const words = wordsOf(ctx.example.entrada).map((w, i) => veil(el('span', '', (i ? ' ' : '') + w)));
  const caret = decor(el('span',
    'display:inline-block;width:7px;height:14px;margin-left:3px;vertical-align:-2px;background:var(--ac)'));
  field.append(...words, caret);
  const send = el('span',
    'flex:none;display:inline-flex;align-items:center;height:26px;padding:0 10px;'
    // --ac-solid + --on-ac is what the app's pressed segmented button uses, and
    // in dark it is the difference between 3.65:1 and 4.5:1 on this label.
    + 'background:var(--ac-solid);color:var(--on-ac);font:600 10px/1 var(--m);letter-spacing:.12em;'
    + 'text-transform:uppercase', ctx.labels.send);
  composer.append(field, send);

  const dots = veil(line(5, 'align-self:flex-start;border:1px solid var(--hair2);'
    + 'background:var(--fill);padding:10px 12px'));
  const beads = [0, 1, 2].map(() => decor(el('div',
    'width:5px;height:5px;background:var(--l3)')));
  dots.append(...beads);

  frame.stage.append(composer, dots);

  tl.at(120, () => appear(composer, motion));
  tl.each(words, 420, 90, (w) => appear(w, motion, 0, 180));
  const typed = 420 + words.length * 90 + 140;
  tl.at(typed, () => {
    fade(caret, motion, 0, 160);
    pulse(send, motion);
  });
  tl.at(typed + 260, () => {
    // The composer hands the message off: it lifts and dims, the reply is landing.
    composer.style.opacity = '0.55';
    composer.style.transform = 'translateY(-5px)';
    if (motion) {
      composer.animate([{ transform: 'none' }, { transform: 'translateY(-5px)' }],
        { duration: 320, easing: EASE });
    }
    appear(dots, motion);
  });
  tl.each(beads, typed + 420, 120, (b) => {
    b.style.background = 'var(--ac)';
    if (motion) b.animate([{ transform: 'scale(.7)' }, { transform: 'scale(1)' }],
      { duration: 260, easing: EASE });
  });
  tl.at(typed + 900, frame.showOutcome);
});
