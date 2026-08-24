"""The contract between what Python DECLARES and what Node EXECUTES.

This is the test that was missing. The isolation proof in graph.py runs its four
obligations over the tools declared in data.py, so its verdict is worth exactly
as much as that list. For a long time the list held seven tools while
api/src/tools/ implemented and executed thirty-seven, and the proof printed
«P1..P4 se cumplen» — a statement about 19% of the surface, phrased as a
guarantee about all of it.

Nothing caught it because nothing compared the two catalogs. That comparison is
what lives here, plus the check that makes the comparison worth running: every
`returns` entry has to name a table and a column that actually exist, because a
misspelt column is checked by P1 as `columna_desconocida` and a column pointing
at the wrong table is not checked at all.

HOW THE COMPARISON READS NODE, and why the fixtures look like this.

It used to regex-scan the TypeScript. That broke twice — on `HERRAMIENTAS` ->
`TOOLS` and on the split into four family files — because the contract was source
formatting. Now `scripts/emit-tool-catalog.mjs` imports the registry and prints
JSON, and export.py runs it as a subprocess. So the fakes below are fake
*emitters*: a `python -c` that prints a chosen payload and exits with a chosen
code. That keeps every fail-closed path testable without stubbing Node, while the
tests that assert today's truth run the real emitter.

Running the real emitter means these tests need Node on PATH. That is deliberate:
if Node cannot be reached, the catalogue genuinely cannot be verified, and a
skipped check is the dark guard this file exists to prevent.
"""

from __future__ import annotations

import dataclasses
import json
import sys

import pytest

from course_ai.ontology.data import BRIDGED, NATIVE, TABLES, TOOLS, Tool
from course_ai.ontology.export import (
    CatalogDrift,
    check_catalog,
    drift,
    node_catalog,
)


# --------------------------------------------------------------- fake emitters
def _emitter(*, stdout: str = "", exit_code: int = 0, stderr: str = "") -> tuple[str, ...]:
    """A stand-in for scripts/emit-tool-catalog.mjs with a scripted answer."""
    prog = (
        "import sys\n"
        f"sys.stdout.write({stdout!r})\n"
        f"sys.stderr.write({stderr!r})\n"
        f"sys.exit({exit_code})\n"
    )
    return (sys.executable, "-c", prog)


def _doc(names, paywalled=(), **override) -> str:
    """A well-formed emitter payload, before a test breaks one field of it."""
    gated = set(paywalled)
    doc = {
        "source": "api/src/tools/index.ts",
        "count": len(list(names)),
        "paywalled": sorted(gated),
        "families": None,
        "tools": [{"name": n, "family": "x", "paywalled": n in gated} for n in names],
    }
    doc.update(override)
    return json.dumps(doc)


def _check_with(export_mod, graph) -> tuple[str, ...]:
    """check_catalog() over an injected declaration, with a fake emitter that reports
    exactly what Node exposes TODAY. So the only possible source of a problem is what
    the test declared on the Python side."""
    import unittest.mock

    with unittest.mock.patch.object(export_mod, "GRAPH", graph):
        return export_mod.check_catalog(_emitter(stdout=_doc(BRIDGED, _real_gated())))


def _real_gated() -> set[str]:
    """The gated set as declared — over BRIDGED, because it is compared against the
    registry's `paywalled` field and a native can never be in it (P5 forbids
    `checks_entitlement` on a native: Node is the only entitlement authority)."""
    return {n for n, h in BRIDGED.items() if h.checks_entitlement}


# ------------------------------------------------------------------ the contract
def test_as_many_are_declared_as_node_executes():
    """The left operand is BRIDGED, not TOOLS, and that is not a weakening: BRIDGED is
    exactly the population whose declaration SAYS Node executes it. Comparing the
    whole of TOOLS once natives exist would have forced the check to tolerate names
    Node does not have — the subset check that kills the other arm."""
    exposed = node_catalog().names
    assert len(BRIDGED) == len(exposed), (
        f"declared as bridged {len(BRIDGED)}, Node executes {len(exposed)}. "
        f"What is not declared is proved by nobody.")


def test_the_two_catalogs_hold_the_same_names():
    extra, missing = drift(BRIDGED, node_catalog().names)
    assert not missing, f"Node executes them and they are not declared here: {', '.join(missing)}"
    assert not extra, f"declared here and Node does not expose them: {', '.join(extra)}"


