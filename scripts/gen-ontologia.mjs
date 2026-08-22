// Genera ONTOLOGIA.md desde api/src/ontology.js. Una sola fuente de verdad: el
// documento no puede desfasarse de lo que el código bloquea de verdad.
import { writeFileSync } from 'node:fs';
import { ONTOLOGIA, ONTOLOGIA_PREVISTA, columnasProhibidas } from '../api/src/ontology.js';
import { catalogo } from '../api/src/agent-tools.js';

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
  'Tampoco hay SQL. Hay siete funciones con argumentos declarados; cualquier clave que no',
  'esté declarada se descarta y queda registrada en la respuesta como `_ignorado`.',
  '',
  '## Herramientas',
  '',
  '| herramienta | qué devuelve | argumentos |',
  '|---|---|---|',
  ...catalogo().map((h) => {
    const args = Object.entries(h.argumentos);
    const cols = args.length ? args.map(([k, v]) => `\`${k}\`: ${v}`).join(', ') : '—';
    return `| \`${h.nombre}\` | ${h.descripcion} | ${cols} |`;
  }),
  '',
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
  'pnpm test:aislamiento',
  '```',
  '',
  'Intenta 31 cosas: colar `user_id` en las siete herramientas, leer el `pass_hash`, el',
  'correo, el nombre y los intentos de otra persona, sacar las `solution` de los labs,',
  'pedir la explicación antes del primer intento, inyectar SQL en `lab_id`, inventar una',
  'herramienta y pasar un `userId` que no sea entero. Ninguna debe pasar.',
  '',
);

writeFileSync(new URL('../ONTOLOGIA.md', import.meta.url), md.join('\n'));
console.log('ONTOLOGIA.md regenerado ·', md.length, 'líneas');
