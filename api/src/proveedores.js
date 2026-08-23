// ============================================================================
// v2 LEGACY — DEPRECADO.  Retirada: 2027-02-21
//
// Sustituido por  ai/src/ia/agente/proveedores.py  (Python, v3).
// Ya no lo importa nadie: server.js habla con el servicio via api/src/ia.js.
//
// Portado sin cambiar la logica: mismos seis proveedores, mismos dos formatos de
// cable, mismo orden por PROVEEDOR_ORDEN. Las llaves las lee ahora el servicio
// de IA, no la API.
//
// Se conserva sin borrar para poder comparar comportamiento con v3 mientras el
// servicio nuevo acumula horas de vuelo. Borrarlo es seguro cuando
// /api/version deje de contar golpes en v1 y v2.
// ============================================================================

// Router de proveedores. La lista se arma con las llaves que existan en el
// entorno: si falta una, ese proveedor simplemente no está. Se intenta en orden
// y el primero que responda gana; el que falla queda anotado en la traza.
//
// Dos formatos de cable, no seis clientes:
//   'anthropic' -> /v1/messages con tools nativos
//   'openai'    -> /chat/completions (OpenRouter, DeepSeek, Kimi, Hugging Face,
//                  opencode y cualquier gateway compatible)

const env = (k) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : null;
};

/** Catálogo declarativo. Orden = prioridad. */
export function proveedores() {
  const lista = [
    { id: 'anthropic', formato: 'anthropic', base: 'https://api.anthropic.com/v1/messages',
      key: env('ANTHROPIC_API_KEY'), modelo: env('ANTHROPIC_MODEL') ?? 'claude-sonnet-5' },
    { id: 'openrouter', formato: 'openai', base: 'https://openrouter.ai/api/v1/chat/completions',
      key: env('OPENROUTER_API_KEY'), modelo: env('OPENROUTER_MODEL') ?? 'anthropic/claude-sonnet-4.5' },
    { id: 'deepseek', formato: 'openai', base: 'https://api.deepseek.com/chat/completions',
      key: env('DEEPSEEK_API_KEY'), modelo: env('DEEPSEEK_MODEL') ?? 'deepseek-chat' },
    { id: 'kimi', formato: 'openai', base: 'https://api.moonshot.ai/v1/chat/completions',
      key: env('KIMI_API_KEY') ?? env('MOONSHOT_API_KEY'), modelo: env('KIMI_MODEL') ?? 'kimi-k2-0905-preview' },
    { id: 'huggingface', formato: 'openai', base: 'https://router.huggingface.co/v1/chat/completions',
      key: env('HF_TOKEN') ?? env('HUGGINGFACE_API_KEY'), modelo: env('HF_MODEL') ?? 'Qwen/Qwen3-235B-A22B-Instruct' },
    // opencode/local: cualquier gateway compatible en la red del servidor.
    { id: 'opencode', formato: 'openai', base: env('OPENCODE_BASE_URL') ?? 'http://127.0.0.1:4096/v1/chat/completions',
      key: env('OPENCODE_API_KEY'), modelo: env('OPENCODE_MODEL') ?? 'claude-sonnet-5' },
  ];
  const orden = (env('PROVEEDOR_ORDEN') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const activos = lista.filter((p) => p.key);
  if (!orden.length) return activos;
  const peso = (p) => { const i = orden.indexOf(p.id); return i < 0 ? 99 : i; };
  return activos.sort((a, b) => peso(a) - peso(b));
}

export const hayProveedor = () => proveedores().length > 0;

/** Herramientas del harness -> esquema del proveedor. */
function comoTools(catalogo, formato) {
  // En agent-tools el argumento se declara como texto: «entero 1..12». Ese texto
  // ES la descripción, y de ahí se deduce el tipo. Todos los declarados son
  // obligatorios: no hay herramienta con argumento opcional.
  const props = (args) => {
    const p = {}; const req = [];
    for (const [k, nota] of Object.entries(args ?? {})) {
      const esNumero = /entero|n[uú]mero/i.test(String(nota));
      p[k] = { type: esNumero ? 'integer' : 'string', description: String(nota) };
      req.push(k);
    }
    return { type: 'object', properties: p, required: req };
  };
  if (formato === 'anthropic') {
    return catalogo.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: props(h.argumentos) }));
  }
  return catalogo.map((h) => ({
    type: 'function',
    function: { name: h.nombre, description: h.descripcion, parameters: props(h.argumentos) },
  }));
}

/**
 * Una vuelta de modelo. Devuelve una forma común para que el harness no sepa de
 * proveedores: { texto, llamadas:[{id,nombre,args}], crudo }.
 */
export async function turno(prov, { sistema, mensajes, catalogo, maxTokens = 1024, timeoutMs = 45000 }) {
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    if (prov.formato === 'anthropic') {
      const res = await fetch(prov.base, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': prov.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: prov.modelo, max_tokens: maxTokens, system: sistema,
          tools: comoTools(catalogo, 'anthropic'), messages: mensajes,
        }),
      });
      if (!res.ok) throw new Error(`${prov.id} ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const d = await res.json();
      const texto = (d.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
      const llamadas = (d.content ?? []).filter((c) => c.type === 'tool_use')
        .map((c) => ({ id: c.id, nombre: c.name, args: c.input ?? {} }));
      return { texto, llamadas, crudo: d.content ?? [], uso: d.usage ?? null };
    }

    const res = await fetch(prov.base, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${prov.key}` },
      body: JSON.stringify({
        model: prov.modelo, max_tokens: maxTokens,
        messages: [{ role: 'system', content: sistema }, ...mensajes],
        tools: comoTools(catalogo, 'openai'), tool_choice: 'auto',
      }),
    });
    if (!res.ok) throw new Error(`${prov.id} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const d = await res.json();
    const m = d.choices?.[0]?.message ?? {};
    const llamadas = (m.tool_calls ?? []).map((c) => ({
      id: c.id, nombre: c.function?.name,
      args: (() => { try { return JSON.parse(c.function?.arguments ?? '{}'); } catch { return {}; } })(),
    }));
    return { texto: (m.content ?? '').trim(), llamadas, crudo: m, uso: d.usage ?? null };
  } finally {
    clearTimeout(reloj);
  }
}
