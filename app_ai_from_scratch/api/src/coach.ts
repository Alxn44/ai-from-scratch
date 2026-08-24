// The proactive assistant's read: the handful of facts a nudge is allowed to be
// built from, in ONE round trip.
//
// WHY AN ENDPOINT AND NOT FOUR EXISTING ONES. The floating AI panel
// (web/src/components/AiPanel.astro) is mounted on EVERY authenticated page, so
// whatever it needs is paid for on every page view. The chat page assembles the
// same picture out of /api/progress + /api/lessons + /api/logros + /api/ranking:
// four HTTP round trips, and three of them return things a nudge never mentions.
// This is one request and four indexed reads.
//
// WHY IT REUSES THE AGENT TOOLS' HELPERS. `me`, `perLesson`, `activeDays`,
// `computeStreak` and `nextStep` are the very functions `mi_panorama` and
// `mi_siguiente_paso` answer with (src/tools/access.ts). Writing a second
// "what should this person do next" would be a second answer to the same
// question, and the day the two disagree the screen and the agent contradict each
// other in front of the student. Same reason the league metal split lives in one
// place: one implementation or none.
//
// WHAT IS DELIBERATELY NOT HERE. No provider call, no model, no prompt. Every
// number below is COUNTED from `attempts`; a nudge whose number cannot be counted
// is not offered at all. Choosing which fact becomes a sentence happens in the
// browser (web/src/lib/coach.ts) out of these fields and nothing else, so the
// proactive assistant costs exactly one SELECT-shaped request and zero tokens.
import { get } from './db.ts';
import { ZONE } from './leagues.ts';
import {
  TOTAL_LABS, TOTAL_LESSONS, activeDays, completed, computeStreak, me, nextStep, perLesson,
} from './tools/access.ts';
import type { Ctx, PerLessonRow } from './tools/access.ts';

/**
 * The next lab, already resolved against the padlock and the drafts.
 *
 * `nextStep` answers a loose `ToolResult` because the model reads it; the panel is
 * typed code, so the wire shape is narrowed here. If nextStep ever grows a third
 * shape this cast is where it will be noticed.
 */
export interface CoachNextLab {
  hay: true;
  lab_id: string;
  leccion: number;
  titulo: string;
  nivel: string;
  ruta: string;
}
export interface CoachNextNone {
  hay: false;
  /** requiere_compra | curso_completo — the same reasons nextStep() gives. */
  motivo: string;
  ruta: string;
  siguienteCerrado: number | null;
}
export type CoachNext = CoachNextLab | CoachNextNone;

export interface CoachState {
  nombre: string;
  pagado: boolean;
  totalLabs: number;
  totalLecciones: number;
  labsResueltos: number;
  leccionesCerradas: number;
  porLeccion: PerLessonRow[];
  /** Consecutive days up to today or yesterday. 0 means it has already broken. */
  racha: number;
  mejorRacha: number;
  diasActivos: number;
  /** Last day with an attempt, as a date in `zona`. null = never. */
  ultimoDia: string | null;
  /**
   * Whole days between that day and today, in the product zone. 0 = solved
   * something today. null = never solved anything, which is a DIFFERENT state
   * from "solved something a long time ago" and gets a different nudge.
   */
  diasSinActividad: number | null;
  zona: string;
  siguiente: CoachNext;
}

// Both dates are converted with the SAME zone the streak uses, in the database,
// so "today" cannot mean one thing here and another in activeDays(). `at` is
// timestamptz, so `AT TIME ZONE` reads it as a local wall clock — the same
// direction as the streak query in src/tools/access.ts.
const SQL_GAP = `
  SELECT ((now() AT TIME ZONE ?)::date - (MAX(at) AT TIME ZONE ?)::date)::int AS dias
  FROM attempts WHERE user_id = ?`;

/** Everything the proactive assistant may know about the asking person. */
export async function coachState(userId: number, lang: string): Promise<CoachState | null> {
  const ctx: Ctx = { userId, lang };
  const u = await me(ctx);
  if (!u) return null;

  const [rows, days, gap] = await Promise.all([
    perLesson(ctx),
    activeDays(ctx),
    get<{ dias: number | null }>(SQL_GAP, [ZONE, ZONE, userId]),
  ]);
  const streak = computeStreak(days.map((r) => r.dia));
  const step = await nextStep(ctx, u);

  return {
    nombre: String(u.name).split(' ')[0] ?? '',
    pagado: !!u.paid,
    totalLabs: TOTAL_LABS,
    totalLecciones: TOTAL_LESSONS,
    labsResueltos: rows.reduce((s, r) => s + r.resueltos, 0),
    leccionesCerradas: completed(rows),
    porLeccion: rows,
    racha: streak.racha,
    mejorRacha: streak.mejorRacha,
    diasActivos: streak.diasActivos,
    ultimoDia: streak.activo,
    diasSinActividad: gap?.dias ?? null,
    zona: ZONE,
    siguiente: step.hay
      ? { hay: true, lab_id: String(step.lab_id), leccion: Number(step.leccion),
          titulo: String(step.titulo), nivel: String(step.nivel), ruta: String(step.ruta) }
      : { hay: false, motivo: String(step.motivo ?? 'desconocido'), ruta: String(step.ruta ?? '/curso'),
          siguienteCerrado: typeof step.siguienteCerrado === 'number' ? step.siguienteCerrado : null },
  };
}
