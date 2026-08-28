// Public shape of a quiz/exam question. `solution` never appears here.
import { examGate, passMark } from './quizzes.ts';

export interface QuestionRow {
  id: string;
  kind: string;
  pack: string;
  idx: number;
  lesson_n: number;
  prompt_es: string;
  prompt_en: string;
  payload: string;
}

export interface QuestionBest {
  question_id: string;
  solved: number | null;
  attempts: number;
}

export interface PublicQuestion {
  id: string;
  kind: string;
  pack: string;
  idx: number;
  lesson: number;
  prompt: string;
  options: { id: string; text: string }[];
  solved: boolean;
  attempts: number;
}

export function publicQuestion(
  row: QuestionRow,
  lang: string,
  best?: QuestionBest | null,
): PublicQuestion {
  const payload = JSON.parse(row.payload) as { options?: { id: string; es: string; en: string }[] };
  const en = lang === 'en';
  const options = (payload.options ?? []).map((o) => ({
    id: o.id,
    text: en ? o.en : o.es,
  }));
  return {
    id: row.id,
    kind: row.kind,
    pack: row.pack,
    idx: row.idx,
    lesson: row.lesson_n,
    prompt: en ? row.prompt_en : row.prompt_es,
    options,
    solved: (best?.solved ?? 0) === 1,
    attempts: best?.attempts ?? 0,
  };
}

export function packScore(rows: QuestionBest[], total: number): {
  correct: number; total: number; passed: boolean; passAt: number;
} {
  const correct = rows.filter((r) => r.solved === 1).length;
  const need = passMark(total);
  return { correct, total, passed: correct >= need, passAt: need };
}

export function ofPack(rows: QuestionBest[], pack: string): QuestionBest[] {
  const p = `${pack}.`;
  return rows.filter((r) => r.question_id.startsWith(p));
}

export { examGate, passMark };
