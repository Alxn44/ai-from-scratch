# Architecture explanation — the prompt

A sibling of [ARCHITECTURE-DIAGRAM-PROMPT.md](ARCHITECTURE-DIAGRAM-PROMPT.md).
That one asks a model to **draw** the system. This one asks a model to **explain**
it — to a new engineer, a reviewer, or a client — and it covers the server and
everything running on it, which the diagram prompt only gestures at.

**The prompt is section 3.** Sections 1 and 2 are the facts it carries, and every
number in them was produced by a command, not typed. Section 4 is what models get
wrong here. Section 5 lists documents in this repository that currently disagree
with the running system — read it before you trust anything else.

> A prompt that says "explain the architecture" and nothing else produces
> confident, generic prose about microservices. The value of this file is the
> payload, not the instruction.

---

## 1. How to refresh the facts

Run these before editing anything below. Read each exit code directly — house
rule 2 — and never through a pipe.

| Fact | Command | Measured |
|---|---|---|
| Services in compose | `grep -cE '^  [a-z][a-z0-9-]*:$' docker-compose.yml` minus 5 volumes | **19** |
| Agent tools | `pnpm check:catalog` | **41** bridged, **9** paywalled |
| Isolation proof | `pnpm prove` | P1–P4 over 41 bridged · P5 over 3 native |
| Ontology classes | read `api/src/ontologia.json` | 120 columns · 62 `jamas` |
| Data catalogue | `grep -cE '^\t\tName: "[a-z_.]+", Table:' data/internal/op/catalog.go` | **98** operations |
| Bus topology | `cd queue && go run ./cmd/queue-topology print` | 6 exchanges · 6 queues · 7 bindings |
| Bus contract | `cd queue && go run ./cmd/queue-topology contract` | agrees across TS · Python · Go |
| Defence policy | `cd defense && go run ./cmd/defense verify` | 6 actions · 5 agents · 1 may act |
| Gates | `pnpm verify:list` | **22** (19 fast + 3 needing Postgres) |

Measured 2026-08-28. **Everything about the Raspberry Pi in section 2.6 was read
from a pasted SSH session on 2026-08-28 and has not been re-verified since.**
Mark it as such when you use it.

---

## 2. The fact sheet

### 2.1 Shape

One monorepo, five languages, one `docker compose` project named `aifromscratch`
(pinned in the file — deriving it from the folder name once created an empty
second database when the project moved).

| Directory | Stack | Owns |
|---|---|---|
| `api/` | Node 22 · TypeScript 7 compiled with **tsgo** · Fastify 5 | HTTP, sessions, the agent tools, the job queue |
| `ai/` | Python 3.12 · FastAPI · uvicorn · **uv** | The agent loop, model providers, and the ontology — the source of truth |
| `web/` | Astro 7 · `@astrojs/node` · GSAP | Lessons, labs, chat, 12 animated scenes |
| `data/` | Go 1.26 · pgx 5 | The closed catalogue. **The only holder of the course database credential.** |
| `queue/` | Go 1.26 · Fiber 3 · amqp091 | The RabbitMQ topology. Nothing routes through it. |
| `defense/` | Go 1.26, one image, five binaries | The five lines of defence |
| `payments/` | TypeScript · Fastify 5 · pg | Mercado Pago checkout and entitlements. Own Postgres. |
| `messages/` | TypeScript · Fastify 5 · pg | AI chat log. Own Postgres as a JSONB document store. |

Prisma 7 is a **devDependency**. It owns the schema and never ships in a runtime
image — `pg` and `pgx` run the queries. Prisma cannot express CHECK constraints,
so three are re-added by hand in the baseline migration and `pnpm db:drift` is
what notices if they vanish.

### 2.2 The 19 services

`db · payments-db · payments · messages-db · messages · broker · init · data ·
api · ia · api-worker · ai-worker · queue · web · morpheus · trinity · smith ·
oracle · neo`

`init` runs migrations plus seed once and exits, so a healthy host shows **18
running containers**.

**Only two publish a port to the host:** `web` (4321) and `api` (8787).
Internal-only, reachable solely on the compose network: `payments` 8785,
`messages` 8786, `data` 8788, `queue` 8790, `ia` 8799.
Loopback-only host bindings, for `psql` and inspection: `db` 5432,
`payments-db` 5433, `messages-db` 5436, `broker` 5672 and 15672.

The database ports are on `127.0.0.1` and not `0.0.0.0` for a reason worth
repeating: Docker writes DNAT rules evaluated **before** the host INPUT chain, so
a host-level DROP on 5432 never sees the packet. Publishing wide cannot be
firewalled away afterwards.

### 2.3 Three databases, one broker

Three separate `postgres:17-alpine` instances, deliberately not one with three
schemas:

