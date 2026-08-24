// Las rutas de medios. Un plugin de Fastify, no rutas sueltas en `server.js`,
// por dos razones que son de encapsulado y no de orden:
//
//  1. El parser de cuerpo. Aquí dentro un cuerpo binario llega como STREAM y no
//     como Buffer, que es lo que permite que un vídeo de 60 MiB pase del
//     navegador al almacén sin juntarse nunca en la memoria de este proceso. Ese
//     parser no debe existir fuera: en el resto del API un `content-type` raro
//     tiene que seguir siendo un 415, no un stream que nadie lee.
//  2. El traductor de errores. `ErrorMedios` se convierte en respuesta en un solo
//     sitio, y solo para estas rutas.
//
// Los dos son encapsulados en Fastify si el plugin NO se envuelve con
// `fastify-plugin`. Por eso no se envuelve.
//
// Lo que este fichero NO hace: decidir. Quién puede leer o escribir qué está en
// `medios.js`; cómo se habla con el almacén, en `media-bridge.js`.

import { Transform } from 'node:stream';
import * as almacen from './media-bridge.js';
import { ErrorMedios } from './media-bridge.js';
import {
  CUBOS, MAX_BYTES, admiteCuerpo, catalogoPublico, claveDeSesion,
  excedido, puedeEscribir, puedeLeer, puedeListar, tipoLimpio,
} from './medios.js';

/** Corta el stream en cuanto se pasa del techo del cubo.
 *
 *  Importa que corte durante la transferencia y no después: `media-store`
 *  escribe a un temporal y solo renombra al terminar, así que una subida
 *  abortada no deja objeto a medias. Comprobar el tamaño al final significaría
 *  haber escrito los 60 MiB antes de decir que no. */
function tope(max, avisar) {
  let n = 0;
  return new Transform({
    transform(trozo, _enc, cb) {
      n += trozo.length;
      if (n > max) { avisar(); return cb(new Error('tope')); }
      cb(null, trozo);
    },
  });
}

/** Cabeceras de todo lo que sale del almacén.
 *
 *  `nosniff` y el CSP no son ceremonia: esto sirve ficheros que subió alguien.
 *  Los tipos permitidos ya excluyen `text/html` y `image/svg+xml` —las dos
 *  formas de que una imagen ejecute JavaScript en nuestro origen—, y estas dos
 *  cabeceras son la segunda cerradura por si esa lista se toca sin pensarlo. */
function blindar(reply, cubo) {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('content-security-policy', "default-src 'none'; sandbox");
  // Solo el cubo público puede vivir en una caché compartida. Lo demás pasó por
  // un muro, y una caché intermedia no sabe nada de muros.
  reply.header('cache-control', cubo === 'publico'
    ? 'public, max-age=3600'
    : 'private, no-store');
}

