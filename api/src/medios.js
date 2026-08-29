// Ontología de los medios: qué cubos existen, quién puede leerlos y quién puede
// escribirlos.
//
// Esto NO es documentación: es la fuente de verdad que el servidor consulta antes
// de tocar el almacén. La regla que la ordena es la misma de `ontology.js`:
//
//   El almacén de medios no decide nada. Decide el API.
//
// `media-store` guarda bytes y comprueba que la clave no se escape del disco. No
// sabe qué es una compra, ni una lección, ni una sesión. Si la autorización
// viviera allí, habría dos sitios donde equivocarse; aquí hay uno.
//
// Clases de LECTURA:
//   publico  → cualquiera, con sesión o sin ella (portadas, imágenes de la landing)
//   sesion   → cualquiera que haya entrado
//   compra   → solo quien pagó (o tutor/admin, que acompañan)
//   leccion  → el muro de pago lección a lección: la clave empieza por NN/
//   propio   → solo el dueño; la clave la pone el servidor, no el cliente
//   admin    → solo administración
//
// Clases de ESCRITURA:
//   propio   → cada quien sobre lo suyo, con la clave que le impone el servidor
//   admin    → solo administración
//
// Nota sobre `clave: 'sesion'`: es el mismo mecanismo que aísla al agente de IA.
// Allí ninguna herramienta acepta un identificador de usuario, así que el modelo
// no puede ni expresar «los datos de otro». Aquí no se llega tan lejos: la ruta
// cruda `/api/medios/avatares/<clave>` sí puede nombrar la clave de otra persona,
// porque es la misma ruta que sirve a los demás cubos. Por eso la clase `propio`
// compara la clave pedida con la que el servidor le habría puesto a esta sesión,
// y `claveDeSesion()` es la única que las fabrica. La ruta de conveniencia
// `/api/medios/avatar` no acepta clave en absoluto.

const MiB = 1024 * 1024;

const IMAGENES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'];
const AUDIO = ['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm'];
const VIDEO = ['video/mp4', 'video/webm'];

export const CUBOS = {
  avatares: {
    proposito: 'La foto de cada persona. Una por cuenta.',
    lectura: 'propio',
    escritura: 'propio',
    clave: 'sesion',
    // 2 MiB es de sobra para una foto de perfil y no invita a usar el cubo de
    // almacén general. Lo que no cabe se recorta antes de subir, no después.
    maxBytes: 2 * MiB,
    tipos: IMAGENES,
  },

  libros: {
    proposito: 'Los PDF del curso, uno por idioma: curso-es.pdf, curso-en.pdf.',
    lectura: 'compra',
    escritura: 'admin',
    clave: 'libre',
    maxBytes: 64 * MiB,
    tipos: ['application/pdf'],
  },

  lecciones: {
    proposito: 'Medios de cada lección: portada, audio, vídeo. La clave empieza por el número de lección con dos cifras.',
    // El muro no es «pagaste o no»: es lección a lección, igual que /api/lessons/:n.
    // La 01 es gratis, así que su portada también lo es.
    lectura: 'leccion',
    escritura: 'admin',
    clave: 'leccion',
    maxBytes: 64 * MiB,
    tipos: [...IMAGENES, ...AUDIO, ...VIDEO, 'application/pdf'],
  },

  publico: {
    proposito: 'Lo que se ve sin haber entrado: imágenes de la landing, og:image, iconos.',
    lectura: 'publico',
    escritura: 'admin',
    clave: 'libre',
    maxBytes: 16 * MiB,
    tipos: [...IMAGENES, ...VIDEO],
  },
};

/** El techo más alto de todos los cubos. Es el límite de cuerpo de las rutas de
 *  subida; el del cubo concreto se comprueba después, byte a byte. */
export const MAX_BYTES = Math.max(...Object.values(CUBOS).map((c) => c.maxBytes));

export const cubo = (nombre) => (Object.hasOwn(CUBOS, String(nombre)) ? CUBOS[nombre] : null);

// ---------------------------------------------------------------------------
// Claves
//
// Las mismas reglas que aplica `media-store`, repetidas aquí a propósito: el API
// no debe depender de que el almacén rechace lo que el API nunca debió mandar.
// Palabras en minúscula de [a-z0-9._-] unidas por '/'.
const PALABRA = /^[a-z0-9._-]+$/;
const MAX_CLAVE = 200;
const MAX_TRAMOS = 8;
// `media-store` guarda la metadata en un hermano `<clave>.media-meta.json`. Una
// clave con ese sufijo pisaría la ficha de otro objeto, así que no se acepta.
const SUFIJO_META = '.media-meta.json';

