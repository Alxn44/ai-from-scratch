// ============================================================================
// v2 LEGACY — DEPRECADO.  Retirada: 2027-02-21
//
// Sustituido por  ai/src/ia/ontologia/  (Python, v3).
//
// Que cambio y por que: en v2 la ontologia era PROSA. Describia el aislamiento
// y el codigo lo implementaba aparte, asi que nada garantizaba que coincidieran:
// una herramienta nueva podia devolver una columna prohibida y la ontologia
// seguiria diciendo que no. En v3 la ontologia son DATOS y un grafo demuestra
// sobre ellos que ninguna columna `jamas` es alcanzable (P1/P2/P3 en
// ai/src/ia/ontologia/grafo.py). La garantia paso de comentario a teorema.
//
// Que queda vivo de este archivo:  columnasProhibidas() y assertSinProhibidas(),
// que agent-tools.js llama en cada consulta. Ya NO llevan su propia copia de la
// verdad: leen api/src/ontologia.json, que lo genera Python con `uv run
// ia-exporta`. Una fuente, un artefacto, dos lectores.
//
// Que esta muerto:  ONTOLOGIA, ONTOLOGIA_PREVISTA y renderParaModelo(). Se
// conservan como registro de v2 y no los importa nadie. El prompt lo emite ahora
// el servicio de IA (/ontologia/prompt).
// ============================================================================

import { createRequire } from 'node:module';

// El artefacto se lee UNA vez al arrancar. Si falta, el servidor no arranca a
// medias: sin la lista de columnas prohibidas, la guardia no protege nada y
// seguir seria peor que parar.
const require = createRequire(import.meta.url);
let GENERADO;
try {
  GENERADO = require('./ontologia.json');
} catch (e) {
  throw new Error(
    'falta api/src/ontologia.json (lo genera `uv --directory ai run ia-exporta`). ' +
    'Sin el, assertSinProhibidas no sabe que columnas bloquear. ' + String(e.message ?? e));
}
if (GENERADO.violaciones?.length) {
  throw new Error(`ontologia.json declara ${GENERADO.violaciones.length} violacion(es) de aislamiento: no se arranca con una fuga documentada`);
}

/** Version del artefacto y su huella, para el log de arranque y /api/version. */
export const ONTOLOGIA_META = { version: GENERADO.version, sha: GENERADO.sha,
                                promptSha: GENERADO.prompt_sha, ordenBorrado: GENERADO.orden_borrado };

// Ontología de la base para el agente de IA.
//
// Esto NO es documentación: es la fuente de verdad que (a) se renderiza al prompt
// del modelo y (b) se usa para bloquear en código lo que nunca puede salir.
//
// Regla de oro: el aislamiento entre usuarios NO vive en el prompt. Vive en que
// ninguna herramienta acepta un identificador de usuario — el id sale siempre de
// la sesión del servidor. Un usuario no puede pedirle al agente datos de otro
// porque el agente no tiene forma de expresar «otro».
//
// Clases de sensibilidad:
//   publico   → contenido del curso; cualquiera puede verlo
//   propio    → solo del usuario de la sesión, nunca de terceros
//   agregado  → sale de varios usuarios, pero solo como conteo o alias con opt-in
//   jamas     → nunca llega al modelo, ni del propio usuario

