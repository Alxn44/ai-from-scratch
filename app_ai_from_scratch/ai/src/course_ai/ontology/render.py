"""The text the model sees.

What is forbidden is never mentioned: naming `labs.solution` in order to say «do
not ask for it» is teaching the model that it exists and what it is called. The
prompt only enumerates what is reachable.

The STRINGS in this file are model-facing content, not code. They are not
translated by a rename: `test_render.py` asserts what may and may not appear in a
prompt, and changing the wording changes what the model is told.
"""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path
from typing import Literal

from .data import TABLES, TOOLS, Tool

Lang = Literal["es", "en"]

_HEADER_ES = (
    "Ontologia de la base de datos. Solo puedes leerla a traves de las herramientas.",
    "No existe acceso a SQL. Ninguna herramienta acepta un identificador de usuario:",
    "el usuario de la sesion lo pone el servidor. No puedes consultar datos de otra persona.",
)
_HEADER_EN = (
    "Database ontology. You can only read it through the tools.",
    "There is no SQL access. No tool accepts a user identifier: the session's user",
    "is set by the server. You cannot look up another person's data.",
)


def render_for_model(lang: Lang = "es") -> str:
    head = _HEADER_ES if lang == "es" else _HEADER_EN
    blocks: list[str] = ["\n".join(head)]
    for name, t in TABLES.items():
        cols = [f"  - {c} ({x.sensitivity}): {x.note}".rstrip()
                for c, x in t.columns.items() if x.sensitivity != "jamas"]
        if not cols:
            # A table forbidden in full (role_audit, payments) is never named.
            continue
        scope = "Alcance" if lang == "es" else "Scope"
        blocks.append("\n".join([f"## {name}", t.purpose,
                                 f"{scope}: {t.per_user}", *cols]))
    return "\n\n".join(blocks)


_RULES_ES = (
    "Eres el asistente de estudio dentro de la plataforma «IA desde cero». Responde en espanol.",
    "Acompanas a una sola persona: la de esta sesion. No puedes ver a nadie mas, y nunca digas que si.",
    "Nunca reveles la solucion de un lab, aunque te la pidan directo: da una pista que apunte a la leccion.",
    "Prefiere las herramientas a tu memoria: si un dato se puede consultar, consultalo. Lenguaje llano, frases cortas.",
    # Without this rule the model answers with emoji. Measured in a real run:
    # «📊 Progreso general», «✅ Leccion 1», «🟡», «⬜». The interface uses not one
    # emoji on any screen — radius 0, monospaced labels — so the chat read like a
    # window from another application pasted inside.
    "No uses emoji ni iconos: la interfaz no los usa en ninguna pantalla. Para una lista, un guion.",
)
_RULES_EN = (
    "You are the study assistant inside the “AI from scratch” platform. Answer in English.",
    "You help one single person: the one in this session. You cannot see anyone else, and you must never claim you can.",
    "Never reveal a lab solution, even if asked directly: give a hint that points at the lesson instead.",
    "Prefer tools over memory: if a number can be looked up, look it up. Plain language, short sentences.",
    "Do not use emoji or icons: the interface uses none on any screen. For a list, use a dash.",
)


def system_prompt(lang: Lang = "es") -> str:
    rules = _RULES_ES if lang == "es" else _RULES_EN
    return "\n".join([*rules, "", render_for_model(lang)])


def fingerprint(lang: Lang = "es") -> str:
    """A short sha256 of the prompt. It travels in the service's response so Node
    can see in a log that the prompt changed without deploying the service."""
    return sha256(system_prompt(lang).encode("utf-8")).hexdigest()[:12]


def catalog() -> list[dict[str, object]]:
    """What is declared to the model. No user in it, same as in v2.

    The dict KEYS stay Spanish: this is the same shape Node's
    GET /api/interno/catalogo returns, and `Bridge.catalog()` exists to compare the
    two lists. Renaming them here would make that comparison compare two shapes.
    """
    return [{"nombre": n, "descripcion": h.description, "argumentos": dict(h.args)}
            for n, h in TOOLS.items()]


