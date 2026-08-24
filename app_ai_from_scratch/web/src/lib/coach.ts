// The proactive assistant's brain. Pure functions: no DOM, no fetch, no clock of
// its own — the caller passes `now`, so every rule below is testable and none of
// them can fire twice because two timers disagreed.
//
// TWO RULES THIS FILE EXISTS TO ENFORCE
//
// 1. IT NEVER INVENTS A NUMBER. Every sentence is built from a field the API
//    counted (api/src/coach.ts): labs solved, days since the last attempt, the
//    live streak, the next unsolved lab. There is no "students like you usually",
//    no estimated time, no percentage nobody measured. If a fact is missing the
//    nudge is simply not offered — see `pickNudge` returning null.
// 2. IT NEVER ASKS A MODEL WHAT TO SAY. A proactive assistant that polls an LLM to
//    decide whether to speak is an invoice that grows while the student reads. The
//    facts arrive in one cheap request and the sentence is chosen here, offline.
//
// The panel (components/AiPanel.astro) owns the two things that need the DOM:
// "is the student typing" and "is this tab visible". Everything else is here.

// ---------------------------------------------------------------------------
// THE WIRE SHAPE — GET /api/coach. Mirrors api/src/coach.ts.
// ---------------------------------------------------------------------------

export interface CoachLesson { n: number; total: number; resueltos: number }

export type CoachNext =
  | { hay: true; lab_id: string; leccion: number; titulo: string; nivel: string; ruta: string }
  | { hay: false; motivo: string; ruta: string; siguienteCerrado: number | null };

export interface CoachState {
  nombre: string;
  pagado: boolean;
  totalLabs: number;
  totalLecciones: number;
  labsResueltos: number;
  leccionesCerradas: number;
  porLeccion: CoachLesson[];
  racha: number;
  mejorRacha: number;
  diasActivos: number;
  ultimoDia: string | null;
  diasSinActividad: number | null;
  zona: string;
  siguiente: CoachNext;
}

// ---------------------------------------------------------------------------
// THE BUDGET
//
// Five numbers. Each one is a limit somebody would otherwise have to mute the
// whole feature to escape.
//
//   MAX_PER_SESSION = 2   Two is enough to say the two useful things ("lesson 3
//                         is one lab from closing", and later "you have not been
//                         back in four days"). The third one is the one that gets
//                         a feature muted, so there is no third one.
//   MIN_GAP_MS = 6 min    Counted from the LAST nudge on this device, not from
//                         the page load, so walking between four sidebar tabs
//                         cannot produce four nudges. Six minutes is longer than
//                         reading a lesson section takes, which is the shortest
//                         thing a student does here between navigations.
//   FIRST_DELAY_MS = 25 s Arriving on a page is the worst moment to be
//                         interrupted: the student is looking for something. The
//                         nudge waits until they have settled.
//   QUIET_AFTER_KEY_MS    Never while they are typing. Any keystroke in a field
//                    = 5 s (a lab answer, the chat box) pushes the nudge back.
//   REPEAT_AFTER_MS       The SAME nudge does not come back for 20 hours. A daily
//                    = 20 h reminder is a reminder; an hourly one is nagging. 20
//                         rather than 24 so it can still land at the same time of
//                         day tomorrow.
//
// And one rule with no number: NEVER TWICE IN A ROW. The nudge that was shown
// last is skipped even if it is the most urgent one, so the assistant cannot
// repeat itself — that is what makes it feel like a nag rather than an assistant.
// ---------------------------------------------------------------------------

export const MAX_PER_SESSION = 2;
export const MIN_GAP_MS = 6 * 60_000;
export const FIRST_DELAY_MS = 25_000;
export const QUIET_AFTER_KEY_MS = 5_000;
export const REPEAT_AFTER_MS = 20 * 60 * 60_000;

/** What the caller remembers between nudges. Serialised to storage as-is. */
export interface NudgeBudget {
  /** Nudges shown in this tab's session. */
  shown: number;
  /** Id of the last nudge shown on this device, so it cannot repeat back to back. */
  lastId: string | null;
  /** When it was shown, epoch ms. 0 = never. */
  lastAt: number;
  /** id → epoch ms of the last time that specific nudge was shown. */
  seen: Record<string, number>;
}

export const EMPTY_BUDGET: NudgeBudget = { shown: 0, lastId: null, lastAt: 0, seen: {} };

export type NudgeId =
  | 'empezar' | 'volver' | 'racha' | 'cerrar' | 'retomar' | 'compra' | 'completo' | 'siguiente';

export interface Nudge {
  id: NudgeId;
  texto: string;
  accion: { txt: string; href: string } | null;
}

/** The strings the nudges are written from. Filled by lib/i18n.ts. */
export interface NudgeText {
  nEmpezar: string;
  nVolver: string;
  nRacha: string;
  nCerrar: string;
  nRetomar: string;
  nSiguiente: string;
  nCompra: string;
  nCompleto: string;
  irLeccion: string;
  irPago: string;
  irLigas: string;
}

const fill = (s: string, v: Record<string, string | number>): string =>
  Object.entries(v).reduce((a, [k, x]) => a.replaceAll(`{${k}}`, String(x)), s ?? '');