export const ONTOLOGIA = {
  users: {
    proposito: 'Una fila por persona registrada. Identidad, rol, preferencias y si compró el curso.',
    porUsuario: 'El agente solo ve la fila de la sesión. Las demás filas no son alcanzables por ninguna herramienta.',
    borradoSuave: 'deleted_at marcado = la fila se conserva para que cuadren los intentos, pero la persona ya no existe para el sistema.',
    columnas: {
      id:           { clase: 'jamas',   nota: 'Identificador interno. El modelo no lo necesita y darlo invita a pedir el de otro.' },
      email:        { clase: 'jamas',   nota: 'Dato personal sin valor para enseñar. La interfaz ya lo muestra a su dueño.' },
      name:         { clase: 'propio',  nota: 'Solo el primer nombre, para dirigirse a la persona.' },
      pass_hash:    { clase: 'jamas',   nota: 'Hash scrypt. Fuera del alcance de todo el código que no sea auth.js.' },
      role:         { clase: 'propio',  nota: 'student | tutor | admin. Define qué puede pedir, no qué sabe el agente.' },
      lang:         { clase: 'propio',  nota: 'Para responder en el idioma correcto.' },
      theme:        { clase: 'propio',  nota: 'Sin valor para el agente; se expone porque no revela nada.' },
      paid:         { clase: 'propio',  nota: 'Para decir «eso se abre con la compra» sin inventar.' },
      cohort:       { clase: 'propio',  nota: 'Solo como etiqueta. NUNCA para enumerar a los compañeros de cohorte.' },
      created_at:   { clase: 'propio',  nota: 'Antigüedad de la cuenta.' },
      failed:       { clase: 'jamas',   nota: 'Telemetría de seguridad. Para un tercero es señal de ataque.' },
      locked_until: { clase: 'jamas',   nota: 'Igual que failed.' },
      deleted_at:   { clase: 'jamas',   nota: 'Estado interno del borrado suave.' },
    },
  },

  lessons: {
    proposito: 'Las 12 lecciones del Vol. 1. Es el corpus con el que el agente enseña.',
    porUsuario: 'Idéntico para todos: no hay nada personal aquí.',
    columnas: {
      n:         { clase: 'publico', nota: '1..12, el orden del curso.' },
      eyebrow:   { clase: 'publico', nota: 'Etiqueta corta del tema.' },
      title:     { clase: 'publico', nota: 'La idea en lenguaje hablado.' },
      summary:   { clase: 'publico', nota: 'Una frase con el concepto.' },
      math:      { clase: 'publico', nota: 'El número que ancla la lección. Solo números, nunca fórmulas.' },
      math_cap:  { clase: 'publico', nota: 'Qué significa ese número.' },
      technical: { clase: 'publico', nota: 'El mecanismo con precisión. Puede estar vacío mientras se redacta.' },
      analogy:   { clase: 'publico', nota: 'Una sola imagen cotidiana. Puede estar vacía mientras se redacta.' },
    },
  },

  labs: {
    proposito: 'Los 36 ejercicios, tres por lección, con su mecánica y su corrección.',
    porUsuario: 'El enunciado es igual para todos. La explicación solo se entrega si esa persona ya intentó ese lab.',
    columnas: {
      id:          { clase: 'publico', nota: '«5.2» = lección 5, ejercicio 2.' },
      lesson_n:    { clase: 'publico', nota: 'A qué lección pertenece.' },
      idx:         { clase: 'publico', nota: '1 fácil, 2 medio, 3 difícil.' },
      level:       { clase: 'publico', nota: 'facil | medio | dificil.' },
      kind:        { clase: 'publico', nota: 'choice | cut | order | build | knob | hotcold. El agente lo necesita para explicar la mecánica.' },
      prompt:      { clase: 'publico', nota: 'El enunciado.' },
      payload:     { clase: 'publico', nota: 'JSON de lo que se ve en pantalla: opciones, palabras, pasos.' },
      solution:    { clase: 'jamas',   nota: 'LA MÁS IMPORTANTE. Si el agente puede leerla, «dime la respuesta del 5.2» destruye el curso. No sale del servidor por ningún camino.' },
      explanation: { clase: 'publico', nota: 'Condicionada: solo para labs que esa persona ya intentó. La interfaz hace lo mismo.' },
      draft:       { clase: 'publico', nota: '1 = sin escribir. Evita que el agente invente contenido.' },
    },
  },

  lesson_text: {
    proposito: 'El texto de enseñanza de cada lección por idioma: mecanismo, analogía y ejemplos resueltos.',
    porUsuario: 'Idéntico para todos. Se sirve en el idioma de la sesión, con respaldo al español.',
    columnas: {
      lesson_n:  { clase: 'publico', nota: 'A qué lección pertenece.' },
      lang:      { clase: 'publico', nota: 'es | en (fr y pt cuando existan).' },
      technical: { clase: 'publico', nota: 'El mecanismo con precisión, 90-140 palabras.' },
      analogy:   { clase: 'publico', nota: 'Una sola imagen cotidiana, 50-80 palabras.' },
      examples:  { clase: 'publico', nota: 'JSON con dos casos resueltos: entrada, salida y por qué.' },
    },
  },

  achievements: {
    proposito: 'Logros ganados: tres grados por lección y un rango por cada lección cerrada.',
    porUsuario: 'Solo los propios. El rango de un tercero solo aparece dentro del ranking, y solo si esa persona aceptó salir.',
    columnas: {
      user_id:   { clase: 'jamas',  nota: 'El agente nunca lo ve ni lo escribe: sale de la sesión.' },
      code:      { clase: 'propio', nota: 'l07.maestro, rango.05. El nombre visible vive en el i18n del front.' },
      kind:      { clase: 'propio', nota: 'leccion | rango.' },
      lesson_n:  { clase: 'propio', nota: 'A qué lección pertenece, o vacío en los rangos.' },
      earned_at: { clase: 'propio', nota: 'Cuándo se ganó.' },
    },
  },

  ranking_optin: {
    proposito: 'Quién aceptó aparecer en el ranking y con qué alias.',
    porUsuario: 'AGREGADO: el agente ve alias y conteos de quienes aceptaron. El mapeo alias → nombre/correo no lo expone ninguna herramienta, así que «quién es kata.mono» no tiene respuesta.',
    columnas: {
      user_id:   { clase: 'jamas',    nota: 'Uniría el alias con la persona: es justo lo que no puede salir.' },
      alias:     { clase: 'agregado', nota: 'Lo único público de otra persona.' },
      joined_at: { clase: 'agregado', nota: 'Desempata la tabla: a igual avance, quien llegó antes va arriba.' },
    },
  },

  league_week: {
    proposito: 'La liga semanal cerrada: metal, caudal y puesto de cada semana.',
    porUsuario: 'El puesto propio, y de terceros solo el alias con su metal. El caudal se calcula de attempts, no de aquí.',
    columnas: {
      user_id: { clase: 'jamas',    nota: 'De la sesión.' },
      week:    { clase: 'propio',   nota: 'El lunes de la semana, en America/Bogota.' },
      metal:   { clase: 'agregado', nota: 'bronce | plata | oro, por tercios de la tabla.' },
      caudal:  { clase: 'agregado', nota: 'Labs resueltos por primera vez esa semana.' },
      puesto:  { clase: 'agregado', nota: 'Dentro de su metal, 1 = arriba.' },
      estado:  { clase: 'agregado', nota: 'activo | salon. Quien acabó los 36 conserva su metal.' },
      cerrada: { clase: 'propio',   nota: '1 = la semana ya se cerró y no se recalcula.' },
    },
  },

  attempts: {
    proposito: 'Cada intento de cada persona en cada lab. Es de donde sale el progreso.',
    porUsuario: 'Solo las filas propias. Los intentos de terceros no son alcanzables ni como conteo: «cuántos intentos lleva Paula» es exactamente la fuga que hay que evitar.',
    columnas: {
      id:      { clase: 'jamas',  nota: 'Identificador interno.' },
      user_id: { clase: 'jamas',  nota: 'El agente nunca lo ve ni lo escribe: sale de la sesión.' },
      lab_id:  { clase: 'propio', nota: 'Qué lab se intentó.' },
      answer:  { clase: 'propio', nota: 'Lo que respondió. Aquí está el valor real del agente: ve el patrón del error.' },
      correct: { clase: 'propio', nota: '1 acertó, 0 falló.' },
      at:      { clase: 'propio', nota: 'Cuándo. Sirve para «llevas dos semanas sin abrirlo».' },
    },
  },

  payments: {
    proposito: 'Los cobros de Mercado Pago.',
    porUsuario: 'Del propio usuario solo un booleano «pagado». Nada más, ni para él.',
    columnas: {
      id:       { clase: 'jamas', nota: 'Interno.' },
      user_id:  { clase: 'jamas', nota: 'De la sesión.' },
      provider: { clase: 'jamas', nota: 'Sin valor para enseñar.' },
      ext_id:   { clase: 'jamas', nota: 'Referencia de la pasarela. Sirve para soporte, no para el agente.' },
      status:   { clase: 'jamas', nota: 'users.paid ya responde lo único que el agente necesita.' },
      amount:   { clase: 'jamas', nota: 'Dato financiero.' },
      currency: { clase: 'jamas', nota: 'Dato financiero.' },
      raw:      { clase: 'jamas', nota: 'Respuesta completa de Mercado Pago: trae datos del pagador y metadatos de la tarjeta. Jamás sale del servidor.' },
      at:       { clase: 'jamas', nota: 'Dato financiero.' },
    },
  },

  role_audit: {
    proposito: 'Rastro de quién cambió el rol de quién.',
    porUsuario: 'Ninguna herramienta lo expone. Es rastro de administración: no hay nada que enseñar con él.',
    columnas: {
      id: { clase: 'jamas' }, actor_id: { clase: 'jamas' }, user_id: { clase: 'jamas' },
      from_role: { clase: 'jamas' }, to_role: { clase: 'jamas' }, at: { clase: 'jamas' },
    },
  },
};

