// Mounting the example scenes on a lesson page.
//
// Three rules, and each one is about a reader rather than a browser:
//
// 1. NOTHING PLAYS OFF SCREEN. An IntersectionObserver starts a scene the first
//    time a third of its card is on screen. An animation that ran while the
//    reader was somewhere else taught nothing, so it waits — and a replay control
//    lets them see it again on purpose.
// 2. LESS MOTION MEANS THE END STATE, NOT A BLANK. With
//    prefers-reduced-motion: reduce the scene is drawn finished at build time,
//    the observer has nothing to trigger, and the replay control is not offered
//    because there is nothing to replay.
// 3. A SCENE THAT CANNOT BUILD LEAVES THE CARD ALONE. The static "you ask /
//    what happens" rows are only hidden once a scene has actually built, and if
//    building throws they come straight back. The lesson text is the product;
//    the scene is an addition to it.
//
// The static rows are hidden rather than removed because the narrator reads them
// (it collects textContent from [data-narra] blocks, which display:none does not
// hide from it), and because they are the fallback the moment anything here fails.

import { isExample, sceneFor } from './index';
import { labelsFor } from './labels';
import { motionAllowed, type SceneHandle, type SceneLang } from './kit';

const VISIBLE = 0.34;

export function mountExampleScenes(scope: ParentNode = document): SceneHandle[] {
  const live: SceneHandle[] = [];
  const hosts = Array.from(scope.querySelectorAll<HTMLElement>('[data-scene-example]'));
  if (!hosts.length) return live;

  const motion = motionAllowed();
  const waiting = new Map<Element, SceneHandle>();
  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        obs.unobserve(e.target);
        waiting.get(e.target)?.play();
        waiting.delete(e.target);
      }
    }, { threshold: VISIBLE })
    : null;

  for (const host of hosts) {
    const card = host.closest('[data-example-card]');
    const rows = card?.querySelector<HTMLElement>('[data-example-io]') ?? null;
    try {
      const example: unknown = JSON.parse(host.dataset.sceneExample ?? 'null');
      const n = Number(host.dataset.sceneLesson);
      const build = Number.isFinite(n) ? sceneFor(n) : null;
      if (!build || !isExample(example)) continue;        // static card, untouched

      const lang: SceneLang = host.dataset.sceneLang === 'en' ? 'en' : 'es';
      const stage = document.createElement('div');
      stage.setAttribute('style', 'display:flex;flex-direction:column;gap:13px');
      host.append(stage);

      const scene = build({ host: stage, example, lang, labels: labelsFor(lang) });
      if (rows) rows.style.display = 'none';
      live.push(scene);

      if (!motion) {
        scene.play();                                    // already the end state
        continue;
      }
      host.append(replayButton(labelsFor(lang).replay, scene));
      if (observer) { waiting.set(host, scene); observer.observe(host); }
      else scene.play();                                 // no observer: show it now
    } catch (err) {
      console.error('example scene not mounted', err);
      host.textContent = '';
      if (rows) rows.style.display = '';
    }
  }

  // Timers do not outlive the page. Cheap, and it keeps `destroy` honest.
  window.addEventListener('pagehide', () => { for (const s of live) s.destroy(); }, { once: true });
  return live;
}

function replayButton(text: string, scene: SceneHandle): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lbl';
  b.setAttribute('style',
    'align-self:flex-start;height:26px;padding:0 9px;border:1px solid var(--hair2);'
    + 'background:transparent;color:var(--l3);cursor:pointer');
  b.textContent = text;
  b.addEventListener('click', () => scene.play());
  return b;
}
