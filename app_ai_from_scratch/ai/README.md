# `ai/` — ontology and agent (v3)

Everything that is AI lives here. TypeScript keeps the HTTP backend and the
frontend; this service has no public routes and does not talk to Postgres.

```bash
uv sync --extra dev
uv run uvicorn course_ai.app:app --port 8799 --reload

uv run pytest -q                  # 187 tests
uv run ai-prove-isolation         # P1..P4 over the graph (exits 1 on failure)
uv run ai-export                  # writes ../api/src/ontologia.json
uv run ai-doc                     # writes ../ONTOLOGY.md
```

## What is inside

```
ontology/
  data.py     the ontology as DATA: 12 tables, 90 columns, 39 tools. Every tool
              declares which tables it touches (`reads`), which columns it
              returns (`returns`) and with what scope (sesion/publico/agregado).
  graph.py    the graph and the PROOF. BFS O(V+E), Kahn for the deletion order,
              and P1..P4 — the four obligations that make it impossible for one
              user to reach another's data.
  render.py   the text the model sees. What is forbidden is never named: saying
              «do not ask for labs.solution» is teaching the model it exists and
              what it is called. Also renders ONTOLOGY.md (`ai-doc`) — the human
              document, from the same data as the prompt.
  export.py   emits api/src/ontologia.json so Node reads the same truth. It
              refuses to write unless Node's catalogue agrees with the declaration,
              names and paywall flags both, and unless P1..P4 hold.
agent/
  providers.py  seven providers, two wire formats. The keys are read by THIS
                service, not by the API.
  bridge.py     the way back to Node. No database access.
  loop.py       the harness: at most 4 model turns, a trace of every step.
app.py          FastAPI. /salud /ontologia/* /agente/turno
bus.py          the broker contract, shared with api/src/bus.ts.
worker.py       the `ai-worker` entrypoint: same image, different command.
```

## The two checks that cross into Node

`export.py` will not write the artefact unless it can first read what Node really
executes. It gets that by running `scripts/emit-tool-catalog.mjs`, which *imports*
`api/src/tools/index.ts` and prints JSON — it does not scan the source. The reader
it replaced was a regex over source formatting and it broke twice, once on a
registry rename and once on the split into family files; both times it correctly
refused to compare, and both times the check sat dark until somebody noticed.

Two more commands, from the repo root, are the acceptance tests for the ontology:

```bash
node scripts/check-ontology-drift.mjs                          # ontology vs schema.prisma
node --experimental-strip-types scripts/emit-tool-catalog.mjs   # 39 tools, 7 paywalled
```

The `--experimental-strip-types` flag is required: Node 22.13 reports
`process.features.typescript === false`.

## Naming

Identifiers, comments and docstrings are English (see `../docs/NAMING.md`). Three
things are deliberately NOT: the route paths (`/salud`, `/ontologia/*`,
`/agente/turno`), the JSON keys on the wire (`sesion`, `respuesta`, `traza`,
`paso`…) which api/ and web/ are written against, and the model-facing strings
(tool `descripcion`, `nota`, the system prompt) which are course content.

## The three things that cannot break

1. **This service never sees a `userId`.** It receives the opaque cookie and
   forwards it to `POST /api/v3/interno/herramienta`; Node validates it and resolves
   the person. If this service could query the database, isolation would be
   implemented twice in two languages and one day they would diverge.
2. **`labs.solution` gets out by no path.** It is the column that destroys the
   course. `test_graph.py` injects a tool that returns it and checks the proof
   catches it **with the path** that causes it.
3. **The prompt does not name what is forbidden.** `test_render.py` checks it in
   both languages, over the ontology block (the behaviour *rule* may well say
   «never reveal a lab solution» — that is an instruction, not a column name).

## Variables

| variable | what for |
|---|---|
| `IA_SECRETO` | shared secret with the API. **The same** in `api/.env` and `ai/.env`. It does not authenticate a person: it proves the call comes from the service. |
| `NODE_URL` | where the API is, for the tool bridge |
| `PORT` | 8799 |
| `ANTHROPIC_API_KEY` and friends | one is enough. With none, `/agente/turno` answers `sin_proveedor` instead of pretending. |
| `PROVEEDOR_ORDEN` | priority, e.g. `anthropic,deepseek,grok,sonnet`. Default: Haiku (flash), then cheap fallbacks, then Grok and Sonnet for reasoning. Opus is refused. |
| `PROVEEDOR_ORDEN_ES` / `PROVEEDOR_ORDEN_EN` | measured quality order for Spanish or English. It takes precedence for that language; the remaining configured providers remain failover. |

`scripts/keys.sh` generates them (the model keys have to be pasted by hand:
each provider issues them and they belong to your account).
