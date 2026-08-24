# Migration v2 → v3

> **Historical record.** Paths on the v2 side of a comparison are old on
> purpose. One update since it was written: `src/legacy/harness.ts` and
> `src/legacy/providers.ts` — the v2 agent loop and its providers, which this
> document describes being retired — have now been DELETED, along with
> `api/test/harness.mts`, once nothing imported them. Nothing was lost:
> `ai/tests/test_render.py` checks the real prompt in both languages, more
> strictly than the v2 test did.

**v3 is what is current. v1 and v2 are legacy and deprecated** (`Sunset: 2027-02-21`).

Five assignments: AI to Python, TS 7 with the Go compiler, algorithms and
complexity, queues, and Go ready to operate. What follows says what was done,
which number decided it, and **what was NOT done and why**.

---

## 1 · All the AI to Python

| before (v2, Node) | now (v3, Python) | lines |
|---|---|---|
| `api/src/ontology.ts` | `ai/src/course_ai/ontology/data.py` + `graph.py` + `render.py` | 155 → 520 |
| `api/src/legacy/harness.ts` | `ai/src/course_ai/agent/loop.py` | 98 → 140 |
| `api/src/legacy/providers.ts` | `ai/src/course_ai/agent/providers.py` | 109 → 145 |
| — | `ai/src/course_ai/app.py` (FastAPI) | 130 |

The three Node files **are still in the repo with a deprecation header**, they are
not imported from `server.js`, and their v2 tests still pass. They get deleted when
`/api/version` stops counting hits on v1 and v2.

### The boundary, and why it is where it is

```
browser → API (Node)  ──POST /agente/turno──→  AI service (Python)
             ↑                                          │
             └──POST /api/interno/herramienta ──────────┘
                  (with the cookie, not with a userId)
```

**The AI service does not talk to Postgres.** The tools are run by Node,
which is the only one that has the session. The reason is not taste: isolation
between users consists of no tool accepting a person identifier. If Python also
queried the database, that rule would be implemented twice in two languages, and
the day they diverged the wrong copy would win — the same mistake that was avoided
by extracting the medal allocation into `api/src/ligas.js`.

The service **never sees a userId**. It receives the opaque cookie and forwards it.

### The tools do NOT move: there are two sets, not one

This corrects what was said earlier in this document and what is still written in a
comment in `api/src/server.js` («las herramientas se portan a Python … y
entonces agent-tools.js pasa a v2 legacy»). That comment is obsolete.

The decision is: **each backend carries its own tools**, so that the system is
agentic from any entry point. It is not a copy of the same ones in two places —
they are two **different** sets, because the two services own different things:

| | `api` (TypeScript) | `ai` (Python) |
|---|---|---|
| owner of | Postgres, sessions, the paywall | models, prompts, the isolation proof |
| kind of tool | data operations: read a lesson, record an attempt, enqueue a lab | AI operations: embeddings, re-ranking, extracting structure, grading free text |
| identity | from the session cookie, never an argument | none — it never sees a person id |

Both registries publish the **same manifest format**, so either of the two backends
can present the other's tools to the model, and either one can be the entry point of
a turn. That is what «agentic from any point» means: two peers, not a client and a
server.

What does not change, and is not negotiable: **`ai/` does not touch the database**. It
asks `api` for the data through a tool call that carries an opaque session, and `api`
decides what that session can see. The service that has the model cannot leak what it
was never given.

### From prose to theorem

In v2 the ontology *described* isolation and the code implemented it
separately: nothing guaranteed they matched. In v3 the ontology is data and a
graph **proves** it (`ai/src/course_ai/ontology/graph.py`):

- **P1** no tool returns a column of class `jamas`
- **P2** every tool that touches a table with `propio` columns declares
  scope `sesion` or `agregado`
- **P3** no signature accepts an argument with which to express «another person»

```
grafo: 84 nodos, 95 aristas (9 tablas, 68 columnas, 7 herramientas)
columnas jamas: 29
aislamiento: P1, P2 y P3 se cumplen en las 7 herramientas
```

It runs in every test, in `uv run ai-prove-isolation` and **in the `docker
build`**: an image with a declared leak does not get built.

The proof is itself proved: `tests/test_graph.py` plants fake tools that
return `labs.solution`, that read `attempts` without a filter and that declare
`user_id`, and checks that all three are caught **together with the path** that causes
them. An isolation test that has never failed has proved nothing.

### A mistake of my own that has to be told

