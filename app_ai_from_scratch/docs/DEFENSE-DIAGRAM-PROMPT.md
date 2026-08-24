# The five lines of defence — diagram prompt

An image prompt for the `defense/` service, plus the facts it is built from and a
list of what a generic "AI cybersecurity agents" prompt gets wrong about *this*
system.

Read the facts first. Every one came from the running code, and a diagram that
contradicts them is worse than no diagram: it will be believed.

---

## What is actually true

| Line | Agent | Owns | Power |
|---|---|---|---|
| 1 | **Morpheus** | The door — Cloudflare Tunnel, zero inbound ports | config only |
| 2 | **Trinity** | The walls — sshd, nftables ruleset, updates | prints a ruleset; applies nothing |
| 3 | **Smith** | Attacks *us* — capabilities, docker socket, secrets in env, shell in image | read-only |
| 4 | **Oracle** | Sees — consumes `defense.signal.*`, scores, publishes threats | **read-only by construction** |
| 5 | **Neo** | The only agent that may act | allowlisted, expiring, rate-limited, audited |

Hard numbers, from `defense verify` and the tests:

- **5 actions** in the allowlist. No generic "run a command" verb exists.
- **10 actions per 10 minutes**, global, across all kinds — the cap that turns
  "attacker triggers 10 000 detections" into ten reversible changes and a loud
  escalation.
- **Every action expires.** `MaxTTL > 0` is asserted for all five; the ban
  timeout is held by the *kernel*, not by a timer in a process that can die.
- **`propose` is the default.** Neo starts unable to change anything.
- **Never-touch:** `cloudflared`, `db`, `broker`, `mosquitto`, `init`. Plus every
  private and CGNAT range, because traffic arrives through the tunnel, so a
  private source address *is* the tunnel.
- **One image, 51.3 MB, `FROM scratch`** — no shell, no package manager, no
  interpreter. Smith checks for `/bin/sh` at runtime and reports a finding if one
  ever appears.
- **Hash-chained audit log.** An edited record, a removed record and a
  front-truncated log are all detected.

## What a generic prompt gets wrong here

Say these out loud in the prompt as negatives, because image models default to
all of them:

1. **No circular "agents talking to each other" hub-and-spoke.** The flow is
   one-directional and that is load-bearing: Oracle publishes threats, Neo
   consumes them, and Neo does **not** publish threats back. A cycle between the
   detector and the responder generates its own traffic, and that traffic looks
   exactly like an attack.
2. **No packet capture, no `eth0` tap, no ML model box.** Requests arrive through
   an outbound tunnel, so the wire carries TLS to Cloudflare. The signal is at
   the application layer.
3. **No Kafka.** One RabbitMQ topic exchange, `course.events`.
4. **No "PHOENIX auto-recovery".** Restoration and credential rotation are
   human-triggered. An agent that rotates credentials on a false positive is
   worse than most attacks.
5. **No robots, shields, hooded figures, glowing brains, or padlock clip-art.**
   This is an infrastructure schematic.

---

## The prompt

