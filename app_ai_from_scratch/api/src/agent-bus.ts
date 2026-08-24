// The agent bus: one queue, one stack and one memo per session.
//
// WHY IT EXISTS. With 37 tools the problem stops being «what can it do» and
// becomes «how many turns does it spend doing it». The harness cap is 4 model
// turns; an ordinary question («what do I do now?») could cost five calls:
// profile, progress, lessons, attempts, league. This module is what makes those
// five fit into one:
//
//   QUEUE (FIFO) — the study plan. `plan_estudio` and `mis_errores` fill it;
//     `cola_siguiente` takes the head ALREADY RESOLVED (the lab card + own
//     attempts + a pointer to the lesson). One tool produces work, another
//     consumes it: the model never asks «and what was next?» again.
//
//   STACK (LIFO) — the focus. Opening a lesson or a lab pushes where the person
//     was. If the conversation branches off («wait, what is a token?»),
//     `foco_volver` returns the previous frame without re-reading anything.
//
//   MEMO — a result cache inside the session. Public things (lessons, statements,
//     glossary) live for TTL_PUBLIC; own data ONLY inside the same turn, because
//     between two messages the person may have solved a lab in another tab and
//     stale progress would be a lie.
//
// ISOLATION. The bus is indexed by `userId`, which the server sets from the
// cookie. There is no function that accepts somebody else's id, so one person's
// queue is not reachable from anybody else's session. It is process memory: if it
// restarts, the plan is lost and nothing happens — it gets asked for again. That
// is why there is no new table: none of this is a fact we owe anybody.
//
// NOTE ON NAMES: the KEYS of everything returned here — `ok`, `razon`, `item`,
// `tipo`, `ref`, `motivo`, `nota`, `largo`, `alto`, `foco`, `repetido`, and every
// key of diagnostics() — travel to the model as tool results and are asserted by
// api/test/agent-bus.mts and api/test/tools.mts. They are wire format, not
// identifiers, so they are unchanged.

const TTL_SESSION = 30 * 60_000;   // half an hour without talking and the session is forgotten
const TTL_PUBLIC = 10 * 60_000;    // course content changes with a deploy
const MAX_SESSIONS = 400;          // memory ceiling: the oldest one is evicted
const QUEUE_CAP = 32;
const STACK_CAP = 16;
const MEMO_CAP = 96;

/** What may be queued or focused on. Data values: the model writes them. */
const KINDS = ['lab', 'leccion', 'tema'] as const;
export type Kind = (typeof KINDS)[number];

/** One queued item. `clave` is internal dedupe and is stripped on the way out. */
export interface QueueItem {
  clave: string;
  tipo: string;
  ref: string;
  motivo: string | null;
  at: number;
}

/** One stack frame: where the person was before the conversation branched. */
export interface Frame {
  tipo: string;
  ref: string;
  nota: string | null;
  at: number;
}

interface MemoEntry {
  value: unknown;
  at: number;
  turn: string | null;
  public: boolean;
}

interface Stats { hits: number; misses: number; encolados: number; servidos: number }

/** One session's bus. Process memory, never persisted. */
export interface Bus {
  queue: QueueItem[];
  stack: Frame[];
  memo: Map<string, MemoEntry>;
  stats: Stats;
  seen: number;
}

const sessions = new Map<number, Bus>();

const now = (): number => Date.now();

/** Drops expired sessions and, if there are still too many, the least recently used. */
function prune(): void {
  const t = now();
  for (const [k, s] of sessions) if (t - s.seen > TTL_SESSION) sessions.delete(k);
  while (sessions.size > MAX_SESSIONS) {
    let oldest: number | null = null;
    for (const [k, s] of sessions) if (oldest === null || s.seen < (sessions.get(oldest)?.seen ?? 0)) oldest = k;
    if (oldest === null) break;
    sessions.delete(oldest);
  }
}