def test_the_order_does_not_matter_but_the_set_does():
    """The names are compared as a set on purpose: the order of Node's registry is
    for human reading (grouped by family) and does not have to match."""
    assert set(BRIDGED) == set(node_catalog().names)


def test_drift_is_reported_in_BOTH_directions():
    """An undeclared tool is an unproved leak; a declared one that does not exist is
    a false promise in the prompt. Both have to hurt."""
    extra, missing = drift({"a", "b"}, {"b", "c"})
    assert extra == ("a",)
    assert missing == ("c",)


def test_check_catalog_is_clean_today():
    assert check_catalog() == ()


# ---- the check has to be able to fail, or it is not checking anything ----
def test_catches_a_tool_node_exposes_and_nobody_declares_here():
    """The original hole, reproduced: Node executes one nobody declared."""
    cmd = _emitter(stdout=_doc([*BRIDGED, "herramienta_nueva"], _real_gated()))
    problems = check_catalog(cmd)
    assert problems, "the drift went unnoticed"
    assert any("herramienta_nueva" in p for p in problems)
    assert any("NOT declared here" in p for p in problems)


def test_catches_a_declared_tool_node_does_not_expose():
    names = [n for n in BRIDGED if n != "cola_siguiente"]
    cmd = _emitter(stdout=_doc(names, _real_gated() - {"cola_siguiente"}))
    problems = check_catalog(cmd)
    assert any("cola_siguiente" in p for p in problems)
    assert any("does NOT expose" in p for p in problems)


@pytest.mark.parametrize("label,cmd", [
    ("non-zero exit", _emitter(stdout=_doc(["curso_indice"]), exit_code=1)),
    ("stdout is not JSON", _emitter(stdout="not json at all\n")),
    ("stdout is empty", _emitter(stdout="")),
    ("payload is a JSON array", _emitter(stdout="[]")),
    ("no tools key", _emitter(stdout=json.dumps({"count": 0, "paywalled": []}))),
    ("empty tools list", _emitter(stdout=_doc([]))),
    ("an entry with no name", _emitter(stdout=json.dumps(
        {"count": 1, "paywalled": [], "tools": [{"family": "x", "paywalled": False}]}))),
    ("duplicate names", _emitter(stdout=json.dumps(
        {"count": 2, "paywalled": [],
         "tools": [{"name": "a", "paywalled": False}, {"name": "a", "paywalled": False}]}))),
    ("count disagrees with the payload", _emitter(stdout=_doc(["a", "b"], count=37))),
    ("no paywalled key", _emitter(stdout=json.dumps(
        {"count": 1, "tools": [{"name": "a", "paywalled": False}]}))),
    ("paywalled names a tool it does not list", _emitter(stdout=_doc(["a"], ["b"]))),
])
def test_an_emitter_that_cannot_be_understood_fails_instead_of_approving(label, cmd):
    """Fail closed. Returning a short or empty list would recreate the bug: the
    comparison would come out «fine» without having compared anything."""
    with pytest.raises(CatalogDrift):
        node_catalog(cmd)


def test_an_emitter_that_is_not_there_also_fails():
    with pytest.raises(CatalogDrift):
        node_catalog(("definitely-not-an-executable-anywhere", "--names"))


def test_the_emitter_stderr_is_surfaced_verbatim():
    """The actionable half of a refusal lives in the emitter's own stderr — a missing
    --experimental-strip-types, a registry that stopped exporting catalog(), an
    absent paywall flag. Paraphrasing it would throw that away."""
    cmd = _emitter(stdout="", exit_code=1,
                   stderr="emit-tool-catalog: catalog() does not report the paywall flag")
    with pytest.raises(CatalogDrift) as box:
        node_catalog(cmd)
    assert "does not report the paywall flag" in str(box.value)


def test_noise_on_stderr_is_not_a_failure_when_the_payload_is_good():
    """Node always writes an ExperimentalWarning about type stripping to stderr, so
    treating a non-empty stderr as failure would make every real run refuse."""
    cmd = _emitter(stdout=_doc(["curso_indice"], []),
                   stderr="(node:1) ExperimentalWarning: Type Stripping is experimental\n")
    assert node_catalog(cmd).names == ("curso_indice",)


