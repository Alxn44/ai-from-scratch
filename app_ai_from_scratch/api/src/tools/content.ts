// Family `contenido` — the course: lessons, teaching text, labs, glossary, search.
// 9 tools.
//
// Everything here is course corpus, so it caches for TTL_PUBLIC — except the two
// that depend on WHO is asking (`lab_ficha`, `requisitos_leccion`), which are
// `publico: false` because their answer changes with the account.
//
// The `descripcion` and `nota` strings stay Spanish: they are read by the model
// and shape what it says to a Spanish-speaking student (docs/NAMING.md).
import { many, one } from '../data.ts';
import type { LessonRow } from '../db.ts';
import { assertNoForbidden } from '../ontology.ts';
import { GLOSSARY, glossaryFor } from '../product.ts';
import { bus, push } from '../agent-bus.ts';
import {
  LAB_ID, TOTAL_LESSONS, hasAccess, language, lessonText, lockedByPaywall,
  me, mechanicIn, perLesson, readableLessons, truncate, FREE_LESSONS,
} from './access.ts';
import { examGate, ofPack, publicQuestion, packScore } from '../assess.ts';
import type { QuestionBest, QuestionRow } from '../assess.ts';
import type { Ctx, Registry, SafeLab, ToolResult } from './access.ts';

/** One search hit before the score is stripped. */
interface Hit {
  leccion: number;
  titulo?: string;
  lab_id?: string;
  donde: string;
  fragmento: string;
  ruta: string;
  p: number;
}

