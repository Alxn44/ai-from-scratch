# Security audit — 2026-08-23

Scope: `api/` (Fastify, 4.2k LOC) · `ai/` (FastAPI, 1.2k LOC) · `web/` (Astro, 7.4k LOC) · infra.

Every finding below marked **PROVEN** was reproduced against a live stack with a real
account. The rest were established by reading code, and say so.

Probe account: `probe-paywall@test.dev`, id 102, `paid = false`, `role = student`.

## Findings, by severity

Status: **fixed** = changed and verified · **in flight** = being fixed now ·
**open** = reported, not yet fixed.

| # | Sev | Finding | Proof | Status |
|---|---|---|---|---|
| 1 | CRITICAL | Forged admin session. `docker-compose.yml` defaulted `JWT_SECRET` to a value published in the repo and never set `NODE_ENV`, so the production guard in `auth.js:5` was unreachable. Sign `{sub, role:'admin'}` and `/api/v3/admin/users` answers. Same missing `NODE_ENV` left `cookieOpts.secure` false. | live | **fixed** |
| 2 | CRITICAL | Repo-committed admin. `seed.js` created `founder.alpadev@gmail.com` as `admin` with `Curso2026*`, and compose ran the seed on **every** container start. | live | **fixed** |
| 3 | CRITICAL | Paywall bypass. `leccion`, `leccion_texto`, `buscar_en_curso`, `cola_siguiente`, `mis_intentos` returned paid content with no entitlement check while `GET /api/lessons/:n` answered 402. | live | **fixed** |
| 4 | HIGH | `labs.payload` **was** the answer. All 8 `order` labs stored `payload.steps` in `solution.order` sequence (`abcd`/`abcd`). The column guard passed because `solution` was not among the keys. | live | **fixed** |
| 5 | HIGH | Stored XSS to admin takeover. `App.astro` toast used `innerHTML` with `title`/`body`; `admin.astro` fed it a raw `users.name` that registration only length-checks. Payload runs in an admin's origin and self-promotes the attacker. | read | **fixed** |
| 6 | HIGH | Session revocation never reached the agent door. `/api/interno/herramienta` selected only `id`, so `token_version` was never compared. `POST /auth/reset` answered `sesionesCerradas: true` and it was false there. | live | **fixed** |
| 7 | HIGH | Postgres published on `0.0.0.0:5432` with password equal to username (`curso:curso`). One connection reaches `pass_hash`, `payments.raw`, `labs.solution`. | read | **fixed** |
| 8 | HIGH | `paid` granted, never revoked. `paid = 0` appears nowhere; `refunded` is an expected status. Pay, refund, keep access permanently. | read | **fixed** |
| 9 | MEDIUM | The ontology guard **passed on tables it did not know**. 9 declared, 12 in the database. `assertSinProhibidas('lesson_text', row)` checked nothing, and `reset_tokens` (password-reset hashes) was unguardable. | read | **fixed** |
| 10 | MEDIUM | Guard absent on 26 of 37 tools. `users`, `attempts` and `ranking_optin` were guarded zero times in 1060 lines. | read | **fixed** |
| 11 | MEDIUM | Account enumeration, two oracles: `left: 2` vs `left: null` in the body, and 52 ms vs 26 ms because scrypt ran only for existing accounts. | live | **fixed** |
| 12 | MEDIUM | `scryptSync` blocks the event loop; concurrent logins are a cheap availability attack. Cost also below current OWASP guidance. | read | **fixed** |
| 13 | MEDIUM | No rate limit on `/api/chat`. Each call runs a four-turn agent loop against a paid provider. Unbounded spend per free account. | read | **fixed** |
| 14 | MEDIUM | Tutor cohort scoping collapsed to "all students" whenever the tutor's `cohort` was NULL — and nothing in the codebase ever writes `cohort`. | live | **fixed** |
| 15 | MEDIUM | No allowlist before tool dispatch in Python. `ai/src/course_ai/agent/loop.py` posted whatever name the model emitted; the catalog was used only to build schemas. 7 declared, 37 reachable. | read | **fixed** |
| 16 | MEDIUM | Deleted accounts stayed published. Soft delete never removed `ranking_optin`, and the league joins omit `deleted_at`, so alias and weekly progress remained queryable — while the product said the account was deleted. | read | **fixed** |
| 17 | MEDIUM | Containers all run as root; no `USER`, no `user:`. An RCE in the API writes `/app` as uid 0; in `ai` it reads every model key. | read | **fixed** |
| 18 | MEDIUM | No healthcheck on `api` or `web`, and `api` waited on `ia` with `service_started` although `ia` defines a healthcheck. `web` serves traffic while `api` is still seeding. | read | **fixed** |
| 19 | LOW | `HERRAMIENTAS[nombre]` resolved off the prototype chain: `constructor`, `__proto__`, `valueOf` returned truthy, then threw a TypeError — a 500 reachable by anything the model can type. | read | **fixed** |
| 20 | LOW | `limpiar()` documented logging it did not do. The stripped key names were echoed **to the model** as `_ignorado` and written to no log, so probing left no trace. | read | **fixed** |
| 21 | LOW | Service secret compared with `===`, not `timingSafeEqual`, which the file already imports. | read | open |
| 22 | LOW | Upstream provider error bodies relayed to the browser. Several providers echo a truncated API key in 401 text. | read | **fixed** |
| 23 | LOW | `/ontologia/prompt`, `/ontologia/grafo`, `/ontologia/prueba` and `/docs` unauthenticated on the AI service. Safe today only because compose gives it no host port. | read | **fixed** |
| 24 | LOW | Client can post fabricated `assistant` turns, overriding the prompt's own rules. | read | **fixed** |
| 25 | LOW | Webhook `ts` is signed and never checked for freshness. Latent: replay is a no-op only because job insert is idempotent and nothing prunes `jobs`. | read | **fixed** |
| 26 | LOW | Last-admin guard omitted `deleted_at IS NULL`, so a soft-deleted ex-admin satisfied it and the last active admin could be demoted. No self-demotion check, no recovery route. | live | **fixed** |
| 27 | LOW | `scripts/keys.sh` rotated a Postgres password that compose never read — a control that reported success while doing nothing. | read | **fixed** |
| 28 | LOW | `dev.mjs` printed the seeded admin password to stdout. | read | **fixed** |
| 29 | LOW | `<script type="application/json">` breakout via display name; `</script>` in a name closes the element early. | read | partly fixed |
| 30 | LOW | Chat trace panel rendered model-emitted tool names unescaped. | read | **fixed** |

