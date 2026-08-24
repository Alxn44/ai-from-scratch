# Runbook

The command for each thing you might ask for. If a task is not here, it is not
yet a routine task — and adding it here is part of doing it the second time.

Everything runs from the repository working directory
(`app_ai_from_scratch/`). The git root is one level up.

---

## Say this → I run this

### Start and stop

| You say | Command | What happens |
|---|---|---|
| "start it", "run it locally" | `pnpm dev` | Postgres + RabbitMQ in Docker, then ai, api and web local with hot reload. Fails loudly and says why. |
| "start it on another port" | `API_PORT=8791 pnpm dev` | Also `WEB_PORT`, `IA_PORT`. The web is told where the api landed, so they cannot disagree. |
| "run it all in Docker" | `pnpm docker` | Every service containerised, including the workers. Closer to production, no hot reload. |
| "stop it" | `pnpm stop` | Kills the Astro daemon (it survives a closed terminal) and brings the containers down. |
| "just the database" | `pnpm db` | Postgres alone, waits for its healthcheck. |

`pnpm dev` refuses to start if a port is held by a process from another project,
prints that process and offers two ways out. It will not kill what it does not
own — it used to, and that is how you lose a colleague's running service.

### Check that it works

| You say | Command | What it proves |
|---|---|---|
| "check everything", "is it green?" | `pnpm verify` | All 11 gates, one verdict. ~12s. |
| "quick check" | `pnpm verify:fast` | Everything that needs no database or server. Prints what it did **not** run. |
| "what are the gates?" | `pnpm verify:list` | The list, and which are slow. |
| "run the tests" | `pnpm test` | The eight api suites. |
| "test the Python side" | `pnpm test:py` | pytest. |
| "prove the isolation" | `pnpm prove` | P1..P4 over the bridged tools, P5 over the native ones. |
| "how good is the search we are beating?" | `uv --directory ai run python tests/baseline.py` | Runs `scripts/emit-search-baseline.mjs`, which CALLS `buscar_en_curso` over the corpus `api/src/seed.ts` defines, and prints what it scores over the 138 fixture questions (70/138 = 51%). It is generated on every `pytest` run and never stored: the version of this column that was typed by hand was wrong on 53 of 138 entries. |
| "check the routing map" | `pnpm concepts` | The concept map in `ai/src/course_ai/retrieval/concepts.py` vs the lesson index Node serves. Fails on a concept pointing at a lesson that does not exist, a lesson no concept covers, an invented glossary term, a term pinned to the wrong lesson, one phrasing routed to two lessons, one slug pointing at two lessons, or a concept nothing can route to. If it cannot read the index it FAILS — it never skips. |
| "check the types" | `pnpm check:types` | tsgo against the pinned baseline (currently 0). |
| "check the lesson animations" | `pnpm check:scenes` | Every lesson has exactly one scene and no scene file is orphaned. Type checking cannot catch this: a lesson with no animation falls back to the static rows and nothing errors. |

`pnpm verify` reads every exit code directly. It never pipes a command into
`tail`, because `tail`'s status is not the command's — that mistake has already
produced one confident, wrong "exit 0" in this repository.

**A gate that cannot run counts as failed, not skipped.** The one exception is a
service that does not exist yet, reported as ABSENT on its own line so it can
never be mistaken for a pass.

### The ontology

| You say | Command | Notes |
|---|---|---|
| "regenerate the ontology" | `pnpm ontology:export` | Rewrites `api/src/ontologia.json` from `ai/src/course_ai/ontology/data.py`. Refuses to write if the proof fails or the catalogue drifted. |
| "update the ontology doc" | `pnpm ontology` | Rewrites `ONTOLOGY.md`. Every number in it is counted at render time, never typed. |
| "check for drift" | `pnpm check:ontology` | Artefact vs `schema.prisma`. Catches a column with no declared class — the direction that silently weakens the guard. |
| "what tools exist?" | `pnpm check:catalog` | Reads the registry by importing it. 37 tools, 7 paywalled. |

To change the ontology, edit `data.py` — never the artefact, never `ONTOLOGY.md`.
Then `pnpm ontology:export && pnpm ontology` and commit all three.