export const CONTENT_TOOLS: Registry = {

  curso_indice: {
    familia: 'contenido', publico: true,
    descripcion: 'Las 12 lecciones con su título, su número ancla y cuántos labs tiene cada una.',
    args: {},
    async fn(): Promise<ToolResult> {
      const rows = await many('lesson.index_with_text_flag');
      return { lecciones: rows };
    },
  },

  leccion: {
    familia: 'contenido', publico: true, paywalled: true,
    descripcion: 'El contenido completo de una lección y el enunciado de sus tres labs. Nunca trae las respuestas.',
    args: { n: 'entero 1..12' },
    async fn(ctx: Ctx, { n }): Promise<ToolResult> {
      const num = Number(n);
      if (!Number.isInteger(num) || num < 1 || num > 12) return { error: 'leccion_invalida' };
      if (!(await readableLessons(ctx)).has(num)) return lockedByPaywall(num);
      const lesson = await one<LessonRow>('lesson.get', { n: num });
      if (!lesson) return { error: 'no_existe' };
      const labs = await many<SafeLab>('lab.list_for_lesson', { lesson_n: num });
      labs.forEach((l) => assertNoForbidden('labs', l));
      return { leccion: lesson, labs };
    },
  },

  leccion_texto: {
    familia: 'contenido', publico: true, paywalled: true,
    descripcion: 'La explicación técnica, la analogía y los dos ejemplos resueltos de una lección, en el idioma de la sesión. Es con lo que hay que enseñar antes de mandar al lab.',
    args: { n: 'entero 1..12', idioma: 'opcional · «es» o «en»; por defecto el de la sesión' },
    async fn(ctx: Ctx, { n, idioma: asked }): Promise<ToolResult> {
      const num = Number(n);
      if (!Number.isInteger(num) || num < 1 || num > 12) return { error: 'leccion_invalida' };
      if (!(await readableLessons(ctx)).has(num)) return lockedByPaywall(num);
      const lang = language(ctx, asked);
      const head = await one<LessonRow>('lesson.card', { n: num });
      if (!head) return { error: 'no_existe' };
      const { texto, escritoEn } = await lessonText(num, lang);
      if (!texto) return { leccion: head, texto: null, nota: 'Esta lección todavía no tiene texto escrito: no lo inventes.' };
      return {
        leccion: head, idioma: escritoEn, pedido: lang,
        tecnica: texto.technical, analogia: texto.analogy, ejemplos: texto.examples,
        nota: escritoEn === lang ? undefined : `No hay texto en «${lang}»: va el español. Puedes traducirlo al responder.`,
      };
    },
    // Teaching a lesson is entering it: the focus is left behind in case the
    // conversation branches off and has to come back.
    efecto(ctx: Ctx, { n }, out: ToolResult): void {
      if (!out?.error) push(bus(ctx.userId), { tipo: 'leccion', ref: Number(n), nota: 'texto de la lección' });
    },
  },

  buscar_en_curso: {
    familia: 'contenido', publico: true, paywalled: true,
    descripcion: 'Busca una palabra o una idea en las 12 lecciones y en los enunciados de los labs, y dice en qué lección está. Úsala antes de responder de memoria.',
    args: { consulta: 'texto libre: «tokens», «por qué inventa cosas»' },
    async fn(ctx: Ctx, { consulta }): Promise<ToolResult> {
      const q = String(consulta ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (q.length < 2) return { error: 'consulta_corta' };
      const words = q.split(/\s+/).filter((w) => w.length > 2).slice(0, 6);
      if (!words.length) return { error: 'consulta_corta' };
      const lang = language(ctx, null);
      const norm = (s: unknown): string => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const count = (text: unknown): number => words.reduce((p, w) => p + (norm(text).includes(w) ? 1 : 0), 0);

      // The filter happens BEFORE the search, not after ranking. A free account used
      // to get 180-character fragments of `technical`, `analogy` and every lab prompt
      // across all twelve lessons — nine hits on one query was enough to walk the
      // paid corpus. Searching only what the caller may read means there is no
      // ranked-but-hidden result to leak a count, a title or a snippet.
      const readable = await readableLessons(ctx);
      const lessons = (await many<LessonRow>('lesson.search_corpus'))
        .filter((l) => readable.has(Number(l.n)));
      const texts = (await many<{ lesson_n: number; technical: string; analogy: string }>(
        'lesson_text.by_lang', { lang }))
        .filter((t) => readable.has(Number(t.lesson_n)));
      const labs = (await many<{ id: string; lesson_n: number; prompt: string }>('lab.prompts'))
        .filter((l) => readable.has(Number(l.lesson_n)));

      const hits: Hit[] = [];
      for (const l of lessons) {
        const where: [string, string][] = [
          ['titulo', `${l.eyebrow} ${l.title} ${l.summary} ${l.math_cap}`],
          ['tecnica', l.technical], ['analogia', l.analogy],
        ];
        for (const [field, text] of where) {
          const p = count(text);
          if (p) hits.push({ leccion: l.n, titulo: l.title, donde: field, fragmento: truncate(text), ruta: `/leccion/${l.n}`, p });
        }
      }
      for (const t of texts) {
        for (const [field, text] of [[`tecnica_${lang}`, t.technical], [`analogia_${lang}`, t.analogy]] as [string, string][]) {
          const p = count(text);
          if (p) hits.push({ leccion: t.lesson_n, donde: field, fragmento: truncate(text), ruta: `/leccion/${t.lesson_n}`, p });
        }
      }
      for (const l of labs) {
        const p = count(l.prompt);
        if (p) hits.push({ leccion: l.lesson_n, lab_id: l.id, donde: 'enunciado', fragmento: truncate(l.prompt), ruta: `/leccion/${l.lesson_n}`, p });
      }
      hits.sort((a, b) => b.p - a.p || a.leccion - b.leccion);
      return {
        consulta: q, encontrados: hits.length,
        resultados: hits.slice(0, 6).map(({ p, ...h }) => h),
        glosario: glossaryFor(q, lang),
        buscadoEn: [...readable].sort((a, b) => a - b),
        cerradas: TOTAL_LESSONS - readable.size,
        nota: hits.length
          ? (readable.size < TOTAL_LESSONS
              ? 'Solo se buscó en las lecciones abiertas para esta cuenta. Si no aparece, puede estar en una cerrada: ofrece la compra, no adivines el contenido.'
              : undefined)
          : 'No aparece en el curso (en lo que esta cuenta puede leer). Dilo así en vez de improvisar una lección que no existe.',
      };
    },
  },

  glosario: {
    familia: 'contenido', publico: true,
    descripcion: 'Qué significa un término del curso (token, perilla, temperatura, contexto…) y en qué lección se explica. Sin argumento devuelve la lista de términos.',
    args: { termino: 'opcional · una palabra o expresión' },
    async fn(ctx: Ctx, { termino }): Promise<ToolResult> {
      const lang = language(ctx, null);
      const q = String(termino ?? '').trim();
      if (!q) return { terminos: GLOSSARY.map((g) => g.termino), total: GLOSSARY.length };
      const found = glossaryFor(q, lang, 4);
      if (!found.length) {
        return { termino: q, hallado: false, terminos: GLOSSARY.map((g) => g.termino),
                 nota: 'No es un término del curso. Puedes explicarlo aparte, pero no lo atribuyas a una lección.' };
      }
      return { termino: q, hallado: true, entradas: found.map((g) => ({ ...g, ruta: `/leccion/${g.leccion}` })) };
    },
  },

  lab_ficha: {
    familia: 'contenido', publico: false, paywalled: true,
    descripcion: 'Un lab suelto: enunciado, nivel, cómo se responde su mecánica y si esta persona ya lo resolvió. Nunca la solución.',
    args: { lab_id: 'texto como «5.2»' },
    async fn(ctx: Ctx, { lab_id }): Promise<ToolResult> {
      const id = String(lab_id ?? '');
      if (!LAB_ID.test(id)) return { error: 'lab_invalido' };
      const card = await one<Pick<SafeLab, 'id' | 'lesson_n' | 'idx' | 'level' | 'kind' | 'draft'>>(
        'lab.card_by_id', { id });
      if (!card) return { error: 'no_existe' };
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      // Found by obligation P4 after the ontology went from 7 declared tools to 37.
      // This tool already loaded the user and already computed hasAccess — and used
      // it as the LABEL `cerrado`, sitting next to the `lab` object it was supposed
      // to be withholding. `lab_ficha {lab_id:'12.3'}` returned a lesson-12
      // statement and payload to a free account while GET /api/v3/lessons/12
      // answered 402 to the same cookie. Computing the rule and not obeying it is
      // the same bug as never computing it.
      if (!(await readableLessons(ctx)).has(Number(card.lesson_n))) return lockedByPaywall(Number(card.lesson_n));
      const [lab, mine] = await Promise.all([
        one<SafeLab>('lab.get', { id }),
        one<{ intentos: number; mejor: number | null }>('attempt.count_for_lab', { lab_id: id }, ctx.userId),
      ]);
      if (!lab) return { error: 'no_existe' };
      assertNoForbidden('labs', lab);
      const lang = language(ctx, null);
      return {
        lab, mecanica: mechanicIn(lab.kind, lang),
        borrador: !!lab.draft, cerrado: false,
        ruta: `/leccion/${lab.lesson_n}`,
        mis: { intentos: mine?.intentos ?? 0, resuelto: mine?.mejor === 1 },
      };
    },
    efecto(ctx: Ctx, { lab_id }, out: ToolResult): void {
      if (!out?.error) push(bus(ctx.userId), { tipo: 'lab', ref: String(lab_id), nota: 'ficha del lab' });
    },
  },

  quiz_leccion: {
    familia: 'contenido', publico: false, paywalled: true,
    descripcion: 'El quiz rápido de una lección: tres preguntas de opción, sin las respuestas. Dice si esta persona ya las acertó.',
    args: { n: 'entero 1..12' },
    async fn(ctx: Ctx, { n }): Promise<ToolResult> {
      const num = Number(n);
      if (!Number.isInteger(num) || num < 1 || num > 12) return { error: 'leccion_invalida' };
      if (!(await readableLessons(ctx)).has(num)) return lockedByPaywall(num);
      const pack = `q${String(num).padStart(2, '0')}`;
      const lang = language(ctx, null);
      const [rows, allBest] = await Promise.all([
        many<QuestionRow>('question.list_for_pack', { pack }),
        many<QuestionBest>('qattempt.best_by_question', {}, ctx.userId),
      ]);
      rows.forEach((r) => assertNoForbidden('questions', r));
      const bestRows = ofPack(allBest, pack);
      const best = new Map(bestRows.map((b) => [b.question_id, b]));
      const preguntas = rows.map((r) => publicQuestion(r, lang, best.get(r.id)));
      const score = packScore(bestRows, rows.length);
      return { leccion: num, pack, preguntas, acertadas: score.correct, total: score.total, cerrado: score.passed };
    },
  },

  examen: {
    familia: 'contenido', publico: false, paywalled: true,
    descripcion: 'Un examen de bloque (1: lecciones 1-4, 2: 5-8, 3: 9-12): preguntas sin respuestas, nota de corte y si esta persona ya lo aprobó.',
    args: { n: 'entero 1..3' },
    async fn(ctx: Ctx, { n }): Promise<ToolResult> {
      const num = Number(n);
      if (!Number.isInteger(num) || num < 1 || num > 3) return { error: 'examen_invalido' };
      const gate = examGate(num);
      if (gate == null) return { error: 'examen_invalido' };
      if (!(await readableLessons(ctx)).has(gate)) return lockedByPaywall(gate);
      const pack = `e${num}`;
      const lang = language(ctx, null);
      const [rows, allBest] = await Promise.all([
        many<QuestionRow>('question.list_for_pack', { pack }),
        many<QuestionBest>('qattempt.best_by_question', {}, ctx.userId),
      ]);
      rows.forEach((r) => assertNoForbidden('questions', r));
      const bestRows = ofPack(allBest, pack);
      const best = new Map(bestRows.map((b) => [b.question_id, b]));
      const preguntas = rows.map((r) => publicQuestion(r, lang, best.get(r.id)));
      const score = packScore(bestRows, rows.length);
      return {
        n: num, pack, de: gate - 3, hasta: gate,
        preguntas, acertadas: score.correct, total: score.total,
        corte: score.passAt, aprobado: score.passed,
      };
    },
  },

  requisitos_leccion: {
    familia: 'contenido', publico: false,
    descripcion: 'Si esta persona puede saltar a una lección: qué debería traer entendido, cómo va en la anterior y si tiene la lección abierta.',
    args: { n: 'entero 1..12' },
    async fn(ctx: Ctx, { n }): Promise<ToolResult> {
      const num = Number(n);
      if (!Number.isInteger(num) || num < 1 || num > 12) return { error: 'leccion_invalida' };
      const u = await me(ctx);
      if (!u) return { error: 'sin_sesion' };
      const rows = await perLesson(ctx);
      const before = rows.filter((r) => r.n < num);
      const weak = before.filter((r) => r.resueltos < r.total)
        .map((r) => ({ leccion: r.n, resueltos: r.resueltos, total: r.total }));
      const previous = num > 1
        ? await one<Pick<LessonRow, 'n' | 'title' | 'summary'>>('lesson.card', { n: num - 1 })
        : null;
      const current = await one<Pick<LessonRow, 'n' | 'eyebrow' | 'title' | 'summary'>>(
        'lesson.card', { n: num });
      return {
        leccion: current, anterior: previous, abierta: hasAccess(u, num),
        libres: FREE_LESSONS,
        previasSinCerrar: weak,
        veredicto: !hasAccess(u, num) ? 'cerrada_por_compra'
          : weak.length ? 'se_puede_pero_hay_huecos' : 'lista',
        porQue: weak.length
          ? 'El curso es acumulativo: cada lección usa el vocabulario de la anterior.'
          : 'No hay lecciones anteriores sin cerrar.',
      };
    },
  },
};