# --------------------------------------------- what makes the contract useful
def test_every_returned_column_really_exists():
    """P1 and P4 are checked against `returns`. A name that does not exist is reported
    as `columna_desconocida`; one that exists in ANOTHER table is not reported and not
    checked. Either way the proof stops meaning something."""
    for name, h in TOOLS.items():
        for ref in h.returns:
            table, dot, col = ref.partition(".")
            assert dot, f"{name}: «{ref}» is not shaped «table.column»"
            assert table in TABLES, f"{name}: the table «{table}» of {ref} is not declared"
            assert col in TABLES[table].columns, (
                f"{name}: the column «{col}» is not in {table} "
                f"(declared: {', '.join(TABLES[table].columns)})")


def test_every_returned_column_comes_from_a_table_the_tool_reads():
    """Returning from a table that is not declared in `reads` is the inconsistency
    that makes the `risk_neighbourhood` warning useless: the graph would not have
    the edge."""
    for name, h in TOOLS.items():
        for ref in h.returns:
            table = ref.split(".", 1)[0]
            assert table in h.reads, f"{name} returns {ref} but does not declare reading {table}"


def test_no_tool_without_tables_returns_columns():
    """The ones that do not touch the database (the in-memory bus, static product
    data) cannot return a column: if they return one, `reads` is incomplete."""
    for name, h in TOOLS.items():
        if not h.reads:
            assert h.returns == (), f"{name} reads no tables but returns {h.returns}"


# ---------------------------------------------------------------------------
# THE VIOLATIONS THE FULL DECLARATION SURFACED, AND WHAT HAPPENED TO THEM
#
# Declaring the other thirty tools turned the proof red immediately: `lab_ficha`
# and `mis_errores` returned `de_pago` columns without ever calling
# `leccionesAbiertas`. Three separate security audits had read that file and
# neither tool was reported by any of them. Obligation P4 found both on the first
# run over the full surface, which is the whole argument for coverage over
# cleverness.
#
# Both are fixed in api/src/tools/ — `paywalled: true` plus the gate — and both
# now declare checks_entitlement=True. In that order: the code first, then the
# declaration. Declaring it first would have turned the proof green while the leak
# stayed open, which is exactly how the paywall became invisible originally.
#
# The set stays here, empty, on purpose. It is where a NEW violation lands, and an
# empty set means the next one fails carrying its own name instead of blending into
# a suite that is already red and that everybody has learned to ignore.
KNOWN_LEAKS: frozenset[tuple[str, str, str]] = frozenset()


def test_there_is_no_new_violation():
    from course_ai.ontology.graph import GRAPH
    today = {(v.tool, v.rule, v.detail) for v in GRAPH.prove_isolation()}
    new = today - KNOWN_LEAKS
    assert not new, f"violations that were not documented: {sorted(new)}"
    fixed = KNOWN_LEAKS - today
    assert not fixed, f"they no longer reproduce, drop them from KNOWN_LEAKS: {sorted(fixed)}"


def test_checks_entitlement_follows_the_code_and_not_the_other_way_round():
    """The cheap way to turn P4 green is to declare checks_entitlement=True without
    touching the code that gates. The leak stays and the test goes quiet, which is
    worse than not having it.

    This reads WHO Node gates from the emitter's `paywalled` field — the registry's
    own answer, not a regex over its formatting — and demands it be exactly the set
    the ontology declares. Naming the concrete pair would go stale the moment an
    eighth paywalled tool is added."""
    gated = node_catalog().paywalled
    declaring = _real_gated()          # over BRIDGED: see _real_gated's docstring
    assert gated, "Node reports no paywalled tool at all: the emitter's flag is not being set"
    assert gated == declaring, (
        "the registry and the ontology do not match.\n"
        f"  only Node gates them (not declared): {sorted(gated - declaring)}\n"
        f"  only the ontology declares it (not gated): {sorted(declaring - gated)}")


def test_check_catalog_reports_a_paywall_mismatch():
    """The names can agree while the paywall flag does not, and that is the case P4
    cannot see on its own: it checks against the declaration, so a declaration that
    drifted from the code turns P4 green over an open leak."""
    cmd = _emitter(stdout=_doc(BRIDGED, _real_gated() - {"leccion_texto"}))
    problems = check_catalog(cmd)
    assert any("paywall" in p for p in problems), problems
    assert any("leccion_texto" in p for p in problems), problems
    # And ONLY the paywall: the names agree, so reporting name drift here would mean
    # the two comparisons are not actually independent.
    assert not any("the declared catalog" in p for p in problems), problems


