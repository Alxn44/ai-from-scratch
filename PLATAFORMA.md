# Plataforma del curso · v3

> **Versionado: v3 es lo actual. v1 y v2 son legacy y están deprecadas**
> (`Sunset: 2027-02-21`). Ver `MIGRACION.md` para el qué y el por qué de cada
> decisión, con los números que la sostienen.

## Arquitectura (v3)

Cuatro servicios. `docker compose up --build`.

| servicio | lenguaje | responsabilidad |
|---|---|---|
| `db` | Postgres 17 | datos y **la cola de trabajos** (`FOR UPDATE SKIP LOCKED`) |
| `ia` | Python 3.13 + FastAPI | **toda la IA**: ontología, grafo de aislamiento, prompt, bucle del agente |
| `api` | Node 22 + Fastify | HTTP, sesión, herramientas contra la base, obrero de la cola |
| `web` | Astro SSR | frontend |

**La regla que manda sobre las demás:** el servicio de IA no habla con Postgres.
Las herramientas las ejecuta la API, que es la única que tiene la sesión. El
aislamiento entre usuarios es que ninguna herramienta acepte un identificador de
persona; implementarlo dos veces en dos lenguajes es garantizar que un día
divergan.

### Comandos

```bash
uv --directory ai run pytest -q               # 33 pruebas de IA
uv --directory ai run ia-prueba-aislamiento   # P1, P2, P3
uv --directory ai run ia-exporta              # regenera api/src/ontologia.json
pnpm --dir api test                           # aislamiento, harness v2, cola, puente v3
pnpm --dir api check                          # tipos con tsgo, contra baseline
pnpm --dir web check                          # tsgo (.ts) + astro check (.astro)
```

`api/src/ontologia.json` es **generado**: lo emite Python. Si falta, la API no
arranca — sin la lista de columnas prohibidas la guardia no protege nada.

Marcados **v2 legacy deprecado**, sin importar desde `server.js`:
`api/src/ontology.js` (salvo la guardia, que ahora lee el artefacto),
`api/src/harness.js`, `api/src/proveedores.js`.

---

## Cómo se corre

El navegador solo habla con Astro; Astro proxea `/api/*` al Fastify (mismo origen → la
cookie de sesión `SameSite=Lax` funciona igual en local y en producción tras un dominio),
y el Fastify habla con el servicio de IA por la red interna. El servicio de IA **no
publica puerto al host**: es interno, no una API pública.

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

## Sin Docker (tres procesos + una base)

```bash
docker compose up -d db            # o tu propio Postgres

scripts/claves.sh                  # JWT_SECRET, IA_SECRETO, clave de Postgres

cd ai                              # el servicio de IA
uv sync --extra dev
uv run ia-exporta                  # genera ../api/src/ontologia.json
uv run uvicorn ia.app:app --port 8799 --reload

cd ../api
pnpm install
pnpm seed                          # 12 lecciones · 36 labs · 3 usuarios
pnpm dev                           # http://127.0.0.1:8787

cd ../web
pnpm install
API_URL=http://127.0.0.1:8787 pnpm dev
```

`api/.env` lo lee `node --env-file-if-exists=.env`, que está en los scripts. (Antes
no lo leía nadie: `claves.sh` escribía un archivo que en desarrollo no hacía nada.)

Sin llave de modelo el chat responde **501 `sin_proveedor`** en vez de fingir. El
resto de la plataforma funciona igual.

El gestor de paquetes es **pnpm** para JS y **uv** para Python (`packageManager` y
`uv.lock` fijados).

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

API, **prefijo `/api/v3/`**: auth (login, logout, register, recover, reset), `me`,
`settings`, `lessons`, `lessons/:n`, `labs/:id/attempt`, `progress`, `logros`, `ranking`,
`ranking/optin`, `ligas`, `chat`, `chat/estado`, `pdf/:lang`, `tutor/cohort`, `admin/*`,
`payments/mercadopago/*`, `version`, `health`.

`/api/v1/*`, `/api/v2/*` y `/api/*` sin versión siguen respondiendo, con
`x-api-version: N-legacy`, `deprecation: true`, `sunset` y `link;
rel="successor-version"`. `/api/version` cuenta los golpes por versión, que es cómo
se sabrá cuándo es seguro borrarlas. El front habla v3 por un único sitio:
`web/src/pages/api/[...path].ts`.

Internas, solo para el servicio de IA (exigen `x-ia-secreto` **y** cookie válida):
`interno/catalogo`, `interno/herramienta`.

Servicio de IA (sin puerto al host): `/salud`, `/ontologia/prompt`, `/ontologia/grafo`,
`/ontologia/prueba`, `/agente/turno`, `/docs`.

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