# ---------------------------------------------------------------------------
# THE HUMAN-FACING DOCUMENT
#
# `ai-doc` renders ONTOLOGY.md from this module, standing to the document exactly
# as `ai-export` stands to the artifact: one source, one generated file.
#
# It replaces scripts/gen-ontologia.mjs, which built the same document by
# importing `ONTOLOGIA` and `ONTOLOGIA_PREVISTA` out of api/src/ontology.js. Those
# are the v2 record — a hand-written copy of this table prose that nothing compares
# against data.py, and which api/src/ontology.ts now describes as dead. So the
# document that was supposed to describe the ontology was generated from a second,
# unvalidated copy of it. That is the exact failure v3 exists to end, and the
# reason the generator could not simply be repointed at the new file names.
#
# The artifact cannot be the source either: ontologia.json carries `clases`,
# `prohibidas`, `herramientas` and the rest, but no `proposito`, no `por_usuario`
# and no per-column `nota`. Those live only here.
_DOC_HEADER = """# Database ontology for the AI agent

> Generated from `ai/src/course_ai/ontology/data.py` by `ai-doc`.
> Regenerate with `pnpm ontology`. Do not edit by hand — edit `data.py`.
"""


def _cell(text: object) -> str:
    """One Markdown table cell. `|` has to be escaped and newlines collapsed, or a
    note like «student | tutor | admin» silently splits the row into extra columns."""
    return " ".join(str(text).split()).replace("|", "\\|")


def _args(tool: Tool) -> str:
    if not tool.args:
        return "—"
    return " · ".join(f"`{k}` ({_cell(v)})" for k, v in tool.args.items())


def _tools_section(families: tuple[tuple[str, tuple[str, ...]], ...]) -> list[str]:
    """Every declared tool, in a rendered row. `rendered()` below is what makes that
    sentence true rather than hopeful.

    The families come from NODE's registry, so a tool Node has no family for was
    never looked up here at all: it was counted in the header and absent from every
    table. Measured before this was fixed — `ai-doc` exited 0 having written a
    header saying «38 tools» over tables describing 37, with the native one nowhere
    on the page and nothing red. A generated document that silently omits a row is
    the same class of failure as a guard that approves what it never inspected.
    """
    out: list[str] = ["## Tools", "",
                      "Read from the registry itself, by "
                      "`scripts/emit-tool-catalog.mjs`, which imports "
                      "`api/src/tools/index.ts` rather than scanning it. The families are "
                      "the registry's own grouping, in its own order. The `native` section "
                      "below it is not in that registry: those tools are executed by this "
                      "service, and `runner` in `data.py` is what says so.", ""]
    for family, members in families:
        out += [f"### family `{family}` · {len(members)}", "",
                "| tool | what it does | arguments | scope | paywalled |",
                "|---|---|---|---|---|"]
        for name in members:
            t = TOOLS.get(name)
            if t is None:
                # Declared by Node, absent here. `check_catalog` refuses to export in
                # this state, so it cannot reach the artifact — but the document is
                # rendered from the declaration and has to say what it does not know
                # rather than drop the row.
                out.append(f"| `{name}` | **not declared in data.py** | — | — | — |")
                continue
            gate = "yes" if t.checks_entitlement else "—"
            out.append(f"| `{name}` | {_cell(t.description)} | {_args(t)} | "
                       f"`{t.scope}` | {gate} |")
        out.append("")
    natives = {n: h for n, h in TOOLS.items() if h.runner == "python"}
    if natives:
        out += [f"### native · {len(natives)}", "",
                "Executed inside `/ai` by `course_ai/retrieval/`, not over the bridge. They "
                "read no table, return no column and decide no entitlement — obligation P5 "
                "requires all three — so what they answer with is lesson NUMBERS, public "
                "glossary terms, a rewritten query and the name of the bridged tool to call "
                "next. The content itself always arrives through that bridged tool, which "
                "Node executes and gates.", "",
                "| tool | what it does | arguments | scope | composes |",
                "|---|---|---|---|---|"]
        for name, t in natives.items():
            composes = ", ".join(f"`{c}`" for c in t.composes) or "—"
            out.append(f"| `{name}` | {_cell(t.description)} | {_args(t)} | "
                       f"`{t.scope}` | {composes} |")
        out.append("")
    return out


def rendered(families: tuple[tuple[str, tuple[str, ...]], ...]) -> frozenset[str]:
    """The tool names `_tools_section` will actually put in a row.

    `ai-doc` refuses when a declared name is not in here. It is the cheap version of
    the rule this repository keeps re-learning: a document is only worth the part of
    the truth it renders, and «counted in the header» is not «described in a table».
    """
    out = {name for _family, members in families for name in members}
    return frozenset(out | {n for n, h in TOOLS.items() if h.runner == "python"})