### Database

| You say | Command | Notes |
|---|---|---|
| "apply migrations" | `pnpm db:deploy` | Prisma owns the schema; the server never creates it. |
| "new migration" | `pnpm db:migrate` | Prisma cannot express CHECK constraints — re-add them by hand in the migration SQL. |
| "check schema drift" | `pnpm db:drift` | Migrations vs `schema.prisma`. Needs a shadow database. |
| "open a shell on the db" | `pnpm db:psql` | |
| "reseed" | `pnpm seed` | Demo accounts only with `SEED_DEMO_USERS=1` and `SEED_DEMO_PASSWORD` set. |
| "wipe and start over" | `pnpm reset` | **Destructive**: drops the volume, re-migrates, reseeds. |

### Secrets

| You say | Command |
|---|---|
| "generate the keys" | `pnpm keys` |
| "is any account using a leaked password?" | `pnpm audit:passwords` |

`pnpm audit:passwords` tries every password this repository has ever published
against every live account, using the same `verifyPassword` the login path uses,
and exits 1 on a match. **Run it against any database you deploy.** It reports
which account matched and never prints a password or a hash. On the local
development database it currently reports three matches, including the `admin` —
that is expected there and unacceptable anywhere else. It is not in `pnpm verify`
because scrypt is deliberately slow and this takes seconds per account.

Writes `api/.env`, `web/.env`, `ai/.env` and the compose `.env`. Model API keys
are pasted by hand. No secret has a working default anywhere: `JWT_SECRET`
refuses known placeholders and anything under 32 characters, and `DATABASE_URL`
has no default outside development.

---

## Deploying

### Normal: pull request into main

1. Branch, commit, open a PR into `main`.
2. `.github/workflows/ci.yml` runs on the PR: api and web, Python, queue, and an
   image build of everything.
3. Merge. `.github/workflows/deploy.yml` **calls the same ci.yml** — not a copy
   of it — then publishes images to GHCR tagged with the commit sha.
4. `release` (in `.github/workflows/release.yml`, called by both pipelines so
   there is exactly one deploy script) SSHes to the host, writes a `.env`, pulls
   the images and runs `docker compose up -d --no-build --wait`.

The host never builds. `--no-build` is load-bearing: with both `build` and
`image` set, compose silently builds a missing image, and a box compiling from
source is running a different artefact than the one CI approved.

Deploy the sha tag, never `latest`. During an incident the first question is
"which commit is live", and `latest` cannot answer it. `docker-compose.prod.yml`
refuses to interpolate without a `TAG`, so this is enforced rather than asked for.

### Turning the deploy on

It **fails on purpose** until configured — a release job that exits 0 without
releasing is the worst available outcome, because main goes green while the
running version silently stops matching the repository.

1. Repository **variable** `DEPLOY_TARGET` — any name for the host. Its presence
   is the on switch.
2. Environment secrets on the `production` Environment:

   | Secret | What it is |
   |---|---|
   | `DEPLOY_HOST` `DEPLOY_USER` `DEPLOY_SSH_KEY` | SSH access. `DEPLOY_PORT` optional, defaults to 22. |
   | `DEPLOY_PATH` | Directory on the host holding the compose files and `.env`. |
   | `WEB_ORIGIN` | The real public origin. The dev value is `http://localhost:4321`, and a cookie scoped to localhost never arrives — every request would look unauthenticated. |
   | `POSTGRES_PASSWORD` `RABBITMQ_PASSWORD` `JWT_SECRET` `IA_SECRETO` | Same secrets compose already demands. Generate with `pnpm keys`. |
   | `MP_ACCESS_TOKEN` `MP_WEBHOOK_SECRET` `MP_PUBLIC_KEY` | Optional. Without them checkout answers 501 rather than faking a payment. |

   All of them are checked before the first SSH, and named one at a time in the
   log, so a missing secret cannot leave the host half-restarted.

3. The host needs Docker, Compose, and `DEPLOY_PATH` to exist. Nothing else — the
   compose files are copied with each deploy, so the host's copy always matches
   the images being started.