# ---------------------------------------------------------------------------
# THE EXPORT REFUSES
#
# The artefact (api/src/ontologia.json) is what Node reads to know which columns to
# block. Writing it after a proof run over the wrong list is signing a report
# nobody read: that is why drift is checked BEFORE the violations, and why both of
# them stop the write.
def test_main_does_not_write_if_the_catalog_drifts(tmp_path, monkeypatch, capsys):
    from course_ai.ontology import export

    target = tmp_path / "ontologia.json"
    monkeypatch.setattr(export, "EMITTER_CMD", _emitter(stdout=_doc(["curso_indice"])))
    monkeypatch.setattr(export, "TARGET", target)

    assert export.main() == 1
    assert not target.exists(), "it wrote the artefact with a drifted catalog"
    output = capsys.readouterr().out
    assert "NOT exporting" in output
    assert "cola_siguiente" in output          # it names the missing ones, one by one


def test_main_does_not_write_when_the_emitter_refuses(tmp_path, monkeypatch, capsys):
    """A catalogue that cannot be read must stop the write just as hard as one that
    disagrees. «Could not check» is the outcome that must never be quiet."""
    from course_ai.ontology import export

    target = tmp_path / "ontologia.json"
    monkeypatch.setattr(export, "EMITTER_CMD",
                        _emitter(stdout="", exit_code=1, stderr="registry moved again"))
    monkeypatch.setattr(export, "TARGET", target)

    assert export.main() == 1
    assert not target.exists()
    output = capsys.readouterr().out
    assert "NOT exporting" in output
    assert "registry moved again" in output


def test_main_writes_when_everything_adds_up(tmp_path, monkeypatch):
    """Today is the clean case: the catalog matches Node, the paywall flags agree and
    P1..P4 hold over all 37, so the artefact IS written. The opposite case —that it
    refuses— is covered by test_main_does_not_write_with_an_injected_leak."""
    from course_ai.ontology import export

    target = tmp_path / "ontologia.json"
    monkeypatch.setattr(export, "TARGET", target)
    assert export.main() == 0
    assert target.exists()
    data = json.loads(target.read_text(encoding="utf-8"))
    assert data["violaciones"] == []
    assert len(data["herramientas"]) == len(TOOLS)


def test_main_does_not_write_with_an_injected_leak(tmp_path, monkeypatch, capsys):
    """The refusal to export is the part that protects: if an artefact with a leak
    inside can be written, Node boots with it.

    The leak is injected by REMOVING `checks_entitlement` from a tool that already
    exists, not by adding a new one. An invented one is not in Node's registry, so
    the drift guard rejects it BEFORE P4 ever looks at it — and then the test passes
    for the wrong reason, which is how you end up with a test that does not prove
    what its name says. Here the set of names stays identical.

    The fake emitter stops gating the same tool, so the name check and the paywall
    check both agree and P4 is what has to catch it. That is also the realistic
    shape of this mistake: somebody removes the gate in the registry and updates the
    declaration to match, leaving two files that agree with each other and a
    `de_pago` column with nothing in front of it.
    """
    from course_ai.ontology import export
    from course_ai.ontology.graph import Graph

    victim = "leccion_texto"
    assert TOOLS[victim].checks_entitlement, "the specimen no longer checks entitlement"
    tools = dict(TOOLS)
    tools[victim] = dataclasses.replace(tools[victim], checks_entitlement=False)
    assert set(tools) == set(TOOLS), "the set of names has to stay the same"
    monkeypatch.setattr(export, "GRAPH", Graph(TABLES, tools))
    monkeypatch.setattr(export, "EMITTER_CMD",
                        _emitter(stdout=_doc(BRIDGED, _real_gated() - {victim})))

    target = tmp_path / "ontologia.json"
    monkeypatch.setattr(export, "TARGET", target)
    assert export.main() != 0
    assert not target.exists(), "it wrote an artefact with a leak inside"
    output = capsys.readouterr().out
    assert "de_pago_sin_verificar" in output, output


# --------------------------------------------------------------------- the caps
def test_the_caps_come_through_when_the_emitter_reports_them():
    caps = node_catalog().caps
    assert caps, "the emitter reported no caps: CAPS is no longer readable from agent-bus.ts"
    assert all(isinstance(v, int) and v > 0 for _, v in caps), caps


