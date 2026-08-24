// The registry: lesson number -> the scene that acts out that lesson's concept.
//
// Twelve types, not twenty-four animations. Each lesson has two examples and both
// play the SAME scene, parameterised by their own `entrada` / `salida` — which is
// why lesson 8's two examples end differently (one message stays in the window,
// one falls off) without two pieces of code.
//
// A lesson with no entry here, or an example missing a field, renders the plain
// static card. That is the fallback: the reading never disappears behind a broken
// animation.

import type { Example, SceneBuilder } from './kit';
import { scene as examplesArrive } from './examples-arrive';
import { scene as errorCloses } from './error-closes';
import { scene as dialsSettle } from './dials-settle';
import { scene as dialsHold } from './dials-hold';
import { scene as wordSplits } from './word-splits';
import { scene as nextWord } from './next-word';
import { scene as threeSlots } from './three-slots';
import { scene as windowFills } from './window-fills';
import { scene as varietySlider } from './variety-slider';
import { scene as fluentThenDoubt } from './fluent-then-doubt';
import { scene as cutoffLine } from './cutoff-line';
import { scene as promptSent } from './prompt-sent';

export const SCENES: Record<number, SceneBuilder> = {
  1: examplesArrive,      // examples land, a pattern emerges
  2: errorCloses,         // the guess closes on the target, the error shrinks
  3: dialsSettle,         // the dials settle into positions
  4: dialsHold,           // your message arrives, the dials do not move
  5: wordSplits,          // the word comes apart into pieces
  6: nextWord,            // candidates weighted, one wins, the text grows
  7: threeSlots,          // what + who for + how, filling in
  8: windowFills,         // the window fills, the oldest falls off
  9: varietySlider,       // one dial, from ten identical answers to varied ones
  10: fluentThenDoubt,    // fluent, confident, then: sounds ≠ true
  11: cutoffLine,         // remembers before the cutoff, blind after
  12: promptSent,         // a request typed and sent
};

export const sceneFor = (n: number): SceneBuilder | null => SCENES[n] ?? null;

/** Every field a scene may read has to be there, and be a non-empty string. */
export function isExample(v: unknown): v is Example {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (['titulo', 'entrada', 'salida', 'nota'] as const)
    .every((k) => typeof e[k] === 'string' && (e[k] as string).trim() !== '');
}

export type { Example, SceneBuilder, SceneHandle, SceneContext } from './kit';
