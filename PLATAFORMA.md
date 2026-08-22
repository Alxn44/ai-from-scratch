# Plataforma del curso · cómo se corre

Tres contenedores: **db** (Postgres 17), **api** (Fastify 5) y **web** (Astro SSR).
El navegador solo habla con Astro; Astro proxea `/api/*` al Fastify (mismo origen → la
cookie de sesión `SameSite=Lax` funciona igual en local y en producción tras un dominio).

## Un solo comando

```bash
pnpm setup        # instala api/ y web/ (solo la primera vez)
pnpm dev          # Postgres en Docker + api y web locales, con recarga
```

`pnpm dev` (`scripts/dev.mjs`) hace, en orden:

1. para los contenedores `api` y `web` si estaban arriba;
2. cierra un dev server de Astro anterior y libera lo que esté escuchando en `8787` y `4321`
   **en loopback** — solo loopback, para no tocar algo tuyo escuchando en otra interfaz;
3. levanta Postgres con `--wait` y espera el healthcheck;
4. **siembra** (si no, un volumen nuevo arranca sin curso);
5. arranca api y web, y **comprueba que los dos responden** antes de decir que está arriba.

Ctrl-C cierra todo, incluido el daemon de `astro dev`.

Dos rarezas del entorno que el script maneja y conviene saber: `astro dev` **termina con
código 0 y deja un daemon detrás** (así que no se puede supervisar por proceso, se supervisa
por puerto), y ese daemon escucha en **IPv6 `[::1]:4321`** mientras la api escucha en
`127.0.0.1:8787` — hay que mirar las dos pilas. Los logs del web, cuando queda en segundo
plano: `pnpm --dir web exec astro dev logs`.

Otros: `pnpm seed` · `pnpm db` (solo Postgres) · `pnpm stop` · `pnpm reset` (borra la base y siembra).

## Todo en contenedores

```bash
pnpm docker                        # = docker compose up --build (db + api + web)
```

- Web: http://localhost:4321 · API: http://localhost:8787 · Postgres: `localhost:5432`
- El arranque de `api` siembra la base (idempotente: actualiza lecciones y labs, no borra intentos).
- Entra en http://localhost:4321/login con `ricardo@velez.co` / `Curso2026*`
  (también `paula@correo.com` tutor y `founder.alpadev@gmail.com` admin, misma clave).

```bash
docker compose logs -f api         # ver el log del backend
docker compose down                # parar
docker compose down -v             # parar y borrar la base
```

## Sin Docker (dos procesos + una base)

```bash
docker compose up -d db            # o tu propio Postgres

cd api
pnpm install
cp .env.example .env               # pon JWT_SECRET
pnpm seed                          # 12 lecciones · 36 labs · 3 usuarios
pnpm dev                           # http://127.0.0.1:8787

cd ../web
pnpm install
API_URL=http://127.0.0.1:8787 pnpm dev
```

El gestor de paquetes es **pnpm** (`packageManager` fijado en los dos `package.json`).

## Qué corre de verdad hoy