@pytest.mark.parametrize("label,raw", [
    ("null", None),
    ("not a mapping", [32, 16]),
    ("a string value", {"queue": "32"}),
    ("a boolean value", {"queue": True}),
    ("zero", {"queue": 0}),
    ("negative", {"queue": -1}),
])
def test_unusable_caps_come_back_empty_rather_than_stopping_the_export(label, raw):
    """Deliberately softer than the checks above. A broken `caps` says nothing about
    whether the TOOL LIST is trustworthy, so it must not stop the artifact; `ai-doc`
    falls back to naming the module and says so. What it must never do is render a
    number nobody read."""
    cmd = _emitter(stdout=_doc(["curso_indice"], [], caps=raw))
    cat = node_catalog(cmd)
    assert cat.caps == ()
    assert cat.names == ("curso_indice",)      # and the catalogue still reads fine


def test_broken_caps_do_not_make_the_catalogue_check_fail():
    cmd = _emitter(stdout=_doc(BRIDGED, _real_gated(), caps="nonsense"))
    assert check_catalog(cmd) == ()


# ------------------------------------------------------------------ ai-doc
# The document is generated too, so it refuses for the same reasons the artifact
# does: one that describes a tool catalogue it could not read looks authoritative
# and is not.
def _doc_families(names, gated=(), **over) -> str:
    fams: dict[str, list[str]] = {}
    for n in names:
        fams.setdefault("contenido", []).append(n)
    return _doc(names, gated, families=fams, **over)


def test_ai_doc_writes_and_renders_the_caps(tmp_path, monkeypatch, capsys):
    from course_ai.ontology import render

    target = tmp_path / "ONTOLOGY.md"
    monkeypatch.setattr(render, "DOC_TARGET", target)
    monkeypatch.setattr("course_ai.ontology.export.EMITTER_CMD",
                        _emitter(stdout=_doc_families(list(BRIDGED),
                                                      caps={"queue": 32, "memo": 96})))
    assert render.main() == 0
    text = target.read_text(encoding="utf-8")
    assert "| `queue` | 32 |" in text
    assert "| `memo` | 96 |" in text
    assert "note:" not in capsys.readouterr().out


def test_ai_doc_says_out_loud_when_the_caps_are_missing(tmp_path, monkeypatch, capsys):
    """Absent caps are not a failure — but they are not silent either, or the document
    quietly stops stating something it used to state."""
    from course_ai.ontology import render

    target = tmp_path / "ONTOLOGY.md"
    monkeypatch.setattr(render, "DOC_TARGET", target)
    monkeypatch.setattr("course_ai.ontology.export.EMITTER_CMD",
                        _emitter(stdout=_doc_families(list(BRIDGED), caps=None)))
    assert render.main() == 0
    out = capsys.readouterr().out
    assert "no usable `caps`" in out
    text = target.read_text(encoding="utf-8")
    assert "The caps on all three live in `CAPS` in `api/src/agent-bus.ts`" in text
    assert "| `queue` |" not in text


def test_ai_doc_refuses_when_the_emitter_refuses(tmp_path, monkeypatch, capsys):
    from course_ai.ontology import render

    target = tmp_path / "ONTOLOGY.md"
    monkeypatch.setattr(render, "DOC_TARGET", target)
    monkeypatch.setattr("course_ai.ontology.export.EMITTER_CMD",
                        _emitter(stdout="", exit_code=1, stderr="registry gone"))
    assert render.main() == 1
    assert not target.exists()
    assert "registry gone" in capsys.readouterr().out


def test_a_null_families_map_falls_back_to_the_per_tool_field():
    """The emitter gives two views of the grouping. `families` missing is not the same
    as unknown: each tool still carries its own `family`, and that is enough."""
    cmd = _emitter(stdout=_doc(["curso_indice"], [], families=None))
    assert node_catalog(cmd).families == (("x", ("curso_indice",)),)


def test_ai_doc_refuses_when_the_registry_reports_no_families(tmp_path, monkeypatch, capsys):
    """Neither view available. The document cannot group the catalogue the way the
    registry does, so it is not written at all rather than invented.

    `caps` is deliberately VALID here. A missing family grouping is then the only
    defect in the payload, so the exit code cannot be blamed on anything else --
    and the absent caps note proves the run never reached the caps branch.
    """
    from course_ai.ontology import render

    payload = json.dumps({
        "count": 1, "paywalled": [], "families": None, "caps": {"queue": 32},
        "tools": [{"name": "curso_indice", "paywalled": False}],   # no `family` key
    })
    target = tmp_path / "ONTOLOGY.md"
    monkeypatch.setattr(render, "DOC_TARGET", target)
    monkeypatch.setattr("course_ai.ontology.export.EMITTER_CMD", _emitter(stdout=payload))
    assert render.main() == 1
    assert not target.exists()
    out = capsys.readouterr().out
    assert "no tool families" in out
    assert "no usable `caps`" not in out


