# AI from Scratch (IA desde cero)

Curso interactivo y vendible de IA desde cero: web Astro, API Fastify, auth,
IA, defensa y un servicio independiente de pagos con Mercado Pago.

## Stack

- **web/** — Astro. Frontend del curso (lecciones, labs, checkout).
- **api/** — Fastify 5 + Node 22. HTTP, contenido, grading y puente entre servicios.
- **auth/** — login, registro, recuperación, cookies/JWT, roles, sesiones y entitlements.
- **payments/** — servicio TS7/`tsgo` extraíble a su propio repositorio, con base
  separada, checkout, suscripciones, webhooks verificados y reintentos.
- **ai/**, **data/**, **queue/**, **security/** — agente, acceso cerrado a datos,
  coordinación durable y respuesta de seguridad.
- **db** y **payments-db** — dos Postgres 17 con límites de persistencia separados.
- **scripts/** — orquestación de dev (`dev.mjs`) y generación de ontología.

## Requisitos

- Node 22
- pnpm 10 (`packageManager` fijado en `package.json`)
- Docker (para Postgres, o correr todo con `docker compose`)

## Correrlo — opción rápida (Docker, todo incluido)

```bash
pnpm keys
# completa MP_ACCESS_TOKEN y MP_WEBHOOK_SECRET en .env
docker compose up --build
```

Levanta la plataforma completa. La siembra corre sola y es idempotente.

## Correrlo — modo desarrollo (local, con hot reload)

```bash
pnpm setup          # instala deps de api/, payments/, web/ y ai/
pnpm db              # solo levanta Postgres en Docker
cp api/.env.example api/.env   # setear JWT_SECRET real
pnpm seed            # 12 lecciones, 36 labs, 3 usuarios de prueba
pnpm dev             # levanta api + web con reload
```

- Web: http://localhost:4321
- API: http://127.0.0.1:8787

## Variables de entorno principales

| Variable | Obligatoria | Qué hace |
|---|---|---|
| `JWT_SECRET` | sí | El server no arranca sin esto. |
| `DATA_URL` / `DATA_SECRETO` | sí para API/worker | Contrato cerrado con `data`; la API no recibe `DATABASE_URL`. |
| `DATABASE_URL` | solo `init`/`pnpm seed` | Credencial de Postgres, exclusiva del servicio de datos y migraciones. |
| `WEB_ORIGIN` | sí | CORS, origen del frontend. |
| `PAYMENTS_URL` / `PAYMENTS_SECRET` | sí | Contrato autenticado entre API y pagos. |
| `PAYMENTS_DB_PASSWORD` | sí en Compose | Base exclusiva del servicio de pagos. |
| `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` | sí para vender | Viven en `payments`, nunca en la API. `MP_PUBLIC_KEY` es opcional. |

## Comandos útiles

```bash
pnpm reset                # borra DB, la levanta de nuevo y reseed
pnpm test:isolation       # test de aislamiento de datos entre usuarios
pnpm ontologia            # regenera el grafo de ontología de conceptos
pnpm stop                 # apaga web local + contenedores docker
```

## Cosas a saber antes de tocar el código

- **Corrección de labs en servidor.** `labs.solution` nunca sale en una respuesta
  (`publicLab()` la filtra). No mover la corrección al cliente.
- **Borrado de cuenta = soft delete.** Se conserva la fila (los intentos siguen
  contando para la cohorte), se marca `deleted_at`, se anonimiza el nombre y se
  rota el correo a `borrado+{id}@alpadev.local`.
- Ver `docs/PLATFORM.md`, `ONTOLOGY.md` y `docs/REGIONS.md` para contexto
  de producto, estado actual y decisiones de contenido.

## Estructura

```
api/        Fastify API — contenido, grading y contratos entre servicios
auth/       Autenticación, sesiones, roles y entitlements
payments/   Pagos TS7/tsgo, suscripciones y webhooks Mercado Pago
web/        Astro frontend
ai/ data/ queue/ security/ servicios internos
scripts/    dev.mjs (orquesta api+web), gen-ontologia.mjs
docker-compose.yml   plataforma completa, un comando
```

El checklist de salida comercial está en `docs/SAAS-READINESS.md`.