The first version of P2 transitively closed the join edges and
reported **4 false violations**: `curso_indice` only reads `lessons`, but the
BFS attributed `lessons → labs → attempts → users` to it. A test that screams while
it is green gets switched off within a week, and then it protects nothing. P2 is now
checked over the tables the query **touches**; the transitive closure stayed as a
design warning (`vecindad_de_riesgo()`): «this is one join away from personal
data».

### One source, one artefact, two readers

Node needs the forbidden columns for its guard. Instead of copying them,
Python **emits** them: `uv run ai-export` writes `api/src/ontologia.json` and
`api/src/ontology.ts` reads it. If it is missing, the server **does not start** — without
the list, the guard protects nothing and carrying on would be worse than stopping.

---

## 2 · TS 7 with the Go compiler (`tsgo`)

`@typescript/native-preview` 7.0.0-dev installed in `web/` and `api/`. Measured, not
assumed:

| what | tsc | tsgo | |
|---|---|---|---|
| the `.ts` files in `web/` | 1.380 s | **0.208 s** | 6.6× |
| the whole API with `checkJs` | — | **0.83 s** | did not exist |

**What `tsgo` does not do, said plainly:**

1. **It speeds nothing up at runtime.** It is a checking compiler; the code that
   runs is still the same JavaScript on the same V8. Any promise
   of «maximum performance» from switching compiler is false. What improves is
   the edit loop.
2. **It does not understand `.astro`.** There is no template plugin, so `astro check`
   is still mandatory. That is why `web/tsconfig.tsgo.json` includes only
   `src/**/*.ts`, and `pnpm check` runs both (5.08 s in total, 0 errors,
   0 warnings, 56 files).

**What it did contribute:** the API was JavaScript **with no type checking at all**. With
`checkJs` it found, in 0.83 s:

- **A real bug I had just written**: `{ ...await res.json() }` in
  `api/src/ai-bridge.ts`. If the service returned `null` or plain text (a proxy that
  answers «Bad Gateway»), the spread throws `TypeError` and the chat falls over with a 500
  and no explanation. Fixed with a shape check.
- **Another real bug**: `alias.padEnd(7)` in `api/scripts/liga-demo.mjs` on a
  `string | number | boolean` value.
- **A weakness with a security consequence**: `cookieOpts.sameSite` was
  widening to `string`. Somebody writes `'Lax'` and it compiles all the same; the cookie goes out
  without CSRF protection and nothing warns. Pinned to the literal.
- **The unwritten Node↔Python contract**: `server.js` was reading `s.proveedores` off
  a value the compiler only knew as `object`. It is now declared in
  `api/src/ai-bridge.ts`, so a key change in FastAPI gets caught by `pnpm check`.

**The baseline is 59, not 0, and that is honest.** 58 of the 59 are the same thing:
`req.body` and `await res.json()` are read with no declared shape. They are not bugs — they are
the mark of where external data comes in unvalidated. The real fix is to put
a JSON schema per route (Fastify validates on its own), and that is already done on the
new routes: `/api/chat` and `/api/interno/herramienta` with
`additionalProperties: false`. `api/scripts/tipos.mjs` **stops the number from
going up** without anyone noticing: a report of 59 that nobody looks at protects nothing;
one that fails at 60 does. It already worked — it caught the 10 messages that my
own queue code added.

---

## 3 · Algorithmic complexity: measure first

### The quadratic in SQL

(It was not the only one. There were two more, in Python, and they are at the end of this section.)

`api/src/ligas.js` was computing the lab total with a correlated
subquery. `EXPLAIN (ANALYZE, BUFFERS)` with 11 users and 74 first-times:

```
SubPlan 2
  -> CTE Scan on primera q  (actual time=0.001..0.002 rows=8 loops=9)
```

`loops=9` — one re-read of the CTE **per user**: O(U × P). With 11 users
it is invisible; with 10.000 it is not. By aggregating `totales` a single time and joining:

| | execution | planning | shape |
|---|---|---|---|
| before | 1.314 ms | 2.194 ms | O(U × P), `SubPlan`, `loops=9` |
| after | **0.603 ms** | **1.090 ms** | O(U + P), all `loops=1` |

Also verified that it returns the same 9 rows with the same totals.

**And what the measurement said NOT to do:** planning cost more
than execution (2.194 ms against 1.314 ms). At this data size there is nothing
more to optimise in the database. Optimising before measuring is guessing.

### Structures and complexity where they matter

`ai/src/course_ai/ontology/graph.py`, all declared in the docstring:

| operation | algorithm | complexity |
|---|---|---|
| `alcance()` | BFS over an adjacency list | O(V+E) |
| `camino()` | BFS with parents | O(V+E) |
| `orden_topologico()` | Kahn | O(V+E) |
| `prueba_aislamiento()` | \|H\| BFS | O(\|H\|·(V+E)) |

