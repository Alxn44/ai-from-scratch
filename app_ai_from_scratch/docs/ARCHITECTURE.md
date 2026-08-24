# Architecture

Four runtimes, one broker, one database. Every identifier, comment and prompt in this
repository is written in English; the *product* is bilingual (ES/EN) and that lives in
translation dictionaries, not in code.

```
                      ┌──────────┐
   browser ──────────►│   web    │  Astro, SSR + islands
                      └────┬─────┘
                           │ HTTP
                      ┌────▼─────┐         ┌──────────┐
                      │   api    │◄───────►│   ai     │  Python, FastAPI
                      │ TS/tsgo  │  HTTP   │          │
                      └──┬────┬──┘  (sync) └──┬───┬───┘
                         │    │               │   │
              ┌──────────▼─┐  │  ┌────────────▼─┐ │
              │ api-worker │  │  │  ai-worker   │ │
              └──────┬─────┘  │  └──────┬───────┘ │
                     │        │         │         │
                  ┌──▼────────▼─────────▼──┐      │
                  │       broker           │  RabbitMQ
                  │  (topic + DLQ)         │
                  └────────────────────────┘      │
                  ┌────────────────────────┐      │
                  │          db            │◄─────┘
                  │  Postgres 17           │  (ai reads nothing directly —
                  └────────────────────────┘   it goes through api tools)
```

## Why there is no `orchestrator` container

The container list asked for one. I did not build it, and this is the argument.

**1. It would sit on the one path a human is waiting on.** A chat turn is synchronous:
the person watches the cursor blink. Today it is `api → ai → (tool call back to api) →
ai`. Routing that through a broker and an orchestrator makes it `api → broker → orch →
broker → ai → …`, and a request/response over a broker is not one hop — it is a reply
queue, a correlation id, a timeout policy and an orphan-reply cleaner. That is latency
and machinery bought for a path that was already correct.

**2. It centralises the thing the design is trying to distribute.** The stated goal is
"agentic from any entry point". A single orchestrator is the opposite: one process that
must know every workflow, and the only process allowed to start one. Every new
capability becomes a change in a box that belongs to nobody.

**3. It is a total single point of failure.** Orchestrator down means chat down, grading
down, everything down. Nothing else in this design has that property — `db` and `broker`
are infrastructure with real HA stories; a bespoke orchestrator is application code with
none.

