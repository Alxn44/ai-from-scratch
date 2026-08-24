# Naming contract

> **The rename is DONE.** This file is kept as the RECORD of it: the left-hand
> column is the old Spanish name on purpose, so that an old commit, an old log
> line or an old branch can still be read. The live policy — everything in
> English, with the deliberate wire-value exceptions — is in
> `app_ai_from_scratch/CLAUDE.md` under "Language", and that is the copy to
> edit if the policy changes.

Every identifier, filename, folder, comment and prompt in this repository is written in
**English**. The *product* is bilingual (ES/EN) and that lives in translation
dictionaries, never in code.

This file is the contract. It exists so that a rename done by several people in parallel
converges instead of colliding: the mapping is decided here once, then applied.

## Two things that stay Spanish, on purpose

**1. Public route paths.** `/leccion/7`, `/pago`, `/ranking`, `/ligas`.

These are the product's public URLs for a Spanish-language course. Renaming them is a
one-way door: existing links, bookmarks and any shared URL break, and search indexing
resets. That is a product decision with a real cost, not a code-style decision, so the
rename does not touch it. The Astro page *files* keep their route names for the same
reason — in Astro the filename **is** the URL.

If English routes are wanted later, the correct move is adding them as aliases with 301s
from the Spanish ones, not renaming in place.

**2. Model-facing strings.** Tool `descripcion` fields, the system prompt, and the
`nota` text inside tool results.

These are read by the model and shape what it says to a Spanish-speaking student. They are
content, and they are covered by `ai/src/.../render.py`, whose tests assert what may and
may not appear in a prompt. Translating them is a content change with a behavioural effect
and it does not belong in a mechanical rename.

## api — JavaScript to TypeScript

