// The agent's tool surface. This is EVERYTHING the model can do against the
// database: there is no SQL, no free-form search, no user parameter.
//
// The isolation lives here and not in the prompt: `ctx.userId` is set by the
// server from the session cookie. No signature accepts a person identifier, so
// the model has no way to express «somebody else's data». If the text the user
// writes tries to inject instructions, the worst it achieves is the agent handing
// them their own data again.
//
// ------------------------------------------------------------------------------
// HOW IT IS ORGANISED (37 tools, four families, one file each)
//
//   ./content.ts      · the course: lessons, texts, labs, glossary, search   (7)
//   ./progress.ts     · this person: progress, mistakes, streak, pace, league (16)
//   ./product.ts      · what is in no table: price, routes, support, settings (7)
//   ./coordination.ts · the stack and the queue (see ../agent-bus.ts)         (7)
//   ./access.ts       · the paywall gate, the ontology guard, shared reads
//
// This file owns the registry, the dispatch, the memo key and the argument
// allowlist — the four things that must exist exactly once.
//
// WHY SO MANY TOOLS. Because these are the questions that actually arrive over
// chat: «what do I do now?», «why can't I open lesson 4?», «how much does it
// cost?», «what am I getting wrong?», «where do I change the language?». Each one
// has its own tool so the answer comes from a fact and not from the model's
// imagination.
//
// HOW THEY TALK TO EACH OTHER. They do not call each other: they leave work on
// the session bus.
//
//   `plan_estudio` and `mis_errores` ENQUEUE labs (FIFO).
//   `cola_siguiente` takes the head and returns it ALREADY RESOLVED — lab card,
//     own attempts, pointer to the lesson — three tools in one.
//   `leccion_texto`, `lab_ficha` and `cola_siguiente` PUSH the focus (LIFO); if
//     the conversation branches off, `foco_volver` recovers where it was.
//   `mi_panorama` SEEDS the memo with profile, progress, streak and next step: if
//     the model then asks for any of those separately, it does not touch the
//     database.
//
// That is what makes it fit in the harness's 4 turns: fewer trips, not less data.
//
// ------------------------------------------------------------------------------
// HOW THE PYTHON SIDE READS THIS REGISTRY
//
// By IMPORTING it, not by scanning the source. `scripts/emit-tool-catalog.mjs`
// imports this file, calls catalog() and prints the tool names, families and the
// paywall flag as JSON; ai/src/course_ai/ontology/export.py and
// ai/tests/test_node_contract.py read that output.
//
// It used to regex the source instead, and that reader broke twice: once when
// `HERRAMIENTAS` was renamed to `TOOLS`, and again when the single agent-tools.js
// was split into these family files. Both times the guard refused to compare
// against an empty list — correct, but it left the 37-tool check dark until
// somebody noticed. The reason was that the contract was source FORMATTING (tool
// keys at exactly two spaces, `paywalled: true` on the line after its key), and
// nothing enforced it: not tsgo, not a test, not a formatter.
//
// So: rename things, split this into ten files, reformat every line. What the
// contract needs is only that catalog() keeps reporting one entry per tool with
// its `familia` and its `paywalled`. DO NOT re-add a formatting dependency.
// ------------------------------------------------------------------------------
import { memo } from '../agent-bus.ts';
import { bus } from '../agent-bus.ts';
import { memoKey, readableLessons, setRegistrySize } from './access.ts';
import type { Ctx, Registry, Tool, ToolResult } from './access.ts';
import { CONTENT_TOOLS } from './content.ts';
import { PROGRESS_TOOLS } from './progress.ts';
import { PRODUCT_TOOLS } from './product.ts';
import { COORDINATION_TOOLS } from './coordination.ts';

export type { Ctx, Tool, ToolResult } from './access.ts';

/** The one registry. Read-only after this line. */
const TOOLS: Registry = {
  ...CONTENT_TOOLS,
  ...PROGRESS_TOOLS,
  ...PRODUCT_TOOLS,
  ...COORDINATION_TOOLS,
};

setRegistrySize(Object.keys(TOOLS).length);

// ---------------------------------------------------------------------------
// THE ARGUMENT ALLOWLIST
//
// Allowlist, not denylist: `clean` is a FRESH object built only from declared
// keys, so an injected `user_id` never reaches the tool at all — it is not
// "ignored", it is unreachable. This is the single barrier between the model and
// the tool arguments, because the Fastify schema declares `args` as a free-form
// object.
//
// The comment here used to claim the leaked key "se descarta y se registra". Only
// the first half was true: `extra` was echoed back to the model as `_ignorado`
// and written to no log, so someone probing for an identity-injection hole left
// no trace on the server. See `log` below.
function allowOnly(allowed: readonly string[], args: unknown):
    { clean: Record<string, unknown>; extra: string[] } {
  const input = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const extra = Object.keys(input).filter((k) => !allowed.includes(k));
  const clean: Record<string, unknown> = {};
  for (const k of allowed) if (k in input) clean[k] = input[k];
  return { clean, extra };
}