export function claveValida(clave) {
  const k = String(clave ?? '');
  if (!k || k.length > MAX_CLAVE) return false;
  if (k.endsWith(SUFIJO_META)) return false;
  const tramos = k.split('/');
  if (tramos.length > MAX_TRAMOS) return false;
  return tramos.every((t) => PALABRA.test(t) && t !== '.' && t !== '..');
}

/** El número de lección que gobierna una clave del cubo `lecciones`: '03/audio/intro.mp3' → 3.
 *  Sin prefijo numérico no hay lección que consultar, y entonces no se abre. */
export function leccionDeClave(clave) {
  const primero = String(clave ?? '').split('/')[0];
  if (!/^\d{2}$/.test(primero)) return null;
  const n = Number(primero);
  return n >= 1 ? n : null;
}

/** La clave que el servidor impone en los cubos propios. El cliente no la elige.
 *
 *  Sin extensión a propósito: `media-store` guarda el tipo en la ficha y lo
 *  devuelve al leer, así que la extensión sería un segundo sitio donde apuntar lo
 *  mismo. Con extensión, cambiar de PNG a JPG dejaría dos avatares vivos y habría
 *  que borrar a ciegas las cinco variantes en cada subida. Una clave por cuenta:
 *  reemplazar es reemplazar y borrar es una sola llamada. */
export function claveDeSesion(nombreCubo, usuario) {
  if (nombreCubo !== 'avatares') return null;
  const id = Number(usuario?.id);
  return Number.isInteger(id) && id > 0 ? `u${id}` : null;
}

/** El tipo de contenido, sin parámetros: 'image/png; charset=x' → 'image/png'.
 *
 *  Se recorta a los caracteres que un tipo puede tener de verdad. No es cosmética:
 *  este valor se devuelve al cliente en `recibido` cuando el cubo no lo admite, y
 *  lo que vuelve al cliente lo escribió el cliente. Filtrarlo aquí, en el borde,
 *  vale más que confiar en que todos los que lo pinten se acuerden de escaparlo.
 *  Lo que no encaje se queda en cadena vacía, que es lo que era: no un tipo. */