### Found by the proof, not by a person

Obligation **P4** (below) flagged `mis_intentos` returning `labs.prompt`, `labs.payload` and
`labs.explanation` with no entitlement check. No human reviewer reported it. It is
finding 3's fifth tool, and it was fixed with the others.

---

## Root cause of findings 3, 4 and 9

The isolation proof reported green the whole time. It was not broken — the rules it
could express did not include the ones being violated.

**The ontology modelled privacy and nothing else.** `clase` answers *whose data is
this* — `publico | propio | agregado | jamas`. `lessons.technical` is correctly
`publico`: identical for everyone, nothing personal in it. It is also the product being
sold. Entitlement is a second, independent axis, and with one axis the hottest rule in
the business was not merely unchecked, it was **inexpressible**.

Fix: `Columna` gained `muro: gratis | de_pago`, `Herramienta` gained
`verifica_compra: bool`, and the proof gained a fourth obligation:

    P1  no tool returns a `jamas` column
    P2  any tool reaching a table with `propio` columns declares scope `sesion` or `agregado`
    P3  no argument can express another person
    P4  no tool returns a `de_pago` column without declaring `verifica_compra`

**And the guard approved what it had never inspected.** `columnasProhibidas` answered
`[]` for an unknown table, so `assertSinProhibidas` was a silent no-op for the three
tables the ontology did not declare — including `reset_tokens`. It now throws on an
undeclared table. A guard that reports safety it did not verify is worse than no guard,
because it stops anyone from looking.

Each obligation was verified by making it fail on an injected tool, with the path
printed:

    fuga_texto       CAUGHT  de_pago_sin_verificar: lesson_text.technical
                             H:fuga_texto -> T:lesson_text -> C:lesson_text.technical
    fuga_enunciado   CAUGHT  de_pago_sin_verificar: labs.prompt, labs.payload
    honesta          passes  (declares verifica_compra)
    fuga_solucion    CAUGHT  devuelve_prohibida: labs.solution  (P1 outranks P4:
                             declaring purchase does not unlock the answer)
    fuga_identidad   CAUGHT  argumento_de_persona: user_id

Coverage is still the open weakness: **7 of 37 tools are declared**, so P1-P4 prove
nothing about the other 30. Closing that is the next task, and the export must fail when
the registry holds a tool the ontology does not know.

---

## Verified clean

Established by reading the code, not assumed.

