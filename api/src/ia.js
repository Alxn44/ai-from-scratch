// Puente hacia el servicio de IA (Python, v3).
//
// Desde v3 el bucle del agente NO vive aqui: vive en ai/ (FastAPI). Este modulo
// hace dos cosas y ninguna mas:
//
//   1. hablarConIA()  manda la conversacion al servicio y devuelve su respuesta.
//   2. atender()      ejecuta la herramienta que el servicio pide, resolviendo el
//                     userId DESDE LA COOKIE. El servicio nunca ve un userId.
//
// Por que el userId se queda de este lado: el aislamiento entre usuarios es que
// ninguna herramienta acepte un identificador de persona. Si el servicio de IA
// pudiera consultar la base, esa regla estaria escrita dos veces en dos
// lenguajes; el dia que divergieran, ganaria la copia equivocada. Una sola
// implementacion o ninguna — lo mismo que con el reparto de metales de ligas.
//
// El secreto compartido (IA_SECRETO) no autentica a una persona: prueba que la
// llamada viene del servicio y no de internet. La persona la identifica la
// cookie, que el servicio reenvia sin abrir.
// EL CONTRATO con ai/ (FastAPI), escrito. No es documentacion: el chequeo de
// tipos lo usa, asi que si el servicio cambia una clave y aqui no, `pnpm check`
// lo dice. Antes de escribirlo, server.js leia `s.proveedores` de un valor que el
// compilador solo conocia como `object`: cualquier falta de ortografia pasaba.
/**
 * @typedef {object} SaludIA
 * @property {boolean} ok
 * @property {string} [error]                 // sin_secreto | estado_NNN | servicio_caido | salud_no_es_objeto
 * @property {string} [detalle]
 * @property {string} [version]
 * @property {number} [vueltas]
 * @property {string[]} [proveedores]
 * @property {Record<string,string>} [modelos]
 * @property {{es: string, en: string}} [prompt_sha]
 * @property {number} [violaciones]
 */
/**
 * @typedef {object} TurnoIA
 * @property {string} [respuesta]
 * @property {string} [error]                 // sin_proveedor | todos_fallaron | ia_error | ia_caida | sin_secreto
 * @property {string} [msg]
 * @property {boolean} [agotado]
 * @property {string} [detalle]              // texto del fallo de red, recortado
 * @property {string} [proveedor]
 * @property {string} [modelo]
 * @property {string} [prompt]                // huella del prompt que se uso
 * @property {number} [estado]
 * @property {Array<Record<string, any>>} [traza]
 */

const env = (k) => { const v = process.env[k]; return v && v.trim() ? v.trim() : null; };

export const IA_URL = env('IA_URL') ?? 'http://127.0.0.1:8799';
export const IA_SECRETO = env('IA_SECRETO');
export const hayIA = () => Boolean(IA_SECRETO);

/**
 * Estado del servicio. Si no responde, se dice; no se finge que hay IA.
 * @param {number} [timeoutMs]
 * @returns {Promise<SaludIA>}
 */
export async function saludIA(timeoutMs = 2500) {
  if (!IA_SECRETO) return { ok: false, error: 'sin_secreto' };
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${IA_URL}/salud`, { signal: ctl.signal });
    if (!res.ok) return { ok: false, error: `estado_${res.status}` };
    // El cuerpo se comprueba antes de expandirlo: si el servicio devolviera null,
    // un numero o una cadena, `{...d}` revienta con TypeError y el chat caeria con
    // un 500 sin explicacion. Lo encontro tsgo (TS2698) — no una peticion real.
    const d = await res.json().catch(() => null);
    if (!d || typeof d !== 'object' || Array.isArray(d)) {
      return { ok: false, error: 'salud_no_es_objeto' };
    }
    return { ok: true, ...d };
  } catch (e) {
    return { ok: false, error: 'servicio_caido', detalle: String(e.message ?? e).slice(0, 160) };
  } finally { clearTimeout(reloj); }
}

/**
 * Un turno completo. `sesion` es la cookie cruda: viaja opaca.
 * @param {{sesion: string, mensajes: Array<{role: string, content: string}>, lang: string}} p
 * @param {number} [timeoutMs]
 * @returns {Promise<TurnoIA>}
 */
export async function hablarConIA({ sesion, mensajes, lang }, timeoutMs = 120000) {
  if (!IA_SECRETO) return { error: 'sin_secreto', msg: 'Falta IA_SECRETO en la API y en el servicio de IA.' };
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${IA_URL}/agente/turno`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-ia-secreto': IA_SECRETO },
      body: JSON.stringify({ sesion, mensajes, lang }),
    });
    // Igual que en saludIA: el cuerpo puede no ser un objeto. Un servicio detras
    // de un proxy que devuelve "Bad Gateway" en texto plano es el caso normal de
    // esto, no un caso raro.
    const crudo = await res.json().catch(() => null);
    const d = crudo && typeof crudo === 'object' && !Array.isArray(crudo) ? crudo : {};
    if (!res.ok) return { error: 'ia_error', estado: res.status, ...d };
    return d;
  } catch (e) {
    return { error: 'ia_caida', msg: 'El servicio de IA no responde.', detalle: String(e.message ?? e).slice(0, 160) };
  } finally { clearTimeout(reloj); }
}