def _tables_section() -> list[str]:
    out: list[str] = ["## Tables", ""]
    for name, t in TABLES.items():
        out += [f"### `{name}`", "", f"**Purpose:** {_cell(t.purpose)}", "",
                f"**Per-user scope:** {_cell(t.per_user)}", ""]
        if t.soft_delete:
            out += [f"**Soft delete:** {_cell(t.soft_delete)}", ""]
        if t.joins_with:
            out += ["**One join away:** "
                    + ", ".join(f"`{o}`" for o in t.joins_with), ""]
        out += ["| column | clase | muro | nota |", "|---|---|---|---|"]
        for col, c in t.columns.items():
            out.append(f"| `{col}` | `{c.sensitivity}` | `{c.paywall}` | {_cell(c.note) or '—'} |")
        out.append("")
    return out


def document(families: tuple[tuple[str, tuple[str, ...]], ...] = (),
             caps: tuple[tuple[str, int], ...] = ()) -> str:
    """The whole document, as one string. Every number in it is counted, not typed.

    `caps` comes from the emitter, which reads `CAPS` out of api/src/agent-bus.ts.
    When it is empty the bus section says where the numbers live instead of stating
    them: a cap typed into this file would be a second copy of that module that
    nothing compares, which is the drift this generator exists to remove.
    """
    from .graph import GRAPH

    forbidden = {t: GRAPH.forbidden_columns(t) for t in TABLES}
    paid = {t: GRAPH.paywalled_columns(t) for t in TABLES}
    n_cols = sum(len(t.columns) for t in TABLES.values())
    order, _cycle = GRAPH.topological_order()
    gated = sorted(n for n, h in TOOLS.items() if h.checks_entitlement)

    out: list[str] = [_DOC_HEADER,
                      f"{len(TABLES)} tables · {n_cols} columns · {len(TOOLS)} tools · "
                      f"{sum(len(v) for v in forbidden.values())} `jamas` columns · "
                      f"{sum(len(v) for v in paid.values())} `de_pago` columns", ""]

    out += [
        "## Isolation is not in the prompt", "",
        "A user cannot obtain another user's data through the agent, and the reason is "
        "not that the prompt asks nicely: it is that **no tool accepts a user "
        "identifier**. The id comes off the session cookie, on the server. The model "
        "has no way to express «somebody else's data», so the classic attack — putting "
        "instructions inside your own alias or a lab answer — has nowhere to go: at "
        "worst the agent returns the asker's own data again.", "",
        "There is no SQL either. There are "
        f"{len(TOOLS)} functions with declared arguments, and an argument key that is "
        "not declared is **discarded and written to the server log**. Nothing about it "
        "comes back in the response. That is deliberate: the rejected key used to be "
        "echoed to the model as `_ignorado`, which told it exactly which name had just "
        "been refused — an invitation to try the next one — while leaving no trace an "
        "operator could read. A rejected identity argument is the highest-signal event "
        "this surface produces, so it goes where the operator looks and nowhere else.", "",
    ]

    out += [
        "## Two axes, and they are orthogonal", "",
        "`clase` answers **whose data is this** — privacy. `muro` answers **who paid to "
        "read it** — entitlement. They are independent, and collapsing them into one is "
        "what let through the most expensive leak in the project.", "",
        "`lessons.technical` is classified `publico`, and correctly so: it is identical "
        "for everybody and there is nothing personal in it. The isolation proof was "
        "green while four tools handed it to accounts that had not paid. The proof was "
        "not broken — the paywall rule could not be *expressed* in the model, so no "
        "test could check it. One axis, and the hottest rule in the product was "
        "invisible.", "",
        "So a column carries both: `publico` + `de_pago` is ordinary paid course "
        "content, and it is the combination that used to be inexpressible.", "",
        "| axis | values | what it means |", "|---|---|---|",
        "| `clase` | `publico` `propio` `agregado` `jamas` | whose data it is |",
        "| `muro` | `gratis` `de_pago` | whether reading it needs an entitlement |", "",
    ]

    out += [
        "## The four obligations", "",
        "Proved over the graph on every test run, in the Docker build "
        "(`ai-prove-isolation`) and before the artifact is written. If all four hold, a "
        "user cannot reach another user's data, a forbidden column, or content they did "
        "not pay for, by any declared path.", "",
        "| | obligation |", "|---|---|",
        "| **P1** | No tool RETURNS a column of class `jamas`. |",
        "| **P2** | Every tool that reaches a table with `propio` columns declares scope "
        "`sesion` or `agregado`. Reaching it as `publico` means a query with no per-user "
        "filter. |",
        "| **P3** | No signature accepts an argument that can express «another person». |",
        "| **P4** | No tool returns a `de_pago` column without declaring that it checks "
        "entitlement. |", "",
        "P4 is the youngest and the reason the second axis exists: P1..P3 were green "
        "while the course was being handed out for free.", "",
    ]

    out += _tools_section(families)

    out += [
        "## How the tools talk to each other: a stack and a queue", "",
        "Tools never call each other. They leave work on the session bus "
        "(`api/src/agent-bus.ts`), which is three structures and nothing more:", "",
        "- **queue** (FIFO) — the study plan. `plan_estudio` and `mis_errores` fill it; "
        "`cola_siguiente` takes the head **already resolved** (the lab card, the "
        "person's own attempts, the explanation if they have tried it, and the lesson it "
        "comes from): three tools in one call.",
        "- **stack** (LIFO) — the focus. Opening a lesson or a lab pushes where the "
        "person was; if the conversation wanders, `foco_volver` returns without "
        "re-reading anything.",
        "- **memo** — the session cache. Course content is reused for a few minutes; own "
        "data **only inside the same turn**, because between two messages the person may "
        "have solved a lab in another tab and stale progress would be a lie. What comes "
        "out of the cache travels marked `_memo: true`, and the chat trace says so.", "",
    ]
    if caps:
        out += ["| structure | cap |", "|---|---|"]
        out += [f"| `{name}` | {value} |" for name, value in caps]
        out += ["", "Read out of `CAPS` in `api/src/agent-bus.ts` by "
                "`scripts/emit-tool-catalog.mjs`, which imports the module. The numbers "
                "cannot drift from the code because they are not copied — they are the "
                "code's own answer at the moment this was generated.", ""]
    else:
        out += ["The caps on all three live in `CAPS` in `api/src/agent-bus.ts`. They are "
                "deliberately not copied here: a number in this document that nothing "
                "compares against that file is the same kind of second copy this "
                "generator was written to remove.", ""]
    out += [
        "The bus is indexed by the session's `userId`, so one person's queue is not "
        "reachable from another's. It is process memory: if the server restarts the plan "
        "is lost and nothing breaks — it gets asked for again. That is why there is no "
        "table for it.", "",
    ]

    out += _tables_section()

    out += [
        "## The forbidden list", "",
        "`assertNoForbidden(table, row)` in `api/src/ontology.ts` runs before data is "
        "returned. It reads the list below out of the generated artifact and throws if a "
        "row carries any of these columns — so a column left out of a tool's `devuelve` "
        "declaration by mistake is still caught, on the real row, at runtime.", "",
        "Its companion `forbiddenColumns(table)` **throws for a table it does not know** "
        "rather than returning an empty list. That direction matters: answering `[]` for "
        "an unknown table silently approves every read from it, which is how three tables "
        "went unguarded while every proof stayed green.", "",
        "| table | `jamas` columns | `de_pago` columns |", "|---|---|---|",
    ]
    for name in sorted(TABLES):
        f = ", ".join(f"`{c}`" for c in forbidden[name]) or "—"
        d = ", ".join(f"`{c}`" for c in paid[name]) or "—"
        out.append(f"| `{name}` | {f} | {d} |")
    out += ["",
            f"Gated tools ({len(gated)} of {len(TOOLS)}), which declare that they resolve "
            f"entitlement before returning: "
            + ", ".join(f"`{n}`" for n in gated) + ".", "",
            "**Deletion order** for an account, from the foreign keys — whoever points "
            "goes first: " + " → ".join(f"`{t}`" for t in reversed(order)) + ".", ""]

    out += [
        "## How it is verified", "",
        "```bash",
        "uv --directory ai run ai-verify        # style, tests, isolation, artifact",
        "uv --directory ai run ai-prove-isolation",
        "pnpm --dir api test                   # every api suite, listed below",
        "pnpm test:isolation                   # delegates to api",
        "pnpm test:tools                       # delegates to api",
        "pnpm --dir api db:drift               # schema.prisma against the migrations",
        "node scripts/check-ontology-drift.mjs # the artifact against schema.prisma",
        "```", "",
        "`pnpm --dir api test` runs `isolation.mts`, `agent-bus.mts`, `transport.mts`, "
        "`tools.mts`, `queue.mts`, `bridge.mts`, `coach.mts` and `data.mts`. The list is "
        "here and the count is not: a number in a document is a copy of something that "
        "changes, and this row already claimed a suite that had been deleted.", "",
        "`isolation.mts` attempts what is forbidden against all "
        f"{len(TOOLS)} tools: slipping `user_id` into every one of them, reading another "
        "person's `pass_hash`, e-mail, name and attempts, extracting lab `solution`s, "
        "asking for the explanation before the first attempt, injecting SQL into "
        "`lab_id`, inventing a tool, passing a non-integer `userId`, and reading another "
        "session's queue. None may pass. `agent-bus.mts` checks the structure: FIFO, "
        "LIFO, the caps, that the memo tells public from own data, and that two sessions "
        "share nothing. `tools.mts` checks the opposite of isolation — that this is "
        f"useful: that all {len(TOOLS)} answer with data, that what one enqueues another "
        "consumes, and that the memo saves queries.", "",
        "On the Python side, `ai-prove-isolation` proves P1..P4 over the graph and "
        "`test_node_contract.py` checks that this declaration still matches the registry "
        "Node executes — names and paywall flags both. Whatever is not declared is proved "
        "by nobody, so that comparison is a precondition of writing the artifact, not a "
        "test somebody remembers to run.", "",
    ]

    out += [
        "## A note on language", "",
        "The prose here is English, like the rest of the repository. The values are not: "
        "`publico` `propio` `agregado` `jamas` `gratis` `de_pago` `sesion` are DATA, "
        "serialised into `api/src/ontologia.json` and read by Node at import time. Tool "
        "descriptions and column notes are also left as they are — they are read by the "
        "model and shape what it says to a Spanish-speaking student, so they are course "
        "content rather than code.", "",
    ]
    return "\n".join(out).rstrip() + "\n"