/**
 * This session's bus. `userId` comes from the server; an id that is not an integer
 * has no bus, the same way it has no tools.
 */
export function bus(userId: unknown): Bus | null {
  if (!Number.isInteger(userId)) return null;
  const id = userId as number;
  prune();
  let s = sessions.get(id);
  if (!s) {
    s = { queue: [], stack: [], memo: new Map(),
          stats: { hits: 0, misses: 0, encolados: 0, servidos: 0 }, seen: now() };
    sessions.set(id, s);
  }
  s.seen = now();
  return s;
}

/** Deletes one session's bus. Used by the tests and by logout. */
export function forget(userId: number): void {
  sessions.delete(userId);
}

/** Tests only: leaves the module as freshly loaded. */
export function forgetAll(): void {
  sessions.clear();
}

const itemKey = (kind: string, ref: unknown): string => `${kind}:${String(ref)}`;

/** What enqueue() answers. Never throws: the model has to be able to read
 *  «it was already there» or «the queue is full» and carry on. */
export type EnqueueResult =
  | { ok: false; razon: 'sin_sesion' }
  | { ok: false; razon: 'tipo_invalido'; tipos: readonly string[] }
  | { ok: false; razon: 'ya_estaba'; clave: string; largo: number }
  | { ok: false; razon: 'cola_llena'; tope: number }
  | { ok: true; item: QueueItem; largo: number };

export function enqueue(
  b: Bus | null,
  { tipo, ref, motivo = null, frente = false }:
    { tipo: unknown; ref: unknown; motivo?: string | null; frente?: boolean }): EnqueueResult {
  if (!b) return { ok: false, razon: 'sin_sesion' };
  if (!KINDS.includes(tipo as Kind)) return { ok: false, razon: 'tipo_invalido', tipos: KINDS };
  const k = itemKey(String(tipo), ref);
  if (b.queue.some((i) => i.clave === k)) return { ok: false, razon: 'ya_estaba', clave: k, largo: b.queue.length };
  if (b.queue.length >= QUEUE_CAP) return { ok: false, razon: 'cola_llena', tope: QUEUE_CAP };
  const item: QueueItem = { clave: k, tipo: String(tipo), ref: String(ref), motivo, at: now() };
  if (frente) b.queue.unshift(item); else b.queue.push(item);
  b.stats.encolados++;
  return { ok: true, item, largo: b.queue.length };
}

/** Takes the head. FIFO: what was queued first is studied first. */
export function dequeue(b: Bus | null): QueueItem | null {
  if (!b || !b.queue.length) return null;
  const item = b.queue.shift()!;
  b.stats.servidos++;
  return item;
}

export function viewQueue(b: Bus | null): Omit<QueueItem, 'clave'>[] {
  return b ? b.queue.map(({ clave, ...i }) => i) : [];
}

export function clearQueue(b: Bus | null): number {
  const n = b ? b.queue.length : 0;
  if (b) b.queue = [];
  return n;
}

export type PushResult =
  | { ok: false; razon: 'sin_sesion' }
  | { ok: false; razon: 'tipo_invalido'; tipos: readonly string[] }
  | { ok: true; repetido: true; alto: number; foco: Frame }
  | { ok: true; alto: number; foco: Frame };

/**
 * Pushes the focus. Repeating the top frame pushes nothing: entering the same
 * lesson twice is not a branch of the conversation.
 */
export function push(
  b: Bus | null,
  { tipo, ref, nota = null }: { tipo: unknown; ref: unknown; nota?: string | null }): PushResult {
  if (!b) return { ok: false, razon: 'sin_sesion' };
  if (!KINDS.includes(tipo as Kind)) return { ok: false, razon: 'tipo_invalido', tipos: KINDS };
  const frame: Frame = { tipo: String(tipo), ref: String(ref), nota, at: now() };
  const above = b.stack[b.stack.length - 1];
  if (above && above.tipo === frame.tipo && above.ref === frame.ref) {
    return { ok: true, repetido: true, alto: b.stack.length, foco: above };
  }
  b.stack.push(frame);
  // When it fills up, the BOTTOM frame falls off: in a conversation what matters
  // is the latest thing, not where you came from twenty messages ago.
  if (b.stack.length > STACK_CAP) b.stack.shift();
  return { ok: true, alto: b.stack.length, foco: frame };
}