export const tipoLimpio = (v) => {
  const t = String(v ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(t) ? t : '';
};

// ---------------------------------------------------------------------------
// Permisos
//
// Devuelven `null` cuando se puede, y `{ status, error, msg }` cuando no. Así la
// ruta hace `const no = puedeLeer(...); if (no) return reply.code(no.status).send(no);`
// y no hay forma de olvidarse de comprobar el resultado.

const NEGADO = {
  sesion:  { status: 401, error: 'no_session' },
  compra:  { status: 402, error: 'requiere_compra' },
  admin:   { status: 403, error: 'solo_admin' },
  cubo:    { status: 404, error: 'no_existe', msg: 'Ese cubo de medios no existe.' },
  clave:   { status: 400, error: 'nombre_invalido', msg: 'La clave son palabras en minúscula de [a-z0-9._-] unidas por /.' },
  tipo:    { status: 415, error: 'tipo_no_permitido' },
  tamano:  { status: 413, error: 'demasiado_grande' },
  ajena:   { status: 403, error: 'clave_ajena', msg: 'En este cubo la clave la pone el servidor, y solo alcanza a lo tuyo.' },
};

const esPersonal = (u) => u && u.role === 'student';

/**
 * @param nombreCubo  cubo pedido
 * @param clave       clave pedida (ya validada o no; se valida aquí)
 * @param usuario     fila de users, o null si no hay sesión
 * @param accesoLeccion  (usuario, n) => boolean — el muro de pago del curso. Es
 *                    `conAcceso` de `server.js` tal cual: el muro sigue viviendo
 *                    en un solo sitio y aquí no se reimplementa.
 */
export function puedeLeer(nombreCubo, clave, usuario, accesoLeccion) {
  const c = cubo(nombreCubo);
  if (!c) return NEGADO.cubo;
  if (!claveValida(clave)) return NEGADO.clave;

  switch (c.lectura) {
    case 'publico':
      return null;
    case 'sesion':
      return usuario ? null : NEGADO.sesion;
    case 'compra':
      if (!usuario) return NEGADO.sesion;
      return usuario.paid || !esPersonal(usuario) ? null : NEGADO.compra;
    case 'leccion': {
      if (!usuario) return NEGADO.sesion;
      const n = leccionDeClave(clave);
      // Una clave sin prefijo de lección no se puede situar detrás del muro, y
      // lo que no se puede situar no se abre.
      if (n === null) return { status: 400, error: 'nombre_invalido', msg: 'En este cubo la clave empieza por el número de lección: 03/portada.png.' };
      return accesoLeccion(usuario, n) ? null : { status: 402, error: 'requiere_compra', leccion: n };
    }
    case 'propio': {
      if (!usuario) return NEGADO.sesion;
      // Esta es la comprobación que hace que la ruta cruda del cubo sea tan
      // segura como la ruta de conveniencia: la clave pedida tiene que ser la
      // que el servidor le habría puesto a esta sesión. Sin esto, `avatares/u1`
      // se lo lleva cualquiera que haya entrado.
      return clave === claveDeSesion(nombreCubo, usuario) ? null : NEGADO.ajena;
    }
    case 'admin':
      if (!usuario) return NEGADO.sesion;
      return usuario.role === 'admin' ? null : NEGADO.admin;
    default:
      // Un cubo con una clase que nadie implementó se cierra, no se abre.
      return NEGADO.admin;
  }
}

export function puedeEscribir(nombreCubo, clave, usuario) {
  const c = cubo(nombreCubo);
  if (!c) return NEGADO.cubo;
  if (!usuario) return NEGADO.sesion;
  if (c.escritura === 'admin' && usuario.role !== 'admin') return NEGADO.admin;
  // En un cubo propio la clave la impone el servidor: si la ruta trae una, es
  // que alguien intentó escribir donde no le toca.
  if (c.clave === 'sesion') {
    const suya = claveDeSesion(nombreCubo, usuario);
    if (!suya) return NEGADO.sesion;
    // `clave` vacía = la ruta de conveniencia, que no pide clave. Con clave, tiene
    // que coincidir con la suya.
    return !clave || clave === suya ? null : NEGADO.ajena;
  }
  if (!claveValida(clave)) return NEGADO.clave;
  if (c.clave === 'leccion' && leccionDeClave(clave) === null) {
    return { status: 400, error: 'nombre_invalido', msg: 'En este cubo la clave empieza por el número de lección: 03/portada.png.' };
  }
  return null;
}

/**
 * Listar no es leer una clave: es leer el índice del cubo.
 *
 * En los cubos donde el permiso depende de la clave —`propio` (¿es tuya?) y
 * `leccion` (¿pagaste esa lección?)— no existe un índice que se pueda enseñar
 * entero, porque la respuesta sería distinta clave a clave. Ahí el prefijo es
 * obligatorio y se autoriza exactamente como si fuera una clave. En los demás el
 * permiso es del cubo y el prefijo solo filtra.
 */
export function puedeListar(nombreCubo, prefijo, usuario, accesoLeccion) {
  const c = cubo(nombreCubo);
  if (!c) return NEGADO.cubo;
  const p = String(prefijo ?? '');
  const porClave = c.lectura === 'propio' || c.lectura === 'leccion';

  if (porClave) {
    if (!p) return { status: 400, error: 'falta_prefijo', msg: `En ${nombreCubo} hay que decir qué prefijo se lista: el permiso depende de la clave.` };
    return puedeLeer(nombreCubo, p, usuario, accesoLeccion);
  }
  if (p && !claveValida(p)) return NEGADO.clave;
  // Sin prefijo no hay clave que validar, así que se consulta el permiso del cubo
  // con una clave cualquiera que sea válida: lo que decide aquí es la clase.
  return puedeLeer(nombreCubo, p || 'x', usuario, accesoLeccion);
}

/** El tipo declarado y el tamaño anunciado, contra lo que admite el cubo. */
export function admiteCuerpo(nombreCubo, tipo, bytesDeclarados) {
  const c = cubo(nombreCubo);
  if (!c) return NEGADO.cubo;
  const t = tipoLimpio(tipo);
  if (!c.tipos.includes(t)) {
    return { ...NEGADO.tipo, msg: `${nombreCubo} admite: ${c.tipos.join(', ')}.`, recibido: t || null };
  }
  // Content-Length es una promesa del cliente, no un hecho: se cree para cortar
  // pronto lo que ya se declara imposible, y se vuelve a contar al recibir.
  if (Number.isFinite(bytesDeclarados) && bytesDeclarados > c.maxBytes) {
    return { ...NEGADO.tamano, max: c.maxBytes, msg: `El máximo de ${nombreCubo} son ${Math.round(c.maxBytes / MiB)} MiB.` };
  }
  return null;
}

export const excedido = (nombreCubo) => ({
  ...NEGADO.tamano,
  max: cubo(nombreCubo)?.maxBytes ?? null,
  msg: `El máximo de ${nombreCubo} son ${Math.round((cubo(nombreCubo)?.maxBytes ?? 0) / MiB)} MiB.`,
});

/** Lo que se le puede contar al cliente de un cubo. Sin techos ni clases: es la
 *  lista de lo que puede mandar, no el manual de cómo saltarse el muro. */
export const catalogoPublico = () =>
  Object.entries(CUBOS).map(([nombre, c]) => ({
    nombre, proposito: c.proposito, maxBytes: c.maxBytes, tipos: c.tipos,
  }));
