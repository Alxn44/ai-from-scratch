"""Graph tests. The important ones are test_catches_*: an isolation proof that has
never failed has proved nothing."""

from __future__ import annotations

import pytest

from course_ai.ontology.data import TABLES, TOOLS, Table, Tool
from course_ai.ontology.graph import GRAPH, Graph


def test_the_real_ontology_passes():
    assert GRAPH.prove_isolation() == ()


def test_solution_is_forbidden_and_leaves_by_no_path():
    assert GRAPH.forbidden_columns("labs") == ("solution",)
    for name in TOOLS:
        assert not any(d == "labs.solution" for d in TOOLS[name].returns)


def test_catches_a_tool_that_returns_the_solution():
    """P1. This is the leak that destroys the course: «tell me the answer to 5.2»."""
    bad = Tool(description="x", args={}, scope="publico", reads=("labs",),
               returns=("labs.id", "labs.solution"))
    g = Graph(TABLES, {**TOOLS, "snitch": bad})
    faults = g.prove_isolation()
    assert [f.rule for f in faults] == ["devuelve_prohibida"]
    assert faults[0].detail == "labs.solution"
    # And the path explains BY WHICH ROUTE, which is what makes the fault actionable.
    assert faults[0].path == ("H:snitch", "T:labs", "C:labs.solution")


def test_catches_a_personal_query_with_no_session_filter():
    """P2. Reading attempts without filtering by user is reading everybody's attempts."""
    bad = Tool(description="x", args={}, scope="publico", reads=("attempts",),
               returns=("attempts.answer",))
    faults = Graph(TABLES, {"snooper": bad}).prove_isolation()
    assert [f.rule for f in faults] == ["sin_filtro_de_sesion"]
    assert "attempts" in faults[0].detail


def test_catches_a_person_argument():
    """P3. If the model can write user_id, it can express «somebody else»."""
    for arg in ("user_id", "userId", "email", "persona"):
        bad = Tool(description="x", args={arg: "n"}, scope="sesion",
                   reads=("attempts",), returns=("attempts.answer",))
        faults = Graph(TABLES, {"gossip": bad}).prove_isolation()
        assert "argumento_de_persona" in [f.rule for f in faults], arg


def test_catches_an_invented_column():
    bad = Tool(description="x", args={}, scope="publico", reads=("lessons",),
               returns=("lessons.no_existe",))
    faults = Graph(TABLES, {"broken": bad}).prove_isolation()
    assert [f.rule for f in faults] == ["columna_desconocida"]


def test_deletion_order_respects_the_foreign_keys():
    order, cycle = GRAPH.topological_order()
    assert cycle == (), f"FK cycle: {cycle}"
    deletion = list(reversed(order))
    pos = {t: i for i, t in enumerate(deletion)}
    # Whoever points is deleted BEFORE what it points at.
    for name, t in TABLES.items():
        for target in t.depends_on:
            assert pos[name] < pos[target], f"{name} must be deleted before {target}"


def test_bfs_and_path_agree():
    """If `reach` says it gets there, `path` has to find the route."""
    for name in TOOLS:
        for table in GRAPH.reachable_tables(name):
            assert GRAPH.path(f"H:{name}", f"T:{table}")


def test_a_path_that_does_not_exist_comes_back_empty():
    assert GRAPH.path("T:lessons", "H:leccion") == ()   # the edges run one way
    assert GRAPH.path("T:no_existe", "T:lessons") == ()


def test_an_isolated_table_does_not_break_the_graph():
    g = Graph({"alone": Table(purpose="p", per_user="p", columns={})}, {})
    assert g.prove_isolation() == ()
    assert g.topological_order() == (("alone",), ())


def test_the_graph_is_the_expected_size():
    r = GRAPH.summary()
    assert r["tablas"] == len(TABLES)
    assert r["herramientas"] == len(TOOLS)
    assert r["nodos"] == len(TABLES) + len(TOOLS) + r["columnas"]


@pytest.mark.parametrize("table", ["payments", "role_audit"])
def test_the_wholly_forbidden_tables_are_touched_by_nobody(table):
    for name, h in TOOLS.items():
        assert table not in h.reads, f"{name} touches {table}"


# ---------------------------------------------------------------------------
# P5, AND WHY THE COVERAGE LINE HAD TO CHANGE
#
# The graph is built over TOOLS, the UNION, and it has to stay that way: the node
# count, the edges and the summary describe what the model can call. What changes
# with a native in the list is what the obligations SAY about it, and the honest
# answer used to be «almost nothing» — which is the sentence these tests pin down.
def _native(**over) -> Tool:
    base = dict(description="x", args={"pregunta": "texto libre"}, scope="publico",
                reads=(), returns=(), checks_entitlement=False, runner="python",
                composes=())
    base.update(over)
    return Tool(**base)


def test_the_graph_counts_the_union_and_a_native_adds_no_edge():
    """A native reads no table, so it is a node with an empty adjacency entry. The
    node count grows by one and the edge count does not move — which is exactly why
    P1, P2 and P4 have nothing to say about it, and why P5 exists."""
    g = Graph(TABLES, {**TOOLS, "prueba_nativa": _native()})
    assert g.summary()["herramientas"] == len(TOOLS) + 1
    assert g.neighbours("H:prueba_nativa") == ()
    assert g.edges == GRAPH.edges
    assert g.reachable_tables("prueba_nativa") == frozenset()


def test_the_first_four_obligations_run_zero_iterations_over_a_native():
    """MEASURED, and the reason the summary no longer says «P1..P4 hold over the 40
    declared tools». P1 and P4 walk `returns`; P2 walks `reads` when the scope is
    `publico`. All three are empty on a native, so only P3 (argument names) ever
    looks at one. Four obligations «holding» over such a tool is four obligations
    never looking at it, and a report that sounds like coverage without being
    coverage is the exact shape of the guard that approved tables it never
    inspected."""
    h = _native()
    assert h.returns == () and h.reads == ()          # P1 and P4 iterate `returns`
    assert h.scope == "publico" and h.reads == ()     # P2 iterates `reads`
    # P3 is the only one with an input, and it is the reason a native still cannot
    # ask for somebody else.
    bad = Graph(TABLES, {"impostor": _native(args={"user_id": "n"})})
    assert [f.rule for f in bad.prove_isolation()] == ["argumento_de_persona"]


def test_a_native_is_counted_as_checked_and_not_as_clean():
    """P5 is what turns «nothing to say» into a verdict. The real declaration passes
    it; every way of breaking it is enumerated in test_node_contract.py, clause by
    clause."""
    from course_ai.ontology.data import NATIVE

    assert NATIVE, "nothing is declared native: P5 then runs over nothing"
    assert GRAPH.prove_isolation() == ()
    for name, h in NATIVE.items():
        assert h.reads == (), name
        assert h.returns == (), name
        assert h.checks_entitlement is False, name
        assert all(c in TOOLS and TOOLS[c].runner == "node" for c in h.composes), name