- **SQL injection.** Two interpolations exist in the whole import graph, both module
  constants (`COLS_LAB`, `MINUTOS_TOKEN`). No user input reaches a SQL string; no dynamic
  `ORDER BY` or column names. `dollars()` renumbers only `?`, and the two files using
  literal `$n` pass zero `?`, so there is no numbering collision.
- **Identity isolation (P3 in practice).** `limpiar` is an allowlist applied at the single
  dispatch point, and it builds a fresh object — an injected `user_id` is unreachable, not
  merely ignored. None of the 37 tools declares an identity-bearing argument. This is the
  strongest part of the codebase.
- **Mass assignment.** `PATCH /api/v3/settings` with `{role, paid, cohort}` returns the
  account unchanged; the handler reads only `lang`/`theme`. Register hardcodes
  `role='student', paid=0`.
- **Webhook forgery.** HMAC over `id;request-id;ts`, length-checked `timingSafeEqual`,
  fails closed with 501 when the secret is missing. `metadata.user_id` is read back from
  the provider's own record, so a payer cannot aim a payment at another account.
- **Classic IDOR.** No route accepts another user's identifier.
- **Session tokens.** HMAC-SHA256, `timingSafeEqual`, `exp` enforced, algorithm
  hardcoded and inside the signed payload, so `alg` confusion does not apply.
- **Password reset.** Token in the clear, only its SHA-256 stored; single use; siblings
  invalidated; 30-minute expiry.
- **SSRF.** Every outbound URL in the AI service is a constant or operator env. The model
  influences only a request body, never a host or path.
- **Secret handling in Python.** No key is printed, logged or returned by any endpoint.
- **Secrets in the client bundle.** Four `import.meta.env` reads; the two server-only ones
  are imported exclusively from `.astro` frontmatter. `MP_PUBLIC_KEY` is a publishable key.
- **Open redirect.** None; every navigation target is a literal or a coerced number.
- **AI answer text** is escaped before insertion.

---

## Requires your decision

1. **The admin account in the local database still has the repo password.** The seed no
   longer recreates it, and forging is closed, but the row is live. Rotating it is your
   call, not mine.
2. **Commented-out live keys** in the root `.env` (`#RAILWAY_API_KEY=`, `#GEMINI_API_KEY=`,
   `#password=`). Commenting out is not rotating. They were never touched.

---

## Verification, at the end of the pass

Every gate run with its own exit code read directly, not through a pipe.

| Gate | Result |
|---|---|
| `pnpm --dir api test` | exit 0 — **209 checks, no failures** (6 suites) |
| `uv run pytest -q` | exit 0 — **79 passed** (baseline was 33) |
| `uv run ruff check .` | exit 0 — all checks passed |
| `uv run ia-prueba-aislamiento` | exit 0 — P1..P4 hold on the 7 declared tools |
| `node api/scripts/tipos.mjs` | **59 messages, equal to baseline** — no type regression |
| `pnpm --dir web exec astro check` | 0 errors, 0 warnings, 20 hints |
| `pnpm dev` | api, ia and web all answering; `IA: ok · anthropic, deepseek, kimi, together` |

That table is a record of that pass and is deliberately not edited afterwards, so the
numbers and the command names are the ones that were true when they were measured. Two
of them have since moved and the reader needs the current spelling:

- the console scripts were renamed in the English pass — `ia-prueba-aislamiento` is now
  `ai-prove-isolation`, `ia-exporta` is `ai-export`, `ia-verifica` is `ai-verify`, and all
  of them are invoked as `uv --directory ai run <name>`;
- "the 7 declared tools" was the true coverage then. All 37 are declared now, and
  `ai-prove-isolation` reports `P1..P4 hold over the 37 DECLARED tools`.

The gates are re-run in full at integration, and the numbers above are replaced by that
run rather than patched in place — a table of half-refreshed measurements is worse than a
dated one, because there is no longer a moment it describes.

Behaviour proved against the running stack, not asserted:

    paywall, unpaid account          leccion / leccion_texto / mis_intentos  -> requiere_compra, ruta /pago
                                     buscar_en_curso -> 0 hits, searched [1], 11 closed
                                     lesson 1 (the free one) still returns 555 chars
    paywall, after marking paid      lesson 12 returns 614 chars, search covers all 12
    order-lab payloads              12.1 payload order dbac, solution abcd; `solution` absent from output
                                     all 8 order labs shuffled, none matching its solution
    chat rate limit                 9 concurrent -> exactly 6x200 and 3x429,
                                     retry-after: 50, structured body
    KDF                             N=2^17 measured at 257 ms vs 28 ms at 2^14;
                                     omitting maxmem raises ERR_CRYPTO_INVALID_SCRYPT_PARAMS,
                                     which proves the options reach the call
    legacy password hashes          3-field rows still verify; wrong password still rejected;
                                     4-field format round-trips
    seed                            `0 usuarios demo` — the demo accounts no longer exist
                                     unless SEED_DEMO_USERS=1 and SEED_DEMO_PASSWORD are set

