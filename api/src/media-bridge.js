// Cliente de `media-store`, el almacén de objetos propio de la plataforma.
//
// Qué es: un servicio Go+Fiber con API mínima propia (no S3, sin base de datos)
// que guarda los bytes en un volumen y la ficha en un hermano
// `<clave>.media-meta.json`. Solo entiende cubos, claves y bytes.
//
// Quién puede llamarlo: solo este proceso. El navegador NUNCA habla con `media`.
// En el Pi va sin puerto publicado, alcanzable por nombre de servicio
// (`media:8792`) y detrás de un secreto compartido. Lo que autoriza al visitante
// pasa antes, en `medios.js`; aquí ya está decidido.
//
// Este fichero no sabe nada del curso: ni muro, ni lecciones, ni sesiones. Es el
// cable, y el cable no opina.

import { Readable } from 'node:stream';

const BASE = (process.env.MEDIA_URL ?? 'http://127.0.0.1:8792').replace(/\/+$/, '');
const SECRETO = process.env.IA_SECRETO ?? '';

// Las llamadas de control (salud, ficha, borrado, listado) son de ida y vuelta y
// deben fallar pronto: si el almacén no contesta en 5 s, no va a contestar. Las
// transferencias no llevan reloj de pared — un vídeo de 60 MiB por una subida
// lenta es legítimo y cortarlo a los 5 s sería un error.
const MS_CONTROL = 5_000;

export const configurado = () => !!SECRETO;

/** Error con la forma que las rutas ya saben devolver: `{ status, error, msg }`. */
export class ErrorMedios extends Error {
  constructor({ status, error, msg, detalle }) {
    super(msg ?? error);
    this.status = status;
    this.error = error;
    this.msg = msg;
    this.detalle = detalle;
  }
  /** Lo que se manda al cliente. `detalle` se queda en el servidor: puede llevar
   *  rutas del almacén y al visitante no le sirven de nada. */
  get cuerpo() {
    return this.msg ? { error: this.error, msg: this.msg } : { error: this.error };
  }
}

// Los códigos de `media-store` traducidos a los de la plataforma, para que la web
// siga teniendo un solo `switch` de errores y no dos vocabularios.
//
// Nota sobre los dos 500: que el almacén no exista, o que rechace nuestro
// secreto, no es culpa de quien está mirando la pantalla. Son fallos de montaje
// y se cuentan como tales; devolver el 401 del almacén tal cual haría creer a la
// web que la sesión caducó, y cerraría la sesión de alguien por un error nuestro.
const MAPA = {
  no_bucket:         { status: 503, error: 'medios_sin_preparar', msg: 'El almacén no tiene ese cubo todavía.' },
  no_object:         { status: 404, error: 'no_existe' },
  object_exists:     { status: 409, error: 'ya_existe', msg: 'Ese medio ya existe. Para reemplazarlo, pídelo explícitamente.' },
  bad_name:          { status: 400, error: 'nombre_invalido' },
  too_large:         { status: 413, error: 'demasiado_grande' },
  corrupt_object:    { status: 500, error: 'medio_corrupto', msg: 'El medio está en el disco pero su ficha no se puede leer.' },
  no_es_el_servicio: { status: 500, error: 'medios_mal_configurado', msg: 'El API y el almacén no comparten el mismo IA_SECRETO.' },
};

const CAIDO = { status: 503, error: 'medios_caido', msg: 'El almacén de medios no responde.' };

/** Traduce una respuesta que no es 2xx. Consume el cuerpo: no se vuelve a leer. */
async function traducir(res) {
  let codigo = null;
  let cuerpo = '';
  try {
    cuerpo = await res.text();
    codigo = JSON.parse(cuerpo)?.error ?? null;
  } catch { /* el almacén contestó algo que no es JSON; queda el status */ }

  if (codigo && MAPA[codigo]) return new ErrorMedios({ ...MAPA[codigo], detalle: cuerpo });
  // Sin código reconocible se usa el status. Un 401 aquí solo puede ser el
  // secreto: el visitante no interviene en esta conexión.
  if (res.status === 401 || res.status === 403) return new ErrorMedios({ ...MAPA.no_es_el_servicio, detalle: cuerpo });
  if (res.status === 404) return new ErrorMedios({ ...MAPA.no_object, detalle: cuerpo });
  if (res.status === 409) return new ErrorMedios({ ...MAPA.object_exists, detalle: cuerpo });
  if (res.status === 413) return new ErrorMedios({ ...MAPA.too_large, detalle: cuerpo });
  return new ErrorMedios({ status: 502, error: 'medios_error', msg: 'El almacén de medios devolvió un error.', detalle: `${res.status} ${cuerpo}`.trim() });
}