`tsgo` (`@typescript/native-preview`, the Go compiler) both checks **and emits** — verified:
`tsgo -p .` produced a runnable `dist/a.js`. So:

    build   tsgo -p .                                        -> dist/*.js
    dev     node --experimental-strip-types --watch src/server.ts
    check   tsgo --noEmit                                    (the existing baseline guard)

Node 22.13 reports `process.features.typescript === false`, so the dev path needs the
explicit flag. It works; it just is not on by default.

| now | becomes | note |
|---|---|---|
| `src/server.js` | `src/server.ts` | |
| `src/auth.js` | `src/auth.ts` | |
| `src/db.js` | `src/db.ts` | |
| `src/grade.js` | `src/grading.ts` | |
| `src/logros.js` | `src/achievements.ts` | |
| `src/ligas.js` | `src/leagues.ts` | |
| `src/producto.js` | `src/product.ts` | |
| `src/trabajos.js` | `src/jobs.ts` | the Postgres queue |
| `src/contenido.js` | `src/content.ts` | |
| `src/seed.js` | `src/seed.ts` | |
| `src/ia.js` | `src/ai-bridge.ts` | the Node to Python bridge |
| `src/ontology.js` | `src/ontology.ts` | already English |
| `src/ontologia.json` | `src/ontology.json` | generated — the exporter's target moves too |
| `src/agent-bus.js` | `src/agent-bus.ts` | |
| `src/agent-tools.js` | `src/tools/` | split, see below |
| `src/harness.js` | `src/legacy/harness.ts` | v2, superseded by the Python loop |
| `src/proveedores.js` | `src/legacy/providers.ts` | v2, superseded by Python providers |

### The tools split

`agent-tools.js` is 1100 lines and 37 tools in one object literal. It becomes a folder,
one file per family, because the families already exist in the code (`contenido`,
`propio`, `producto`, `coordinar`) and are what the tests group by:

    src/tools/index.ts        registry, dispatch, memo, the arg allowlist
    src/tools/access.ts       the paywall gate and the ontology guard wrappers
    src/tools/content.ts      7 tools
    src/tools/progress.ts     16 tools  (was the `propio` family)
    src/tools/product.ts      7 tools
    src/tools/coordination.ts 7 tools

`index.ts` keeps the current public surface — `catalogo`/`ejecutar`/`familias` become
`catalog`/`run`/`families` — so callers change one import line, not their logic.

### Spanish identifiers to English, api

    ejecutar -> run              catalogo -> catalog        familias -> families
    limpiar -> allowOnly         registrar -> log           usarRegistro -> setLogger
    llave -> cacheKey            leccionesAbiertas -> readableLessons
    cerradaPorCompra -> lockedByPaywall                     conAcceso -> hasAccess
    yo -> me                     idioma -> language         pendientes -> pending
    porLeccion -> perLesson      cerradas -> completed      diasActivos -> activeDays
    recorta -> truncate          salida -> output           entrada -> input
    herramienta -> tool          herramientas -> tools      sobran -> extra
    marcas -> markers            cacheado -> cached         vuelta -> turn
    encola -> enqueue            estadoCola -> queueState   obrero -> worker
    tomaLote -> takeBatch        espera -> backoff          caudal -> flow
    semanaActual -> currentWeek  reparteMetales -> assignMetals
    frenoChat -> chatBrake       golpeMinuto -> minuteBucket
    segundosAMedianoche -> secondsToMidnight
    resolveSession, currentUser, requireUser, requireRole   already English

## ai — package rename

The Python package is literally named `ia`. It becomes `course_ai`.

| now | becomes |
|---|---|
| `src/ia/` | `src/course_ai/` |
| `src/ia/ontologia/` | `src/course_ai/ontology/` |
| `src/ia/ontologia/datos.py` | `src/course_ai/ontology/data.py` |
| `src/ia/ontologia/grafo.py` | `src/course_ai/ontology/graph.py` |
| `src/ia/ontologia/exporta.py` | `src/course_ai/ontology/export.py` |
| `src/ia/ontologia/render.py` | `src/course_ai/ontology/render.py` |
| `src/ia/agente/` | `src/course_ai/agent/` |
| `src/ia/agente/bucle.py` | `src/course_ai/agent/loop.py` |
| `src/ia/agente/herramientas.py` | `src/course_ai/agent/bridge.py` |
| `src/ia/agente/proveedores.py` | `src/course_ai/agent/providers.py` |
| `src/ia/verifica.py` | `src/course_ai/verify.py` |
| `src/ia/app.py` | `src/course_ai/app.py` |

Console scripts: `ia-exporta` -> `ai-export`, `ia-prueba-aislamiento` -> `ai-prove-isolation`,
`ia-verifica` -> `ai-verify`, `ia-worker` -> `ai-worker`. Every caller must move with them:
`scripts/dev.mjs`, `ai/Dockerfile`, `docker-compose.yml`, `api/scripts/`.

### Spanish identifiers to English, ai

    Tabla -> Table               Columna -> Column          Herramienta -> Tool
    Clase -> Sensitivity         Alcance -> Scope           Muro -> Paywall
    TABLAS -> TABLES             HERRAMIENTAS -> TOOLS      GRAFO -> GRAPH
    columnas -> columns          proposito -> purpose        por_usuario -> per_user
    une -> joins_with            depende_de -> depends_on   usa -> reads
    devuelve -> returns          verifica_compra -> checks_entitlement
    alcance() -> reach()         camino() -> path()
    orden_topologico -> topological_order
    tablas_alcanzables -> reachable_tables
    vecindad_de_riesgo -> risk_neighbourhood
    prueba_aislamiento -> prove_isolation
    Violacion -> Violation       motivo -> rule             detalle -> detail
    camino -> path               bucle -> loop              correr -> run
    Puente -> Bridge             ejecutar -> call           vueltas -> max_turns
    Resultado -> Result          traza -> trace             salida -> output
    proveedores -> providers     prompt_sistema -> system_prompt
    render_para_modelo -> render_for_model
    huella -> fingerprint        catalogo -> catalog

`ARGS_PROHIBIDOS` -> `IDENTITY_ARGS`. The class values themselves — `publico`, `propio`,
`agregado`, `jamas`, `gratis`, `de_pago`, `sesion` — are DATA, and they are serialised into
`ontology.json` which Node reads. Renaming them is a coordinated change of a generated
artifact and its consumer; it happens in one commit or not at all.

## web — library files

Route files do not move (see above). `src/lib/` does.

| now | becomes |
|---|---|
| `campo.ts` | `field.ts` |
| `desbloqueo.ts` | `unlock.ts` |
| `gato.ts` | `cat.ts` |
| `insignias.ts` | `badges.ts` |
| `narrador.ts` | `narrator.ts` |
| `narrativa.ts` | `narrative.ts` |
| `sonido.ts` | `sound.ts` |

`chat-client.ts`, `labs-client.ts`, `flags.ts`, `fx.ts`, `i18n.ts`, `icons.ts`, `prefs.ts`,
`region.ts`, `roadmap.ts`, `seo.ts`, `session.ts`, `site.ts`, `theme-css.ts`,
`lang-anim.ts` keep their names.

## Rules for whoever applies this

1. **Use `git mv`.** A delete plus an add loses `--follow` history on a file with months
   of decisions in it.
2. **One module at a time, tests after each.** 209 api checks and 79 Python tests are the
   net. A rename that goes green on both is done; a rename that needs a test edited is a
   behaviour change wearing a rename's clothes — stop and say so.
3. **Do not translate a comment into a worse comment.** These files carry the reasoning
   for decisions that were arrived at expensively. If a sentence does not survive
   translation, rewrite it so it says the same thing, and keep the specifics: the numbers,
   the file references, the failure it prevents.
4. **`ontology.json` is generated.** Change the exporter's target path and the reader's
   path in the same change, or the API throws at import — by design.