# ---------------------------------------------------------------------------
# THE THIRD AXIS: WHO EXECUTES THE TOOL
#
# `runner` was added because the model had no field for a fact that was about to
# become true: some tools are answered inside /ai, with no database and no bridge.
# Without the field the only way to add one was to put it in the same flat list the
# contract test compares against Node, which turns a total equality into «declared
# is a superset of what Node runs» — i.e. into nothing.
#
# So the equality moved its LEFT OPERAND to BRIDGED and did not change in any other
# way: same two directions, same count check beside it, same paywall comparison read
# from the registry's own flag. What the tests below add is the other half of the
# deal — the native population is checked by a rule of its own, and every clause of
# that rule is shown here to be able to FAIL.
def _native(**over) -> Tool:
    """A well-formed native declaration, before a test breaks one field of it."""
    base = dict(description="Enruta la pregunta tal como la escribio la persona.",
                args={"pregunta": "texto libre"}, scope="publico",
                reads=(), returns=(), checks_entitlement=False, runner="python",
                composes=())
    base.update(over)
    return Tool(**base)


def _with(extra: dict[str, Tool]) -> dict[str, Tool]:
    """Today's declaration plus some invented tools. The real names are untouched, so
    a failure can only come from what the test added."""
    tools = dict(TOOLS)
    tools.update(extra)
    return tools


def _node_says_today() -> tuple[str, ...]:
    """A fake emitter that reports exactly what Node exposes today. Anything the test
    adds on the Python side is therefore drift, which is the point."""
    return _emitter(stdout=_doc(BRIDGED, _real_gated()))


def test_the_two_views_partition_the_declaration():
    """TOOLS stays the UNION: it is what the model is offered, what the artefact
    carries and what ai-doc renders. BRIDGED and NATIVE are views over it, never a
    second list — a hand-kept list of native names is the drift bug this axis exists
    to avoid, because deleting a tool and forgetting the list silently SHRINKS the
    population the equality covers."""
    assert set(BRIDGED) | set(NATIVE) == set(TOOLS)
    assert not set(BRIDGED) & set(NATIVE)
    assert len(BRIDGED) + len(NATIVE) == len(TOOLS)
    assert all(h.runner in ("node", "python") for h in TOOLS.values())


def test_every_declared_native_has_a_handler_and_vice_versa():
    """The placeholder this replaces asserted `set(BRIDGED) == set(TOOLS)` and
    `len(NATIVE) == 0` — «nothing is native yet, and it may not become native until
    the loop can dispatch one». Three natives are declared now and the loop does
    dispatch them, so keeping that assertion would have meant either deleting it or
    watching it go red for the right reason and be silenced. It is replaced by the
    condition it was standing in for.

    Importing `retrieval.tools` is itself half the check: the module RAISES at import
    time when the two sets differ, so this test failing to import is the same signal
    as this test failing. Both directions are asserted anyway, because a raise in a
    module nobody imports protects nothing.
    """
    from course_ai.retrieval.tools import NATIVE_HANDLERS

    assert set(NATIVE_HANDLERS) == set(NATIVE), (
        f"declared and not implemented: {sorted(set(NATIVE) - set(NATIVE_HANDLERS))}; "
        f"implemented and not declared: {sorted(set(NATIVE_HANDLERS) - set(NATIVE))}")
    assert NATIVE, "the natives vanished: P5 then runs over nothing and says it holds"


def test_the_bridged_half_still_covers_everything_node_runs():
    """The property the split had to preserve, stated as a relation and not a number.

    Measured before the `runner` field existed: the emitter exits 0 with 37 tools and
    7 paywalled. Measured after three natives were added: `len(BRIDGED)` is still 37
    and `set(BRIDGED)` is still identical to Node's catalogue, because `runner`
    defaults to "node" and no existing declaration changed. The natives are extra
    tools, not a hole in the equality — which is exactly what this asserts, in both
    directions, against the real registry.
    """
    node = frozenset(node_catalog().names)
    assert set(BRIDGED) == node
    assert not (set(NATIVE) & node), (
        "a native name is ALSO in Node's registry: two dispatch paths for one tool, "
        "and the entitlement question reopens for the Node half")
    assert set(TOOLS) - node == set(NATIVE), (
        "every declared name Node does not run has to be a declared native; anything "
        "else is a tool the model is offered and nothing executes")


