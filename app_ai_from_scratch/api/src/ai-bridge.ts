// The bridge to the AI service (Python, v3).
//
// Since v3 the agent LOOP does not live here: it lives in ai/ (FastAPI). This
// module does two things and nothing else:
//
//   1. talkToAi()  sends the conversation to the service and returns its answer.
//   2. The tool the service asks for is executed by server.ts, which resolves the
//      userId FROM THE COOKIE. The service never sees a userId.
//
// Why the userId stays on this side: isolation between users IS the fact that no
// tool accepts a person identifier. If the AI service could query the database,
// that rule would be written twice in two languages; the day they diverged, the
// wrong copy would win. One implementation or none — the same as with the league
// metal split.
//
// The shared secret (IA_SECRETO) does not authenticate a person: it proves the
// call comes from the service and not from the internet. The person is identified
// by the cookie, which the service forwards without opening it.
//
// THE CONTRACT with ai/ (FastAPI), written down. It is not documentation: the type
// checker uses it, so if the service renames a key and this does not, `pnpm check`
// says so. Before it was written, server.ts read `s.proveedores` off a value the
// compiler only knew as `object`: any misspelling went through.
//
// The env var names (IA_URL, IA_SECRETO), the header (`x-ia-secreto`), the request
// body keys (`sesion`, `mensajes`, `lang`) and every field below are the WIRE
// FORMAT shared with ai/ and with web/. They stay as they are: renaming one is a
// coordinated change across two services.

/** GET /salud on the AI service. */
export interface AiHealth {
  ok: boolean;
  /** sin_secreto | estado_NNN | servicio_caido | salud_no_es_objeto */
  error?: string;
  detalle?: string;
  version?: string;
  vueltas?: number;
  proveedores?: string[];
  modelos?: Record<string, string>;
  prompt_sha?: { es: string; en: string };
  violaciones?: number;
}

/** POST /agente/turno on the AI service. */
export interface AiTurn {
  respuesta?: string;
  /** sin_proveedor | todos_fallaron | ia_error | ia_caida | sin_secreto */
  error?: string;
  msg?: string;
  agotado?: boolean;
  /** the network failure text, truncated */
  detalle?: string;
  proveedor?: string;
  modelo?: string;
  /** fingerprint of the prompt that was used */
  prompt?: string;
  estado?: number;
  traza?: Record<string, unknown>[];
}

const env = (k: string): string | null => { const v = process.env[k]; return v && v.trim() ? v.trim() : null; };

export const AI_URL = env('IA_URL') ?? 'http://127.0.0.1:8799';
export const AI_SECRET = env('IA_SECRETO');
export const hasAi = (): boolean => Boolean(AI_SECRET);

/** State of the service. If it does not answer, we say so; we do not pretend there is AI. */
export async function aiHealth(timeoutMs = 2500): Promise<AiHealth> {
  if (!AI_SECRET) return { ok: false, error: 'sin_secreto' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI_URL}/salud`, { signal: ctl.signal });
    if (!res.ok) return { ok: false, error: `estado_${res.status}` };
    // The body is checked before it is spread: if the service returned null, a
    // number or a string, `{...d}` blows up with a TypeError and the chat would
    // fall over with an unexplained 500. tsgo found it (TS2698) — not a real
    // request.
    const d: unknown = await res.json().catch(() => null);
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      return { ok: false, error: 'salud_no_es_objeto' };
    }
    return { ok: true, ...(d as Omit<AiHealth, 'ok'>) };
  } catch (e) {
    return { ok: false, error: 'servicio_caido',
             detalle: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
  } finally { clearTimeout(timer); }
}

/** One neutral conversation message, as it travels to the service. */
export interface ChatMessage { role: string; content: string }

/** One full turn. `sesion` is the raw cookie: it travels opaque. */
export async function talkToAi(
  { sesion, mensajes, lang }: { sesion: string; mensajes: ChatMessage[]; lang: string },
  timeoutMs = 120000): Promise<AiTurn> {
  if (!AI_SECRET) return { error: 'sin_secreto', msg: 'Falta IA_SECRETO en la API y en el servicio de IA.' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI_URL}/agente/turno`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-ia-secreto': AI_SECRET },
      body: JSON.stringify({ sesion, mensajes, lang }),
    });
    // Same as in aiHealth: the body may not be an object. A service behind a proxy
    // answering "Bad Gateway" in plain text is the normal case of this, not a rare
    // one.
    const raw: unknown = await res.json().catch(() => null);
    const d = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as AiTurn;
    if (!res.ok) return { error: 'ia_error', estado: res.status, ...d };
    return d;
  } catch (e) {
    return { error: 'ia_caida', msg: 'El servicio de IA no responde.',
             detalle: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
  } finally { clearTimeout(timer); }
}
