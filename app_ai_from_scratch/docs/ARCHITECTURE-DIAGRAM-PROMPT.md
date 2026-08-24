# Architecture diagram — the prompt

Two prompts. The first is for an **image model**. The second is **Mermaid**, which
is what belongs in the repository: an image cannot be diffed, and this
architecture has changed three times today.

**Read the facts before editing either one.** Every number came from the running
system — `docker compose config`, `data verify`, `defense verify`,
`emit-tool-catalog`, `ai-prove-isolation`. A diagram that contradicts them is
worse than no diagram, because it will be believed.

---

## The facts

| Service | Stack | Port | Exposure |
|---|---|---|---|
| `web` | Astro | 4321 | **published** |
| `api` | Node 22 + TypeScript (tsgo) | 8787 | **published** |
| `ia` | Python 3 + FastAPI (uv) | 8799 | internal |
| `data` | Go + pgx | 8788 | internal |
| `queue` | Go + Fiber | 8790 | internal |
| `morpheus` `trinity` `smith` `oracle` `neo` | Go, one image | — | internal |
| `db` | postgres:17-alpine | 5432 | internal |
| `broker` | rabbitmq:4-management-alpine | 5672 | internal |
| `init` `api-worker` `ai-worker` | migrate stage / api image / ai image | — | no port |
| `panel` | Astro, separate host behind Cloudflare Access | — | internal |

**Only two services publish a port.** That is the most important fact in the
picture and the one every generic diagram gets wrong.

### Five things the diagram must get right

1. **The tunnel arrow points OUT.** The Pi is behind CGNAT, so no inbound port
   from the internet is possible. `cloudflared` makes an outbound connection to
   Cloudflare's edge. Every request arrives back down that connection.
2. **Python has no database access.** No `psycopg`, no `asyncpg`, no
   `DATABASE_URL` anywhere in `ai/`. Tool calls go
   `Bridge.call()` → `POST /api/v3/interno/herramienta` → executed by Node with
   the asking user's own id. That absence *is* the isolation guarantee: draw
   **no line from `ia` to `db`**.
3. **`data` is the only holder of the credential.** It exposes a closed catalogue
   of **10 named operations** and **no SQL endpoint at all**. 8 are agent-facing,
   2 are internal exemptions (grading needs `labs.solution`; login needs
   `users.pass_hash`). An RCE in `api` after the migration reads ten shapes
   scoped to one actor, not twelve tables.
4. **One agent may act.** Of the five defence agents only Neo can change the
   running system, and it starts in `propose` mode where it changes nothing.
   Oracle publishes threats, Neo consumes them, and there is **no edge back**.
5. **Prisma owns the schema; `pg`/pgx run the queries.** No query engine in any
   image. Prisma cannot express CHECK constraints — three are hand-added in the
   baseline migration.

### Numbers worth putting on the page

- 12 lessons · 36 labs · 12 ranks
- 37 agent tools, 7 paywalled · 3 native Python tools
- Ontology: 46 columns classed `jamas` · obligations P1–P4 over the 37 bridged
  tools, P5 over the 3 native ones
- Bus: one topic exchange `course.events` + `.dlx` + 4 fanout retry tiers
- Defence: 5 actions, ≤10 per 10 min globally, every action expiring
- Images: `defense` 51 MB, `data` 14.6 MB, `queue` 6 MB — all `FROM scratch`

---

## Prompt 1 — for an image model