// A rejected identity argument is the highest-signal event this surface produces,
// so it goes to a log the operator reads. Defaults to the console; the server can
// hand over its own structured logger with `setLogger`.
export type ToolLogger = (data: Record<string, unknown>, msg: string) => void;

let log: ToolLogger = (data, msg) => console.warn(`[tools] ${msg}`, JSON.stringify(data));
export const setLogger = (fn: ToolLogger): void => { log = fn; };

/** Tool names grouped by family. Used by the front end and the documentation. */
export function families(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, h] of Object.entries(TOOLS)) (out[h.familia] ??= []).push(name);
  return out;
}

/** One catalog entry, exactly as ai/src/course_ai/agent/providers.py reads it. */
export interface CatalogEntry {
  nombre: string;
  descripcion: string;
  argumentos: Record<string, string>;
  familia: string;
  /**
   * Whether run() has to resolve the entitlement before calling this tool.
   *
   * INTERNAL. It is here so the build-time reader (scripts/emit-tool-catalog.mjs)
   * can check that the gated tools are exactly the ones the ontology declares with
   * verifica_compra. It must NOT reach the model:
   * ai/src/course_ai/agent/providers.py picks nombre/descripcion/argumentos by
   * name, so adding a field here does not put it in a prompt — keep it that way.
   * What the model can see about the paywall is the answer it gets back, never
   * the flag.
   */
  paywalled: boolean;
}

/** What is declared to the model: name, description and arguments. No user. */
export function catalog(): CatalogEntry[] {
  return Object.entries(TOOLS).map(([nombre, h]) => ({
    nombre, descripcion: h.descripcion, argumentos: h.args, familia: h.familia,
    paywalled: !!h.paywalled,
  }));
}

/**
 * Runs a tool. `ctx` is built by the server from the cookie; anything coming from
 * the model can only influence `args`, and only its declared keys.
 *
 * The memo is transparent: if the same tool with the same arguments was already
 * resolved (and is still fresh), the database is not queried again and the output
 * carries `_memo: true`. The effects — push, enqueue — run either way, because
 * they are part of the conversation and not of the data.
 */
export async function run(ctx: Ctx | null, name: string, args: unknown): Promise<ToolResult> {
  // `Object.hasOwn`, not `TOOLS[name]`: the registry is a plain object, so a model
  // emitting `constructor`, `__proto__` or `valueOf` used to resolve truthy off
  // the prototype chain and then throw a TypeError on `h.args` — a 500 from the
  // internal bridge, reachable by anything the model can type.
  const h: Tool | null = Object.hasOwn(TOOLS, name) ? TOOLS[name]! : null;
  if (!h) return { error: 'herramienta_desconocida', nombre: name };
  if (!ctx || !Number.isInteger(ctx.userId)) return { error: 'sin_sesion' };
  const { clean, extra } = allowOnly(Object.keys(h.args), args);
  const b = bus(ctx.userId);

  // Entitlement is part of the cache key, not a reason to stop caching.
  //
  // The bus is per person, so a ten-minute slot never crossed sessions and course
  // content was always safe to reuse — dropping these tools to `publico: false`
  // to fix the paywall threw away a real saving on a paid LLM path. The one true
  // hazard was the purchase boundary: a `requiere_compra` cached at 10:00 would
  // still be served at 10:05 to someone who paid at 10:01.
  //
  // Folding the open-lesson set into the key removes that: paying changes the
  // signature, so the stale entry is not invalidated, it is simply never asked
  // for again. Resolved once here and passed down on the ctx, so the tool that
  // gates does not repeat the query.
  let key = memoKey(name, clean, ctx);
  let scoped = ctx;
  if (h.paywalled) {
    const readable = await readableLessons(ctx);
    scoped = { ...ctx, readable };
    key += `|abre:${[...readable].sort((x, y) => x - y).join(',')}`;
  }

  let out: ToolResult, cached = false;
  if (h.cachea === false) {
    out = await h.fn(scoped, clean);
  } else {
    const r = await memo<ToolResult>(b, key, { public: !!h.publico, turn: scoped.turn ?? null },
      () => h.fn(scoped, clean));
    out = r.value; cached = r.cached;
  }

  // The effect always runs, including over a cached output: pushing the focus is
  // not data that can be reused, it is something that happened in the
  // conversation.
  if (h.efecto) h.efecto(scoped, clean, out);

  // Nothing mutates the output stored in the memo: a new shallow copy with the
  // markers is always what goes back.
  const markers: ToolResult = {};
  if (cached) markers._memo = true;
  // Logged server-side, and NOT echoed back. Telling the model which key names
  // were stripped is a small oracle handed to the side of the conversation that
  // may have been probing for them.
  if (extra.length) log({ userId: ctx.userId, herramienta: name, sobran: extra }, 'argumentos no declarados, descartados');
  return Object.keys(markers).length ? { ...out, ...markers } : out;
}