| Pieza | Estado |
|---|---|
| Registro, login, logout | funciona · scrypt + JWT en cookie httpOnly · 5 fallos = 15 min de bloqueo |
| Recuperar contraseña | funciona · `/recuperar`, enlace de un uso, 30 min, huella sha256 en la base, cambia la clave y cierra las otras sesiones. **Sin proveedor de correo el enlace solo sale en el log.** |
| Borrado de cuenta | funciona · soft delete, correo liberado, intentos conservados |
| Roles (student/tutor/admin) | funciona · se validan en el servidor, no en el cliente |
| Muro de pago | funciona · lección 01 y sus 3 labs gratis; 02–12 devuelven 402, también al intentar un lab. La lección cerrada se ve como vitrina, sin enunciados |
| Lección | funciona · ficha + matemática + **explicación técnica + analogía + 2 ejemplos** (tabla `lesson_text`, es y en) y después los labs |
| Lección + 3 labs | funciona · **36 labs escritos**, 0 borradores · probado: la solución califica y la respuesta mala se rechaza en los 36 |
| Animación de resultado | funciona · acierto y fallo con GSAP y respaldo en Web Animations API; respeta `prefers-reduced-motion` |
| Logros y rangos | funciona · 3 grados por lección + 12 rangos (`achievements`); al subir de rango se abre el roadmap animado de 12 paradas |
| Ranking | funciona · solo con opt-in y alias (`ranking_optin`). La respuesta no lleva nombre ni correo |
| Chat | funciona · `/chat` con modo normal (sin costo, contesta con tus datos) y modo IA |
| Modo IA | cableado · `api/src/harness.js` (modelo → guardia → herramientas → modelo, tope 4 vueltas) y 6 proveedores en `proveedores.js`. **Sin llave devuelve 501** |
| Aislamiento del agente | probado · `pnpm --dir api test`: 31 comprobaciones de aislamiento + 17 del harness |
| Progreso | funciona · cada intento va a Postgres y el panel lo lee |
| Idioma y tema | funciona · los selectores se construyen con los diccionarios que existan (`IDIOMAS`); el API ya acepta `fr` y `pt` |
| Narrativa por región | funciona · CO / LATAM / US / UE por cabecera geo del CDN, con los medios de pago que existen en cada mercado (`REGIONES.md`) |
| SEO / AEO | funciona · `/robots.txt` (18 agentes, incluidos los de LLM), `/llms.txt`, `/sitemap.xml`, JSON-LD `Organization` + `Course` + `FAQPage` |
| Legales | funciona · `/terminos` y `/privacidad`, y la garantía quedó en **14 días** (7 estaba por debajo del mínimo de la UE) |
| Contraste | medido: 0 fallos WCAG AA en las páginas públicas y de la app × oscuro y papel |
| Panel tutor / admin | funciona · datos reales, cambio de rol auditado |
| PDF | ruta lista · 402 sin compra, 503 mientras no exista `api/files/curso-{es,en}.pdf` |
| Mercado Pago | **no cobra**: sin `MP_ACCESS_TOKEN` devuelve 501. El webhook verifica firma y ya hay `back_urls` a `/pago/gracias` y `/pago/error` |

## Rutas

Públicas: `/` `/login` `/registro` `/recuperar` `/pago` `/pago/gracias` `/pago/error`
`/terminos` `/privacidad` `/soporte` `/robots.txt` `/llms.txt` `/sitemap.xml` + 404 propio.

Con sesión: `/panel` `/curso` `/leccion/{n}` `/chat` `/logros` `/ranking` `/perfil` `/ajustes`
`/tutor` (tutor) `/admin` (admin).

API: auth (login, logout, register, recover, reset), `me`, `settings`, `lessons`,
`lessons/:n`, `labs/:id/attempt`, `progress`, `logros`, `ranking`, `ranking/optin`,
`chat`, `chat/estado`, `pdf/:lang`, `tutor/cohort`, `admin/*`, `payments/mercadopago/*`, `health`.

## Comprobaciones

```bash
pnpm dev                          # levanta todo y no dice «listo» hasta que los dos responden
pnpm --dir api test               # aislamiento del agente + harness
pnpm --dir web i18n               # deriva de claves entre idiomas
pnpm --dir web exec astro check   # tipos (necesita typescript 6: la 7 rompe la API que usa)
```

## Lo que falta para poder dictar el curso

1. Credenciales de Mercado Pago y montar el Payment Brick en `/pago`.
2. Una llave de proveedor para el modo IA (cualquiera de las seis).
3. Stripe para Estados Unidos y la Unión Europea: Mercado Pago no opera allí (`REGIONES.md`).
4. Proveedor de correo, o quien pierda la contraseña se queda fuera.
5. Generar `api/files/curso-es.pdf` y `curso-en.pdf`.
6. Francés y portugués: el cableado está, faltan los diccionarios (`CONTENIDO-LECCIONES.md`).
7. Límite por IP en `/api/auth/recover` (hoy solo hay límite por cuenta: 3 por hora).
8. Apagar la siembra en producción: crea tres cuentas con contraseña conocida y una es admin.
9. Los labs de tipo `build` se califican flojo a propósito: aceptan cualquier pieza no vacía en
   cada ranura. Componer no tiene una única respuesta buena; si quieres exigir más, hay que
   marcar qué tiles son válidas por ranura en `solution`.