# ---- (A) a Python-answered tool that nobody declared as Python-answered ----
def test_a_python_answered_tool_left_at_the_default_runner_is_caught():
    """THE REGRESSION THIS AXIS COULD HAVE INTRODUCED, and the reason `runner`
    defaults to "node".

    Somebody writes a tool that /ai answers in-process and does not think about the
    field. It lands in BRIDGED, Node does not expose it, and the `extra` arm fires
    with the message it always had. Forgetting is LOUD; that is the whole design of
    the default."""
    from course_ai.ontology import export
    from course_ai.ontology.graph import Graph

    forgot = _native(runner="node")           # the default, i.e. nobody set it
    monkey = Graph(TABLES, _with({"prueba_nativa": forgot}))
    problems = _check_with(export, monkey)
    assert problems, "a Python tool declared as bridged went unnoticed"
    assert any("prueba_nativa" in p for p in problems), problems
    assert any("does NOT expose" in p for p in problems), problems


def test_the_same_tool_declared_native_is_accepted_and_moves_no_number():
    """The complement of the test above, and the proof that the equality did not
    become laxer: the very same tool, with the very same fake emitter, is clean once
    it says who runs it. What changed is not the strictness — it is that the
    population the equality covers is now stated instead of assumed."""
    from course_ai.ontology import export
    from course_ai.ontology.graph import Graph

    g = Graph(TABLES, _with({"prueba_nativa": _native()}))
    assert _check_with(export, g) == ()
    assert g.prove_isolation() == (), g.prove_isolation()


def test_a_native_node_also_exposes_is_caught():
    """Two dispatch paths for one name: the model cannot tell which authority
    answered, and the entitlement question reopens for the Node half. Registering the
    natives as stubs in Node so both sides read 40 = 40 is the version of this the
    guard would NOT have caught — this is what catches it."""
    from course_ai.ontology import export
    from course_ai.ontology.graph import Graph

    tools = dict(TOOLS)
    tools["glosario"] = _native()             # a real, Node-exposed name, declared native
    problems = _check_with(export, Graph(TABLES, tools))
    assert any("ALSO exposes" in p for p in problems), problems
    assert any("glosario" in p for p in problems), problems


@pytest.mark.parametrize("target,expected", [
    ("no_existe_esta", "does not expose"),
    ("leccion_texto", "GATED"),               # paywalled: true in the registry
])
def test_a_native_cannot_compose_what_it_should_not(target, expected):
    """`composes` is the composition made visible. Composing a name Node does not
    expose is a call that answers `herramienta_desconocida`; composing a GATED one is
    a native returning paid content through the back door, which is the leak whatever
    it delegates to internally."""
    from course_ai.ontology import export
    from course_ai.ontology.graph import Graph

    g = Graph(TABLES, _with({"prueba_nativa": _native(composes=(target,))}))
    problems = _check_with(export, g)
    assert any(expected in p for p in problems), problems
    assert any("prueba_nativa" in p for p in problems), problems


# ---- (B) a bridged tool that disappears from Node ----
def test_every_single_bridged_tool_is_caught_if_node_stops_exposing_it():
    """Not one specimen: EVERY bridged name, one at a time. The `extra` arm is the
    one a subset check would have deleted, and it is the one that catches «the
    ontology promises a tool that does not exist» — a misspelt bridged name reaching
    the model as an always-erroring offered tool.

    Both comparisons are asserted, because they are not the same check: the set
    equality is the expensive one and the count is the cheap one that still fails
    when a deduped or collided payload has made the expensive one vacuous."""
    for victim in BRIDGED:
        cmd = _emitter(stdout=_doc([n for n in BRIDGED if n != victim],
                                   _real_gated() - {victim}))
        cat = node_catalog(cmd)
        assert len(BRIDGED) != len(cat.names), f"{victim}: the count check went blind"
        assert set(BRIDGED) != set(cat.names), f"{victim}: the set check went blind"
        extra, missing = drift(BRIDGED, cat.names)
        assert extra == (victim,), f"{victim}: {extra}"
        assert not missing
        problems = check_catalog(cmd)
        assert any(victim in p for p in problems), f"{victim}: {problems}"
        assert any("does NOT expose" in p for p in problems), f"{victim}: {problems}"