// Tablas que aún no existen. La regla se escribe ANTES para que quien las
// construya la herede en vez de improvisarla.
export const ONTOLOGIA_PREVISTA = {
  chat_log: {
    proposito: 'Historial de conversaciones del modo IA, si algún día se guarda.',
    porUsuario: 'PROPIO y con fecha de caducidad. Hoy no se guarda nada: la conversación vive en el navegador y el servidor solo la ve de paso. Si se añade la tabla, el agente no debe poder leer conversaciones anteriores sin que la persona lo pida.',
  },
};

/**
 * Columnas que no pueden salir del servidor por ningún camino.
 * Sale del artefacto generado, no de ONTOLOGIA (que es el registro de v2).
 */
export function columnasProhibidas(tabla) {
  return GENERADO.prohibidas[tabla] ?? [];
}

/** Lanza si una fila lleva una columna prohibida. Se llama antes de devolver datos. */
export function assertSinProhibidas(tabla, fila) {
  const prohibidas = columnasProhibidas(tabla);
  const filtradas = Object.keys(fila ?? {}).filter((k) => prohibidas.includes(k));
  if (filtradas.length) {
    throw new Error(`ontologia: ${tabla} intentó devolver ${filtradas.join(', ')}`);
  }
  return fila;
}

/**
 * @deprecated v2. El prompt lo emite el servicio de IA: GET /ontologia/prompt.
 * Se conserva para poder comparar el texto viejo con el nuevo si hace falta.
 */
export function renderParaModelo() {
  const bloque = (nombre, t) => {
    const cols = Object.entries(t.columnas ?? {})
      .filter(([, c]) => c.clase !== 'jamas')
      .map(([k, c]) => `  - ${k} (${c.clase}): ${c.nota ?? ''}`.trimEnd());
    return [`## ${nombre}`, t.proposito, `Alcance: ${t.porUsuario}`, ...cols].join('\n');
  };
  return [
    'Ontología de la base de datos. Solo puedes leerla a través de las herramientas.',
    'No existe acceso a SQL. Ninguna herramienta acepta un identificador de usuario:',
    'el usuario de la sesión lo pone el servidor. No puedes consultar datos de otra persona.',
    '',
    ...Object.entries(ONTOLOGIA).map(([n, t]) => bloque(n, t)),
  ].join('\n\n');
}
