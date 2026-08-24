# Course platform · v3

> **Versioning: v3 is what is current. v1 and v2 are legacy and deprecated**
> (`Sunset: 2027-02-21`). See `MIGRATION.md` for the what and the why of each
> decision, with the numbers that back it.

## Architecture (v3)

Four services. `docker compose up --build`.

| service | language | responsibility |
|---|---|---|
| `db` | Postgres 17 | data and **the job queue** (`FOR UPDATE SKIP LOCKED`) |
| `ia` | Python 3.13 + FastAPI | **all the AI**: ontology, isolation graph, prompt, agent loop |
| `api` | Node 22 + Fastify | HTTP, session, tools against the database, queue worker |
| `web` | Astro SSR | frontend |

**The rule that outranks the rest:** the AI service does not talk to Postgres.
The tools are run by the API, which is the only one holding the session. Isolation
between users *is* the fact that no tool accepts a person identifier; implementing it
twice in two languages guarantees that one day they diverge.

### Commands

```bash
uv --directory ai run pytest -q               # 33 AI tests
uv --directory ai run ai-prove-isolation   # P1..P4
uv --directory ai run ai-export              # regenerates api/src/ontologia.json
pnpm --dir api test                           # every api suite (ONTOLOGY.md lists them)
pnpm --dir api check                          # types with tsgo, against the baseline
pnpm --dir web check                          # tsgo (.ts) + astro check (.astro)
```

`api/src/ontologia.json` is **generated**: Python emits it. If it is missing, the API does
not start — without the list of forbidden columns the guard protects nothing.

Marked **v2 legacy deprecated**, not imported from `server.js`:
`api/src/ontology.ts` (except the guard, which now reads the artefact),
`(deleted: the v2 agent loop, removed once nothing imported it)`, `(deleted: the v2 agent loop, removed once nothing imported it)`.

---

## How it runs

The browser only talks to Astro; Astro proxies `/api/*` to Fastify (same origin → the
`SameSite=Lax` session cookie behaves the same locally and in production behind a domain),
and Fastify talks to the AI service over the internal network. The AI service **publishes no
port to the host**: it is internal, not a public API.

## One single command

```bash
pnpm setup        # installs api/ and web/ (first time only)
pnpm dev          # Postgres in Docker + local api and web, with reload
```

`pnpm dev` (`scripts/dev.mjs`) does, in order:

1. stops the `api` and `web` containers if they were up;
2. closes a previous Astro dev server and frees whatever is listening on `8787` and `4321`
   **on loopback** — loopback only, so it does not touch something of yours listening on another interface;
3. brings Postgres up with `--wait` and waits for the healthcheck;
4. **seeds** (otherwise a fresh volume starts with no course);
5. starts api and web, and **checks that both respond** before claiming it is up.

Ctrl-C shuts everything down, including the `astro dev` daemon.

Two quirks of the environment that the script handles and that are worth knowing: `astro dev`
**exits with code 0 and leaves a daemon behind** (so it cannot be supervised by process, it is
supervised by port), and that daemon listens on **IPv6 `[::1]:4321`** while the api listens on
`127.0.0.1:8787` — both stacks have to be checked. The web logs, when it is left in the
background: `pnpm --dir web exec astro dev logs`.

Others: `pnpm seed` · `pnpm db` (Postgres only) · `pnpm stop` · `pnpm reset` (drops the database and seeds).

## Everything in containers

```bash
pnpm docker                        # = docker compose up --build (db + api + web)
```

- Web: http://localhost:4321 · API: http://localhost:8787 · Postgres: `localhost:5432`
- Starting `api` seeds the database (idempotent: it updates lessons and labs, it does not delete attempts).
- Log in at http://localhost:4321/login with `ricardo@velez.co` / `Curso2026*`
  (also `paula@correo.com` tutor and `founder.alpadev@gmail.com` admin, same password).

```bash
docker compose logs -f api         # see the backend log
docker compose down                # stop
docker compose down -v             # stop and drop the database
```

## Without Docker (three processes + one database)

```bash
docker compose up -d db            # or your own Postgres

scripts/keys.sh                  # JWT_SECRET, IA_SECRETO, Postgres password

cd ai                              # the AI service
uv sync --extra dev
uv run ai-export                  # generates ../api/src/ontologia.json
uv run python -m uvicorn course_ai.app:app --port 8799 --reload

cd ../api
pnpm install
pnpm seed                          # 12 lessons · 36 labs · 3 users
pnpm dev                           # http://127.0.0.1:8787

cd ../web
pnpm install
API_URL=http://127.0.0.1:8787 pnpm dev
```

`api/.env` is read by `node --env-file-if-exists=.env`, which is in the scripts. (Before,
nobody read it: `keys.sh` wrote a file that did nothing in development.)

With no model key the chat answers **501 `sin_proveedor`** instead of faking it. The
rest of the platform works just the same.

The package manager is **pnpm** for JS and **uv** for Python (`packageManager` and
`uv.lock` pinned).

## What actually runs today

