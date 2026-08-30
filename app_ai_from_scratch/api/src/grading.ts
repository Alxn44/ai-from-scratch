// Grading lives ONLY on the server: the client never receives `solution`.

const norm = (xs: unknown[]): string => xs.map(String).map((s) => s.trim()).sort().join('|');

/**
 * The parsed `solution` column. Every mechanic reads a different field, so the
 * fields are optional and the switch below is what decides which one is real.
 * Declared rather than left as `any` so a mechanic that reads `sol.cuts` on a
 * `knob` lab is visible here instead of being `undefined` at runtime.
 */
export interface Solution {
  value?: unknown;
  cuts?: unknown[];
  order?: unknown[];
  slots?: unknown[];
  min?: number;
  max?: number;
}

/** What the browser sends back. Shape depends on the mechanic. */
export type Answer = unknown;

/** The narrow row the grader is allowed to receive from data. */
export interface GradableLab { kind: string; solution: string }

export function grade(lab: GradableLab, answer: Answer): boolean {
  const sol = JSON.parse(lab.solution) as Solution;
  switch (lab.kind) {
    case 'choice':
      return String(answer) === String(sol.value);
    case 'cut':
      return Array.isArray(answer) && norm(answer) === norm(sol.cuts ?? []);
    case 'order':
      return Array.isArray(answer)
        && answer.map(String).join(',') === (sol.order ?? []).map(String).join(',');
    case 'build':
      return !!answer && typeof answer === 'object' &&
             (sol.slots ?? []).every((_k, i) => {
               const v = (answer as Record<number, unknown>)[i];
               return typeof v === 'string' && v.trim().length > 0;
             });
    case 'knob': {
      const t = Number(answer);
      return Number.isFinite(t) && t >= Number(sol.min) && t <= Number(sol.max);
    }
    case 'hotcold':
      return Number(answer) === Number(sol.value);
    default:
      return false;
  }
}

/** The hint shape per mechanic. `null` when the mechanic needs none. */
export type Hint =
  | { err: number; word: string }
  | { range: [number | undefined, number | undefined] }
  | null;

// Hint returned to the client when the mechanic needs one.
// Without this the client would have to know the answer in order to say «cold» or
// «hot». The words are product copy for a Spanish-language course and travel to
// web/src/pages/leccion/[n].astro as data: they are not identifiers.
export function hint(lab: GradableLab, answer: Answer, lang: 'es' | 'en' = 'es'): Hint {
  const sol = JSON.parse(lab.solution) as Solution;
  if (lab.kind === 'hotcold') {
    const err = Math.abs(Number(answer) - Number(sol.value));
    const word = lang === 'en'
      ? (err === 0 ? 'exact' : err <= 5 ? 'hot' : err <= 20 ? 'warm' : 'cold')
      : (err === 0 ? 'exacto' : err <= 5 ? 'caliente' : err <= 20 ? 'tibio' : 'frío');
    return { err, word };
  }
  if (lab.kind === 'knob') return { range: [sol.min, sol.max] };
  return null;
}

/** The best attempt on a lab, as the progress queries return it. */
export interface BestAttempt {
  lab_id: string;
  solved: number | null;
  attempts: number;
}

/** A lab as the client is allowed to see it: no `solution`, no `explanation`. */
export interface PublicLab {
  id: string;
  lesson: number;
  idx: number;
  level: string;
  kind: string;
  prompt: string;
  payload: unknown;
  draft: boolean;
  solved: boolean;
  attempts: number;
}

/** Paid lab fields that may cross to the browser. `solution` cannot be named here. */
export interface PublicLabSource {
  id: string;
  lesson_n: number;
  idx: number;
  level: string;
  kind: string;
  prompt: string;
  payload: string;
  draft: number;
}

/** What the client MAY see. */
export function publicLab(lab: PublicLabSource, best: BestAttempt | null | undefined): PublicLab {
  return {
    id: lab.id,
    lesson: lab.lesson_n,
    idx: lab.idx,
    level: lab.level,
    kind: lab.kind,
    prompt: lab.prompt,
    payload: JSON.parse(lab.payload),
    draft: !!lab.draft,
    solved: !!best,
    attempts: best?.attempts ?? 0,
  };
}