> A precise infrastructure schematic of a five-layer defence system, landscape
> 16:9. Flat vector, thin 1.5px strokes, strict orthogonal grid, right-angle
> connectors only. Technical documentation style — **not** an illustration: no
> robots, no hooded figures, no shields, no glowing brains, no isometric
> perspective, no 3D.
>
> **Palette, exactly these values:** background `#0B0D12`. Brand blue `#3355FF`
> for the request path. Green `#2ED47A` for the defence layer. Amber `#FFB03A`
> for the one trust boundary. Red `#FF6B6B` used **once**, on a single badge.
> Greys `#8B93A7` and `#565B6C` for infrastructure. No gradients, no glow, no
> drop shadows.
>
> **Typography:** one geometric sans (Inter) in three weights. Agent names in
> medium. All numbers, ports and identifiers in a monospace face at half size.
>
> **Composition — a tall left column and a wide right field.**
>
> **Left column, five stacked rows, each a rounded rectangle outlined in green,
> each with a large numeral and a name:**
> `1 MORPHEUS — the door` · `2 TRINITY — the walls` ·
> `3 SMITH — attacks us` · `4 ORACLE — sees` · `5 NEO — the only actor`.
> Under Oracle, small monospace: `read-only by construction`. Under Neo, a small
> solid `#FF6B6B` badge: `propose mode — acts only when told to`. Under Smith:
> `no capabilities, no network`.
>
> **Right field, three horizontal bands:**
>
> 1. **Top band** — a thick amber dashed line spanning the width, labelled
>    `CGNAT — no inbound port exists`. Above it a rounded box
>    `Cloudflare edge`. Below it a box `cloudflared`, with one arrow pointing
>    **UP** through the amber line, annotated `outbound tunnel — the only door`.
>    This arrow direction is essential and must not be reversed.
> 2. **Middle band** — the protected services as small grey boxes in a row:
>    `web :4321`, `api :8787`, `ia :8799`, `data :8788`, `queue :8790`,
>    `Postgres`, `RabbitMQ`. Draw a thin grey padlock beside four of them with
>    one shared caption: `never-touch: cloudflared · db · broker · mosquitto`.
> 3. **Bottom band — the decision path, the most important part of the image.**
>    Left to right, four elements joined by green arrows:
>    a small stack of chips labelled `defense.signal.*` →
>    a box `ORACLE — score in a 5 min window` →
>    a box `NEO — policy` →
>    a **fork** into two clearly different outcomes: a green solid arrow to
>    `ACT — 1 of 5 allowlisted actions` and a green dashed arrow to
>    `ESCALATE — with the exact command a human would run`.
>    Around the `NEO — policy` box, four small callout chips, evenly spaced:
>    `≤10 actions / 10 min (global)`, `every action expires`,
>    `irreversible ⇒ human`, `no shell, ever`.
>    Draw **no** arrow from Neo back to Oracle. The one-way flow is the point.
>
> **Bottom-right corner:** a small box `audit — hash-chained, tamper-evident`
> with three tiny stacked record glyphs, each linked to the next by a short line.
>
> **Legend, bottom-left, four rows:** blue = request path; grey = service;
> green = defence signal; amber dashed = trust boundary.
>
> **Caption strip along the bottom edge, small monospace:**
> `Raspberry Pi 4B · arm64 · one scratch image, 51 MB · 5 actions · propose by default`
>
> Spell every label exactly as written. Prefer empty space over decoration. No
> icons other than the padlock and the record glyphs.

### Checking the render

Three failures to look for first, because they are the ones models produce:

1. **A reversed tunnel arrow.** There is no inbound path on this topology.
2. **An arrow from Neo back to Oracle.** That loop does not exist and drawing it
   inverts the design.
3. **Extra agents, or a packet-capture box.** Five agents, no wire tap.

---

## Mermaid, for the repository

An image cannot be diffed. This is the version that stays correct.

```mermaid
flowchart LR
  subgraph edge["outside — no inbound port exists (CGNAT)"]
    cf["Cloudflare edge"]
  end
  cfd["cloudflared"] -. "outbound tunnel — the only door" .-> cf

  subgraph svc["protected — never-touch: cloudflared · db · broker · mosquitto"]
    api["api :8787"]
    dat["data :8788"]
    pg[("Postgres")]
    mq{{"RabbitMQ · course.events"}}
  end
  cfd --> api --> dat --> pg
  api --- mq

  subgraph lines["the five lines"]
    m["1 Morpheus · the door"]
    t["2 Trinity · the walls"]
    s["3 Smith · attacks us"]
    o["4 Oracle · sees, read-only"]
    n["5 Neo · the only actor"]
  end

  mq -- "defense.signal.*" --> o
  o -- "scored threat" --> n
  n -- "ACT · 1 of 5, expiring" --> svc
  n -. "ESCALATE · with the exact command" .-> human["a human"]
  m -. "findings" .-> mq
  t -. .-> mq
  s -. .-> mq

  audit[["audit — hash-chained"]]
  n --> audit
```

Note what the graph does **not** contain: any edge from `n` back to `o`.