| Piece | Status |
|---|---|
| Register, login, logout | works · scrypt + JWT in an httpOnly cookie · 5 failures = 15 min lockout |
| Password recovery | works · `/recuperar`, single-use link, 30 min, sha256 fingerprint in the database, changes the password and closes the other sessions. **With no email provider the link only shows up in the log.** |
| Account deletion | works · soft delete, email released, attempts kept |
| Roles (student/tutor/admin) | works · validated on the server, not on the client |
| Paywall | works · lesson 01 and its 3 labs free; 02–12 return 402, including when attempting a lab. A locked lesson is shown as a shop window, without the prompts |
| Lesson | works · card + maths + **technical explanation + analogy + 2 examples** (`lesson_text` table, es and en) and then the labs |
| Lesson + 3 labs | works · **36 labs written**, 0 drafts · tested: the solution grades and the wrong answer is rejected in all 36 |
| Result animation | works · success and failure with GSAP and a Web Animations API fallback; respects `prefers-reduced-motion` |
| Achievements and ranks | works · 3 grades per lesson + 12 ranks (`achievements`); on rank-up the animated 12-stop roadmap opens |
| Ranking | works · only with opt-in and an alias (`ranking_optin`). The response carries neither name nor email |
| Chat | works · `/chat` with normal mode (no cost, answers with your data) and AI mode |
| AI mode | wired · `(deleted: the v2 agent loop, removed once nothing imported it)` (model → guard → tools → model, 4-turn cap) and 6 providers in `(deleted: the v2 agent loop, removed once nothing imported it)`. **With no key it returns 501** |
| Agent tools | works · **37 across four families** (`api/src/tools/`): 7 for the course, 16 for your account, 7 for the platform (price, routes, PDF, settings, support) and 7 for coordination. None of them accepts another person's identifier |
| Stack, queue and cache | works · `api/src/agent-bus.ts`. `plan_estudio` and `mis_errores` enqueue (FIFO); `cola_siguiente` delivers the lab with its card, your attempts and its lesson **in one call**; focus is stacked (LIFO) and `foco_volver` returns; the memo reuses course content for 10 min and your own data only within the turn. The trace says when a value came out of the cache |
| Agent isolation | tested · `pnpm --dir api test`. Each suite prints its own count; the numbers are deliberately not copied here, because four hard-coded totals in a document are four things that rot silently — this row said «21 for the harness» after the harness was deleted |
| Progress | works · every attempt goes to Postgres and the dashboard reads it |
| Language and theme | works · the selectors are built from whichever dictionaries exist (`IDIOMAS`); the API already accepts `fr` and `pt` |
| Narrative by region | works · CO / LATAM / US / EU from the CDN geo header, with the payment methods that exist in each market (`REGIONS.md`) |
| SEO / AEO | works · `/robots.txt` (18 agents, LLM ones included), `/llms.txt`, `/sitemap.xml`, JSON-LD `Organization` + `Course` + `FAQPage` |
| Legal | works · `/terminos` and `/privacidad`, and the guarantee ended up at **14 days** (7 was below the EU minimum) |
| Contrast | measured: 0 WCAG AA failures on the public and app pages × dark and paper |
| Tutor / admin dashboard | works · real data, role change audited |
| PDF | route ready · 402 without a purchase, 503 for as long as `api/files/curso-{es,en}.pdf` does not exist |
| Mercado Pago | **does not charge**: without `MP_ACCESS_TOKEN` it returns 501. The webhook verifies the signature and there are already `back_urls` to `/pago/gracias` and `/pago/error` |

## Routes

Public: `/` `/login` `/registro` `/recuperar` `/pago` `/pago/gracias` `/pago/error`
`/terminos` `/privacidad` `/soporte` `/robots.txt` `/llms.txt` `/sitemap.xml` + its own 404.

With a session: `/panel` `/curso` `/leccion/{n}` `/chat` `/logros` `/ranking` `/perfil` `/ajustes`
`/tutor` (tutor) `/admin` (admin).

API, **prefix `/api/v3/`**: auth (login, logout, register, recover, reset), `me`,
`settings`, `lessons`, `lessons/:n`, `labs/:id/attempt`, `progress`, `logros`, `ranking`,
`ranking/optin`, `ligas`, `chat`, `chat/estado`, `pdf/:lang`, `tutor/cohort`, `admin/*`,
`payments/mercadopago/*`, `version`, `health`.

`/api/v1/*`, `/api/v2/*` and unversioned `/api/*` still respond, with
`x-api-version: N-legacy`, `deprecation: true`, `sunset` and `link;
rel="successor-version"`. `/api/version` counts the hits per version, which is how
we will know when it is safe to delete them. The front end speaks v3 through a single place:
`web/src/pages/api/[...path].ts`.

Internal, for the AI service only (they require `x-ia-secreto` **and** a valid cookie):
`interno/catalogo`, `interno/herramienta`.

AI service (no port on the host): `/salud`, `/ontologia/prompt`, `/ontologia/grafo`,
`/ontologia/prueba`, `/agente/turno`, `/docs`.

## Checks

```bash
pnpm dev                          # brings everything up and does not claim it is ready until both respond
pnpm --dir api test               # agent isolation, the bus, the tools, the bridge
pnpm --dir web i18n               # key drift between languages
pnpm --dir web exec astro check   # types (needs typescript 6: 7 breaks the API it uses)
```

## What is missing before the course can be taught

1. Mercado Pago credentials, and mounting the Payment Brick on `/pago`.
2. A provider key for AI mode (any of the six).
3. Stripe for the United States and the European Union: Mercado Pago does not operate there (`REGIONS.md`).
4. An email provider, or whoever loses their password is locked out.
5. Generating `api/files/curso-es.pdf` and `curso-en.pdf`.
6. French and Portuguese: the wiring is there, the dictionaries are missing (`LESSON-CONTENT.md`).
7. A per-IP limit on `/api/auth/recover` (today there is only a per-account limit: 3 per hour).
8. Turning the seed off in production: it creates three accounts with a known password and one is admin.
9. `build`-type labs are graded loosely on purpose: they accept any non-empty piece in
   each slot. Composing does not have a single good answer; if you want to demand more, you have to
   mark which tiles are valid per slot in `solution`.