async function pedir(ruta, opciones = {}, { reloj = MS_CONTROL } = {}) {
  if (!SECRETO) {
    throw new ErrorMedios({ status: 503, error: 'medios_sin_configurar', msg: 'Falta IA_SECRETO en el servidor: el almacén de medios está apagado.' });
  }
  const cabeceras = { ...(opciones.headers ?? {}), 'x-ia-secreto': SECRETO };
  try {
    return await fetch(`${BASE}${ruta}`, {
      ...opciones,
      headers: cabeceras,
      ...(reloj ? { signal: AbortSignal.timeout(reloj) } : {}),
    });
  } catch (e) {
    // Conexión rechazada, DNS, reloj agotado: para el visitante es todo lo mismo.
    throw new ErrorMedios({ ...CAIDO, detalle: String(e?.message ?? e) });
  }
}

// La clave puede llevar '/' y eso es parte de la ruta, no un separador que haya
// que escapar. Cada tramo se codifica por su cuenta. `medios.js` ya garantiza que
// solo hay [a-z0-9._-], así que esto es cinturón sobre tirantes.
const rutaObjeto = (cubo, clave) =>
  `/objects/${encodeURIComponent(cubo)}/${String(clave).split('/').map(encodeURIComponent).join('/')}`;

// ---------------------------------------------------------------------------
// Operaciones

export async function salud() {
  const res = await pedir('/health', { method: 'GET' });
  if (!res.ok) throw await traducir(res);
  return res.json();
}

/** Crea el cubo. Es idempotente en el almacén: llamarlo dos veces no es un error. */
export async function asegurarCubo(cubo) {
  const res = await pedir(`/buckets/${encodeURIComponent(cubo)}`, { method: 'PUT' });
  if (!res.ok) throw await traducir(res);
  return true;
}

export async function listarCubos() {
  const res = await pedir('/buckets', { method: 'GET' });
  if (!res.ok) throw await traducir(res);
  return res.json();
}

export async function listar(cubo, prefijo = '') {
  const q = prefijo ? `?prefix=${encodeURIComponent(prefijo)}` : '';
  const res = await pedir(`/buckets/${encodeURIComponent(cubo)}/objects${q}`, { method: 'GET' });
  if (!res.ok) throw await traducir(res);
  return res.json();
}

/**
 * Sube un objeto. `cuerpo` es un stream de Node y se pasa tal cual: el fichero
 * no se junta en memoria en ningún punto del camino, ni aquí ni en el almacén.
 * `duplex: 'half'` es obligatorio en fetch para mandar un cuerpo perezoso.
 *
 * Devuelve `{ creado }`: 201 = nuevo, 200 = reemplazado.
 */
export async function subir(cubo, clave, { cuerpo, tipo, reemplazar = false, bytes = null }) {
  const q = reemplazar ? '?overwrite=1' : '';
  const headers = { 'content-type': tipo || 'application/octet-stream' };
  // Si se conoce el tamaño se anuncia: deja que el almacén rechace lo que no cabe
  // antes de escribir un solo byte en el disco.
  if (Number.isFinite(bytes)) headers['content-length'] = String(bytes);

  const res = await pedir(rutaObjeto(cubo, clave) + q, {
    method: 'PUT',
    headers,
    body: cuerpo,
    duplex: 'half',
  }, { reloj: 0 });

  if (!res.ok) throw await traducir(res);
  return { creado: res.status === 201, clave, cubo };
}

/** La ficha del objeto, sin traerse los bytes. */
export async function ficha(cubo, clave) {
  const res = await pedir(`${rutaObjeto(cubo, clave)}?meta=1`, { method: 'GET' });
  if (!res.ok) throw await traducir(res);
  return res.json();
}

/** Existe o no, sin cuerpo. Devuelve la ficha que quepa en cabeceras, o null. */
export async function existe(cubo, clave) {
  const res = await pedir(rutaObjeto(cubo, clave), { method: 'HEAD' });
  if (res.status === 404) return null;
  if (!res.ok) throw await traducir(res);
  return {
    tipo: res.headers.get('content-type'),
    bytes: Number(res.headers.get('content-length') ?? 0),
    etag: res.headers.get('etag'),
  };
}

/**
 * Descarga. Devuelve un stream de Node listo para `reply.send()`, más las
 * cabeceras que hay que repetirle al cliente. El cuerpo no se lee aquí: viaja
 * del almacén al navegador sin pasar por la memoria de este proceso.
 */
export async function descargar(cubo, clave) {
  const res = await pedir(rutaObjeto(cubo, clave), { method: 'GET' }, { reloj: 0 });
  if (!res.ok) throw await traducir(res);
  if (!res.body) throw new ErrorMedios({ ...MAPA.corrupt_object, detalle: 'respuesta sin cuerpo' });
  return {
    cuerpo: Readable.fromWeb(res.body),
    tipo: res.headers.get('content-type') ?? 'application/octet-stream',
    bytes: Number(res.headers.get('content-length') ?? 0) || null,
    etag: res.headers.get('etag'),
  };
}

/** Borrado real, sin papelera. Es idempotente: borrar lo que no está no es error. */
export async function borrar(cubo, clave) {
  const res = await pedir(rutaObjeto(cubo, clave), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw await traducir(res);
  return true;
}