# ---- P5, clause by clause: the native rule has to be able to fail ----
@pytest.mark.parametrize("label,override,rule", [
    ("it reads a table", {"reads": ("lessons",)}, "nativa_lee_tablas"),
    ("it returns a column",
     {"reads": ("lessons",), "returns": ("lessons.title",)}, "nativa_devuelve_columnas"),
    ("it decides entitlement", {"checks_entitlement": True}, "nativa_decide_compra"),
    ("it composes something undeclared",
     {"composes": ("no_existe_esta",)}, "compone_desconocida"),
])
def test_each_native_clause_of_P5_can_fail(label, override, rule):
    """P5 is not a formality and this is the measurement that says so: P1, P2 and P4
    all iterate over `reads`/`returns`, so over a tool with both empty they run ZERO
    iterations. Only P3 has anything to say about a native. Four obligations
    «holding» over such a tool is four obligations never looking at it."""
    from course_ai.ontology.graph import Graph

    g = Graph(TABLES, _with({"prueba_nativa": _native(**override)}))
    rules = {v.rule for v in g.prove_isolation() if v.tool == "prueba_nativa"}
    assert rule in rules, rules


def test_declaring_reads_on_a_native_cannot_be_silenced_by_declaring_entitlement():
    """The trap P5 closes. A native that declares the tables it «conceptually»
    searches produces phantom P4 violations for a code path that does not exist, and
    the only way to silence those inside the old model was checks_entitlement=True —
    Python declaring itself an entitlement authority, which is exactly what P4 exists
    to forbid. Now both spellings are violations."""
    from course_ai.ontology.graph import Graph

    honest = Graph(TABLES, _with({"x": _native(
        reads=("lessons", "lesson_text"), returns=("lesson_text.technical",))}))
    phantom = {v.rule for v in honest.prove_isolation() if v.tool == "x"}
    assert "de_pago_sin_verificar" in phantom      # the phantom P4 it used to produce
    assert "nativa_lee_tablas" in phantom
    assert "nativa_devuelve_columnas" in phantom

    silenced = Graph(TABLES, _with({"x": _native(
        reads=("lessons", "lesson_text"), returns=("lesson_text.technical",),
        checks_entitlement=True)}))
    rules = {v.rule for v in silenced.prove_isolation() if v.tool == "x"}
    assert "de_pago_sin_verificar" not in rules    # the old silencer still silences P4
    assert "nativa_decide_compra" in rules, "and P5 is what refuses to let it"


def test_a_bridged_tool_may_not_declare_composes():
    """The other direction of P5. `composes` describes a native handler's allowance;
    on a tool Node executes it is a fact nothing reads, and a fact nothing reads is
    the next thing to drift."""
    from course_ai.ontology.graph import Graph

    tools = dict(TOOLS)
    tools["glosario"] = dataclasses.replace(tools["glosario"], composes=("curso_indice",))
    rules = {v.rule for v in Graph(TABLES, tools).prove_isolation() if v.tool == "glosario"}
    assert rules == {"puente_compone"}, rules


def test_main_does_not_write_with_a_native_that_breaks_P5(tmp_path, monkeypatch, capsys):
    """P5 stops the artefact exactly like P1..P4 do. An artefact that documents a
    Python tool with a table in its hand is signing a report nobody read."""
    from course_ai.ontology import export
    from course_ai.ontology.graph import Graph

    target = tmp_path / "ontologia.json"
    monkeypatch.setattr(export, "TARGET", target)
    monkeypatch.setattr(export, "GRAPH",
                        Graph(TABLES, _with({"prueba_nativa": _native(reads=("labs",))})))
    monkeypatch.setattr(export, "EMITTER_CMD", _node_says_today())
    assert export.main() == 1
    assert not target.exists()
    assert "nativa_lee_tablas" in capsys.readouterr().out


def test_the_artefact_says_who_executes_each_tool():
    """`ejecutor` in the exported herramientas. Node types that key
    `Record<string, unknown>` and consumes none of its fields, but a file whose
    subject is «what Node executes» must not carry an unlabelled native name."""
    from course_ai.ontology.export import payload

    tools = payload()["herramientas"]
    assert len(tools) == len(TOOLS)            # the UNION: the artefact hides nothing
    assert {t["ejecutor"] for t in tools.values()} <= {"node", "python"}
    for name, entry in tools.items():
        assert entry["ejecutor"] == TOOLS[name].runner
