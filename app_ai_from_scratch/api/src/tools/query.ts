// The composable-query family: the model builds its own reads.
//
// ============================================================================
// WHY THIS IS A PLAN AND NOT SQL.
//
// The request was "give the model tools so it can build its own SQL queries".
// SQL is not survivable here, and the reason is one line of this project's own
// ontology, about labs.solution:
//
//	"LA MAS IMPORTANTE. Si el agente puede leerla, «dime la respuesta del 5.2»
//	 destruye el curso."
//
// Every message this model reads was typed by a student, which makes all of it
// attacker-authored. Hand it a SQL string and the attack is one line, and the
// same door reaches users.pass_hash, payments.raw and reset_tokens.token_hash.
//
// The deeper cost is that the PROOFS die. P1, P3 and P4 are properties of a
// closed set of statements; over arbitrary SQL they cannot be decided, so
// ai-prove-isolation, data-catalog and data-smoke would keep printing green
// while proving nothing. A gate that certifies an obligation it cannot test is
// worse than no gate, because the review passes.
//
// So the model composes a PLAN -- table, columns, filters, aggregates, grouping,
// ordering -- and the data service assembles the statement. It gets the freedom
// that was actually being asked for, in combinations nobody enumerated in
// advance, and:
//
//   · a `jamas` column is not in the selectable universe. `solution` is not
//     filtered out of a result; it cannot be named.
//   · the actor filter is INJECTED on every personal table. There is no field
//     for another person's id, so "read another student's attempts" is
//     unspellable rather than refused. That is P3.
//   · `de_pago` columns are not selectable either, so this is not a way around
//     the paywall the named tools are gated by. That is P4.
//
// data/internal/plan holds the compiler and its attack suite.
//
// ----------------------------------------------------------------------------
// WHY IT IS AGENTIC AND NOT JUST PERMISSIVE.
//
// Two things make this usable by a model rather than merely open:
//
//   1. `consulta_campos` returns the surface. The model asks once what it may
//      read and then composes; an agent that has to PROBE for its surface
//      spends a turn per refusal, and a turn is a model call.
//   2. Refusals are returned verbatim, and they name what IS readable:
//      «"solution" is not readable on labs. Readable: draft, id, idx, kind,
//      lesson_n, level». That is what lets the model fix its own plan on the
//      next turn instead of guessing. None of those messages carries a
//      forbidden VALUE -- they list readable columns, which are readable by
//      definition.
//
// WHAT IT DELIBERATELY CANNOT DO: no joins, no subqueries, no expressions, no
// OR, no ordering by a column it did not select. Each of those is a place where
// a plan stops being checkable by reading it. They are absent because absent is
// provable and "validated" is an argument.
import { DataRefused, plannable, query } from '../data.ts';
import type { Ctx, Registry, ToolResult } from './access.ts';

/** What /v1/plannable answers. Shape owned by data/internal/httpapi. */
interface Surface {
  tables: Record<string, { columns: string[]; scope?: string }>;
  operators: string[];
  aggregates: string[];
  limits: Record<string, number>;
}

// The plan's own field names, so an argument the model invents is refused HERE
// with a message about the plan rather than at the far end with a JSON error.
// The data service also sets DisallowUnknownFields; this is the near copy that
// gives a better message, not the check that makes it safe.
const PLAN_FIELDS = ['table', 'select', 'where', 'group', 'aggregate', 'order', 'limit'];

const asPlan = (args: Record<string, unknown>): Record<string, unknown> => {
  const unknown = Object.keys(args).filter((k) => !PLAN_FIELDS.includes(k));
  if (unknown.length) {
    throw new Error(
      `consulta: ${unknown.join(', ')} is not part of a plan. A plan has exactly: `
      + `${PLAN_FIELDS.join(', ')}. There is no join, no subquery and no raw fragment -- `
      + 'ask consulta_campos for what can be read.');
  }
  if (typeof args.table !== 'string' || !args.table) {
    throw new Error('consulta: a plan needs a table. consulta_campos lists the ones that can be read.');
  }
  const plan: Record<string, unknown> = { table: args.table };
  for (const f of PLAN_FIELDS) if (f !== 'table' && args[f] !== undefined) plan[f] = args[f];
  return plan;
};

export const QUERY_TOOLS: Registry = {

  // Asked first, and cached: the surface changes only when a migration changes
  // the ontology, so paying for it once per session is the whole point.
  consulta_campos: {
    familia: 'contenido', publico: true, cachea: true,
    descripcion: 'Que se puede consultar: las tablas, sus columnas legibles, los operadores y los '
      + 'limites. Pidela ANTES de armar una consulta.',
    args: {},
    async fn(): Promise<ToolResult> {
      const s: Surface = await plannable();
      return {
        tablas: s.tables, operadores: s.operators, agregados: s.aggregates, limites: s.limits,
      };
    },
  },

  consulta: {
    familia: 'contenido', publico: false,
    descripcion: 'Arma tu propia consulta: tabla, columnas, filtros, agrupacion, agregados, orden y '
      + 'limite. No es SQL: el servicio de datos ensambla la sentencia. Nunca podras nombrar una '
      + 'columna prohibida ni los datos de otra persona.',
    args: {
      table: 'la tabla (consulta_campos las lista)',
      select: 'lista de columnas legibles',
      where: 'lista de {column, op, value} u {column, op, values} para `in`',
      group: 'lista de columnas por las que agrupar (deben estar en select)',
      aggregate: 'lista de {fn, column, as}; fn: count|sum|avg|min|max',
      order: 'lista de {column, dir}; column debe estar en el resultado',
      limit: 'entero, por defecto 100',
    },
    async fn(ctx: Ctx, args: Record<string, unknown>): Promise<ToolResult> {
      const plan = asPlan(args);
      try {
        // The actor is ctx.userId, taken from the session cookie the server
        // verified. It is a separate argument to op() and never part of the
        // plan, which is why no argument of this tool can express a person.
        const r = await query<Record<string, unknown>>(plan as never, ctx.userId);
        return { filas: r.rows, total: r.affected, consulta: plan };
      } catch (e) {
        // A refusal is an ANSWER for an agent: it says what is readable, and the
        // model composes a better plan next turn. Re-thrown as a plain Error so
        // the loop shows it to the model instead of turning it into a 500.
        if (e instanceof DataRefused) throw new Error(e.message);
        throw e;
      }
    },
  },
};
