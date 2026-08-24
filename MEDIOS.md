# Medios · el almacén de objetos y cómo lo usa la plataforma

Fecha: **24 de agosto de 2026.** Lo de abajo describe lo que hay en *este*
repositorio ese día. Si lo lees mucho después, cada afirmación lleva
`fichero:línea` o un comando para que puedas comprobarla en vez de creerla.

## La regla

> **El almacén de medios no decide nada. Decide el API.**

`media-store` es un servicio Go+Fiber que guarda bytes en un volumen y la ficha
en un hermano `<clave>.media-meta.json`. No es S3 y no tiene base de datos.
Entiende cubos, claves y bytes: no sabe qué es una compra, ni una lección, ni una
sesión.

El navegador **nunca** habla con `media`. Habla con Astro, Astro proxea a
`api`, y `api` autoriza y reenvía. Por eso `media` va sin puerto publicado:
alcanzable solo por nombre de servicio dentro de la red de compose, detrás de un
secreto compartido (`x-ia-secreto` ← `IA_SECRETO`). Un puerto abierto sería una
segunda puerta sin muro.

```
navegador → web (Astro) → api (Fastify) → media (Go)
             proxea        AUTORIZA        guarda bytes
```

## Las tres piezas en `api/`

| Fichero | Qué es | Qué NO hace |
|---|---|---|
| `api/src/medios.js` | La tabla de permisos: cubos, clases de lectura y escritura, claves válidas, techos y tipos. Fuente de verdad, no documentación. | No habla con nadie. Es puro. |
| `api/src/media-bridge.js` | El cable: `MEDIA_URL`, el secreto, subir/bajar/ficha/borrar/listar, y la traducción de errores. | No opina sobre permisos. |
| `api/src/medios-rutas.js` | Un plugin de Fastify con las rutas, el parser de cuerpo binario y el traductor de errores, los tres **encapsulados**. | No decide. Pregunta a `medios.js`. |

El muro de pago salió de `server.js` a `api/src/muro.js` cuando el plugin
necesitó la misma respuesta: lo consultan el índice de lecciones, el intento de
un lab y ahora los medios. Una regla con tres lectores no puede vivir dentro de
uno de ellos.

## Los cubos

| cubo | lectura | escritura | clave | techo | tipos |
|---|---|---|---|---|---|
| `avatares` | **propio** | propio | la pone el servidor | 2 MiB | png jpeg webp avif gif |
| `libros` | **compra** | admin | libre | 64 MiB | pdf |
| `lecciones` | **lección** | admin | empieza por `NN/` | 64 MiB | imagen, audio, vídeo, pdf |
| `publico` | **público** | admin | libre | 16 MiB | imagen, vídeo |

Clases de lectura: `publico` (con sesión o sin ella) · `sesion` · `compra` (o
tutor/admin) · `leccion` (el muro lección a lección, igual que `/api/lessons/:n`)
· `propio` · `admin`.

### El convenio de nombres

Claves en minúscula: palabras de `[a-z0-9._-]` unidas por `/`. Máximo 200
caracteres y 8 tramos. Los ficheros que hoy tengan mayúsculas, tildes o espacios
**hay que renombrarlos** antes de subirlos.

```
avatares/u42                        ← una por cuenta, sin extensión (ver abajo)
libros/curso-es.pdf
libros/curso-en.pdf
lecciones/01/portada.png
lecciones/03/audio/intro.mp3
lecciones/12/video/cierre.mp4
publico/og-image.png
publico/landing/mesa-llena.webp
```

Dos decisiones que parecen detalles y no lo son:

- **La lección va con dos cifras** (`01`, no `1`). Es lo que permite situar la
  clave detrás del muro leyendo el primer tramo. Una clave del cubo `lecciones`
  sin prefijo numérico no se puede situar, y lo que no se puede situar no se
  abre: responde 400, no 200.
- **El avatar no lleva extensión.** El tipo lo guarda `media-store` en la ficha y
  lo devuelve al leer. Con extensión habría dos sitios apuntando a lo mismo, y
  cambiar de PNG a JPG dejaría dos avatares vivos. Una clave por cuenta:
  reemplazar es reemplazar y borrar es una sola llamada.

