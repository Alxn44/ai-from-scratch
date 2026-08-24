// Scene chrome: the only words the scenes own.
//
// Everything else a scene shows is the lesson's own `entrada` / `salida`, which
// already arrive written in the reader's language. These are the few labels the
// visuals need in order to be readable at all: the two row headers, the words on
// the ends of a slider, the stamp on the invention scene.
//
// `ask` and `happens` deliberately mirror `lec.pides` / `lec.pasa` in i18n.ts.
// The scenes ship to the browser and i18n.ts is a 700-line server-side
// dictionary, so importing it here would drag the whole thing into the client
// bundle for two strings. If those two labels change there, change them here.

export type SceneLabels = {
  ask: string;
  happens: string;
  error: string;
  dials: string;
  unchanged: string;
  next: string;
  what: string;
  whoFor: string;
  how: string;
  window: string;
  same: string;
  varied: string;
  soundsNotTrue: string;
  cutoff: string;
  today: string;
  send: string;
  replay: string;
};

export const SCENE_LABELS: Record<'es' | 'en', SceneLabels> = {
  es: {
    ask: 'Le pides',
    happens: 'Qué pasa',
    error: 'error',
    dials: 'perillas',
    unchanged: 'sin cambios',
    next: 'siguiente',
    what: 'qué',
    whoFor: 'para quién',
    how: 'cómo',
    window: 'ventana',
    same: 'igual',
    varied: 'variado',
    soundsNotTrue: 'suena ≠ cierto',
    cutoff: 'corte',
    today: 'hoy',
    send: 'enviar',
    replay: 'Repetir',
  },
  en: {
    ask: 'You ask',
    happens: 'What happens',
    error: 'error',
    dials: 'dials',
    unchanged: 'unchanged',
    next: 'next',
    what: 'what',
    whoFor: 'who for',
    how: 'how',
    window: 'window',
    same: 'same',
    varied: 'varied',
    soundsNotTrue: 'sounds ≠ true',
    cutoff: 'cutoff',
    today: 'today',
    send: 'send',
    replay: 'Replay',
  },
};

/** Anything that is not 'en' falls back to Spanish, the course's own language. */
export const labelsFor = (lang: string): SceneLabels => (lang === 'en' ? SCENE_LABELS.en : SCENE_LABELS.es);
