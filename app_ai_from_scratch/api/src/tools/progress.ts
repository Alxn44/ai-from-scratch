// Family `propio` — this person: progress, mistakes, streak, pace, league, access.
// 16 tools.
//
// Everything here is `publico: false`: the answer depends on who is asking, so it
// may only be reused inside the same model turn. Between two messages the person
// may have solved a lab in another tab and stale progress would be a lie.
//
// The `descripcion` and `nota` strings stay Spanish: they are read by the model
// (docs/NAMING.md).
import { many, one } from '../data.ts';
import type { AchievementRow, AttemptRow, LessonRow } from '../db.ts';
import { assertNoForbidden } from '../ontology.ts';
import { LESSON_GRADES, MAX_RANK, achievementsFor, lessonCode, rankCode } from '../achievements.ts';
import { MIN_LEAGUE, METALS, ZONE, assignMetals, currentWeek, flow } from '../leagues.ts';
import { PRICE } from '../product.ts';
import { bus, enqueue, seed, top, viewQueue } from '../agent-bus.ts';
import {
  FREE_LESSONS, LAB_ID, TOTAL_LABS, activeDays, completed, computeStreak,
  hasAccess, language, leagueFor, lockedByPaywall, me, mechanicIn, memoKey, nextStep,
  pending, perLesson, readableLessons, truncate,
} from './access.ts';
import type { Ctx, Registry, SafeLab, ToolResult } from './access.ts';