Memoised BFS was chosen over the Floyd-Warshall transitive closure (O(V³)):
with V=84 that would be **16 times more work to answer less**. And no
recursion was put where iteration is correct — reconstructing the path from
the parents is iterative because that is how it is written.

The **topological order** turned up a finding: with the (symmetric) join edges,
Kahn put 7 of 9 tables into a cycle. A second set of **directed**
foreign-key edges was needed (`depende_de`). With those, the real deletion order
for an account comes out, which until now was implicit in the code:

```
attempts → role_audit → ranking_optin → payments → league_week
         → achievements → labs → users → lessons
```

The queue index is the query too, not an ornament:
`CREATE INDEX jobs_listos ON jobs (estado, corre_en) WHERE estado = 'pendiente'`.

---

### Two more quadratics, in Python, with the wrong label on top

I found them by measuring, not by reading. `ai/src/course_ai/ontology/graph.py` had two
functions with quadratic complexity, and one of them literally carried the
comment `# ---- Kahn: O(V + E) ----`.

The method: the real ontology is 12 tables and 37 tools, far too small
to measure anything. So a synthetic bench builds ontologies with the **same
shape** as the real one —a chain of tables where each one depends on the previous and
joins to the following ones— and scales it, watching the growth factor for each
doubling of the input. 2.0 is linear; 4.0 is quadratic.

```
                       antes                  después
tablas  herram.   topológico  vecindad    topológico  vecindad
    25       37      0.05 ms   0.64 ms       0.01 ms   0.04 ms
    50       80      0.21 ms   2.82 ms       0.01 ms   0.16 ms
   100      160      0.71 ms  11.48 ms       0.02 ms   0.65 ms
   200      320      2.26 ms  44.00 ms       0.05 ms   2.66 ms

factor por duplicación:  3.2x-4.3x  →  1.93x-2.03x   (topológico)
```

**`orden_topologico()`**: it was doing `for otra, t in sorted(self.tablas.items())`
**inside** the `while cola`. It sorted the V tables and walked all of them for each
node it popped off the queue: O(V² log V). Real Kahn needs the **reverse**
adjacency —«who depends on me»—, which is built once by walking the
edges. With that, popping a node costs its out-degree and not V. 45 times
faster with 200 tables.

**`tablas_alcanzables()`**: a full BFS **per tool**, O(H·(V+E)). With 7
tools you do not notice; with 37 it is 37 walks of the same graph, and the number of
tools is exactly what was going to grow. Now there is a single Tarjan pass
for all the tables: strongly connected components → condensation → propagation
in reverse topological order. 16.5 times faster.

The strongly connected components are needed and **not** a plain memoised DFS,
because `une` is not always declared in both directions: the table subgraph is
directed and can have cycles, and inside a cycle naive memoisation
returns incomplete sets depending on where you enter.

And the part that makes the optimisation worth anything: it was checked to be **identical** to the
implementation it replaces. A reference BFS implementation runs over
seven graph shapes —a chain of 40, a cycle of 3, two joined cycles, a complete graph
of 12, a graph with no edges, a random one with a fixed seed, and the real ontology— and
the sets match in all of them. An optimisation that changes an answer is not
an optimisation.

What stays quadratic on purpose: `vecindad_de_riesgo()` still grows ~4x,
because its **output** is O(H·T) — for each tool, the list of tables with personal
data that it reaches. That is the size of the result, not a defect of the
algorithm. What was taken out of the loop was the predicate
`any(c.clase == "propio")`, which was recomputing the same answer H times.

## 4 · Queues: Postgres INSIDE a service, RabbitMQ BETWEEN services

### The only job that genuinely cannot be synchronous

The Mercado Pago webhook. It used to verify the signature and **then** call
the Mercado Pago API and write to the database twice, all before answering
200. Two real consequences:

- if their API is slow, MP times out and **retries**; the buyer's `paid = 1`
  was left at the mercy of a third party's retry policy;
- if the fetch fails, we answer 500 and **the event is lost** unless MP
  insists.

Now: verify the signature → **enqueue** → answer 200 in milliseconds → a worker
processes it with retries.

### Why RabbitMQ YES, and why the earlier argument was badly framed

This used to say «Why not RabbitMQ», and the reasoning was not false: it was a
correct answer to **a different question**.

