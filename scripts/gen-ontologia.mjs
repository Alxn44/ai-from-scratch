// Genera ONTOLOGIA.md desde api/src/ontology.js. Una sola fuente de verdad: el
// documento no puede desfasarse de lo que el código bloquea de verdad.
import { writeFileSync } from 'node:fs';
import { ONTOLOGIA, ONTOLOGIA_PREVISTA, columnasProhibidas } from '../api/src/ontology.js';
import { catalogo, familias } from '../api/src/agent-tools.js';
import { TOPES } from '../api/src/agent-bus.js';

const CLASES = {
  publico: 'público · contenido del curso',
  propio: 'propio · solo de la sesión',
  agregado: 'agregado · conteos o alias con opt-in',
  jamas: '**JAMÁS** · no sale del servidor',
};

const md = [
  '# Ontología de la base para el agente de IA',
  '',
  '> Generado desde `api/src/ontology.js`. No editar a mano: se regenera con `pnpm ontologia`.',
  '',
  '## El aislamiento no está en el prompt',
  '',
  'Un usuario no puede obtener datos de otro a través del agente, y la razón no es que',
  'el prompt se lo pida: es que **ninguna herramienta acepta un identificador de usuario**.',
  'El id sale de la cookie de sesión, en el servidor. El modelo no tiene forma de expresar',
  '«los datos de otra persona», así que el ataque clásico —poner instrucciones dentro del',
  'propio alias o de la respuesta de un lab— no tiene a dónde ir: en el peor caso el agente',
  'devuelve otra vez los datos de quien pregunta.',
  '',
  `Tampoco hay SQL. Hay ${catalogo().length} funciones con argumentos declarados; cualquier clave que no`,
  'esté declarada se descarta y queda registrada en la respuesta como `_ignorado`.',
  '',
  '## Cómo se hablan entre ellas: una pila y una cola',
  '',
  'Las herramientas no se llaman unas a otras. Se dejan trabajo en el bus de la sesión',
  '(`api/src/agent-bus.js`), que son tres estructuras y nada más:',
  '',
  `- **cola** (FIFO, tope ${TOPES.cola}) — el plan de estudio. \`plan_estudio\` y \`mis_errores\` la`,
  '  llenan; `cola_siguiente` saca la cabeza **ya resuelta** (ficha del lab, intentos propios,',
  '  explicación si ya lo intentó y la lección de donde sale): tres herramientas en una llamada.',
  `- **pila** (LIFO, tope ${TOPES.pila}) — el foco. Abrir una lección o un lab apila dónde estaba la`,
  '  persona; si la conversación se va por una rama, `foco_volver` regresa sin releer nada.',
  `- **memo** (tope ${TOPES.memo}) — la caché de la sesión. El contenido del curso se reusa 10`,
  '  minutos; un dato propio **solo dentro del mismo turno**, porque entre dos mensajes la persona',
  '  pudo resolver un lab en otra pestaña y un progreso viejo sería una mentira. Lo que sale de la',
  '  caché viaja marcado con `_memo: true`, y la traza del chat lo dice.',
  '',
  'El bus se indexa por el `userId` de la sesión, así que la cola de una persona no es',
  'alcanzable desde la de otra. Es memoria del proceso: si el servidor se reinicia se pierde',
  'el plan y no pasa nada — se vuelve a pedir. Por eso no hay tabla nueva.',
  '',
  '## Herramientas',
  '',
  ...Object.entries(familias()).flatMap(([familia, nombres]) => [
    `### familia \`${familia}\` · ${nombres.length}`,
    '',
    '| herramienta | qué devuelve | argumentos |',
    '|---|---|---|',
    ...catalogo().filter((h) => h.familia === familia).map((h) => {
      const args = Object.entries(h.argumentos);
      const cols = args.length ? args.map(([k, v]) => `\`${k}\`: ${v}`).join(', ') : '—';
      return `| \`${h.nombre}\` | ${h.descripcion} | ${cols} |`;
    }),
    '',
  ]),
  '## Tablas',
  '',
];

for (const [nombre, t] of Object.entries(ONTOLOGIA)) {
  md.push(`### \`${nombre}\``, '', t.proposito, '', `**Alcance por usuario:** ${t.porUsuario}`, '');
  if (t.borradoSuave) md.push(`**Borrado suave:** ${t.borradoSuave}`, '');
  md.push('| columna | clase | nota |', '|---|---|---|');
  for (const [c, d] of Object.entries(t.columnas)) {
    md.push(`| \`${c}\` | ${CLASES[d.clase]} | ${d.nota ?? ''} |`);
  }
  const proh = columnasProhibidas(nombre);
  md.push('', `Bloqueadas en código (\`assertSinProhibidas\`): ${proh.length ? proh.map((c) => '`' + c + '`').join(', ') : 'ninguna'}`, '');
}

md.push('## Tablas previstas', '', 'La regla se escribe antes de construirlas, para que se herede:', '');
for (const [nombre, t] of Object.entries(ONTOLOGIA_PREVISTA)) {
  md.push(`### \`${nombre}\``, '', t.proposito, '', `**Alcance:** ${t.porUsuario}`, '');
}

md.push(
  '## Cómo se verifica',
  '',
  '```bash',
  'pnpm --dir api test        # aislamiento + bus + herramientas + harness',
  'pnpm test:aislamiento      # solo el aislamiento',
  '```',
  '',
  `\`test/aislamiento.mjs\` intenta lo prohibido contra las ${catalogo().length} herramientas: colar \`user_id\` en`,
  'todas, leer el `pass_hash`, el correo, el nombre y los intentos de otra persona, sacar las',
  '`solution` de los labs, pedir la explicación antes del primer intento, inyectar SQL en',
  '`lab_id`, inventar una herramienta, pasar un `userId` que no sea entero y ver la cola de',
  'otra sesión. Ninguna debe pasar.',
  '',
  '`test/bus.mjs` comprueba la estructura: FIFO, LIFO, los topes, que el memo distinga lo',
  'público de lo propio y que dos sesiones no compartan nada. `test/herramientas.mjs`',
  'comprueba lo contrario del aislamiento —que esto sirva—: que las',
  `${catalogo().length} respondan con datos, que lo que una encola otra lo consuma y que el memo ahorre`,
  'consultas. `test/harness.mjs` corre el bucle contra un proveedor falso.',
  '',
);

writeFileSync(new URL('../ONTOLOGIA.md', import.meta.url), md.join('\n'));
console.log('ONTOLOGIA.md regenerado ·', md.length, 'líneas');