**4. Business logic drifts away from the data that constrains it.** Deciding *"which lab
comes next"* needs attempts, access rights and lesson order. Those live behind `api`. An
orchestrator making that decision either re-reads the database (a second writer to
`api`'s tables) or asks `api` anyway (a pointless hop).

### What replaces it

Orchestration is a **library, not a service** — the same contract implemented once per
runtime:

| Concern | Where it lives |
|---|---|
| Message envelope, routing keys, idempotency key, retry/backoff policy | `packages/orchestration` (TS) · `ai/src/course_ai/orchestration` (Python) |
| Coordination substrate | RabbitMQ topic exchange + per-consumer queues + DLQ |
| Who may start work | any service — both backends publish and both consume |

`RabbitMQ` *is* the orchestrator. It is the part of an orchestrator that is genuinely
hard (durable routing, fan-out, dead-lettering, back-pressure) and it is already written,
battle-tested and operable. What a bespoke orchestrator would add on top is policy, and
policy belongs in a versioned library next to the code it governs.

## Containers

Eight compose services, five images. `api-worker` runs the **same image** as `api`
with a different command, and `ai-worker` likewise; `init` is the `migrate` stage of
the api Dockerfile.

| Service | Image | Command | Published |
|---|---|---|---|
| `db` | `postgres:17-alpine` | — | `127.0.0.1:5432` |
| `broker` | `rabbitmq:4-management-alpine` | — | `127.0.0.1:15672` (UI only) |
| `init` | `./api` target `migrate` | `prisma migrate deploy && node src/seed.js` | none, runs once |
| `api` | `./api` | `node src/server.js` | `127.0.0.1:8787` |
| `api-worker` | `./api` | `node src/worker.js` | none |
| `ia` | `./ai` | `uvicorn` | none, `expose` only |
| `ai-worker` | `./ai` | `python -m course_ai.worker` | none |
| `web` | `./web` | astro node adapter | `4321` |

Sharing an image between a service and its worker is deliberate. A worker built from
different code than the API is a bug class of its own: the worker's idea of a tool
diverges from the API's, and nothing detects it until a job produces a wrong answer.
Same image, different entrypoint, makes that divergence impossible to express.

**AMQP (5672) is not published at all** — only sibling containers speak it. The
management UI is published on loopback because it is a credentialed admin console:
on `0.0.0.0` it is reachable from the network, and on Linux Docker's DNAT rules skip
the host `INPUT` chain, so a host firewall never sees the packet.

Every long-running container runs as a non-root user, and `/app` stays root-owned:
the process needs to READ its source, never to write it. An RCE that lands as `node`
therefore cannot patch `src/` to survive a restart.

### One healthcheck lesson, paid for

The broker's first healthcheck was written in exec form with `&&` in the argument
list. `CMD` does not run a shell, so `&&` arrived as a literal argument and
`rabbitmq-diagnostics` answered `too many arguments`. The container sat in
`starting` forever and everything with `condition: service_healthy` on it stalled
instead of failing. **A healthcheck that can never pass is worse than no
healthcheck**: it converts an error into a deadlock. It is `CMD-SHELL` now, and it
checks `check_local_alarms` as well as `check_running` — a node with a memory or
disk alarm is running and refusing publishes, which from the outside looks like a
hung producer.

## Transport rule

**HTTP for the path a human is waiting on. The broker for everything else.**

| Work | Transport | Why |
|---|---|---|
| Chat turn, tool call inside a turn | HTTP, `api ↔ ai` | Synchronous by nature; a person is blocked on it |
| Grading a batch, embeddings, weekly league close, e-mail, exports, re-indexing | RabbitMQ | Nobody is waiting; needs retry, back-pressure and durability |

Putting the chat turn on the broker would be architecture for its own sake. Putting the
weekly league close on HTTP would mean a failed request silently loses a week of
standings. Each mechanism where it earns its complexity.

## Tools live in both backends

Not one set moved, and not one set duplicated — **two different sets**, because the two
services own different things.

| | `api` (TypeScript) | `ai` (Python) |
|---|---|---|
| Owns | Postgres, sessions, the paywall | models, prompts, the ontology proof |
| Tool kind | data operations: read a lesson, record an attempt, queue a lab | AI operations: embed, re-rank, extract structure, grade free text |
| Identity | from the session cookie, never an argument | none — it never sees a user id |
| Registry | `api/src/tools/` | `ai/src/course_ai/tools/` |

Both registries publish the **same manifest shape**, so either backend can present the
other's tools to a model, and either can be the entry point for an agent turn. That is
what "agentic from any point" means here: two peers, not a client and a server.

The isolation guarantee is unchanged and non-negotiable: `ai` never touches the database.
It asks `api` for data through a tool call carrying an opaque session, and `api` decides
what that session is allowed to see. The service holding the model cannot leak what it
was never given.

## Database

**Prisma owns the schema. It does not own the queries, and it is not in the running image.**

    prisma/schema.prisma          the schema, introspected from the real database
    prisma/migrations/            history, starting from a baseline
    prisma.config.ts              connection URL (Prisma 7 moved it out of the schema)
    src/db.ts                     get / all / run — native SQL through `pg`

There is no `@prisma/client` and no query engine here. A query engine whose only job is
to forward raw SQL strings is ~15 MB of binary and a codegen step bought for nothing.
Prisma is a **dev dependency and a CLI**.

### What it replaced, and why that mattered

The schema used to be twenty idempotent DDL statements inside `db.js migrate()`, executed
by the API at every boot. Four concrete problems, not stylistic ones:

- **No history.** Nothing recorded what changed or when, so nothing could be rolled back.
- **Destructive changes were inexpressible.** `CREATE TABLE IF NOT EXISTS` and
  `ADD COLUMN IF NOT EXISTS` cannot state a rename, a type change or a drop. The first
  time one was needed it would have been hand-run with no record.
- **Dead lines accumulated.** `ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version`
  sat directly under a `CREATE TABLE` that already declared it. Nothing ever removes those.
- **Drift was undetectable.** A hand-altered database looked identical to a correct one.

`pnpm --dir api db:drift` now answers that last question with an exit code: it replays the
migrations into a shadow database and diffs. That check is most of the reason to adopt
Prisma here.

### Applying it is a separate step

`docker-compose` has a one-shot **`init`** service, built from the Dockerfile's `migrate`
stage (the runtime image installs with `--prod` and prunes the CLI). It runs
`prisma migrate deploy` then the seed, and `api` waits on
`condition: service_completed_successfully`.

Both used to happen inside the API process. With one instance that works. With two it is
two processes running DDL and two seeding the same rows, and "it never broke because we
only ever ran one" is not a property to keep while planning to scale.

### The cost, stated: Prisma silently drops CHECK constraints

This is not a caveat, it is a measured defect in the adoption path.

Prisma's datamodel cannot express a `CHECK`. A baseline generated **from the live
database** — which held three of them — came out with **zero** in 222 lines:

    users_role_check    role  IN ('student','tutor','admin')
    labs_level_check    level IN ('facil','medio','dificil')
    jobs_estado_check   estado IN ('pendiente','curso','hecho','muerto')

Adopting Prisma without noticing that would have made `role = 'superadmin'` insertable the
next time anyone regenerated the schema.

Handled in two places, because a comment is not a mechanism:

1. The three constraints are re-added by hand at the end of the baseline migration.
2. `db.ts migrate()` queries `pg_constraint` at startup and **refuses to boot** if any is
   missing, naming it. Verified by dropping one: the process refused and named it; restored,
   it passed.

Any future migration touching those tables must carry the constraints forward. The startup
check is what makes forgetting loud instead of silent.