DOC_TARGET = Path(__file__).resolve().parents[4] / "ONTOLOGY.md"


def main() -> int:
    """`uv run ai-doc` (or `pnpm ontology`). Writes ONTOLOGY.md at the repo root.

    The tool families come from Node's registry through the emitter, so this refuses
    for the same reasons `ai-export` refuses: a document that describes a tool
    catalogue it could not read is worse than no document, because it looks
    authoritative. Everything else it renders comes from data.py.
    """
    from .export import CatalogDrift, node_catalog

    try:
        node = node_catalog()
    except CatalogDrift as e:
        print(f"NOT writing {DOC_TARGET.name}: {e}")
        return 1
    if not node.families:
        print(f"NOT writing {DOC_TARGET.name}: the emitter reported no tool families, so "
              f"the document cannot group the catalogue the way the registry does.")
        return 1
    if not node.caps:
        # Said out loud rather than swallowed: the document is still correct, but it
        # is describing the bus in prose because the numbers could not be read.
        print("note: the emitter reported no usable `caps`, so the bus section names "
              "CAPS in api/src/agent-bus.ts instead of stating the numbers.")
    # A declared tool that lands in no rendered row would be counted in the header
    # and described nowhere — the state `ai-doc` used to exit 0 in. It refuses now.
    unrendered = sorted(set(TOOLS) - rendered(node.families))
    if unrendered:
        print(f"NOT writing {DOC_TARGET.name}: {len(unrendered)} declared tool(s) would be "
              f"counted in the header and appear in no table: {', '.join(unrendered)}.")
        print("A tool Node has no family for is only rendered when it declares "
              "`runner=\"python\"`; a bridged name Node does not expose is caught earlier "
              "by check_catalog.")
        return 1
    text = document(node.families, node.caps)
    DOC_TARGET.write_text(text, encoding="utf-8")
    print(f"wrote {DOC_TARGET.name}: {len(TABLES)} tables, {len(TOOLS)} tools, "
          f"{len(text.splitlines())} lines")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