export function pop(b: Bus | null): Frame | null {
  if (!b || !b.stack.length) return null;
  return b.stack.pop() ?? null;
}

export function top(b: Bus | null): Frame | null {
  return b && b.stack.length ? b.stack[b.stack.length - 1]! : null;
}

export function viewStack(b: Bus | null): Frame[] {
  return b ? [...b.stack].reverse() : [];
}

/** Validity options for one memo entry. */
export interface MemoScope { public?: boolean; turn?: string | null }

/**
 * Memoises a tool result.
 *
 * `public` decides validity: course content is worth TTL_PUBLIC; own data is only
 * worth the same `turn`, and with no turn nothing is cached. That way the same
 * message does not query the same row twice, and the next message goes back to the
 * database in case the person solved something while talking.
 */
export async function memo<T>(
  b: Bus | null, key: string, { public: isPublic = false, turn = null }: MemoScope,
  fn: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
  if (!b) return { value: await fn(), cached: false };
  const e = b.memo.get(key);
  const fresh = e && (isPublic ? now() - e.at < TTL_PUBLIC : turn && e.turn === turn);
  if (fresh && e) {
    b.stats.hits++;
    return { value: e.value as T, cached: true };
  }
  const value = await fn();
  b.stats.misses++;
  // An error is not cached: a transient failure must not stay stuck to the turn.
  if (!isError(value) && (isPublic || turn)) {
    b.memo.set(key, { value, at: now(), turn, public: isPublic });
    if (b.memo.size > MEMO_CAP) b.memo.delete(b.memo.keys().next().value!);
  }
  return { value, cached: false };
}

const isError = (v: unknown): boolean =>
  !!v && typeof v === 'object' && 'error' in v && Boolean((v as { error?: unknown }).error);

/** Seeds the memo with something already computed (used by the combo tools). */
export function seed(b: Bus | null, key: string, value: unknown, { public: isPublic = false, turn = null }: MemoScope): boolean {
  if (!b || isError(value) || (!isPublic && !turn)) return false;
  b.memo.set(key, { value, at: now(), turn, public: isPublic });
  if (b.memo.size > MEMO_CAP) b.memo.delete(b.memo.keys().next().value!);
  return true;
}

/** What can be told to the model (and to the trace) about its own bus. */
export type Diagnostics =
  | { disponible: false }
  | {
      disponible: true;
      cola: { largo: number; tope: number; encolados: number; servidos: number };
      pila: { alto: number; tope: number; foco: Frame | null };
      memo: { entradas: number; tope: number; aciertos: number; fallos: number; consultasAhorradas: number };
      ttl: { sesionMin: number; publicoMin: number };
    };

export function diagnostics(b: Bus | null): Diagnostics {
  if (!b) return { disponible: false };
  const { hits, misses, encolados, servidos } = b.stats;
  return {
    disponible: true,
    cola: { largo: b.queue.length, tope: QUEUE_CAP, encolados, servidos },
    pila: { alto: b.stack.length, tope: STACK_CAP, foco: top(b) },
    memo: { entradas: b.memo.size, tope: MEMO_CAP, aciertos: hits, fallos: misses,
            consultasAhorradas: hits },
    ttl: { sesionMin: TTL_SESSION / 60_000, publicoMin: TTL_PUBLIC / 60_000 },
  };
}

export const CAPS = { queue: QUEUE_CAP, stack: STACK_CAP, memo: MEMO_CAP, sessions: MAX_SESSIONS };
export { KINDS };
