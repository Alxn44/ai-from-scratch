// Prueba del harness sin gastar creditos: un proveedor falso en formato OpenAI
// que primero pide una herramienta y luego responde texto. Verifica el bucle,
// la conversion de esquemas, la guardia del userId y la traza.
import { createServer } from 'node:http';
import { migrate, get, pool } from '../src/db.js';

const puerto = 4599;
let vueltas = 0;
let recibido = [];

const srv = createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c));
  req.on('end', () => {
    const d = JSON.parse(cuerpo || '{}');
    recibido.push(d);
    vueltas++;
    res.setHeader('content-type', 'application/json');
    if (vueltas === 1) {
      // Primer turno: pide progreso Y trata de colar el id de otra persona.
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '', tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'mi_progreso', arguments: JSON.stringify({ user_id: 99, userId: 99 }) } },
        ] } }],
      }));
      return;
    }
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Vas por buen camino.' } }] }));
  });
});

await new Promise((r) => srv.listen(puerto, '127.0.0.1', r));
process.env.OPENCODE_BASE_URL = `http://127.0.0.1:${puerto}/v1/chat/completions`;
process.env.OPENCODE_API_KEY = 'de-prueba';
process.env.PROVEEDOR_ORDEN = 'opencode';

const { correr } = await import('../src/harness.js');
const { proveedores } = await import('../src/proveedores.js');

await migrate();
const yo = await get("SELECT id FROM users WHERE email = 'ricardo@velez.co'");
const otro = await get("SELECT id FROM users WHERE email = 'paula@correo.com'");

let fallos = 0;
const ok = (cond, txt) => { console.log(`  ${cond ? 'ok  ' : 'FALLO'} · ${txt}`); if (!cond) fallos++; };

ok(proveedores().some((p) => p.id === 'opencode'), 'el router ve el proveedor falso');

const r = await correr({ ctx: { userId: yo.id }, mensajes: [{ role: 'user', content: 'como voy' }], lang: 'es' });

ok(r.respuesta === 'Vas por buen camino.', 'devuelve la respuesta final del modelo');
ok(r.proveedor === 'opencode', 'reporta qué proveedor respondió');
ok(vueltas === 2, `dos vueltas de modelo (fueron ${vueltas})`);

const pasos = r.traza.map((t) => t.paso);
ok(pasos.filter((p) => p === 'modelo').length === 2, 'la traza tiene los dos turnos de modelo');
ok(pasos.includes('herramienta'), 'la traza registra la herramienta ejecutada');
const th = r.traza.find((t) => t.paso === 'herramienta');
ok(th?.nombre === 'mi_progreso', 'ejecutó la herramienta pedida');
ok(Array.isArray(th?.ignorado) && th.ignorado.includes('user_id') && th.ignorado.includes('userId'),
  `el id colado por el modelo queda ignorado y anotado (${JSON.stringify(th?.ignorado)})`);

// El resultado que viajó de vuelta al modelo no puede ser el progreso de otro.
const segundo = recibido[1];
const resultado = segundo.messages.find((m) => m.role === 'tool');
ok(!!resultado, 'el resultado de la herramienta vuelve al modelo');
const payload = JSON.parse(resultado.content);
ok(!JSON.stringify(payload).includes(`"userId":${otro.id}`), 'no viaja el id de otra persona');
ok(!/paula|correo\.com|pass_hash/i.test(resultado.content), 'el resultado no lleva datos de otra persona');

// El esquema de herramientas que ve el modelo: sin identificadores de usuario.
const tools = segundo.tools ?? [];
ok(tools.length === 7, `se declaran las 7 herramientas (fueron ${tools.length})`);
const props = JSON.stringify(tools.map((t) => t.function.parameters));
ok(!/user_?id/i.test(props), 'ningún argumento declarado acepta un id de usuario');
ok(/"lecci?on"|"leccion"/.test(JSON.stringify(tools.map((t) => t.function.name))), 'la herramienta de lección está declarada');

// Sistema: la ontología viaja y no menciona columnas prohibidas.
const sistema = segundo.messages[0];
ok(sistema.role === 'system' && sistema.content.includes('Ontología'), 'el sistema lleva la ontología');
ok(!/pass_hash|solution/.test(sistema.content), 'el sistema no menciona pass_hash ni solution');

// Sin sesión válida el bucle no ejecuta nada.
vueltas = 0; recibido = [];
const sin = await correr({ ctx: { userId: 'no-soy-numero' }, mensajes: [{ role: 'user', content: 'hola' }], lang: 'es' });
const thSin = sin.traza.find((t) => t.paso === 'herramienta');
ok(thSin?.ok === false, 'sin userId entero la herramienta responde error, no datos');

srv.close();
await pool.end();
console.log(fallos ? `\n${fallos} fallos` : '\nsin fallos');
process.exit(fallos ? 1 : 0);