**Rollback is automatic.** The deploy records the live tag in
`$DEPLOY_PATH/.deployed-tag` before touching anything. If the new tag does not
pass its healthchecks within 180s, it prints `compose ps` and the last 80 log
lines from api, ia and web, then re-deploys the previous tag. On a *first* deploy
with no recorded tag it stops and leaves the stack alone rather than tearing it
down, because that would turn a failed deploy into an outage with no way back.

To roll back by hand, on the host:

```bash
cd "$DEPLOY_PATH"
sed -i 's/^TAG=.*/TAG=<the good sha>/' .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-build --wait
```

### Hotfix: production is broken now

```bash
git checkout -b hotfix/<short-name>
# fix, commit, push
```

Pushing to `hotfix/**` runs `.github/workflows/hotfix.yml`, which:

- runs the gates a hotfix is **never** allowed to skip — the isolation proof, the
  ontology drift check, the tool catalogue, the Python suite, the type baseline
  and all eight api suites;
- skips only genuinely slow things: the full image matrix, `go test -race`, the
  web type check, the artefact-freshness regenerate;
- publishes images tagged `hotfix-<sha>`, never `latest`, because the code is not
  on a reviewed branch yet;
- **opens the back-merge PR into main itself.** A hotfix branch that never
  returns to main gets reverted by the next ordinary release, and then the same
  outage happens a second time.

Speed comes from dropping checks that are slow, never from dropping checks that
are safe. A hotfix is exactly when someone edits a query under time pressure,
which is exactly when the isolation proof earns its keep.

---

## The services

| Directory | What it is | Its own tools |
|---|---|---|
| `api/` | Node + TypeScript (tsgo). HTTP, sessions, the 37 agent tools, the Postgres job queue. | `scripts/types.mjs` (the pinned type baseline), `scripts/audit-passwords.mjs`, `scripts/close-leagues.mjs`, `scripts/league-demo.mjs` |
| `ai/` | Python + FastAPI. The agent loop, the providers, and the ontology — the source of truth. | `ai-export` (the artefact), `ai-doc` (`ONTOLOGY.md`), `ai-verify`, `ai-prove-isolation`, `ai-check-concepts`, `ai-worker` |
| `web/` | Astro. The lessons, labs, chat, and the 12 animated lesson scenes. | `scripts/scenes-check.mjs`, `scripts/i18n-check.mjs` |
| `queue/` | Go + Fiber. Owns the RabbitMQ topology between services. | `cmd/queue-topology`, `cmd/queue-verify`, plus `scripts/` and `tools/` |
| `scripts/` | Everything spanning more than one service. | `dev.mjs`, `verify.mjs`, `keys.sh`, `check-ontology-drift.mjs`, `emit-tool-catalog.mjs`, `emit-lesson-index.mjs` |

Each service carries its own tooling rather than everything living in one shared
bin directory, so a tool moves with the thing it inspects. Only the genuinely
cross-service ones sit in the top-level `scripts/`: the launcher, the gate
runner, key generation, and the two checks whose whole job is comparing one
service against another.

**Two queues, on purpose.** Postgres carries work *inside* one service
(`SKIP LOCKED`, capped backoff, dead jobs kept rather than dropped). RabbitMQ
carries work *between* services. One queue for both jobs would either put a
broker in the request path or make cross-service delivery depend on a table
nobody else can see.

---

## House rules these scripts encode

Each of these exists because its absence caused a real failure here.

1. **Fail closed.** A guard that approves what it never inspected is worse than
   no guard, because the review passes. `forbiddenColumns` throws for an
   undeclared table rather than returning `[]`; `ai-export` refuses to write when
   the catalogue drifted; the emitter refuses to emit a catalogue missing the
   paywall flag.
2. **Read exit codes directly.** Never through a pipe.
3. **Never skip silently.** The bridge suite once printed "skipped: no server"
   and exited 0. CI now starts a real server and fails if it never answers.
4. **Generate from the source of truth, never from a copy of it.** The tool
   catalogue is read by importing the registry, not by regex over its source —
   that reader broke twice. `ONTOLOGY.md` is rendered from `data.py`, not from a
   second hand-written copy of the table prose.
5. **Don't touch what isn't yours.** `pnpm dev` identifies a process by its
   working directory before killing it.
