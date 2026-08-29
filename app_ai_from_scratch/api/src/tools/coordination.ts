// Family `coordinar` — the stack and the queue (see src/agent-bus.ts). 7 tools.
//
// These are the ones that make 39 tools fit inside the 4-turn cap: one tool
// produces work, another consumes it already resolved. All of them are
// `cachea: false`, because they MUTATE the queue or the stack — a memoised
// `cola_siguiente` would hand out the same head twice.
//
// The `descripcion` and `nota` strings stay Spanish: they are read by the model
// (docs/NAMING.md).
import { many, one } from '../data.ts';
import type { AttemptRow, LessonRow } from '../db.ts';
import { assertNoForbidden } from '../ontology.ts';
import { glossaryFor } from '../product.ts';
import {
  KINDS, bus, dequeue, diagnostics, enqueue, pop, push, top, viewQueue, viewStack,
} from '../agent-bus.ts';
import {
  LAB_ID, language, lessonText, lockedByPaywall, me, mechanicIn, pending,
  readableLessons, toolCount, truncate,
} from './access.ts';
import type { Ctx, Registry, SafeLab, ToolResult } from './access.ts';

export const COORDINATION_TOOLS: Registry = {

  plan_estudio: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Arma un plan con los siguientes labs en orden y lo deja en la cola. Después, cada `cola_siguiente` entrega uno ya resuelto con su contexto.',
    args: { sesiones: 'opcional · entero 1..12, cuántos labs planear; por defecto 5' },
    async fn(ctx: Ctx, { sesiones }): Promise<ToolResult> {
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      const howMany = sesiones === undefined || sesiones === null || sesiones === '' ? 5 : Number(sesiones);
      if (!Number.isInteger(howMany) || howMany < 1 || howMany > 12) return { error: 'sesiones_invalido' };
      const left = await pending(ctx, u);
      const plan = left.filter((l) => !l.cerrado && !l.borrador).slice(0, howMany);
      const b = bus(ctx.userId);
      const queued = plan.map((l) => enqueue(b, { tipo: 'lab', ref: l.lab_id, motivo: 'plan' }));
      const locked = left.filter((l) => l.cerrado).length;
      return {
        plan: plan.map((l, i) => ({ orden: i + 1, lab_id: l.lab_id, leccion: l.leccion, titulo: l.titulo, nivel: l.level, mecanica: l.kind })),
        encolados: queued.filter((e) => e.ok).length,
        yaEstaban: queued.filter((e) => 'razon' in e && e.razon === 'ya_estaba').length,
        enCola: viewQueue(b).length,
        cerradosPorCompra: locked,
        comoSeGasta: 'Llama `cola_siguiente` para recibir el primero con su ficha, sus intentos y su lección. No hace falta pedir cada cosa aparte.',
        nota: plan.length ? undefined : 'No hay labs abiertos sin resolver para planear.',
      };
    },
  },

  cola_siguiente: {
    familia: 'coordinar', publico: false, cachea: false, paywalled: true,
    descripcion: 'Saca lo primero de la cola y lo devuelve YA RESUELTO: ficha del lab, intentos propios, explicación si ya lo intentó y la lección de donde sale. Una llamada en vez de tres.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const b = bus(ctx.userId);
      const item = dequeue(b);
      if (!item) return { vacia: true, nota: 'La cola está vacía. `plan_estudio` o `mis_errores` la llenan.' };
      const lang = language(ctx, null);
      const readable = await readableLessons(ctx);
      if (item.tipo === 'lab') {
        const card = await one<Pick<SafeLab, 'id' | 'lesson_n' | 'idx' | 'level' | 'kind' | 'draft'>>(
          'lab.card_by_id', { id: item.ref });
        if (!card) return { item, error: 'no_existe' };
        if (!readable.has(Number(card.lesson_n))) return { item, ...lockedByPaywall(Number(card.lesson_n)) };
        const lab = await one<SafeLab>('lab.get', { id: item.ref });
        if (!lab) return { item, error: 'no_existe' };
        assertNoForbidden('labs', lab);
        const attempts = (await many<Pick<AttemptRow, 'answer' | 'correct' | 'at'>>(
          'attempt.mine_for_lab', { lab_id: item.ref }, ctx.userId)).reverse();
        // The second read has to pass the same guard as the first. It used to
        // bypass it, so a reclassified column would have kept leaking here while
        // the isolation proof still reported green.
        const explanation = attempts.length
          ? assertNoForbidden('labs', await one<{ explanation: string }>('lab.explanation', { id: item.ref }))?.explanation ?? null
          : null;
        const { texto, escritoEn } = await lessonText(lab.lesson_n, lang);
        return {
          item, lab, mecanica: mechanicIn(lab.kind, lang),
          mis: { intentos: attempts.length, resuelto: attempts.some((i) => i.correct === 1), ultimos: attempts.slice(-3) },
          explicacion: explanation,
          leccion: texto ? { n: lab.lesson_n, idioma: escritoEn, tecnica: truncate(texto.technical, 400), analogia: truncate(texto.analogy, 300) } : null,
          ruta: `/leccion/${lab.lesson_n}`,
          quedanEnCola: viewQueue(b).length,
          nota: explanation ? undefined : 'Sin intentos previos: no hay explicación que dar, solo una pista.',
        };
      }
      if (item.tipo === 'leccion') {
        const n = Number(item.ref);
        if (!readable.has(n)) return { item, ...lockedByPaywall(n) };
        const head = await one<LessonRow>('lesson.card', { n });
        const { texto, escritoEn } = await lessonText(n, lang);
        return { item, leccion: head, idioma: escritoEn, tecnica: texto?.technical ?? null, analogia: texto?.analogy ?? null,
                 ejemplos: texto?.examples ?? null, ruta: `/leccion/${n}`, quedanEnCola: viewQueue(b).length };
      }
      return { item, glosario: glossaryFor(item.ref, lang), quedanEnCola: viewQueue(b).length };
    },
    // What comes off the queue becomes the focus: `foco_volver` goes back to what
    // was being looked at before.
    efecto(ctx: Ctx, _args, out: ToolResult): void {
      const item = out?.item as { tipo: string; ref: string; motivo?: string | null } | undefined;
      if (item && !out.error) {
        push(bus(ctx.userId), { tipo: item.tipo, ref: item.ref, nota: item.motivo ?? 'de la cola' });
      }
    },
  },

  cola_estado: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Qué hay pendiente en la cola de estudio y cuál es el foco actual, sin sacar nada.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const b = bus(ctx.userId);
      const queue = viewQueue(b);
      return {
        enCola: queue.length, cola: queue.slice(0, 12),
        foco: top(b), pila: viewStack(b).slice(0, 6),
        nota: queue.length ? 'Usa `cola_siguiente` para gastar el primero con todo su contexto.' : 'Vacía: `plan_estudio` o `mis_errores` la llenan.',
      };
    },
  },

  cola_encolar: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Deja algo pendiente para más tarde en la cola: un lab, una lección o un tema que salió en la conversación.',
    args: { tipo: '«lab», «leccion» o «tema»', ref: 'el lab («5.2»), la lección («7») o el tema («tokens»)', motivo: 'opcional · por qué queda pendiente' },
    async fn(ctx: Ctx, { tipo, ref, motivo }): Promise<ToolResult> {
      const b = bus(ctx.userId);
      if (!KINDS.includes(String(tipo) as never)) return { error: 'tipo_invalido', tipos: KINDS };
      if (String(tipo) === 'lab' && !LAB_ID.test(String(ref))) return { error: 'lab_invalido' };
      if (String(tipo) === 'leccion' && !(Number(ref) >= 1 && Number(ref) <= 12)) return { error: 'leccion_invalida' };
      const r = enqueue(b, { tipo: String(tipo), ref: String(ref).slice(0, 60), motivo: motivo ? String(motivo).slice(0, 120) : null });
      return { ...r, enCola: viewQueue(b).length };
    },
  },

  foco_apilar: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Guarda dónde está la persona antes de irte por una rama de la conversación. Después `foco_volver` regresa aquí.',
    args: { tipo: '«lab», «leccion» o «tema»', ref: 'el lab, la lección o el tema', nota: 'opcional · qué se estaba haciendo' },
    async fn(ctx: Ctx, { tipo, ref, nota }): Promise<ToolResult> {
      if (!KINDS.includes(String(tipo) as never)) return { error: 'tipo_invalido', tipos: KINDS };
      const b = bus(ctx.userId);
      const r = push(b, { tipo: String(tipo), ref: String(ref).slice(0, 60), nota: nota ? String(nota).slice(0, 120) : null });
      return { ...r, pila: viewStack(b).slice(0, 6) };
    },
  },

  foco_volver: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Cierra la rama actual y devuelve a dónde estaba la persona antes. Para «volvamos a lo que estábamos».',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      const b = bus(ctx.userId);
      const closed = pop(b);
      const backTo = top(b);
      if (!closed) return { vacia: true, nota: 'No hay foco guardado: nada que cerrar.' };
      return {
        cerrado: closed, vuelvoA: backTo,
        ruta: backTo ? (backTo.tipo === 'lab' ? `/leccion/${String(backTo.ref).split('.')[0]}` : backTo.tipo === 'leccion' ? `/leccion/${backTo.ref}` : null) : null,
        nota: backTo ? undefined : 'Era el último marco: no queda nada abajo.',
      };
    },
  },

  bus_diagnostico: {
    familia: 'coordinar', publico: false, cachea: false,
    descripcion: 'Cómo va la coordinación de esta sesión: largo de la cola, alto de la pila y cuántas consultas ahorró la caché. Para explicar de dónde salió un dato.',
    args: {},
    async fn(ctx: Ctx): Promise<ToolResult> {
      return { ...diagnostics(bus(ctx.userId)), turno: ctx.turn ? 'sí' : 'no', herramientas: toolCount() };
    },
  },
};