export default async function medios(app, opciones) {
  // `accesoLeccion` es el muro de pago del curso. Lo inyecta `server.js` para que
  // el muro siga viviendo en un solo sitio y no se reimplemente aquí.
  const { usuarioActual, accesoLeccion } = opciones;

  // Cualquier cuerpo que no sea de un tipo que Fastify ya parsea (JSON,
  // urlencoded) llega tal cual, sin leerlo. Encapsulado a este plugin.
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ErrorMedios) {
      // El detalle se queda en el log: puede llevar rutas del almacén.
      if (err.status >= 500) req.log.error({ err: err.error, detalle: err.detalle }, 'medios');
      return reply.code(err.status).send(err.cuerpo);
    }
    if (err.statusCode === 413 || err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ error: 'demasiado_grande' });
    }
    if (String(err.code ?? '').startsWith('FST_ERR_CTP')) {
      return reply.code(415).send({ error: 'tipo_no_permitido' });
    }
    req.log.error({ err }, 'medios: fallo no previsto');
    return reply.code(500).send({ error: 'error_interno' });
  });

  const sesion = (req) => usuarioActual(req);
  // El `status` viaja en la línea de estado, no dentro del JSON.
  const negar = (reply, { status, ...cuerpo }) => reply.code(status).send(cuerpo);

  // ---------------------------------------------------------------------------
  // Catálogo. Lo que el cliente necesita para no intentar subidas imposibles.
  app.get('/', async (req, reply) => {
    const u = await sesion(req);
    if (!u) return negar(reply, { status: 401, error: 'no_session' });
    return { cubos: catalogoPublico() };
  });

  // Salud del almacén. Solo admin: dice qué commit está vivo allí.
  app.get('/salud', async (req, reply) => {
    const u = await sesion(req);
    if (!u) return negar(reply, { status: 401, error: 'no_session' });
    if (u.role !== 'admin') return negar(reply, { status: 403, error: 'solo_admin' });
    return { almacen: await almacen.salud(), configurado: almacen.configurado() };
  });

  // Crea los cubos declarados. Idempotente, y solo hace falta la primera vez:
  // las subidas también lo intentan solas si el cubo no estaba.
  app.post('/preparar', async (req, reply) => {
    const u = await sesion(req);
    if (!u) return negar(reply, { status: 401, error: 'no_session' });
    if (u.role !== 'admin') return negar(reply, { status: 403, error: 'solo_admin' });
    const hechos = [];
    for (const nombre of Object.keys(CUBOS)) { await almacen.asegurarCubo(nombre); hechos.push(nombre); }
    return { cubos: hechos };
  });

  // ---------------------------------------------------------------------------
  // El avatar propio. Sin clave en la ruta: la pone el servidor.

  app.put('/avatar', { bodyLimit: MAX_BYTES }, async (req, reply) => {
    const u = await sesion(req);
    if (!u) return negar(reply, { status: 401, error: 'no_session' });
    const clave = claveDeSesion('avatares', u);
    return subida(req, reply, 'avatares', clave, { reemplazar: true });
  });

  app.get('/avatar', async (req, reply) => {
    const u = await sesion(req);
    if (!u) return negar(reply, { status: 401, error: 'no_session' });
    return bajada(reply, 'avatares', claveDeSesion('avatares', u));
  });

  app.delete('/avatar', async (req, reply) => {
    const u = await sesion(req);
    if (!u) return negar(reply, { status: 401, error: 'no_session' });
    await almacen.borrar('avatares', claveDeSesion('avatares', u));
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------------------
  // Rutas crudas por cubo y clave. La clave puede llevar '/', así que va como
  // comodín. Las rutas estáticas de arriba ganan a `:cubo` en el router.

  app.get('/:cubo', async (req, reply) => {
    const u = await sesion(req);
    const { cubo } = req.params;
    const prefijo = String(req.query?.prefix ?? '');
    const no = puedeListar(cubo, prefijo, u, accesoLeccion);
    if (no) return negar(reply, no);
    return almacen.listar(cubo, prefijo);
  });

  app.get('/:cubo/*', async (req, reply) => {
    const u = await sesion(req);
    const { cubo } = req.params;
    const clave = req.params['*'];
    const no = puedeLeer(cubo, clave, u, accesoLeccion);
    if (no) return negar(reply, no);
    return bajada(reply, cubo, clave, req.query?.descarga === '1');
  });

  app.put('/:cubo/*', { bodyLimit: MAX_BYTES }, async (req, reply) => {
    const u = await sesion(req);
    const { cubo } = req.params;
    const clave = req.params['*'];
    const no = puedeEscribir(cubo, clave, u);
    if (no) return negar(reply, no);
    return subida(req, reply, cubo, clave, { reemplazar: req.query?.reemplazar === '1' });
  });

  app.delete('/:cubo/*', async (req, reply) => {
    const u = await sesion(req);
    const { cubo } = req.params;
    const clave = req.params['*'];
    const no = puedeEscribir(cubo, clave, u);
    if (no) return negar(reply, no);
    await almacen.borrar(cubo, clave);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------------------

  async function bajada(reply, cubo, clave, comoAdjunto = false) {
    const m = await almacen.descargar(cubo, clave);
    blindar(reply, cubo);
    reply.header('content-type', m.tipo);
    if (m.bytes) reply.header('content-length', String(m.bytes));
    if (m.etag) reply.header('etag', m.etag);
    if (comoAdjunto) {
      const nombre = String(clave).split('/').pop().replace(/"/g, '');
      reply.header('content-disposition', `attachment; filename="${nombre}"`);
    }
    return reply.send(m.cuerpo);
  }

  async function subida(req, reply, cubo, clave, { reemplazar }) {
    const tipo = tipoLimpio(req.headers['content-type']);
    const declarados = Number(req.headers['content-length']);
    const no = admiteCuerpo(cubo, tipo, Number.isFinite(declarados) ? declarados : null);
    if (no) return negar(reply, no);

    // Fastify ya parseó el cuerpo si el tipo era uno de los suyos. Aquí no puede
    // pasar —`admiteCuerpo` no admite JSON en ningún cubo— pero si algún día un
    // cubo admitiera un tipo parseable, el stream no existiría y esto lo dice.
    const entrada = req.body;
    if (!entrada || typeof entrada.pipe !== 'function') {
      return negar(reply, { status: 400, error: 'cuerpo_invalido', msg: 'Manda los bytes en crudo, no un formulario.' });
    }

    let paso = false;
    const contador = tope(CUBOS[cubo].maxBytes, () => { paso = true; });
    // El stream se encadena con `pipeline` para que un fallo en cualquiera de los
    // dos extremos destruya el otro y no deje un socket colgando.
    const cuerpo = entrada.pipe(contador);
    entrada.on('error', (e) => contador.destroy(e));

    // Cuando salta el techo NO se destruye el socket del cliente, aunque sea lo
    // primero que apetece. Si se destruye, el que sube recibe un ECONNRESET en
    // vez del 413 y se queda sin saber por que fallo: probado, y era justo lo
    // que pasaba. Lo correcto es dejar de reenviar y TIRAR lo que siga llegando,
    // para que el cliente pueda terminar de escribir y leer la respuesta.
    //
    // Tirarlo tiene un tope propio: si aun despues del corte sigue empujando el
    // doble del techo, ya no es alguien con un fichero grande, y ahi si se corta.
    let tirados = 0;
    contador.on('error', () => {
      entrada.unpipe(contador);
      entrada.on('data', (trozo) => {
        tirados += trozo.length;
        if (tirados > CUBOS[cubo].maxBytes) entrada.destroy();
      });
      entrada.resume();
    });

    try {
      const r = await guardar(cubo, clave, { cuerpo, tipo, reemplazar });
      return reply.code(r.creado ? 201 : 200).send({ cubo, clave, creado: r.creado, tipo });
    } catch (e) {
      // Si el que cortó fue el contador, el error real es el techo del cubo, no
      // lo que `fetch` diga de la conexión rota.
      // El socket ya no sirve para otra peticion: se cierra tras contestar.
      if (paso) { reply.header('connection', 'close'); return negar(reply, excedido(cubo)); }
      throw e;
    }
  }

  // Cubos que ya se sabe que existen en el almacén, en lo que dura el proceso.
  // Crear un cubo es idempotente, así que esto no es una caché de corrección sino
  // de ruido: sin ella habría un PUT de más en cada subida.
  const preparados = new Set();

  /** Se asegura de que el cubo existe ANTES de empezar a mandar los bytes.
   *
   *  La alternativa tentadora —subir, y si el almacén dice `no_bucket` crearlo y
   *  reintentar— no es correcta: para cuando llega esa respuesta el stream de la
   *  petición ya se consumió en parte, y un stream no se rebobina. El reintento
   *  subiría lo que quedaba y guardaría un fichero truncado sin que nadie se
   *  entere. Un viaje de ida y vuelta la primera vez de cada cubo es más barato
   *  que un medio corrupto.
   *
   *  Esto es lo que hace que desplegar un volumen vacío no exija un paso manual:
   *  el primer avatar del primer día crea `avatares` y sigue. */
  async function guardar(cubo, clave, args) {
    if (!preparados.has(cubo)) {
      await almacen.asegurarCubo(cubo);
      preparados.add(cubo);
    }
    return almacen.subir(cubo, clave, args);
  }
}