> A precise infrastructure schematic, landscape 16:9. Flat vector, thin 1.5px
> strokes, strict orthogonal grid, right-angle connectors only. Technical
> documentation style — **not** an illustration: no robots, no shields, no hooded
> figures, no glowing brains, no padlock clip-art, no isometric perspective, no
> 3D.
>
> **Palette, exactly these values:** background `#0B0D12`. Panels `#12161F` with
> `#262E42` borders. Brand blue `#3355FF` for the request path. Grey `#8B93A7`
> for asynchronous messaging. Green `#2ED47A` for the defence layer. Amber
> `#FFB03A` for the single trust boundary. Text `#FFFFFF` down to `#565B6C`. No
> gradients, no glow, no drop shadows.
>
> **Typography:** Inter in three weights. Service names in medium; every port,
> number and identifier in a monospace face at half size.
>
> **Composition — five horizontal bands, plus a green column down the right edge.**
>
> **Band 1 (top), above the boundary:** a small globe labelled `Internet`, and a
> rounded box `Cloudflare edge — WAF · TLS · Access`. Directly beneath them a
> thick amber dashed line spanning the full width, labelled
> `CGNAT — no inbound port exists`.
>
> **Band 2:** a single box `cloudflared`, with **one arrow pointing UP** through
> the amber line, annotated `outbound tunnel — the only door`. This direction is
> essential and must not be reversed.
>
> **Band 3 — the request path, four boxes left to right joined by thick blue
> arrows:** `web · Astro · :4321` → `api · Node 22 + TypeScript · :8787` →
> `ia · Python + FastAPI · :8799`, and from `api` a second blue arrow down-right
> to `data · Go + pgx · :8788`.
> Label the `api → ia` arrow `POST /api/v3/interno/herramienta — 37 tools, 7 paywalled`.
> Label the `api → data` arrow `POST /v1/op — 10 named operations, no SQL`.
> Beside `ia`, a small caption: `no DATABASE_URL — Python never touches the database`.
> Beside `data`, a small caption: `the only holder of the credential`.
>
> **Band 4 — state, two boxes:** `Postgres 17 — schema by Prisma, queries by pgx`
> and `RabbitMQ 4 — course.events (topic)`. Draw a solid blue line from `data`
> down to Postgres and **no line from `ia` to Postgres**. Draw thin grey lines
> from `api`, `ia` and `queue` to RabbitMQ. Beside RabbitMQ, three small stacked
> chips: `.dlx`, `retry ×4 tiers`, `18 defence bindings`. Below it a box
> `queue · Go + Fiber · :8790` captioned `owns the topology`, and two small
> port-less boxes `api-worker` and `ai-worker` hanging off RabbitMQ.
>
> **Band 5 (bottom):** a box `panel · Astro` set apart on its own, connected only
> to `data` and to the Cloudflare edge, captioned
> `super-admin · separate host · behind Access`.
>
> **Right-edge column, five small boxes stacked, all outlined in green, each with
> a large numeral:** `1 MORPHEUS`, `2 TRINITY`, `3 SMITH`, `4 ORACLE`,
> `5 NEO`. A green dashed arrow from ORACLE down to NEO labelled `scored threat`.
> A green dotted line from the column to RabbitMQ labelled `defense.finding.*`.
> On NEO only, a small solid badge: `the only agent that may act · propose by default`.
> On ORACLE, a caption: `read-only by construction`.
> Draw **no** arrow from NEO back to ORACLE.
>
> **Legend, bottom-left, four rows:** thick blue = request path; thin grey =
> asynchronous message; green dashed = defence signal; amber dashed = trust
> boundary.
>
> **Caption strip along the bottom edge, small monospace:**
> `Raspberry Pi 4B · arm64 · 16 services · 2 published ports · 46 columns classed jamas`
>
> Spell every label exactly as written. Prefer empty space over decoration.

### Checking the render

The four failures image models actually produce here, in order of likelihood:

1. **A reversed tunnel arrow.** There is no inbound path.
2. **A line from `ia` to Postgres.** Its absence is the guarantee.
3. **An arrow from Neo back to Oracle.** That loop does not exist, and drawing it
   inverts the whole design.
4. **`api` drawn straight to Postgres with no `data` in between.** That is the
   architecture being replaced.

---

## Prompt 2 — Mermaid, for the repository

```mermaid
flowchart TB
  subgraph outside["outside — no inbound port exists (CGNAT)"]
    net["Internet"] --> cf["Cloudflare edge<br/>WAF · TLS · Access"]
  end

  cfd["cloudflared"] -. "outbound tunnel — the only door" .-> cf

  subgraph app["request path"]
    web["web<br/>Astro · :4321"]
    api["api<br/>Node 22 + TypeScript · :8787"]
    ia["ia<br/>Python + FastAPI · :8799<br/>no DATABASE_URL"]
    dat["data<br/>Go + pgx · :8788<br/>the only holder of the credential"]
  end

  cfd --> web --> api
  api -- "POST /api/v3/interno/herramienta<br/>37 tools · 7 paywalled" --> ia
  api -- "POST /v1/op<br/>10 named operations · no SQL" --> dat

  subgraph state["state"]
    pg[("Postgres 17<br/>schema: Prisma · queries: pgx")]
    mq{{"RabbitMQ 4<br/>course.events + .dlx + retry ×4"}}
  end

  dat --> pg
  api --- mq
  ia --- mq
  q["queue<br/>Go + Fiber · :8790<br/>owns the topology"] --- mq
  aw["api-worker"] --- mq
  pw["ai-worker"] --- mq

  subgraph def["the five lines of defence"]
    m1["1 Morpheus · the door"]
    t2["2 Trinity · the walls"]
    s3["3 Smith · attacks us"]
    o4["4 Oracle · sees, read-only"]
    n5["5 Neo · the only actor<br/>propose by default"]
  end

  mq -- "defense.signal.*" --> o4
  o4 -- "scored threat" --> n5
  m1 -. "defense.finding.*" .-> mq
  t2 -. .-> mq
  s3 -. .-> mq
  n5 -. "defense.action.* / escalation" .-> mq

  pan["panel · Astro<br/>super-admin · separate host behind Access"] --> dat
  pan -. .-> cf
```

Note what the graph does **not** contain: no edge `ia --> pg`, no edge
`n5 --> o4`, no edge `api --> pg`.

---

## What the diagram deliberately omits

Written down so nobody "fixes" the picture by adding them back:

- **No line from `ia` to Postgres.** Its absence is the isolation guarantee.
- **No inbound arrow through the CGNAT boundary.** There is no such path.
- **No arrow from Neo to Oracle.** A cycle between the detector and the
  responder generates traffic that looks like an attack.
- **No `nft` box on the Pi.** `trinity nft` prints a ruleset for a human to
  apply; no agent applies it.
- **No packet capture and no ML box.** Requests arrive over TLS through the
  tunnel; the attack signal is at the application layer.
- **Only two published ports**, though sixteen services exist.
