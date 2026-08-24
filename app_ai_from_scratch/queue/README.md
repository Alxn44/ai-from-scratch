# `queue/` — the transport between services (Go + Fiber)

Owns the RabbitMQ topology: the exchanges, the queues, the bindings, the retry
ladder and the dead-letter policy. Plus an HTTP surface for enqueueing work and
for answering *what is in flight right now*.

It holds no course logic, touches no database, and is not on any path a person
waits on.

```bash
scripts/dev.sh                       # HTTP surface locally (no broker: see below)
go test ./... -race                  # 91 tests, 129 with subtests
go run ./cmd/queue-verify            # the gate: build, vet, gofmt, tests, contract
go run ./cmd/queue-topology print    # the topology as data, no broker needed

tools/topology.sh verify             # check it against the live broker
tools/smoke.sh                       # one message across three services
tools/dead-letters.sh show           # what is parked, and why it matters
```

---

## What this service owns

| Owns | Where |
|---|---|
| The topology, as data | `internal/bus/topology.go` |
| The retry ladder and the attempt ceiling | `internal/bus/retry.go` |
| The envelope on the wire | `internal/bus/envelope.go` |
| What counts as a *failed* publish | `internal/broker/confirm.go` |
| Dedupe policy, dispatch, dead-lettering | `internal/bus/dispatch.go` |
| Declaring and **verifying** the topology | `cmd/queue-topology` |
| Enqueue, inspect, replay dead letters | `internal/httpapi` |

## What it deliberately does **not** own

- **Any course logic.** No lessons, no labs, no grading, no user data. The routing
  keys for that work (`ai.grading.batch.requested`, `ai.embeddings.requested`)
  belong to the services that own the data; they are neither bound nor handled
  here.
- **A database.** Not a connection, not a driver, not a migration. The moment
  this service opens one it becomes a second writer to `api`'s tables, which is
  argument 4 in *Why there is no `orchestrator` container*
  ([../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)).
  The idempotency claim therefore goes over HTTP to `api`, which owns the row —
  exactly as `ai/src/course_ai/bus.py` does it.
- **Routing.** Nothing flows *through* this process. Every service declares the
  topology on connect (idempotently) and publishes straight to the exchange.
- **The chat turn.** HTTP for the path a human is waiting on; the broker for
  everything else.
- **The Postgres job queue.** `api/src/jobs.ts` stays. See below.

### The line this service is not allowed to cross

[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) refuses to build an `orchestrator`
container, and both
`api/src/bus.ts` and `ai/src/course_ai/bus.py` open by restating why: *orchestration
is a library, not a service.* That argument still holds, and this service is
built to stay on the right side of it. The four objections, and what answers each:

| The objection to an orchestrator | Why it does not apply here |
|---|---|
| It sits on the path a human waits on | Nothing here is on the chat path. `api → ai` is untouched. |
| It centralises what the design distributes | It decides no workflow. Any service still publishes and consumes on its own. |
| It is a total single point of failure | Stop this container: grading, chat and the league close all keep working. Declaration is idempotent and every service does it on connect. |
| Business logic drifts from its data | There is none here, and no database to read it from. |

**The test to apply to any future change:** if stopping this container would break
something else, it has become the orchestrator and the change is wrong.

---

## RabbitMQ *between* services, Postgres *inside* one

Two queues, one rule each. This is the part worth reading before adding a job
anywhere.

```
   ┌──────────────────────────┐          ┌──────────────────────────┐
   │           api            │          │            ai            │
   │  ┌────────────────────┐  │          │                          │
   │  │  jobs.ts (Postgres)│  │          │   (no database at all)   │
   │  │  SKIP LOCKED       │  │          │                          │
   │  │  same transaction  │  │          │                          │
   │  └────────────────────┘  │          │                          │
   └───────────┬──────────────┘          └─────────────┬────────────┘
               │                                       │
               └──────────────► broker ◄───────────────┘
                            (RabbitMQ topic)
```