export const PROGRESS_TOOLS: Registry = {

  mi_panorama: {
    familia: 'propio', publico: false,
    descripcion: 'TODO el estado de esta persona de una sola vez: perfil, progreso, racha, siguiente paso, liga y qué tiene en la cola. Empieza por aquí: ahorra cuatro llamadas.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      const [rows, days, league] = await Promise.all([perLesson(ctx), activeDays(ctx), leagueFor(ctx, u)]);
      const step = await nextStep(ctx, u);
      const labs = rows.reduce((s, r) => s + r.resueltos, 0);
      const profile = {
        nombre: String(u.name).split(' ')[0], rol: u.role, idioma: u.lang,
        pagado: !!u.paid, cohorte: u.cohort, desde: u.created_at,
      };
      const progress = { labsResueltos: labs, totalLabs: TOTAL_LABS, leccionesCerradas: completed(rows), porLeccion: rows };
      const dates = days.map((r) => r.dia);
      const streak = { ...computeStreak(dates), zona: ZONE, ultimosDias: dates.slice(0, 14) };
      const b = bus(ctx.userId);
      return {
        perfil: profile, progreso: progress, racha: streak, siguiente: step,
        liga: { activa: league.activa, yo: league.yo, motivo: league.motivo ?? null, semana: league.semana },
        cola: { largo: viewQueue(b).length, siguienteEnCola: viewQueue(b)[0] ?? null },
        foco: top(b),
      };
    },
    // Seeds the memo: if the model later asks for the profile, the progress, the
    // streak or the next step separately, it does not go back to the database in
    // this turn.
    efecto(ctx: Ctx, _args, out: ToolResult): void {
      if (out?.error) return;
      const b = bus(ctx.userId);
      const scope = { public: false, turn: ctx.turn ?? null };
      seed(b, memoKey('mi_perfil', {}, ctx), out.perfil, scope);
      seed(b, memoKey('mi_progreso', {}, ctx), out.progreso, scope);
      seed(b, memoKey('mi_racha', {}, ctx), out.racha, scope);
      seed(b, memoKey('mi_siguiente_paso', {}, ctx), out.siguiente, scope);
    },
  },

  mi_progreso: {
    familia: 'propio', publico: false,
    descripcion: 'Cuántas lecciones, labs, quizzes y exámenes lleva resueltos la persona de esta sesión, lección por lección.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const rows = await perLesson(ctx);
      const [packs, best] = await Promise.all([
        many<{ pack: string; kind: string; total: number }>('question.packs'),
        many<{ question_id: string; solved: number | null }>('qattempt.best_by_question', {}, ctx.userId),
      ]);
      const solved = new Set(best.filter((b) => b.solved === 1).map((b) => b.question_id));
      const currentIds = new Map(await Promise.all(packs.map(async (p) => [
        p.pack, new Set((await many<{ id: string }>('question.list_for_pack', { pack: p.pack })).map((r) => r.id)),
      ] as const)));
      const quizPacks = packs.filter((p) => p.kind === 'quiz');
      const examPacks = packs.filter((p) => p.kind === 'exam');
      const quizzesHechos = quizPacks.filter((p) =>
        [...solved].filter((id) => currentIds.get(p.pack)?.has(id)).length >= (currentIds.get(p.pack)?.size ?? 0)).length;
      const examenes = examPacks.map((p) => {
        const ids = currentIds.get(p.pack) ?? new Set<string>();
        const acertadas = [...solved].filter((id) => ids.has(id)).length;
        const corte = Math.ceil(ids.size * 0.7);
        return { n: Number(p.pack.slice(1)), acertadas, total: ids.size, corte, aprobado: acertadas >= corte };
      });
      return {
        labsResueltos: rows.reduce((s, r) => s + r.resueltos, 0), totalLabs: TOTAL_LABS,
        leccionesCerradas: completed(rows), porLeccion: rows,
        quizzesHechos, quizzesTotal: quizPacks.length,
        examenesAprobados: examenes.filter((e) => e.aprobado).length,
        examenes,
      };
    },
  },

  mis_intentos: {
    familia: 'propio', publico: false, paywalled: true,
    descripcion: 'Los intentos de la persona de esta sesión en un lab, con lo que respondió. La explicación solo llega si ya lo intentó.',
    args: { lab_id: 'texto como «5.2»' },
    async fn(ctx: Ctx, { lab_id }): Promise<ToolResult> {
      const id = String(lab_id ?? '');
      if (!LAB_ID.test(id)) return { error: 'lab_invalido' };
      const card = await one<Pick<SafeLab, 'id' | 'lesson_n' | 'idx' | 'level' | 'kind' | 'draft'>>(
        'lab.card_by_id', { id });
      if (!card) return { error: 'no_existe' };
      // Found by obligation P4, not by a person: this tool returns labs.prompt,
      // labs.payload and labs.explanation, all three behind the paywall, and it
      // never checked. Own attempts are not a licence to read the statement of a
      // lesson this account cannot open.
      if (!(await readableLessons(ctx)).has(Number(card.lesson_n))) return lockedByPaywall(Number(card.lesson_n));
      const [lab, attemptsDesc] = await Promise.all([
        one<SafeLab>('lab.get', { id }),
        many<Pick<AttemptRow, 'lab_id' | 'answer' | 'correct' | 'at'>>(
          'attempt.mine_for_lab', { lab_id: id }, ctx.userId),
      ]);
      if (!lab) return { error: 'no_existe' };
      const attempts = attemptsDesc.reverse();
      assertNoForbidden('labs', lab);
      // The explanation behaves the same as in the interface: it appears once
      // there has been an attempt, not before. With no attempts there is nothing
      // to explain.
      const explanation = attempts.length
        ? assertNoForbidden('labs', await one<{ explanation: string }>('lab.explanation', { id }))?.explanation ?? null
        : null;
      return {
        lab, intentos: attempts, resuelto: attempts.some((i) => i.correct === 1),
        explicacion: explanation,
        nota: explanation ? undefined : 'Esta persona todavía no ha intentado este lab: no le des la explicación ni la respuesta.',
      };
    },
  },

  mi_perfil: {
    familia: 'propio', publico: false,
    descripcion: 'Nombre de pila, rol, idioma y si compró el curso. Solo de la sesión actual.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      return {
        nombre: String(u.name).split(' ')[0],
        rol: u.role, idioma: u.lang, pagado: !!u.paid,
        cohorte: u.cohort, desde: u.created_at,
      };
    },
  },

  mi_siguiente_paso: {
    familia: 'propio', publico: false,
    descripcion: 'Qué lab concreto sigue ahora, respetando candados y borradores. La respuesta a «¿qué hago?». Deja el lab en la cola.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      return nextStep(ctx, u);
    },
    efecto(ctx: Ctx, _args, out: ToolResult): void {
      if (out?.hay) enqueue(bus(ctx.userId), { tipo: 'lab', ref: out.lab_id, motivo: 'siguiente_paso' });
    },
  },

  mis_pendientes: {
    familia: 'propio', publico: false,
    descripcion: 'Los labs que le faltan, en orden de curso, marcando los que están cerrados por compra. Opcionalmente los de una sola lección.',
    args: { n: 'opcional · entero 1..12 para filtrar por lección' },
    async fn(ctx: Ctx, { n }): Promise<ToolResult> {
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      const num = n === undefined || n === null || n === '' ? null : Number(n);
      if (num !== null && (!Number.isInteger(num) || num < 1 || num > 12)) return { error: 'leccion_invalida' };
      const every = await pending(ctx, u);
      const list = num === null ? every : every.filter((l) => l.leccion === num);
      return {
        leccion: num, pendientes: list.length,
        abiertos: list.filter((l) => !l.cerrado && !l.borrador).length,
        cerrados: list.filter((l) => l.cerrado).length,
        labs: list.slice(0, 20),
      };
    },
  },

  mis_errores: {
    familia: 'propio', publico: false, paywalled: true,
    descripcion: 'Los labs que intentó y no ha resuelto, con lo que respondió y qué mecánica se le atraviesa. Aquí está el patrón del error. Los deja en la cola.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const failed = await many<{
        lab_id: string; intentos: number; ultimo: string;
        lesson_n: number; level: string; kind: string; prompt: string;
      }>('progress.failed_labs', {}, ctx.userId);
      if (!failed.length) return { atascados: 0, labs: [], porMecanica: [], nota: 'No hay labs intentados sin resolver.' };
      const wrong = await many<Pick<AttemptRow, 'lab_id' | 'answer' | 'at'>>(
        'progress.wrong_attempts', {}, ctx.userId);
      const perLab = new Map<string, { respuesta: string; at: Date }[]>();
      for (const m of wrong) {
        const xs = perLab.get(m.lab_id) ?? [];
        if (xs.length < 3) { xs.push({ respuesta: m.answer, at: m.at }); perLab.set(m.lab_id, xs); }
      }
      const byMechanic = new Map<string, number>();
      // Attempt rows OUTLIVE the entitlement that created them: POST
      // /labs/:id/attempt checks access at attempt time only. So a refund
      // (users.paid -> 0) or a tutor demoted to student leaves rows behind, and
      // this tool kept serving 180 characters of `labs.prompt` from lessons the
      // account can no longer open. Found by P4, not by a reviewer.
      const readable = await readableLessons(ctx);
      const visible = failed.filter((f) => readable.has(Number(f.lesson_n)));
      const hidden = failed.length - visible.length;
      for (const f of visible) byMechanic.set(f.kind, (byMechanic.get(f.kind) ?? 0) + 1);
      const lang = language(ctx, null);
      return {
        atascados: visible.length,
        cerradosPorCompra: hidden || undefined,
        labs: visible.slice(0, 8).map((f) => ({
          lab_id: f.lab_id, leccion: f.lesson_n, nivel: f.level, mecanica: f.kind,
          comoSeResponde: mechanicIn(f.kind, lang),
          enunciado: truncate(f.prompt), intentos: f.intentos, ultimo: f.ultimo,
          misRespuestasMalas: perLab.get(f.lab_id) ?? [],
        })),
        porMecanica: [...byMechanic].map(([mecanica, labs]) => ({ mecanica, labs })).sort((a, b) => b.labs - a.labs),
        nota: hidden
          ? `Hay ${hidden} lab(s) atascado(s) en lecciones cerradas para esta cuenta: no los enseñes, ofrece la compra.`
          : 'Da una pista que apunte a la lección. No la solución.',
      };
    },
    efecto(ctx: Ctx, _args, out: ToolResult): void {
      const b = bus(ctx.userId);
      for (const l of (out?.labs ?? []) as { lab_id: string }[]) {
        enqueue(b, { tipo: 'lab', ref: l.lab_id, motivo: 'atascado' });
      }
    },
  },

  mi_racha: {
    familia: 'propio', publico: false,
    descripcion: 'Días seguidos con actividad, mejor racha y cuándo fue la última vez. Sirve para «llevas dos semanas sin abrirlo».',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const days = (await activeDays(ctx)).map((r) => r.dia);
      return { ...computeStreak(days), zona: ZONE, ultimosDias: days.slice(0, 14) };
    },
  },

  mi_ritmo: {
    familia: 'propio', publico: false,
    descripcion: 'Cuántos labs resuelve por semana y, a ese ritmo, cuánto le falta para terminar los 36. Responde «¿cuánto me queda?».',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const weeks = await many<{ semana: string; labs: number }>(
        'progress.weekly_pace', { zone: ZONE }, ctx.userId);
      // The total is counted separately: adding up the six weeks in the list would
      // tell someone who started a year ago that they are missing labs they have
      // already solved.
      const total = await one<{ c: number }>('progress.solved_count', {}, ctx.userId);
      const done = total?.c ?? 0;
      const recent = weeks.slice(0, 4);
      const mean = recent.length ? recent.reduce((s, r) => s + r.labs, 0) / recent.length : 0;
      const left = Math.max(0, TOTAL_LABS - done);
      return {
        resueltos: done, faltan: left, totalLabs: TOTAL_LABS,
        porSemana: weeks, mediaUltimas4: Number(mean.toFixed(1)),
        semanasEstimadas: mean > 0 ? Math.ceil(left / mean) : null,
        nota: mean > 0 ? undefined : 'Sin semanas con aciertos no hay ritmo que proyectar: no inventes una fecha.',
      };
    },
  },

  mi_historial: {
    familia: 'propio', publico: false,
    descripcion: 'Los últimos intentos con su fecha: qué tocó y si acertó. Responde «¿qué hice ayer?».',
    args: { dias: 'opcional · entero 1..30, por defecto 7' },
    async fn(ctx: Ctx, { dias }): Promise<ToolResult> {
      const d = dias === undefined || dias === null || dias === '' ? 7 : Number(dias);
      if (!Number.isInteger(d) || d < 1 || d > 30) return { error: 'dias_invalido' };
      const rows = await many<{ lab_id: string; correct: number; at: string; lesson_n: number }>(
        'progress.history', { days: d }, ctx.userId);
      return {
        dias: d, intentos: rows.length,
        aciertos: rows.filter((f) => f.correct === 1).length,
        eventos: rows.map((f) => ({ lab_id: f.lab_id, leccion: f.lesson_n, acerto: f.correct === 1, at: f.at })),
        nota: rows.length ? undefined : `Sin actividad en los últimos ${d} días.`,
      };
    },
  },

  mi_acceso: {
    familia: 'propio', publico: false,
    descripcion: 'Qué tiene abierto y qué no, y por qué. La respuesta a «¿por qué no puedo abrir la lección 4?».',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      const lessons = await many<Pick<LessonRow, 'n' | 'title'>>('lesson.list');
      const open = lessons.filter((l) => hasAccess(u, l.n)).map((l) => l.n);
      const locked = lessons.filter((l) => !hasAccess(u, l.n)).map((l) => l.n);
      return {
        pagado: !!u.paid, rol: u.role, leccionesLibres: FREE_LESSONS,
        abiertas: open, cerradas: locked,
        porQue: u.paid ? 'La compra está confirmada: están abiertas las 12.'
          : locked.length ? `Sin compra están abiertas la ${FREE_LESSONS} y sus 3 labs; el resto devuelve «requiere compra».`
          : 'El rol de esta cuenta abre todo el curso sin compra.',
        precio: u.paid ? null : { monto: PRICE.monto, moneda: PRICE.moneda, garantiaDias: PRICE.garantiaDias, ruta: '/pago' },
      };
    },
  },

  mis_logros: {
    familia: 'propio', publico: false,
    descripcion: 'El rango de la persona de esta sesión. Un rango por cada lección cerrada.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const rows = await perLesson(ctx);
      const done = completed(rows);
      const earned = (await many<Pick<AchievementRow, 'code' | 'kind' | 'lesson_n' | 'earned_at'>>(
        'achievement.mine', {}, ctx.userId)).slice(0, 8);
      earned.forEach((g) => assertNoForbidden('achievements', g));
      return {
        leccionesCerradas: done,
        rango: Math.min(done, MAX_RANK),
        rangoMax: MAX_RANK,
        faltanParaSiguiente: done >= MAX_RANK ? 0 : 1,
        ultimos: earned,
        ruta: '/logros',
      };
    },
  },

  logros_faltantes: {
    familia: 'propio', publico: false,
    descripcion: 'Qué logros le faltan y qué hay que hacer exactamente para cada uno. Responde «¿qué me falta para el siguiente?».',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const rows = await perLesson(ctx);
      const should = achievementsFor(rows.map((r) => ({ n: r.n, solved: r.resueltos, total: r.total })));
      const has = new Set((await many<{ code: string }>(
        'achievement.codes', {}, ctx.userId)).map((r) => r.code));
      const missing: { code: string; kind: string; leccion?: number; comoSeGana: string; teFaltan: number }[] = [];
      for (const r of rows) {
        for (let i = 0; i < LESSON_GRADES.length; i++) {
          const code = lessonCode(r.n, LESSON_GRADES[i]!);
          if (r.resueltos < i + 1) {
            missing.push({ code, kind: 'leccion', leccion: r.n,
                           comoSeGana: `resolver ${i + 1} de los ${r.total} labs de la lección ${r.n}`,
                           teFaltan: i + 1 - r.resueltos });
          }
        }
      }
      const done = completed(rows);
      for (let level = done + 1; level <= MAX_RANK; level++) {
        missing.push({ code: rankCode(level), kind: 'rango',
                       comoSeGana: `cerrar ${level} lecciones completas`, teFaltan: level - done });
      }
      return {
        ganados: has.size, alcanzados: should.length, faltan: missing.length,
        siguientes: missing.sort((a, b) => a.teFaltan - b.teFaltan).slice(0, 6),
        ruta: '/logros',
      };
    },
  },

  mi_liga: {
    familia: 'propio', publico: false,
    descripcion: 'Su liga de esta semana: metal, puesto, caudal y cuándo cierra. Si no está en liga, dice exactamente qué falta.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      const e = await leagueFor(ctx, u);
      const explains: Record<string, string> = {
        requiere_compra: 'La liga es para quien compró: sin compra no hay ascenso que usar.',
        sin_alias: 'Hace falta apuntarse al ranking con un alias. El alias es lo único público.',
        cohorte_insuficiente: `Por debajo de ${MIN_LEAGUE} personas no hay liga: una liga de dos no compara nada.`,
      };
      // `in`, not `e.motivo`: leagueFor returns four shapes and the successful one
      // carries no `motivo` at all, so reading the property off the union is
      // unsound even though the runtime value would be undefined and land on the
      // same default. Narrowing says which branch we are in instead of guessing.
      const reason = 'motivo' in e ? e.motivo : null;
      return {
        ...e,
        explicacion: reason
          ? explains[reason]
          : 'Mide el caudal de la semana: labs resueltos por primera vez, lunes a domingo.',
        ruta: '/ligas',
      };
    },
  },

  ligas_tabla: {
    familia: 'propio', publico: false,
    descripcion: 'La tabla de la liga semanal: alias, metal, puesto y caudal de quienes aceptaron aparecer. Nunca nombres ni correos.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const [rows, week] = await Promise.all([flow(), currentWeek()]);
      if (rows.length < MIN_LEAGUE) {
        return { activa: false, motivo: 'cohorte_insuficiente', minimo: MIN_LEAGUE, participantes: rows.length, semana: week, tabla: [] };
      }
      // The user_id never goes out: the alias is the only public thing about
      // another person.
      const table = assignMetals(rows).map(({ user_id, ...r }) => r);
      const mine = await one<{ alias: string }>('ranking.mine', {}, ctx.userId);
      return {
        activa: true, semana: week, zona: ZONE, metales: METALS, participantes: table.length,
        tabla: table.slice(0, 30), miAlias: mine?.alias ?? null, ruta: '/ligas',
      };
    },
  },

  ranking_publico: {
    familia: 'propio', publico: false,
    descripcion: 'Alias y avance de quienes aceptaron aparecer, más la posición propia. Nunca nombres ni correos.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      // Alias only: no tool exposes the alias -> name/email mapping, so «who is
      // kata.mono» has no answer down this path.
      const [allRows, mine] = await Promise.all([
        many<{ alias: string; lecciones: number; labs: number }>('ranking.table'),
        one<{ alias: string }>('ranking.mine', {}, ctx.userId),
      ]);
      const table = allRows.slice(0, 20).map(({ alias, lecciones }) => ({ alias, lecciones }));
      return {
        disponible: true,
        apuntado: !!mine,
        miAlias: mine?.alias ?? null,
        miPuesto: mine ? (table.findIndex((r) => r.alias === mine.alias) + 1) || null : null,
        tabla: table,
      };
    },
  },
};
