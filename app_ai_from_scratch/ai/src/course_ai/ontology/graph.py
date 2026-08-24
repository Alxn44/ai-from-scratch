"""The ontology graph, and the isolation PROOF over it.

Why a graph and not a list of rules: isolation does not break through a single
loose column, it breaks through a PATH. `ranking_publico` reads no forbidden
column, but it joins `ranking_optin` with other people's `attempts`; what has to
be answerable is «by which route does the model get to this column», and that is
reachability, not membership.

Nodes:  H:name (tool) · T:name (table) · C:table.column
Edges:  H --reads--> T · T --joins_with--> T · T --has--> C

Complexity, with V nodes, E edges, H tools and T tables. This table is MEASURED,
not asserted: there is a synthetic bench that scales the input and watches the
growth factor per doubling (2.0 = linear, 4.0 = quadratic).

    reach(start)                BFS                     O(V + E)
    path(a, b)                  BFS with parents        O(V + E)
    _reachable_by_table         Tarjan + condensation   O(V + E), cached
    reachable_tables(h)         union of already
                                computed sets           O(|reads|)
    topological_order()         Kahn with reverse
                                adjacency + heap        O(V + E log V)
    risk_neighbourhood()        H set unions            O(H * T) — that is the SIZE
                                                        of the output, not a defect
    prove_isolation()           walks `returns`         O(sum |returns|)
                                + one path per fault    + O(F * (V + E))

Two of these were quadratic with an O(V+E) signature written on top of them, and
they were fixed by measuring first:

  · topological_order() sorted the T tables and walked them ENTIRE for every node
    it popped off the queue: O(T^2 log T). It grew 3.2x-4.3x per doubling. With
    the reverse adjacency it came down to 1.93x-2.03x, and in absolute terms
    2.26 ms -> 0.04 ms with 200 tables: 56 times faster.
  · reachable_tables() did a full BFS per tool: O(H * (V+E)). Now there is a
    single Tarjan pass for all the tables. The result is IDENTICAL to the BFS it
    replaces — checked against a reference implementation over chains, 3-cycles,
    two joined cycles, a complete graph, a graph with no edges, a random graph
    with a fixed seed, and the real ontology.

The strongly connected components are needed, rather than a plain memoised DFS,
because `joins_with` is not always declared in both directions: the table
subgraph is DIRECTED and can have cycles, and inside a cycle naive memoisation
returns incomplete sets depending on where you enter.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import cached_property
from heapq import heapify, heappop, heappush

from .data import IDENTITY_ARGS, TABLES, TOOLS, Table, Tool


@dataclass(frozen=True, slots=True)
class Violation:
    """An isolation fault, with the path that produces it. Without the path a
    fault is not actionable: it says there is a leak but not by which route."""

    tool: str
    rule: str
    detail: str
    path: tuple[str, ...] = ()

    def __str__(self) -> str:  # pragma: no cover - only for the CLI
        route = "  ->  ".join(self.path) if self.path else "(direct)"
        return f"[{self.tool}] {self.rule}: {self.detail}\n    {route}"


def _t(name: str) -> str:
    return f"T:{name}"


def _h(name: str) -> str:
    return f"H:{name}"


def _c(table: str, col: str) -> str:
    return f"C:{table}.{col}"


class Graph:
    """An adjacency list over the ontology. Built once, then queried."""

    def __init__(self, tables: Mapping[str, Table] = TABLES,
                 tools: Mapping[str, Tool] = TOOLS) -> None:
        self.tables = tables
        self.tools = tools
        self.adj: dict[str, tuple[str, ...]] = {}
        self._build()

    # ---- construction: O(V + E) ----
    def _build(self) -> None:
        adj: dict[str, list[str]] = {}
        for name, t in self.tables.items():
            # T --has--> C  and  T --joins_with--> T
            adj[_t(name)] = [_c(name, c) for c in t.columns]
            adj[_t(name)] += [_t(o) for o in t.joins_with if o in self.tables]
            for c in t.columns:
                adj.setdefault(_c(name, c), [])
        for name, h in self.tools.items():
            adj[_h(name)] = [_t(x) for x in h.reads if x in self.tables]
        self.adj = {k: tuple(v) for k, v in adj.items()}

    def neighbours(self, node: str) -> tuple[str, ...]:
        return self.adj.get(node, ())

    @cached_property
    def nodes(self) -> tuple[str, ...]:
        return tuple(self.adj)

    @cached_property
    def edges(self) -> int:
        return sum(len(v) for v in self.adj.values())

    # ---- BFS: O(V + E) ----
    def reach(self, start: Iterable[str]) -> frozenset[str]:
        seen: set[str] = set(start)
        queue = deque(seen)
        while queue:
            for v in self.neighbours(queue.popleft()):
                if v not in seen:
                    seen.add(v)
                    queue.append(v)
        return frozenset(seen)

    def path(self, src: str, dst: str) -> tuple[str, ...]:
        """BFS with parents. Returns the SHORTEST path, which is the one that
        explains the leak best: the long one always exists if the short one does."""
        if src == dst:
            return (src,)
        parent: dict[str, str] = {src: src}
        queue = deque([src])
        while queue:
            u = queue.popleft()
            for v in self.neighbours(u):
                if v in parent:
                    continue
                parent[v] = u
                if v == dst:
                    route = [v]
                    while route[-1] != src:
                        route.append(parent[route[-1]])
                    return tuple(reversed(route))
                queue.append(v)
        return ()

    # ---- table -> tables reachability, ALL of it in one pass ----
    #
    # This used to be one BFS per tool: O(H · (V+E)). Measured over synthetic
    # graphs shaped like the real one, `risk_neighbourhood` grew 3.8x-4.4x per
    # doubling of the input — quadratic. With 7 tools nobody notices; with 37 it is
    # 37 walks of the same graph, and the number of tools is what is going to grow.
    #
    # Now it is computed ONCE for every table and cached:
    #
    #   1. Iterative Tarjan -> strongly connected components.    O(V+E)
    #      They are needed because `joins_with` is NOT always declared in both
    #      directions, so the table subgraph is directed and can have cycles. A
    #      plain memoised DFS gives incomplete results inside a cycle.
    #   2. Condensation -> DAG of components.                    O(V+E)
    #   3. Propagation in reverse topological order: what a component reaches is
    #      itself plus the union of its successors.
    #
    # The tools stop walking: `reachable_tables` is the union of what the tables it
    # declares in `reads` reach. O(|reads|) with the sets already computed.
    def _tarjan(self) -> tuple[dict[str, int], list[list[str]]]:
        """Strongly connected components of the TABLE subgraph. Iterative: a large
        ontology would blow Python's recursion limit."""
        neighbours = {n: [o for o in t.joins_with if o in self.tables]
                      for n, t in self.tables.items()}
        index: dict[str, int] = {}
        low: dict[str, int] = {}
        on_stack: set[str] = set()
        stack: list[str] = []
        comp_of: dict[str, int] = {}
        comps: list[list[str]] = []
        counter = 0

        for root in self.tables:
            if root in index:
                continue
            # (node, index into its neighbours) — the call stack, by hand.
            work: list[tuple[str, int]] = [(root, 0)]
            index[root] = low[root] = counter
            counter += 1
            stack.append(root)
            on_stack.add(root)
            while work:
                u, i = work[-1]
                if i < len(neighbours[u]):
                    work[-1] = (u, i + 1)
                    v = neighbours[u][i]
                    if v not in index:
                        index[v] = low[v] = counter
                        counter += 1
                        stack.append(v)
                        on_stack.add(v)
                        work.append((v, 0))
                    elif v in on_stack:
                        low[u] = min(low[u], index[v])
                    continue
                work.pop()
                if work:
                    parent = work[-1][0]
                    low[parent] = min(low[parent], low[u])
                if low[u] == index[u]:
                    group: list[str] = []
                    while True:
                        w = stack.pop()
                        on_stack.discard(w)
                        group.append(w)
                        if w == u:
                            break
                    for w in group:
                        comp_of[w] = len(comps)
                    comps.append(group)
        return comp_of, comps

    @cached_property
    def _reachable_by_table(self) -> Mapping[str, frozenset[str]]:
        comp_of, comps = self._tarjan()
        # DAG of components.
        successors: list[set[int]] = [set() for _ in comps]
        for name, t in self.tables.items():
            ci = comp_of[name]
            for o in t.joins_with:
                if o in self.tables and comp_of[o] != ci:
                    successors[ci].add(comp_of[o])
        # Tarjan emits the components in REVERSE topological order of the
        # condensed DAG, so walking them in order already guarantees the successors
        # are resolved. A second sort is not needed.
        comp_reach: list[frozenset[str]] = []
        for ci, group in enumerate(comps):
            acc = set(group)
            for cj in successors[ci]:
                acc |= comp_reach[cj]
            comp_reach.append(frozenset(acc))
        return {n: comp_reach[comp_of[n]] for n in self.tables}

    def reachable_tables(self, tool: str) -> frozenset[str]:
        """Tables the query can touch, joins included."""
        h = self.tools.get(tool)
        if h is None:
            return frozenset()
        by_table = self._reachable_by_table
        out: set[str] = set()
        for t in h.reads:
            if t in by_table:
                out |= by_table[t]
        return frozenset(out)

    def risk_neighbourhood(self) -> Mapping[str, tuple[str, ...]]:
        """A design warning, not a violation: per tool, the tables holding personal
        data that sit one join away from what it already reads. It is the list of
        what breaks if somebody adds a JOIN without looking at the scope."""
        # `any(c.sensitivity == "propio" for ...)` used to be INSIDE the per-tool
        # loop: with H tools, V tables and C columns that is O(H·V·C) recomputing
        # the same answer. It is a property of the table, not of the tool, so it is
        # computed once.
        with_personal = self._tables_with_own_columns
        out: dict[str, tuple[str, ...]] = {}
        for name, h in self.tools.items():
            already_reads = set(h.reads)
            nearby = sorted((self.reachable_tables(name) & with_personal) - already_reads)
            if nearby:
                out[name] = tuple(nearby)
        return out

    @cached_property
    def _tables_with_own_columns(self) -> frozenset[str]:
        return frozenset(n for n, t in self.tables.items()
                         if any(c.sensitivity == "propio" for c in t.columns.values()))

    # ---- Kahn: O(V + E) ----
    def topological_order(self) -> tuple[tuple[str, ...], tuple[str, ...]]:
        """Kahn over the DIRECTED `depends_on` edges.

        It serves one concrete purpose: deleting an account in the right order —
        first whoever points, then what is pointed at. Today that order is implicit
        in the deletion code; here it is a piece of data that can be read.

        With `joins_with` this did not work: `joins_with` is symmetric
        (users<->attempts) and Kahn put seven of nine tables in a cycle. A cycle
        here IS a modelling error, which is why it is returned — so a test can
        assert on it.
        """
        # The comment above used to say O(V+E) and it was false. The previous
        # version did, INSIDE the while, `for other, t in sorted(self.tables.items())`:
        # it sorted the V tables and walked them entire for every node it popped off
        # the queue. That is O(V^2 log V). Measured over synthetic graphs shaped
        # like the real one, the time grew 3.2x-4.3x per doubling of the input —
        # quadratic, with an O(V+E) signature put on top of it.
        #
        # Real Kahn needs the REVERSE adjacency: «who depends on me». It is built
        # once by walking the edges, and then popping a node costs its out-degree,
        # not V. O(V+E) in total.
        dependents: dict[str, list[str]] = {n: [] for n in self.tables}
        indegree = dict.fromkeys(self.tables, 0)
        for name, t in self.tables.items():
            for o in t.depends_on:
                if o in indegree:
                    indegree[name] += 1
                    dependents[o].append(name)

        # A stable order matters: `orden_borrado` goes into the generated artefact,
        # and an order that dances between runs makes noise in every diff. A heap
        # keeps the alphabetical tie-break without re-sorting on each turn.
        ready = [n for n, g in indegree.items() if g == 0]
        heapify(ready)
        order: list[str] = []
        while ready:
            u = heappop(ready)
            order.append(u)
            for other in dependents[u]:
                indegree[other] -= 1
                if indegree[other] == 0:
                    heappush(ready, other)
        cycle = tuple(sorted(n for n, g in indegree.items() if g > 0))
        return tuple(order), cycle

    # ---- the proof ----
    def prove_isolation(self) -> tuple[Violation, ...]:
        """Four obligations. If all four hold, a user cannot reach another user's
        data, nor a forbidden column, nor content they did not pay for, by any
        declared path.

        P1  No tool RETURNS a column of class `jamas`.
        P2  Every tool that reaches a table with `propio` columns declares scope
            `sesion` or `agregado`. Reaching it with scope `publico` means a query
            with no per-user filter.
        P3  No signature accepts an argument that can express «another person».
        P4  No tool returns a `de_pago` column without declaring
            `checks_entitlement`.
        P5  A native tool (`runner == "python"`) touches no table, returns no
            column, decides no entitlement, and composes only DECLARED bridged
            tools. A bridged tool composes nothing.

        P4 exists because P1..P3 stayed green while four tools handed the whole
        course to accounts that had not paid. It was not a bug in the proof: the
        paywall could not be expressed in the model. `sensitivity` says whose the
        data is; it does not say who paid to read it. They are two axes, and with
        only one of them the hottest rule in the product was invisible.

        P5 exists for the mirror-image reason, and it is not a formality. P1, P2 and
        P4 all iterate over `reads`/`returns`, so over a tool with both empty they
        run ZERO iterations: only P3 (the argument names) has anything to say about
        a native. Four obligations «holding» over such a tool is the same sentence
        as four obligations never looking at it, and a report that sounds like
        coverage without being coverage is precisely the failure this file's own
        summary line was rewritten to stop telling. P5 is what makes a native
        COUNTED as checked rather than counted as clean.

        Its clauses are not style. Empty `reads`/`returns` is ENFORCED because a
        native that declares the tables it «conceptually» searches produces phantom
        P4 violations for a code path that does not exist, and the only way to
        silence those inside this model is `checks_entitlement=True` — which is
        Python declaring itself an entitlement authority, the exact thing P4 exists
        to forbid. So `runner == "python" => checks_entitlement is False` is the
        structural spelling of «a native may never return gated content».

        The Node-facing half of the native rule — that Node must not ALSO expose a
        name declared native, and that a composed tool must be one Node actually
        exposes and does not gate — lives in export.check_catalog(), because that is
        where the registry's own catalogue is read. It cannot live here: this module
        is imported by export.py, and the proof must stay a pure function over the
        data (no subprocess, no Node on PATH) so that every caller of
        prove_isolation() keeps costing nothing.
        """
        faults: list[Violation] = []
        # The declared bridged population, computed from the same mapping the proof
        # runs over, so an injected Graph proves the same rule over its own tools.
        bridged = {n for n, x in self.tools.items() if x.runner == "node"}
        for name, h in self.tools.items():
            # P1
            for ref in h.returns:
                table, _, col = ref.partition(".")
                t = self.tables.get(table)
                if t is None:
                    faults.append(Violation(name, "tabla_desconocida", ref))
                    continue
                c = t.columns.get(col)
                if c is None:
                    faults.append(Violation(name, "columna_desconocida", ref))
                elif c.sensitivity == "jamas":
                    faults.append(Violation(name, "devuelve_prohibida", ref,
                                            self.path(_h(name), _c(table, col))))
            # P2 is checked over `reads` — the tables the query TOUCHES — and not
            # over the transitive closure of `joins_with`. With the closure,
            # `curso_indice` (which only reads lessons) reported a violation through
            # lessons -> labs -> attempts -> users: four faults, none of them real.
            # A test that screams while it is green gets switched off, and then it
            # protects nothing. The closure is still computed, but as a design
            # warning: risk_neighbourhood().
            if h.scope == "publico":
                for table in sorted(x for x in h.reads if x in self.tables):
                    personal = [c for c, x in self.tables[table].columns.items()
                                if x.sensitivity == "propio"]
                    if personal:
                        faults.append(Violation(
                            name, "sin_filtro_de_sesion",
                            f"{table} tiene columnas propias ({', '.join(personal)}) "
                            f"y la herramienta se declara publica",
                            self.path(_h(name), _t(table))))
            # P3
            for arg in h.args:
                if arg.lower().replace("-", "_") in IDENTITY_ARGS:
                    faults.append(Violation(name, "argumento_de_persona", arg))
            # P4. Checked over `returns`, same as P1: what matters is what LEAVES
            # the server, not what the query touches on the inside.
            if not h.checks_entitlement:
                for ref in h.returns:
                    table, _, col = ref.partition(".")
                    t = self.tables.get(table)
                    if t is None:
                        continue          # P1 already reported it as tabla_desconocida
                    c = t.columns.get(col)
                    if c is not None and c.paywall == "de_pago":
                        faults.append(Violation(
                            name, "de_pago_sin_verificar", ref,
                            self.path(_h(name), _c(table, col))))
            # P5. The native contract. Four clauses over the natives and one over
            # the bridged, all of them fail-closed: a native is in violation until
            # its declaration says it cannot reach the database, cannot decide who
            # paid, and cannot call anything that is not a declared bridged tool.
            if h.runner == "python":
                if h.reads:
                    faults.append(Violation(
                        name, "nativa_lee_tablas",
                        f"es nativa y declara leer {', '.join(h.reads)}; "
                        f"Python no tiene acceso a la base"))
                if h.returns:
                    faults.append(Violation(
                        name, "nativa_devuelve_columnas",
                        f"es nativa y declara devolver {', '.join(h.returns)}; "
                        f"el contenido sale por una herramienta del puente"))
                if h.checks_entitlement:
                    faults.append(Violation(
                        name, "nativa_decide_compra",
                        "es nativa y declara verificar el derecho de acceso; "
                        "la autoridad de compra es Node y solo Node"))
                for target in h.composes:
                    if target not in bridged:
                        faults.append(Violation(
                            name, "compone_desconocida",
                            f"compone «{target}», que no es una herramienta "
                            f"declarada del puente"))
            elif h.composes:
                faults.append(Violation(
                    name, "puente_compone",
                    f"la ejecuta Node y declara componer {', '.join(h.composes)}; "
                    f"`composes` describe a las nativas"))
        return tuple(faults)

    def forbidden_columns(self, table: str) -> tuple[str, ...]:
        t = self.tables.get(table)
        if t is None:
            return ()
        return tuple(c for c, x in t.columns.items() if x.sensitivity == "jamas")

    def paywalled_columns(self, table: str) -> tuple[str, ...]:
        """The `de_pago` columns of a table — the SECOND axis, and the one Node had
        no runtime notion of.

        The asymmetry this exists to close: `assertNoForbidden` in
        api/src/ontology.ts inspects the keys of an actual returned row against the
        `jamas` list, so a tool whose `returns` declaration is incomplete is still
        caught at runtime for a `jamas` column. There was no equivalent list for
        `de_pago`, so the same incomplete declaration made a paid column invisible
        to P4 *and* to the runtime — one mistake, no backstop. Exporting the axis
        does not enforce anything by itself; it makes the fact available to whoever
        adds the guard.
        """
        t = self.tables.get(table)
        if t is None:
            return ()
        return tuple(c for c, x in t.columns.items() if x.paywall == "de_pago")

    def summary(self) -> Mapping[str, object]:
        # The KEYS stay Spanish on purpose: this dict is the body of
        # GET /ontologia/grafo and its names are the same ones the generated
        # artefact carries (`orden_borrado`), which is what api/src/ontology.js
        # reads at import time. Renaming them is a coordinated change with a
        # consumer in another language, not a rename.
        order, cycle = self.topological_order()
        return {
            "nodos": len(self.nodes), "aristas": self.edges,
            "tablas": len(self.tables), "herramientas": len(self.tools),
            "columnas": sum(len(t.columns) for t in self.tables.values()),
            "prohibidas": sum(len(self.forbidden_columns(t)) for t in self.tables),
            # Deletion goes the REVERSE way from the topological order: whoever
            # points goes first.
            "orden_borrado": tuple(reversed(order)), "ciclo": cycle,
            "vecindad_de_riesgo": self.risk_neighbourhood(),
            "violaciones": len(self.prove_isolation()),
        }