**Postgres, inside one service — `api/src/jobs.ts`.** Work that one service both
enqueues and runs, next to the transaction that caused it: the Mercado Pago
webhook, the persisted spend counters. Its superpower is that the enqueue and the
business write are **the same commit**. `INSERT INTO jobs` inside the transaction
that records a payment either both happen or neither does. Put that on a broker
and you have bought the classic distributed bug: the row commits, the publish
fails, and the job is lost — or the publish succeeds, the transaction rolls back,
and a consumer processes work that never happened.

**RabbitMQ, between services.** Work that crosses a service boundary or fans out
to more than one interested consumer: batch grading, embeddings, the weekly league
close, exports, re-indexing. `ai` **could not** use the Postgres queue even if it
wanted to — it has no database connection, deliberately, because that isolation
is what makes it impossible for one user's data to reach another. That is not an
inconvenience the broker works around; it is *the reason the broker exists.*

**Why not one queue for everything?** Both directions have been considered and
both are worse:

- *Everything on Postgres* means giving `ai` the database. That deletes the single
  strongest security property in this repository (`ai` never sees a `userId`) to
  save one container. And `LISTEN/NOTIFY` is not durable fan-out: a notification
  delivered while nobody is listening is gone.
- *Everything on RabbitMQ* means the payment webhook loses transactional
  enqueueing, and every in-service job pays a network round trip plus a broker
  hop to hand work to the process it started in. It also makes the broker a hard
  dependency of a code path that currently survives its absence.

The question to ask is **not** "is this asynchronous?" — it is **"does anybody else
need to see it?"** Same process both ends: Postgres. Crosses an image boundary:
the broker.

---

## The topology

```
exchange  course.events                topic    durable   everybody binds here
exchange  course.events.dlx            topic    durable   dead letters
queue     course.events.dead           durable            bound to .dlx with '#'
exchange  course.events.retry.{ms}     fanout   durable   one per delay tier
queue     course.events.retry.{ms}     durable            ttl={ms}, dead-letters to course.events
queue     queue.work                   durable            dead-letters to .dlx
```

Retry tiers: **1000, 4000, 16000, 60000 ms**. Five attempts over ~81 seconds,
then the dead-letter queue and a human.

Two design points that are easy to get wrong and expensive to debug:

- **The wait happens in the broker, never in the consumer.** A failed attempt is
  republished to the delay queue for its attempt number, which holds it for its
  TTL and then dead-letters it *back* to the main exchange. A `nack(requeue=true)`
  would put the message straight back at the head of the queue and spin the CPU
  at broker speed.
- **The delay exchanges are `fanout`, not `direct`.** A message dead-lettered out
  of a delay queue keeps the routing key it was *published* with. Publishing to a
  direct exchange would mean using the tier's name as the key, and the message
  would return to the main exchange with that key and match nothing — silently.

`queue.work` binds `queue.#` and `bus.echo`, and nothing else. It does **not**
bind `#`: that would look like observability and would be sabotage, copying every
message in the fleet here and dead-lettering every type without a handler. Depth
and flow are read from the broker instead (`GET /queues`), which observes without
consuming.

---

## Three implementations, one contract

This package is the **third** copy of the envelope, the routing keys and the
retry numbers. `api/src/bus.ts` and `ai/src/course_ai/bus.py` are the other two,
and their headers say they "must stay readable as one document, because the two
runtimes read each other's messages."

A third copy is a third place to drift, and drift here is silent: a service that
thinks the ceiling is 5 attempts and one that thinks it is 6 do not argue, they
just dead-letter at different moments. So the numbers are **read back out of the
other two files and compared**:

```bash
go run ./cmd/queue-topology contract
# contract agrees with api/src/bus.ts and ai/src/course_ai/bus.py
# (envelope fields, retry ladder, ceiling, delivery mode, exchange name)
```