### Sobre las claves propias

El aislamiento del agente de IA funciona porque **ninguna herramienta acepta un
identificador de usuario**: el modelo no puede ni expresar «los datos de otro».
Aquí no se llega tan lejos, y conviene decirlo en voz alta: la ruta cruda
`/api/medios/avatares/<clave>` **sí** puede nombrar la clave de otra persona,
porque es la misma ruta que sirve a los demás cubos.

Por eso la clase `propio` compara la clave pedida con la que el servidor le
habría puesto a esa sesión (`claveDeSesion()`, la única que las fabrica).
`GET /api/medios/avatares/u7` con la sesión de otro responde **403 `clave_ajena`**,
y lo mismo escribir y borrar. Están las tres probadas.

## Las rutas

Todas bajo `/api/medios`. Prefijo registrado en `api/src/server.js:20`.

| ruta | quién | qué |
|---|---|---|
| `GET /api/medios` | sesión | los cubos, sus techos y sus tipos |
| `GET /api/medios/salud` | admin | qué commit del almacén está vivo |
| `POST /api/medios/preparar` | admin | crea los cubos. Idempotente, y casi nunca hace falta: la primera subida de cada cubo lo crea sola |
| `PUT /api/medios/avatar` | sesión | sube el propio. **Sin clave en la ruta** |
| `GET /api/medios/avatar` | sesión | lee el propio |
| `DELETE /api/medios/avatar` | sesión | borra el propio |
| `GET /api/medios/:cubo?prefix=` | según el cubo | listado |
| `GET /api/medios/:cubo/*` | según el cubo | descarga. `?descarga=1` la fuerza como adjunto |
| `PUT /api/medios/:cubo/*` | según el cubo | sube. `?reemplazar=1` para pisar (si no, 409) |
| `DELETE /api/medios/:cubo/*` | según el cubo | borra. Idempotente |

En `avatares` y `lecciones` el permiso depende de la clave, así que **listar
exige prefijo**: sin él no hay índice que enseñar y responde 400 `falta_prefijo`.

El cuerpo de una subida son **los bytes en crudo**, no un formulario:

```bash
curl -X PUT --data-binary @foto.png -H 'content-type: image/png' \
     -b cookie.txt http://localhost:4321/api/medios/avatar
```

### Cabeceras de lo que sale

`x-content-type-options: nosniff` y `content-security-policy: default-src 'none';
sandbox` en todo. Los tipos permitidos ya excluyen `text/html` e
`image/svg+xml` —las dos formas de que una imagen ejecute JavaScript en nuestro
origen— y esas dos cabeceras son la segunda cerradura por si esa lista se toca
sin pensarlo.

`cache-control`: `public, max-age=3600` solo en el cubo `publico`. Todo lo demás
pasó por un muro y va `private, no-store`, porque una caché intermedia no sabe
nada de muros.

## Los códigos de error

Los del almacén se traducen a los de la plataforma para que la web siga teniendo
**un solo `switch`** y no dos vocabularios.

| `media-store` | la plataforma | HTTP |
|---|---|---|
| `no_object` | `no_existe` | 404 |
| `object_exists` | `ya_existe` | 409 |
| `bad_name` | `nombre_invalido` | 400 |
| `too_large` | `demasiado_grande` | 413 |
| `no_bucket` | `medios_sin_preparar` | 503 |
| `corrupt_object` | `medio_corrupto` | 500 |
| `no_es_el_servicio` | `medios_mal_configurado` | **500** |
| (sin conexión) | `medios_caido` | 503 |
| (sin `IA_SECRETO`) | `medios_sin_configurar` | 503 |

Y los que pone `api` antes de llamar: `requiere_compra` (402), `solo_admin`
(403), `clave_ajena` (403), `tipo_no_permitido` (415), `falta_prefijo` (400).

**Los dos 500 son deliberados.** Que el almacén rechace nuestro secreto no es
culpa de quien está mirando la pantalla: es un fallo de montaje. Devolver su 401
tal cual le diría a la web que la sesión caducó, y le cerraría la sesión a
alguien por un error nuestro.

## Cómo se corre