/**
 * Every nudge this state supports, most useful first.
 *
 * Exported separately from `pickNudge` because the ordering IS the product
 * decision: "you are one lab from closing lesson 3" beats "here is the next lab"
 * every time, and a reader should be able to see that order without reading the
 * budget logic wrapped around it.
 */
export function candidates(s: CoachState, T: NudgeText): Nudge[] {
  const out: Nudge[] = [];
  const next = s.siguiente;
  const toLesson = (n: number): { txt: string; href: string } =>
    ({ txt: fill(T.irLeccion, { n }), href: `/leccion/${n}` });

  // Never solved anything. A different state from "has not been back in a while",
  // and it gets its own sentence rather than a «0 days» that reads like a bug.
  if (s.diasSinActividad === null && next.hay) {
    out.push({ id: 'empezar', texto: fill(T.nEmpezar, { lab: next.lab_id, n: next.leccion }),
               accion: toLesson(next.leccion) });
  }

  // Away for three days or more. Under three it is a weekend, not a lapse.
  if (s.diasSinActividad !== null && s.diasSinActividad >= 3 && next.hay) {
    out.push({ id: 'volver', texto: fill(T.nVolver, { d: s.diasSinActividad, lab: next.lab_id }),
               accion: toLesson(next.leccion) });
  }

  // The streak is alive but today is still empty. Only counts from two days: at
  // one day there is no streak worth protecting.
  if (s.racha >= 2 && s.diasSinActividad !== null && s.diasSinActividad >= 1 && next.hay) {
    out.push({ id: 'racha', texto: fill(T.nRacha, { r: s.racha }), accion: toLesson(next.leccion) });
  }

  // A lesson one lab away from closing, and one with more than one left. Only
  // lessons with something already solved are considered, which is also what makes
  // them safe to link to: a locked lesson cannot have a solved lab in it.
  const started = s.porLeccion.filter((l) => l.total > 0 && l.resueltos > 0 && l.resueltos < l.total);
  const nearly = started.find((l) => l.total - l.resueltos === 1);
  if (nearly) {
    out.push({ id: 'cerrar', texto: fill(T.nCerrar, { n: nearly.n }), accion: toLesson(nearly.n) });
  }
  const halfway = started.find((l) => l.total - l.resueltos >= 2);
  if (halfway) {
    out.push({ id: 'retomar', texto: fill(T.nRetomar, { n: halfway.n, k: halfway.total - halfway.resueltos }),
               accion: toLesson(halfway.n) });
  }

  if (!next.hay && next.motivo === 'requiere_compra') {
    out.push({ id: 'compra', texto: fill(T.nCompra, { n: next.siguienteCerrado ?? '' }),
               accion: { txt: T.irPago, href: next.ruta } });
  }
  if (!next.hay && next.motivo === 'curso_completo') {
    out.push({ id: 'completo', texto: fill(T.nCompleto, { n: s.totalLabs }),
               accion: { txt: T.irLigas, href: next.ruta } });
  }

  // Last, because it is the least informative thing that is still true.
  if (next.hay) {
    out.push({ id: 'siguiente', texto: fill(T.nSiguiente, { lab: next.lab_id, n: next.leccion, t: next.titulo }),
               accion: toLesson(next.leccion) });
  }
  return out;
}

/** True when the budget allows a nudge at all, ignoring which one it would be. */
export function withinBudget(b: NudgeBudget, now: number, loadedAt: number): boolean {
  if (b.shown >= MAX_PER_SESSION) return false;
  if (now - loadedAt < FIRST_DELAY_MS) return false;
  if (b.lastAt && now - b.lastAt < MIN_GAP_MS) return false;
  return true;
}

/**
 * The nudge to show now, or null.
 *
 * Returning null is the common case and it is not a failure: silence is the
 * default behaviour of this feature.
 */
export function pickNudge(
  s: CoachState, T: NudgeText, b: NudgeBudget, now: number, loadedAt: number,
): Nudge | null {
  if (!withinBudget(b, now, loadedAt)) return null;
  for (const c of candidates(s, T)) {
    if (c.id === b.lastId) continue;                             // never twice in a row
    const last = b.seen[c.id] ?? 0;
    if (last && now - last < REPEAT_AFTER_MS) continue;          // per-nudge cooldown
    return c;
  }
  return null;
}

/** The budget after INTERRUPTING with `id`. Pure: the caller persists the result. */
export function spend(b: NudgeBudget, id: NudgeId, now: number): NudgeBudget {
  return { shown: b.shown + 1, lastId: id, lastAt: now, seen: { ...b.seen, [id]: now } };
}

/**
 * The budget after ANSWERING with `id` — the panel was opened, so the student
 * asked and this was not an interruption.
 *
 * `shown` does not move (the per-visit allowance is about interruptions) and
 * neither does `lastAt` (the six-minute gap starts at an interruption, not at an
 * answer), but the cooldown does: having just read "you have not solved a lab
 * yet" in the panel, being told the same thing again 30 seconds later as a nudge
 * is the exact repetition this file exists to prevent.
 */
export function noted(b: NudgeBudget, id: NudgeId, now: number): NudgeBudget {
  return { ...b, lastId: id, seen: { ...b.seen, [id]: now } };
}