It compares `ENVELOPE_FIELDS`, `BASE_DELAY_MS`, `DELAY_FACTOR`, `DELAY_CAP_MS`,
`MAX_ATTEMPTS`, `PERSISTENT`, `RECONNECT_MS` and the default exchange name. If it
cannot find or read a constant it **fails** — it never reports a verified
contract over a comparison it did not make. `queue-verify` runs it as a step with
no skip path.

The envelope is byte-compatible with the other two on purpose: fields in contract
order, HTML escaping off (Go escapes `<`, `>` and `&`; `JSON.stringify` and
`json.dumps(ensure_ascii=False)` do not), and `produced_at` with milliseconds and
a literal `Z`.

---

## Fail closed, loudly

Every one of these is a rule this repository already paid for.

- **A publish with no broker is a failure**, never a silent success — the same
  choice `bus.ts` makes with `published: false, reason: 'bus_disabled'`.
- **A tool that cannot verify exits non-zero with the reason.** Never exit 0 with
  an empty result. `queue-topology verify` on an unreachable broker says *"verify
  could not run, so nothing was checked"* and exits 1.
- **`verify` is passive.** It declares nothing. A verifier that creates what it
  fails to find always passes, which makes it a declaration tool wearing a
  check's name. It also states, every time, that **bindings are not checked** —
  AMQP 0-9-1 has no passive binding query, and claiming otherwise would be worse
  than the gap.
- **An unreadable queue reports "unreadable", never `0`.** "No messages" and "I
  could not look" are different facts.
- **`/health` can fail.** It distinguishes *no broker configured* (503
  `no_broker`) from *configured but not connected* (503 `disconnected`) from
  *connected* (200 `ok`). A health endpoint that always answers ok is decoration.
- **A handler that never returns is a failure**, not a permanently occupied
  prefetch slot. Go cannot cancel a goroutine from outside, so the deadline frees
  the *slot* and the goroutine is abandoned — and `stats.abandoned` counts it, so
  the leak is visible instead of being a slow memory climb nobody can explain.

## No forgeable defaults

- No default `AMQP_URL`, no default secret, no default DSN. A default pointing at
  a real host is how a service ends up talking to the wrong broker while looking
  healthy.
- `IA_SECRETO` is **required** outside development. A known placeholder or a
  secret under 32 characters throws with an actionable message, the same standard
  as `sessionKey()` in `api/src/auth.ts`. In development an ephemeral one is
  minted per boot and said out loud.
- `APP_ENV` defaults to **production**. Forgetting it makes the rules stricter,
  never looser — `auth.ts` records a guard that only fired when `NODE_ENV` was
  exactly `'production'` and therefore never fired at all.
- The service secret is compared with `crypto/subtle.ConstantTimeCompare` over
  SHA-256 digests, never `==`. Hashing first removes the length from the
  comparison rather than branching on it, because an early return on a length
  mismatch puts the secret's length back on the wire.

---

## HTTP

`/health` needs no secret — a healthcheck carrying a credential puts it in every
compose file and process listing. Everything else requires `x-ia-secreto`.

| Route | What it does |
|---|---|
| `GET /health` | 200 only when actually connected. 503 otherwise, with which of the two problems it is. |
| `GET /topology` | The topology as data. Works with no broker: *what should exist* is a different question from *what does*. |
| `POST /topology/declare` | Declare it, idempotently. |
| `GET /topology/verify` | Passive check. 409 with the list if anything is missing, 503 if it could not look. |
| `GET /queues` | Depth and consumer count per queue. 409 if any queue could not be read. |
| `POST /enqueue` | `{type, payload, key?, idempotency_key?}` → **202** with the id, or 502/503 with `published: false`. Unknown JSON fields are rejected. |
| `POST /dead/replay` | `{limit}` — move up to `limit` dead letters back. Requires an explicit limit; acks off the DLQ only after the republish is confirmed. |

Route paths and the JSON keys of *new* routes are English. `IA_SECRETO` and the
`x-ia-secreto` header stay Spanish because `api` and `ai` already send them and
renaming them breaks both.

## Docker