- `curso` — the course. Only `data` holds its credential.
- `payments` — provider payloads and webhook history. The course database
  receives idempotent entitlement events and **never** a Mercado Pago secret.
- `messages` — chat, as JSONB documents. No person tables, no foreign keys into
  `curso`. The API injects `userId` from the cookie.

`rabbitmq:4-management-alpine` is the coordination substrate. **RabbitMQ is the
orchestrator** — there is no orchestrator service, and the policy on top of it
lives as a library inside the services doing the work. The test for any future
change: if stopping the `queue` container would break another service, `queue`
has become the orchestrator and the change is wrong.

Topology, printed from `queue`:

- exchanges: `course.events` (topic) · `course.events.dlx` (topic) ·
  `course.events.retry.{1000,4000,16000,60000}` (fanout) — 6 total
- queues: `course.events.dead` · four retry queues with `x-message-ttl` and
  `x-dead-letter-exchange: course.events` · `queue.work` with
  `x-dead-letter-exchange: course.events.dlx` — 6 total
- 7 bindings · retry ladder 1 s → 4 s → 16 s → 60 s · redelivery ceiling 5
- the envelope, ladder, ceiling, delivery mode and exchange name are **checked
  across all three implementations** by `queue-topology contract`

Split of duties: **HTTP carries the path a human is waiting on** (the chat turn,
`api ↔ ia`). Everything nobody is blocked on — batch grading, embeddings, the
weekly league close, email, exports — goes over the bus, because it needs
retries, back-pressure and durability.

### 2.4 The two isolation guarantees

These are the load-bearing claims. An explanation that misses them has missed
the system.

**(a) Python never touches a database.** No `psycopg`, no `asyncpg`, no
`DATABASE_URL` anywhere in `ai/`. A tool call goes
`Bridge.call()` → `POST /api/v3/interno/herramienta` → executed by Node with the
asking user's own id. The absence of that connection *is* the guarantee.

**(b) `api` holds no database credential either.** It calls `data`, which speaks
a **closed catalogue of 98 named operations and has no SQL endpoint at all** —
no `sql.run`, no `table.select`, no operation taking a table or column name as a
parameter. Statements are assembled from each operation's declared column list,
so a wildcard is *unreachable* rather than rejected.

Of the 98: 78 agent-facing, 20 internal exemptions (grading needs
`labs.solution`; login needs `users.pass_hash`), 11 behind the paywall, 35 write.

`api/src/db.ts` still imports `pg` — it is retained **only** by the one-shot
`init` image. A verify gate (`api-data-boundary`) fails the build if a pool, a
SQL literal or a `DATABASE_URL` reference returns to the runtime API source.

`data` refuses to boot without the generated ontology artefact, and says so:

```
guard: cannot read the ontology artefact at /etc/data/ontologia.json …
this service will not start without it, because a data service with no
forbidden-column list is a data service with no guard
```

### 2.5 The ontology

Data, not prose. Edited in `ai/src/course_ai/ontology/data.py`; everything else
(`api/src/ontologia.json`, `ONTOLOGY.md`) is generated.

120 classified columns: **62 `jamas`** · 32 `publico` · 22 `propio` · 4
`agregado`. 16 tables carry forbidden columns. 16 tables are `de_pago`.
44 tools declared (41 bridged to Node + 3 native to Python). Artefact version 3,
`violaciones: []`.

**Two orthogonal axes, and collapsing them is a bug that already shipped here.**
`clase` (`publico|propio|agregado|jamas`) answers *whose data is this* — privacy.
`muro` (`gratis|de_pago`) answers *who paid to read it* — entitlement. With a
single axis the paywall rule was inexpressible, the proof stayed green, and the
paid corpus walked out. P4 exists because of that.

Four obligations, proved by `pnpm prove`:
P1 no `jamas` column is returned by any tool · P2 a tool reaching `propio`
columns declares its scope · P3 no argument can express another person · P4 no
`de_pago` column is returned without declaring `verifica_compra`. P5 covers the
three native Python tools.

### 2.6 The five lines of defence

One Go image, five commands, Matrix-named: **Morpheus** (the door — needs
`network_mode: host` to see real listeners) · **Trinity** (the walls — reads
`sshd_config` and `/proc` read-only, applies nothing) · **Smith** (the adversary,
deliberately the least privileged thing in the file) · **Oracle** (sees, scores,
read-only by construction) · **Neo** (the only one that may act).

Verified: **6 actions, all expiring and rate limited; 5 agents, exactly one of
which may act.** Ceiling is 10 actions per 10 minutes from a closed allowlist,
and none may touch `cloudflared`, `db`, `broker` or `mosquitto`.