GRAPH = Graph()


def main() -> int:
    """`uv run ai-prove-isolation`. Exits 1 if there are violations: usable in CI."""
    g = GRAPH
    r = g.summary()
    print(f"graph: {r['nodos']} nodes, {r['aristas']} edges "
          f"({r['tablas']} tables, {r['columnas']} columns, {r['herramientas']} tools)")
    print(f"`jamas` columns: {r['prohibidas']}")
    print(f"deletion order: {' -> '.join(r['orden_borrado']) or '(empty)'}")
    if r["ciclo"]:
        print(f"FOREIGN-KEY CYCLE (modelling error): {', '.join(r['ciclo'])}")
    for h, nearby in sorted(r["vecindad_de_riesgo"].items()):
        print(f"warning: {h} has {', '.join(nearby)} one join away (personal data)")
    faults = g.prove_isolation()
    if not faults:
        # Says HOW MANY obligations ran and over HOW MANY tools.
        #
        # It used to say «P1, P2 y P3 se cumplen» while four of them ran, and it did
        # not say it only covered the declared ones. That is the same class of lie as
        # the guard that approved tables it never inspected: the report sounds like a
        # guarantee and does not cover what it appears to cover. The total Node
        # executes is not written here by hand —it would rot— the contract test
        # compares it against the real catalog.
        # The two populations are printed SEPARATELY, and P5 is named, because
        # «P1..P4 hold over the 38 declared tools» would have been the same lie in a
        # new place: three of those four obligations iterate over reads/returns and
        # run zero iterations over a native. A number that mixes the two makes the
        # unchecked half look covered by the checked half's rules.
        bridged = sum(1 for h in g.tools.values() if h.runner == "node")
        native = len(g.tools) - bridged
        print(f"isolation: P1..P4 hold over {bridged} bridged tools"
              f" · P5 holds over {native} native")
        print("COVERAGE: the declared ones only. The contract test checks that the "
              "bridged list still matches the catalog Node exposes, and P5 covers "
              "the native ones; whatever is not declared is proved by nobody.")
        return 0
    print(f"isolation: {len(faults)} violation(s)")
    for f in faults:
        print(f"  {f}")
    return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