### Two defects found while verifying the fixes

**The rate limiter was written and never called.** `frenoChat` existed in `server.js`
and no code path invoked it, so `/api/chat` was still unlimited. The type baseline
caught it as `TS6133: 'frenoChat' is declared but its value is never read`. A security
control that is present in the diff and absent from the call graph is worse than one
that was never written, because the review passes.

**The proof misreported its own coverage.** `ia-prueba-aislamiento` printed
"P1, P2 y P3 se cumplen en las 7 herramientas" after running four obligations, and said
nothing about the 30 undeclared tools it does not check. Same failure shape as the guard
that approved tables it had never inspected: the output reads as a guarantee and is not
one. It now names the obligation count and states the coverage limit explicitly.

### Still open

- **Finding 21**, `===` on the service secret. One line, not yet changed.
- **Ontology coverage: 7 of 37 tools declared.** P1..P4 prove nothing about the other 30,
  and the export does not yet fail when the registry holds an undeclared tool. This is the
  largest remaining gap and it is a coverage problem, not a correctness one.
- **8 more `set:html={JSON.stringify(...)}` sites** in `web/src/pages/` carrying the same
  `</script>` breakout shape as the one that was fixed. `leccion/[n].astro:142` embeds
  `lab.payload` directly.
- **`chat.astro:206`** interpolates `d.proveedor` / `d.modelo` without `esc()`.
- **`herramientas.py:54`** returns Node's response body as `{"detalle": r.text[:200]}` into
  the tool result. It does not reach the HTTP response, but it does reach the model.

---

## Added after the queue service landed

These are new, found while integrating the Go `queue/` service. Kept separate from the
audit above so that pass's record stays a record.

### Fixed: the three bus implementations disagreed about `payload`

`api/src/bus.ts` accepted an **array** payload; `ai/src/course_ai/bus.py` and
`queue/internal/bus/envelope.go` both refused one. The cause is that
`typeof [] === 'object'`, so Node's `typeof raw.payload !== 'object'` check let arrays
through, while Python asks `isinstance(payload, dict)` and Go types the field
`map[string]any` so an array cannot decode at all.

Consequence: `{"payload": []}` was valid work to one service and a dead letter to the
other two, so **which service happened to consume the message decided whether the work
ran**. Nothing publishes an array payload today, which is why it never surfaced. Proven by
running both runtimes' actual expressions: Node `false` (not malformed), Python `False`
(not a dict).

Fixed in `api/src/bus.ts` by adding `!Array.isArray(...)`, so all three now agree with what
all three headers already documented. Pinned by `parse refuses: payload is an array` in
`api/test/transport.mts`, and mutation-checked: reverting the fix turns that test red, and
restoring it turns it green. The suite went 82 → 83 checks.

### Open: one shared secret across two trust boundaries

`queue/internal/config/config.go:241` reads **`IA_SECRETO`** — the same credential the AI
service uses. `docker-compose.yml` passes it to both.

What it costs: `IA_SECRETO` plus a session cookie is what authenticates a caller to
`/api/v3/interno/herramienta`, which **executes agent tools**. So a compromise of the queue
service — a process holding a broker connection and an HTTP enqueue endpoint — yields the
credential that reaches tool execution, and vice versa. Rotating it requires touching three
services at once.

The counter-argument, stated fairly: `IA_SECRETO` has never been a per-service identity. It
means "this caller is an internal service, not a browser", and by that reading a third
internal service using it is consistent rather than novel.

Not changed yet, deliberately: splitting it is a coordinated edit across `scripts/keys.sh`,
`docker-compose.yml` and `config.go`. **It is cheapest right now**, while nothing calls the
queue service, and it gets more expensive the moment something does.

### Open: `queue` cannot prove its own bindings anywhere

`queue-topology verify` checks 6 exchanges and 6 queues and states, in its own output, that
the **7 bindings are never verified** — AMQP 0-9-1 has no passive binding query. That is
honest rather than hidden, but it means a binding silently missing from a deployed broker
would route nothing and no check would notice. The retry ladder round-tripping through the
real delay queues is the only indirect evidence the bindings exist, because the message
could not come back without them.