All five run `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, no
`docker.sock`, no `DATABASE_URL`, no `JWT_SECRET`. `DEFENSE_MODE` defaults to
`propose` — nothing is applied until a human sets `enforce`, and that lives in
the host environment, never in a committed file. Neo revokes a session by
publishing on the bus and letting `api` do it with its own credentials: **the
agent with the power holds the fewest keys.** There is no edge from Neo back to
Oracle.

### 2.7 The server and the pipeline

*Provenance: image and workflow facts are read from the repository today. The
host facts are from a pasted SSH session on 2026-08-28 and are not re-verified.*

**Build.** `deploy.yml` fires on push to main. It runs `ci.yml` as a required
gate (5 jobs: node · python · queue · defense · images) and then publishes
**seven** multi-arch (`linux/amd64` + `linux/arm64`) images to GHCR:
`api · api-migrate · ai · web · queue · defense · data`.
`api-migrate` is the migrate stage published separately, because the runtime
stage installs with `--prod` and prunes the Prisma CLI it needs.

**Release.** `release.yml` refuses to run without `vars.DEPLOY_TARGET`, and
refuses loudly rather than exiting 0 — *"a release job that exits 0 without
releasing is the worst outcome available."* It derives the required secret list
**from the compose files** rather than a hand-kept copy, then SSHes to the host,
`scp`s both compose files so the host's wiring always matches the images, and
runs `pull` + `up -d --no-build`.

`TAG` is the commit sha, **never `latest`** — during an incident the first
question is which commit is live, and `latest` cannot answer it. `--no-build`
matters too: with both `build:` and `image:` present, compose would quietly
compile from source on the host, which is a different artefact from the one CI
passed.

**Host.** A Raspberry Pi (`anton`, `aarch64`) at `~/aifromscratch`, behind
residential CGNAT — **no inbound port from the internet exists**. `cloudflared`
makes an outbound connection to Cloudflare's edge and every request arrives back
down it. The public origin is `aifromscratch.shop`. Because of CGNAT a
cloud runner cannot reach the host on its own; that is why `DEPLOY_TARGET` was
switched off rather than misconfigured.

`docker-compose.pi.yml` is a no-op marker (`services: {}`); host-port bindings
are parameterised in the base file so the Pi can select loopback-only ports via
`.env` without compose appending a second published port.

**Gates.** `pnpm verify` — 22 gates, up to 9 concurrent, one verdict, ~12 s.
Three need Postgres and never run concurrently with each other. A gate that
cannot run counts as **failed**, not skipped; the only exception is a service
that does not exist yet, reported as ABSENT on its own line.

---

## 3. The prompt

Paste everything between the rules, with sections 1–2 above appended as the
payload.

---

You are explaining a production system to a competent engineer who has never
seen it. They will make decisions based on what you say, so being wrong is worse
than being incomplete.

**Source of truth.** Use only the fact sheet supplied below. Where it is silent,
say "the fact sheet does not cover this" — do not fill the gap from what similar
systems usually do. Every number you state must appear in the fact sheet. If you
want a number that is not there, name the command that would produce it instead
of guessing.

**Structure your explanation in this order.** Each section earns its place by
answering the question in its heading; drop a section rather than pad it.

1. **What it is, in five sentences.** What the product does, who uses it, and the
   one architectural decision that shapes everything else.
2. **The request path.** Follow a single real request from the browser to the
   database and back. Name every process it passes through, the port, and what
   that process is allowed to do. State plainly which components it does *not*
   touch, and why that absence is deliberate.
3. **The trust boundaries.** There are three that matter: the CGNAT edge, the
   database credential, and the paywall. For each: what it separates, what
   enforces it, and what would have to go wrong for it to fail.
4. **State and coordination.** The databases, why they are separate, and the
   split between synchronous HTTP and the asynchronous bus. Give the rule that
   decides which one a new feature should use.
5. **The server.** What the host is, how traffic reaches it, how code gets onto
   it, and what a deploy actually executes. Include what happens when the deploy
   is not configured.
6. **The defence layer.** Five agents, what each watches, and the single
   structural property that keeps the layer from becoming a liability.
7. **What would surprise you.** Four to six decisions that look wrong until you
   know the failure that caused them. Give the failure, not just the rule.
8. **Where this explanation is thin.** Name what you could not verify and what a
   reader should check before relying on it.

**How to write it.**

- Plain declarative sentences. No "leverages", "robust", "seamless",
  "cutting-edge", "best practices". If a sentence survives with the word removed,
  the word was decoration.
- Prefer the concrete: "the API holds no database credential" beats "strong
  separation of concerns".
- Every claim about a count, a port, a version or a limit carries the number.
- When a design choice has a cost, name the cost. A system explained with no
  trade-offs has been sold, not explained.
- Do not invent a diagram. If asked for one, point at
  `docs/ARCHITECTURE-DIAGRAM-PROMPT.md`.
- Length: 900–1,400 words. If you cannot fit it, cut section 7, never section 3.

**Six traps specific to this system.** Getting any of these wrong makes the
explanation actively harmful:

1. **The tunnel points outward.** The host is behind CGNAT. There is no inbound
   port, no port-forward, no reverse proxy accepting connections from the
   internet. `cloudflared` dials out; replies come back down that connection.
2. **Python has no database access.** Not "limited", not "read-only" — none. No
   driver, no DSN. Tool calls are executed by Node on the AI's behalf with the
   asking user's id.
3. **The API has no database credential either.** It calls a Go service that
   exposes named operations and no SQL. Do not describe `api → Postgres`.
4. **There is no orchestrator service.** RabbitMQ is the orchestrator. The
   `queue` service declares the topology and observes it; nothing routes through
   it, and stopping it must not break anything else.
5. **Only two of the nineteen services publish a port.** Any explanation
   implying a service mesh of publicly reachable APIs is describing a different
   system.
6. **The defence layer starts unable to act.** `propose` is the default, one
   agent of five may ever act, and there is no feedback edge from the responder
   back to the detector.

**Calibration.** State confidence where it varies. The repository facts were
measured on 2026-08-28; the host facts were read from an SSH session on the same
date and are not re-verified. Say so rather than presenting both at the same
confidence.

*[append sections 1 and 2 of this file as the fact sheet]*

---

## 4. What models get wrong here

In order of how often it happens:

1. **A generic three-tier story.** "Frontend, backend, database" erases the two
   decisions this system is actually about — that Python cannot reach the
   database and neither can Node.
2. **Inventing the inbound port.** Models reach for nginx, a load balancer, or
   port 443 open on the host. None exist.
3. **Counting services from the folder list.** There are 8 source directories and
   19 compose services; workers share their service's image with a different
   command.
4. **Explaining the bus as "for scale".** It is there for retries, back-pressure
   and durability on work nobody is waiting for. Throughput is not the argument.
5. **Softening the defence layer into a feature list.** The interesting property
   is that it is disarmed by default and structurally cannot arm itself.
6. **Quoting `latest`.** Deploys are pinned to a commit sha and the file says why
   at length.

---

## 5. Documents in this repository that are currently wrong

Found while measuring for this file on 2026-08-28. **Do not build an explanation
on any of these until they are corrected** — a prompt carrying a stale number
produces a confidently wrong answer, which is the failure mode this whole
document exists to prevent.

| Claim | Where | Says | Measured |
|---|---|---|---|
| Service count | `docs/ARCHITECTURE-DIAGRAM-PROMPT.md` | 16 | **19** |
| Agent tools | `CLAUDE.md` · `RUNBOOK.md` | 37 · 39 | **41** bridged (+3 native) |
| Paywalled tools | `docs/ARCHITECTURE-DIAGRAM-PROMPT.md` · `RUNBOOK.md` | 7 | **9** |
| `data` operations | `docs/ARCHITECTURE-DIAGRAM-PROMPT.md` | 10 | **98** |
| `jamas` columns | `docs/ARCHITECTURE-DIAGRAM-PROMPT.md` | 46 | **62** |
| Defence actions | `docs/ARCHITECTURE-DIAGRAM-PROMPT.md` | 5 | **6** |
| Verify gates | `RUNBOOK.md` | 19 | **22** (19 fast + 3 slow) |
| `panel` service | `docs/ARCHITECTURE-DIAGRAM-PROMPT.md` | listed with a port row and a Mermaid node | **does not exist** — no `panel/` directory, 0 references in either compose file |

The generated artefacts are not in this table because they cannot drift: the
`tool-catalog` gate reads the registry by import and already reports 41.

### And one defect that is not documentation

`docker-compose.prod.yml:58` and `:65` pull
`${IMAGE_REPO}/payments:${TAG}` and `${IMAGE_REPO}/messages:${TAG}`.
`.github/workflows/deploy.yml` publishes seven images —
`api · api-migrate · ai · web · queue · defense · data` — and contains **zero**
references to `payments` or `messages`.

Failure: set `DEPLOY_TARGET`, push to main. CI goes green, seven images publish,
`release.yml` SSHes to the host and runs
`docker compose -f docker-compose.yml -f docker-compose.prod.yml pull`, which
fails with `manifest unknown` for `payments`. `up -d --no-build` has no fallback,
so the release stops there — after the images were published and after main went
green. The fix is two more `docker/build-push-action` steps in `deploy.yml`,
matching the existing `data` step. Blast radius: the deploy path only.
Reversibility: trivial.
