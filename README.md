# AI from Scratch (IA desde cero)

Curso interactivo de IA desde cero: web (Astro) + API (Fastify/Postgres) con
lecciones, labs corregidos en servidor, ontología de conceptos y pagos (Mercado Pago).

## Stack

- **web/** — Astro. Frontend del curso (lecciones, labs, checkout).
- **api/** — Fastify 5 + Node 22. Sin ORM, `pg` directo a Postgres 17. Auth con
  `node:crypto` (scrypt + HMAC). Corrección de labs vive en el servidor
  (`api/src/grade.js`), nunca en el cliente.
- **db** — Postgres 17 (contenedor `db` en `docker-compose.yml`).
- **media** — `media-store`, el almacén de objetos propio (repositorio aparte, Go).
  Guarda avatares, PDF y medios de lección. El navegador no lo alcanza: `api`
  autoriza y hace de proxy. Detrás de un perfil de compose. Ver `MEDIOS.md`.
- **scripts/** — orquestación de dev (`dev.mjs`) y generación de ontología.

## Requisitos

- Node 22
- pnpm 10 (`packageManager` fijado en `package.json`)
- Docker (para Postgres, o correr todo con `docker compose`)

## Correrlo — opción rápida (Docker, todo incluido)

```bash
docker compose up --build
```

Levanta `db` (Postgres), `api` (puerto 8787) y `web` (puerto 4321). La siembra
(`seed`) corre sola y es idempotente.

## Correrlo — modo desarrollo (local, con hot reload)

```bash
pnpm setup          # instala deps de api/ y web/
pnpm db              # solo levanta Postgres en Docker
cp api/.env.example api/.env   # setear JWT_SECRET real
pnpm seed            # 12 lecciones, 36 labs, 3 usuarios de prueba
pnpm dev             # levanta api + web con reload
```

- Web: http://localhost:4321
- API: http://127.0.0.1:8787

## Variables de entorno (`api/.env`)

| Variable | Obligatoria | Qué hace |
|---|---|---|
| `JWT_SECRET` | sí | El server no arranca sin esto. |
| `DATABASE_URL` | sí (o la inyecta docker compose) | Conexión a Postgres. |
| `WEB_ORIGIN` | sí | CORS, origen del frontend. |
| `MP_ACCESS_TOKEN` / `MP_PUBLIC_KEY` / `MP_WEBHOOK_SECRET` | no | Sin estas, `/api/payments/...` responde `501` (no se puede pagar, resto de la app funciona igual). |
| `IA_SECRETO` | no | Secreto compartido con `media-store`. Sin él, `/api/medios/*` responde `503` y el resto de la app funciona igual. |
| `MEDIA_URL` | no | Dónde está el almacén. Por defecto `http://127.0.0.1:8792`; en compose, `http://media:8792`. |

## Comandos útiles

```bash
pnpm reset                # borra DB, la levanta de nuevo y reseed
pnpm test:aislamiento     # test de aislamiento de datos entre usuarios
pnpm --dir api test:medios   # 87 comprobaciones de medios, sin Postgres ni Docker
pnpm ontologia            # regenera el grafo de ontología de conceptos
pnpm stop                 # apaga web local + contenedores docker
```

## Cosas a saber antes de tocar el código

- **Corrección de labs en servidor.** `labs.solution` nunca sale en una respuesta
  (`publicLab()` la filtra). No mover la corrección al cliente.
- **Borrado de cuenta = soft delete.** Se conserva la fila (los intentos siguen
  contando para la cohorte), se marca `deleted_at`, se anonimiza el nombre y se
  rota el correo a `borrado+{id}@alpadev.local`.
- **El almacén de medios no decide nada; decide el API.** `media-store` guarda
  bytes. Quién puede leer o escribir cada cubo está declarado en
  `api/src/medios.js`, y el muro de pago en `api/src/muro.js`. No duplicar
  ninguna de las dos reglas dentro de una ruta.
- Ver `PLATAFORMA.md`, `MEDIOS.md`, `ONTOLOGIA.md`, `ESTADO.md` y `REGIONES.md`
  para contexto de producto, estado actual y decisiones de contenido.

## Estructura

```
api/        Fastify API — auth, contenido, grading, ontología, pagos
web/        Astro frontend
scripts/    dev.mjs (orquesta api+web), gen-ontologia.mjs
docker-compose.yml   db + api + web, un comando (+ media, tras --profile medios)
```
