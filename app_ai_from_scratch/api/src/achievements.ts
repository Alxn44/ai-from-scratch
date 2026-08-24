// The achievement catalogue. The codes live here (the server decides what was
// earned); the visible names live in the front end's i18n, so the same
// achievement reads in Spanish and in English without duplicating the logic.
//
// Two families:
//   leccion  — three grades per lesson, by labs solved (1, 2, 3).
//   rango    — one global grade for every lesson completed (12 in total).
//
// `leccion`, `rango`, `aprendiz`, `oficiante` and `maestro` are DATA, not
// identifiers: they are written into achievements.code / achievements.kind and
// read back by the front end's i18n. Renaming them is a data migration plus a
// coordinated change in web/, so they stay.

export const LESSON_GRADES = ['aprendiz', 'oficiante', 'maestro'] as const;

/** Code of a lesson achievement: l07.maestro */
export const lessonCode = (n: number, grade: string): string =>
  `l${String(n).padStart(2, '0')}.${grade}`;
/** Code of a global rank: rango.05 */
export const rankCode = (level: number): string => `rango.${String(level).padStart(2, '0')}`;

export const MAX_RANK = 12;

/** One lesson's progress, as the per-lesson queries return it. */
export interface LessonProgress {
  n: number;
  solved: number;
  total: number;
}

/** An achievement as it is written into the `achievements` table. */
export interface EarnedAchievement {
  code: string;
  kind: string;
  lesson_n: number | null;
}

/** Which achievements a progress state earns. */
export function achievementsFor(lessons: readonly LessonProgress[]): EarnedAchievement[] {
  const out: EarnedAchievement[] = [];
  let completed = 0;
  for (const l of lessons) {
    for (let i = 0; i < LESSON_GRADES.length; i++) {
      if (l.solved >= i + 1) {
        out.push({ code: lessonCode(l.n, LESSON_GRADES[i]!), kind: 'leccion', lesson_n: l.n });
      }
    }
    if (l.total > 0 && l.solved === l.total) completed++;
  }
  for (let level = 1; level <= Math.min(completed, MAX_RANK); level++) {
    out.push({ code: rankCode(level), kind: 'rango', lesson_n: null });
  }
  return out;
}

/** Current rank level (0..12) from the codes already earned. */
export function rankLevel(codes: readonly string[]): number {
  let max = 0;
  for (const c of codes) {
    if (!c.startsWith('rango.')) continue;
    const n = Number(c.slice(6));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}