What it was answering was *«does it take a broker to move a payment message once in a
while?»*. It did not, and it still does not. The design question was
another one: *«how do two backends talk to each other?»*. With the AI in Python and the app in
TypeScript there are **two services that both need to start work**, and for that
a table in Postgres forces the producer to know the consumer's schema
and forces both to share the database — which is exactly the boundary that the
migration to Python exists in order not to cross (`ai/` does not touch the database, see section 1).

RabbitMQ is in. **The Postgres queue stays**, and the split is:

| job | where | why |
|---|---|---|
| payment webhook, league close, email — inside one service | `jobs` table in Postgres | it is already deployed and backed up, transactional with the rest of the write, and `FOR UPDATE SKIP LOCKED` is real queue semantics |
| chat turn, tool call within the turn | direct HTTP `api` ↔ `ia` | there is a person waiting; request/response over a broker means a reply queue, a correlation id, a timeout policy and orphan cleanup |
| everything else **between services** | RabbitMQ | the producer does not need to know the consumer, and `ai/` does not need database credentials |

What was NOT done, and `ARCHITECTURE.md` argues it in detail: **there is no
`orquestador` container**. RabbitMQ *is* the orchestrator — it is the
genuinely hard part (durable routing, dead-lettering, back-pressure) and it is already
written. The policy an orchestrator would add on top lives as a library
(`api/src/bus.ts`, `ai/src/course_ai/bus.py`), compiled inside the services that
do the work. A central process that has to know every flow is a total single
point of failure and centralises exactly what the design wants to distribute.

### When to change (conditions, not opinions)

1. more than ~50 jobs/second sustained, **or**
2. a consumer that is not this process (email, PDF on another machine), **or**
3. fan-out is needed: one event with several interested parties.

Of the three conditions, the one that was met was **2**: there is a consumer that
is not this process. `ai-worker` is a separate container, in another language, with no
access to the database. Neither of the other two is met yet, and they did not need to
be.

**Ready to operate:** `encola()` and the worker loop are still the
boundary of the Postgres queue, untouched. The broker did not replace them: it was added
for the traffic that crosses from one service to another.

21 checks in `api/test/cola.mjs`: idempotency by key, SKIP LOCKED,
exponential backoff with a ceiling (2 s → 1024 s), death after 6 attempts **without
deleting the job** (a payment lost without a trace is worse than one visible in
state `muerto`), and a type with no handler that stays pending.

### A design bug that a test found

The first version took any due job. The queue test started
failing because the worker of the running server was eating the `test.*` jobs,
finding no handler and **killing them**. The symptom was the test's; the bug was
production's: in a rolling deploy the old instance kills jobs of a
new type that the new instance would know how to run.

Fixed: `tomaLote()` filters by the types that that process knows how to run
(`tipo = ANY(?)`). A type nobody knows how to do stays pending — and
`estadoCola()` counts it as an **orphan**, because a job nobody takes and
nobody counts is a job lost in silence.

---

## 5 · Go: ready to operate, without writing Go

**There is no Go code, and that is the right call today.** Writing a service in Go that
replaces something that answers in 0.6 ms is not preparation, it is work that has to be
maintained with nothing coming back.

What is prepared is the **possibility**: the three services talk to each other over
HTTP with JSON and written contracts (`api/src/ai-bridge.ts` declares the AI one; FastAPI
publishes its own at `/docs`). Any one of them can be reimplemented in Go without touching
the other two.

**The first candidate is NOT the API.** Fastify with 4 users is orders of
magnitude away from its limit. And it is not the AI service: it spends 99 % of the time
waiting on a model — that is I/O, and `asyncio` already does it well. Moving it to Go
would improve 1 % of the time.

The real first candidate will be the first thing that is **CPU-bound or with many
connections at once**. Today it does not exist. When it does:

| future job | why Go | trigger |
|---|---|---|
| on-demand PDF generation | CPU and memory per request | > 1 PDF/s or p95 > 3 s |
| presence / live table over WebSocket | thousands of idle connections | > 5.000 simultaneous connections |
| queue worker across several machines | constant consumption, a standalone binary | > 50 jobs/s (the same threshold as RabbitMQ) |

Until one of them is met, the decision is no. And it is written down so the
next person does not have to argue it again.

---

## How all of it is checked

```bash
# AI (Python)
uv --directory ai run pytest -q               # 33 tests
uv --directory ai run ai-prove-isolation   # P1..P4
uv --directory ai run ai-export              # regenerates api/src/ontologia.json

# API (Node)
pnpm --dir api test                           # isolation + harness v2 + queue + v3 bridge
pnpm --dir api check                          # types with tsgo, against the baseline

# Frontend
pnpm --dir web check                          # tsgo (.ts) + astro check (.astro)

# All together
docker compose up --build                     # db + ia + api + web
```