```bash
cp api/.env.example api/.env         # pon JWT_SECRET y IA_SECRETO
pnpm --dir api test:medios           # 87 comprobaciones, sin Postgres y sin almacén
docker compose --profile medios up -d media   # cuando la imagen exista
```

`media` está **detrás de un perfil de compose** a propósito: su imagen todavía no
está publicada en ninguna parte, y meterla en el arranque por defecto rompería
`pnpm docker`, que hoy funciona. Sin almacén, las rutas de medios responden 503 y
el resto del curso sigue igual — igual que sin credenciales de Mercado Pago el
checkout responde 501 en vez de fingir un pago.

`pnpm --dir api test:medios` levanta un `media-store` **falso** en un puerto
local con el mismo contrato que el de verdad. Prueba las tres capas —la tabla de
permisos, el cable y las rutas por HTTP real— sin Postgres y sin Docker, así que
corre en cualquier máquina. Va por HTTP de verdad y no por `app.inject()` porque
lo que hay que demostrar es que un fichero pasa del cliente al almacén **sin
juntarse en memoria**, y un inject entrega el cuerpo ya buffereado: la prueba
pasaría sin probar nada. Hay una comprobación que manda 900 KiB y compara byte a
byte lo que vuelve.

## Lo que falta

Ordenado por lo que bloquea a lo demás.

1. **La imagen de `media-store` no existe en ningún registro.** `media-store` es
   otro repositorio (y según su propio handoff, todavía **sin un solo commit**),
   así que el workflow de release de esta plataforma no lo va a recoger. Hay que
   decidir: (a) publicarlo a GHCR etiquetado con el sha desde *su* repositorio, y
   que un workflow suyo entre por SSH al Pi y haga `pull`; o (b) referenciar la
   imagen desde el despliegue de esta plataforma. En el Pi **no se compila nada**.
   Mientras tanto, `MEDIA_IMAGE` en `docker-compose.yml` apunta a un nombre que
   nadie ha publicado.
2. **`VERSION` con el sha** al publicar, para que `/health` diga qué commit está
   vivo. La ruta `GET /api/medios/salud` ya lo enseña cuando lo haya.
3. **Copia de seguridad de `media-data`.** Un solo nodo, tan duradero como el
   disco del Pi. `media-store` borra de verdad: no hay papelera. Falta decidir
   rsync o restic, cada cuánto y dónde aterriza. Hasta que exista, lo que se
   borre no vuelve.
4. **Peticiones por rango.** `GET` sirve el objeto entero. Para que el audio y el
   vídeo se puedan buscar hace falta `Range` en `media-store` (`SendFile` de
   fasthttp, o rangos a mano). Hueco conocido, del lado del almacén.
5. **Sembrar los medios que ya existen.** No hay ningún fichero del curso en este
   repositorio, así que no se ha subido nada. Cuando estén: renombrarlos al
   convenio de arriba y subirlos con `PUT /api/medios/:cubo/*` como admin.
6. **Interfaz.** No hay ninguna pantalla que suba un avatar ni que enseñe un
   medio. El API está listo y probado; `web/` no se ha tocado más que para
   arreglar el proxy. Cuando se haga, hará falta i18n para los códigos nuevos.

## Nota sobre los dos handoffs

Los dos documentos de traspaso del 24 de agosto describen un
`app_ai_from_scratch` con `api` en TypeScript, un servicio `data/` en Go, `ai/`
en Python, `queue/`, `scripts/verify.mjs` y `docs/`. **Nada de eso está en este
repositorio**, que es una instantánea anterior: `api` en JavaScript con Fastify,
`web` en Astro, Postgres, y un solo commit. Comprobado: cero ficheros `.ts`,
`.mts`, `.go` o `.py`.

```bash
find . -path ./.git -prune -o \( -name '*.mts' -o -name '*.go' -o -name '*.py' \) -print
```

Lo que se hizo aquí es el punto 1 del primer handoff —cablear `api` para que
haga de proxy de los medios— adaptado al código que sí existe. La forma
(la tabla de permisos, la traducción de errores, el streaming, las pruebas)
sobrevive a la migración a TypeScript aunque cambien las extensiones.