Multi-stage: `golang:1.26-alpine` builds, and the runtime image is **`scratch`** —
6 MB, two static binaries and a CA bundle, running as uid `10001`. No shell, no
package manager, no compiler, no libc, so an RCE lands in a filesystem with
nothing to run and nothing to write.

The trade-off, stated: `docker exec` gets you nothing, because there is no
`/bin/sh`. Debugging is `docker logs` and the HTTP surface. That is also why the
healthcheck is a subcommand of the binary itself (`queue healthcheck`) — a scratch
image has no curl, and a healthcheck that cannot run is a container that is never
reported unhealthy.

`go vet` and `go test` run **at build time**, the way `ai/Dockerfile` runs
`ai-prove-isolation`: if the tests fail the image is not built. The cross-runtime
contract check is **not** in the image build, because it reads `../api` and
`../ai` and a service image must not need its siblings' source to build — it runs
in `queue-verify` instead, where the whole repository is present.

## AMQP is not published to the host

This surprises everyone once. Port 5672 is deliberately not published (see
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md): only sibling containers speak it,
and on Linux Docker's DNAT
skips the host `INPUT` chain, so publishing it would bypass a host firewall). So
a process on the host **cannot** reach the broker.

`scripts/dev.sh` does not pretend otherwise: it starts the service with no
`AMQP_URL`, `/health` answers 503 `no_broker`, and every write route refuses.
That is fine for working on the HTTP surface. For anything touching the broker,
`tools/topology.sh` and `tools/smoke.sh` run inside the compose network.

## Layout

```
cmd/queue/            the service: HTTP + consumer + graceful shutdown
cmd/queue-topology/   print · contract · declare · verify · queues
cmd/queue-verify/     the gate, like ai's ai-verify
internal/bus/         the contract: envelope, topology, retry, dispatch, claims
internal/broker/      the amqp091 adapter: connect, confirm, consume, inspect
internal/config/      environment only, and what it refuses to run
internal/httpapi/     the Fiber surface
internal/binding/     the queue name and routing patterns, in one place
scripts/              dev helpers
tools/                operational tools, run inside the compose network
```

`internal/binding` exists for a boring, load-bearing reason: `cmd/queue` consumes
the queue and `cmd/queue-topology` declares it, Go cannot import one `main` from
another, and two copies of a routing pattern is a service that consumes one set
of keys while the tool declares another — silently.

## Variables

| variable | what for |
|---|---|
| `AMQP_URL` | The broker. **No default.** Unset is supported and loud: `/health` says 503 `no_broker`. |
| `IA_SECRETO` | Shared service secret. Required outside development. The **same** value as in `api/.env` and `ai/.env`. |
| `APP_ENV` | `development` relaxes the secret rule. Anything else, including unset, is production. |
| `PORT` | 8790 |
| `BUS_EXCHANGE` | `course.events`. A name, not a credential, so it may default — and all three runtimes must agree on it. |
| `BUS_PREFETCH` | 8 |
| `BUS_CLAIM_URL` | `api`'s claim route, for durable idempotency. **Unset today** — see below. |
| `BUS_WORKER_ID` | Claim owner. Stable across restarts on purpose; a pid would not be. |
| `BUS_HANDLER_TIMEOUT_MS` · `BUS_DRAIN_MS` · `BUS_PUBLISH_TIMEOUT_MS` · `BUS_CLAIM_LEASE_S` | 60000 · 20000 · 10000 · 300 — the same numbers as the other two runtimes. |

## Known gap: idempotency is in memory

`BUS_CLAIM_URL` should point at `api`'s claim route, which **does not exist yet** —
the same note is at the top of `ai/src/course_ai/bus.py`, which has been waiting
for it too. Until it does, this service uses in-memory claims, says so at boot,
and reports it in `/health` as a `warning`.

What that costs, precisely: a redelivery *after a restart* can run a handler
twice. Within one process life, dedupe is correct.

The route is a small amount of work over the `pgClaims()` already exported by
`api/src/bus.ts`, and it would serve `ai` and `queue` at once. It is `api`'s to
write.
