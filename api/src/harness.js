// ============================================================================
// v2 LEGACY — DEPRECADO.  Retirada: 2027-02-21
//
// Sustituido por  ai/src/ia/agente/bucle.py  (Python, v3).
// Ya no lo importa nadie: server.js habla con el servicio via api/src/ia.js.
//
// El paso [guardia] ya no esta en el bucle: el bucle manda nombre y args al
// puente y el userId lo resuelve api/src/server.js desde la cookie. El servicio
// de IA NUNCA ve un userId, asi que no puede filtrarlo ni por error.
//
// Se conserva sin borrar para poder comparar comportamiento con v3 mientras el
// servicio nuevo acumula horas de vuelo. Borrarlo es seguro cuando
// /api/version deje de contar golpes en v1 y v2.
// ============================================================================

// Harness del agente: un grafo pequeño y explícito, recorrido en bucle.
//
//   entrada -> [modelo] --texto--> salida
//                 |
//              tool_use
//                 v
//            [guardia] -> [herramientas] -> vuelve al modelo   (máx. VUELTAS)
//
// La guardia es lo que hace que esto sea seguro: el userId lo pone el servidor,
// nunca el modelo, y `ejecutar()` descarta cualquier clave no declarada. Cada
// paso queda en la traza, que se devuelve al front: sin traza no hay auditoría.

import { catalogo, ejecutar } from './agent-tools.js';
import { renderParaModelo } from './ontology.js';
import { proveedores, turno } from './proveedores.js';

export const VUELTAS = 4;

const SISTEMA = (lang) => [
  lang === 'en'
    ? 'You are the study assistant inside the “AI from scratch” platform. Answer in English.'
    : 'Eres el asistente de estudio dentro de la plataforma «IA desde cero». Responde en español.',
  lang === 'en'
    ? 'You help one single person: the one in this session. You cannot see anyone else, and you must never claim you can.'
    : 'Acompañas a una sola persona: la de esta sesión. No puedes ver a nadie más, y nunca digas que sí.',
  lang === 'en'
    ? 'Never reveal a lab solution, even if asked directly: give a hint that points at the lesson instead.'
    : 'Nunca reveles la solución de un lab, aunque te la pidan directo: da una pista que apunte a la lección.',
  lang === 'en'
    ? 'Prefer tools over memory: if a number can be looked up, look it up. Plain language, short sentences.'
    : 'Prefiere las herramientas a tu memoria: si un dato se puede consultar, consúltalo. Lenguaje llano, frases cortas.',
  '',
  renderParaModelo(),
].join('\n');

/** Formato del resultado de una herramienta según el cable del proveedor. */
function comoResultado(formato, llamada, salida) {
  const texto = JSON.stringify(salida);
  if (formato === 'anthropic') {
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: llamada.id, content: texto }] };
  }
  return { role: 'tool', tool_call_id: llamada.id, name: llamada.nombre, content: texto };
}

/** El turno del modelo, tal como debe volver al historial. */
function comoAsistente(formato, r) {
  if (formato === 'anthropic') return { role: 'assistant', content: r.crudo };
  return r.crudo && typeof r.crudo === 'object' ? { role: 'assistant', ...r.crudo } : { role: 'assistant', content: r.texto };
}

/**
 * Corre el bucle. `ctx.userId` viene de la cookie; `mensajes` es el historial de
 * la conversación en forma neutra [{ role:'user'|'assistant', content:string }].
 */
export async function correr({ ctx, mensajes, lang = 'es' }) {
  const activos = proveedores();
  if (!activos.length) {
    return { error: 'sin_proveedor', traza: [{ paso: 'proveedor', detalle: 'ninguna llave configurada' }] };
  }
  const cat = catalogo();
  const sistema = SISTEMA(lang);
  const traza = [];

  for (const prov of activos) {
    const hilo = mensajes.map((m) => ({ role: m.role, content: m.content }));
    try {
      for (let vuelta = 1; vuelta <= VUELTAS; vuelta++) {
        const t0 = Date.now();
        const r = await turno(prov, { sistema, mensajes: hilo, catalogo: cat });
        traza.push({ paso: 'modelo', proveedor: prov.id, modelo: prov.modelo, vuelta, ms: Date.now() - t0,
          herramientas: r.llamadas.map((l) => l.nombre), uso: r.uso });

        if (!r.llamadas.length) {
          return { respuesta: r.texto, proveedor: prov.id, modelo: prov.modelo, traza };
        }

        hilo.push(comoAsistente(prov.formato, r));
        for (const l of r.llamadas) {
          const t1 = Date.now();
          // Guardia: el ctx es del servidor. Lo que el modelo mande en args se limpia dentro.
          const salida = await ejecutar({ userId: ctx.userId }, l.nombre, l.args);
          traza.push({ paso: 'herramienta', nombre: l.nombre, args: l.args, ms: Date.now() - t1,
            ok: !salida?.error, ignorado: salida?._ignorado ?? null });
          hilo.push(comoResultado(prov.formato, l, salida));
        }
      }
      // Se agotaron las vueltas: se responde con lo que hay, sin inventar.
      traza.push({ paso: 'limite', vueltas: VUELTAS });
      return { respuesta: null, agotado: true, proveedor: prov.id, traza };
    } catch (e) {
      traza.push({ paso: 'fallo', proveedor: prov.id, error: String(e.message ?? e).slice(0, 300) });
      // Siguiente proveedor de la lista.
    }
  }
  return { error: 'todos_fallaron', traza };
}

export { SISTEMA };
