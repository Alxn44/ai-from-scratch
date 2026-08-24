"""Emits ontologia.json so that Node reads the SAME truth.

Node needs two things out of the ontology: the `jamas` columns (for its
`assertSinProhibidas` guard) and the deletion order. Neither of them is logic:
they are data. So Python — which is where the ontology is authored and verified —
emits them, and Node imports them.

This is the opposite of duplicating: there is one source (data.py), one generated
artefact (ontologia.json) and two readers. If somebody edits the JSON by hand,
Node's test detects it because the fingerprint does not add up.

"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any

from ..ontology.graph import GRAPH
from ..ontology.render import fingerprint

TARGET = Path(__file__).resolve().parents[4] / "api" / "src" / "ontologia.json"

# ---------------------------------------------------------------------------
# DRIFT CHECK AGAINST NODE
#
# The isolation proof runs over the tools DECLARED here. That means the report is
# only worth the declaration: for a long time seven tools were declared while
# Node executed thirty-seven, and the proof printed «P1..P4 se cumplen» over 19%
# of the surface. Nothing detected it, because nothing compared the two lists.
#
# So the comparison is a precondition of the export, not a test somebody may
# remember to run. An artefact that documents a proof over the wrong tool set is
# exactly as misleading as one that documents a leak.
#
# HOW NODE'S CATALOGUE IS READ, and why it is no longer a regex.
#
# This used to scan the TypeScript source for `^const HERRAMIENTAS = \{$` and for
# tool keys indented by exactly two spaces. That reader broke twice: once when the
# registry was renamed `HERRAMIENTAS` -> `TOOLS`, and again when the single
# `agent-tools.js` was split into four family files. Both times it did the right
# thing and refused to compare against an empty list — but a guard that is off is
# a guard that protects nothing, and the check sat dark until somebody noticed.
#
# It kept breaking because the contract was source FORMATTING, which no compiler,
# test or formatter enforces. So Node now EMITS its catalogue and this reads JSON:
# `scripts/emit-tool-catalog.mjs` imports `api/src/tools/index.ts` and prints what
# `catalog()` actually returns. The output cannot drift from the code, because it
# is the code — rename the registry, split it into ten files, reformat every line,
# and the same 37 tools still come out.
#
# THE OTHER WAY, and why not: GET /api/v3/interno/catalogo with the
# `x-ia-secreto` header, which is what agent/bridge.py:Bridge.catalog() is for.
# That is the right check at RUNTIME, because it sees the process actually
# serving. It is the wrong check for a build step: no API up means no check, and
# «no check» must never be the quiet outcome. The emitter needs nothing running.
ROOT = Path(__file__).resolve().parents[4]

# `--experimental-strip-types` is not optional: Node here is 22.13, where
# `process.features.typescript` is false, so it cannot import a .ts registry
# without being told to strip the types. The emitter says so too when it fails.
EMITTER = ROOT / "scripts" / "emit-tool-catalog.mjs"
EMITTER_CMD: tuple[str, ...] = ("node", "--experimental-strip-types", str(EMITTER))

# A hung Node must not hang CI. The emitter opens no connection, so anything past
# a couple of seconds is already pathological; the ceiling is generous anyway.
EMITTER_TIMEOUT_S = 120.0


class CatalogDrift(RuntimeError):
    """The declared catalog and the one Node exposes do not match."""


@dataclass(frozen=True, slots=True)
class NodeCatalog:
    """What Node says it executes. `paywalled` is the set that gates on entitlement.

    `families` is (family, names) in the registry's own order — grouping for human
    reading, which is why the order is kept rather than sorted. It is empty when the
    registry does not report one; only `ai-doc` needs it, so the drift check does
    not refuse over it.

    `caps` is the session-bus ceiling, read by the emitter out of `CAPS` in
    api/src/agent-bus.ts. Same deal: only the document renders it, and it is empty
    when the emitter could not read it.
    """

    names: tuple[str, ...]
    paywalled: frozenset[str]
    families: tuple[tuple[str, tuple[str, ...]], ...] = ()
    caps: tuple[tuple[str, int], ...] = ()


def _refuse(reason: str, stderr: str = "") -> CatalogDrift:
    """Every refusal carries the emitter's own words. Its stderr is where the
    actionable half lives — a missing `--experimental-strip-types`, a registry that
    no longer exports catalog(), an absent paywall flag — and paraphrasing it here
    would throw away the only part a reader can act on."""
    tail = f"\n--- emitter stderr ---\n{stderr.strip()}" if stderr.strip() else ""
    return CatalogDrift(f"{reason}{tail}")


def node_catalog(cmd: Sequence[str] | None = None) -> NodeCatalog:
    """Runs the emitter and parses its stdout. Never returns a partial catalogue.

    Every way this can go wrong raises, because being unable to check is not the
    same thing as checking and coming out clean — that equivalence is exactly what
    let thirty tools go unproved. A non-zero exit, unparseable stdout, an empty
    tool list, a missing key or a count that disagrees with its own payload all
    refuse to produce a value.

    Note on stderr: Node always writes an ExperimentalWarning about type stripping
    there, so stderr being non-empty is NOT a failure signal. Success is the exit
    code plus a well-formed payload; stderr is only ever quoted back on failure.
    """
    argv = tuple(cmd) if cmd is not None else EMITTER_CMD
    try:
        proc = subprocess.run(argv, capture_output=True, text=True,
                              timeout=EMITTER_TIMEOUT_S, check=False)
    except FileNotFoundError as e:
        raise _refuse(
            f"cannot run the tool-catalogue emitter ({argv[0]} not found): {e}. Without "
            f"Node's registry there is nothing to compare against, and exporting without "
            f"comparing is what let 30 tools through.") from e
    except OSError as e:
        raise _refuse(f"cannot run the tool-catalogue emitter {argv!r}: {e}.") from e
    except subprocess.TimeoutExpired as e:
        raise _refuse(
            f"the tool-catalogue emitter did not finish in {EMITTER_TIMEOUT_S:g}s. It opens "
            f"no connection, so a hang is a bug worth looking at rather than waiting out.",
            e.stderr or "") from e

    if proc.returncode != 0:
        raise _refuse(
            f"the tool-catalogue emitter exited {proc.returncode}. It refuses rather than "
            f"printing a partial catalogue, so this is its answer, not a transport problem.",
            proc.stderr)
    try:
        doc = json.loads(proc.stdout)
    except ValueError as e:
        head = proc.stdout.strip()[:200] or "(nothing on stdout)"
        raise _refuse(
            f"the tool-catalogue emitter printed something that is not JSON ({e}). "
            f"stdout began: {head!r}", proc.stderr) from e
    if not isinstance(doc, dict):
        raise _refuse(f"the emitter printed {type(doc).__name__}, not a JSON object.",
                      proc.stderr)

    tools = doc.get("tools")
    if not isinstance(tools, list) or not tools:
        raise _refuse(
            f"the emitter payload has no usable «tools» list (got "
            f"{type(tools).__name__}). Comparing against an empty catalogue would "
            f"recreate the original bug with extra steps.", proc.stderr)

    names: list[str] = []
    for entry in tools:
        name = entry.get("name") if isinstance(entry, dict) else None
        if not isinstance(name, str) or not name:
            raise _refuse(f"the emitter payload has an entry with no «name»: {entry!r}.",
                          proc.stderr)
        names.append(name)
    if len(set(names)) != len(names):
        raise _refuse("the emitter payload holds duplicate tool names.", proc.stderr)

    # The emitter states its own count. Trusting the list over the claim, or the
    # other way round, would hide a truncated payload; requiring them to agree
    # means a truncated one cannot be read as a complete one.
    count = doc.get("count")
    if count != len(names):
        raise _refuse(
            f"the emitter says count={count!r} but printed {len(names)} tool(s). A payload "
            f"that disagrees with itself cannot be compared against anything.", proc.stderr)

    # The paywall flag is required, not optional: `check_catalog` compares the gated
    # set against the tools declaring `checks_entitlement`, and a comparison over an
    # absent field is the silent no-op this whole module exists to prevent. The
    # emitter refuses without it, so reaching here without the key means something
    # else printed this payload.
    gated = doc.get("paywalled")
    if not isinstance(gated, list) or any(not isinstance(g, str) for g in gated):
        raise _refuse(
            f"the emitter payload has no «paywalled» list (got {type(gated).__name__}). "
            f"Without it the paywall obligation cannot be checked at all.", proc.stderr)
    unknown = sorted(set(gated) - set(names))
    if unknown:
        raise _refuse(
            f"the emitter marks tool(s) as paywalled that it does not list: "
            f"{', '.join(unknown)}.", proc.stderr)

    return NodeCatalog(tuple(names), frozenset(gated),
                       _families(doc, names, proc.stderr), _caps(doc.get("caps")))


def _caps(raw: Any) -> tuple[tuple[str, int], ...]:
    """The session-bus caps, or nothing.

    Anything that is not a mapping of names to positive integers comes back empty
    rather than raising, and that is a deliberate difference from the checks above:
    a broken `caps` says nothing about whether the TOOL LIST is trustworthy, so
    taking the export down over it would stop the artifact for a reason unrelated
    to the guarantee the artifact carries. `ai-doc` says out loud when it falls back
    and prints the sentence that points at the module instead — what it never does
    is print a number it did not read.
    """
    if not isinstance(raw, dict):
        return ()
    out: list[tuple[str, int]] = []
    for name, value in raw.items():
        # bool is an int in Python, and a cap of `True` is not a cap.
        if not isinstance(name, str) or isinstance(value, bool) or not isinstance(value, int):
            return ()
        if value <= 0:
            return ()
        out.append((name, value))
    return tuple(out)


def _families(doc: dict[str, Any], names: Sequence[str],
              stderr: str) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """Groups the tools by family, from whichever view the emitter provides.

    It gives two: a `families` map straight off `registry.families()`, and a
    `family` on each tool. When both are present they have to agree — a payload
    that contradicts itself cannot be rendered into a document that claims to
    describe the registry. Neither present is not an error here: only the document
    needs the grouping, and refusing the export over it would take the catalogue
    check down for a cosmetic reason.
    """
    grouped = doc.get("families")
    if isinstance(grouped, dict):
        out: list[tuple[str, tuple[str, ...]]] = []
        seen: set[str] = set()
        for family, members in grouped.items():
            if not isinstance(members, list) or any(not isinstance(m, str) for m in members):
                raise _refuse(f"the emitter's «families» entry {family!r} is not a list "
                              f"of names.", stderr)
            out.append((str(family), tuple(members)))
            seen.update(members)
        if seen != set(names):
            raise _refuse(
                f"the emitter's «families» and «tools» disagree: "
                f"only in families {sorted(seen - set(names))}, "
                f"only in tools {sorted(set(names) - seen)}.", stderr)
        return tuple(out)
    # Fall back to the per-tool field, in first-appearance order.
    order: list[str] = []
    members: dict[str, list[str]] = {}
    for entry in doc.get("tools", []):
        family = str(entry.get("family") or "")
        if family not in members:
            members[family] = []
            order.append(family)
        members[family].append(str(entry["name"]))
    if order == [""]:
        return ()
    return tuple((f, tuple(members[f])) for f in order)


def drift(declared: Iterable[str], exposed: Iterable[str]) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """(extra_in_python, missing_in_python). BOTH directions matter.

    · Node exposes one that is not declared here -> the model can call it and no
      obligation covers it. That is the hole there was.
    · One is declared here that Node does not expose -> the ontology promises a
      tool that does not exist, and the prompt announces it to the model.
    """
    d, e = set(declared), set(exposed)
    return tuple(sorted(d - e)), tuple(sorted(e - d))


def check_catalog(cmd: Sequence[str] | None = None) -> tuple[str, ...]:
    """A list of problems, in plain language. Empty = the two catalogs agree.

    Two comparisons, both of them preconditions of the export rather than tests
    somebody may remember to run:

      names      what Node executes vs what this ontology declares AS BRIDGED,
                 both ways.
      paywall    the tools Node gates on entitlement vs the tools declaring
                 `checks_entitlement`. P4 is checked against that declaration, so
                 a declaration that does not match the code turns P4 green while
                 the leak stays open — which is exactly how the paywall became
                 invisible the first time.
      native     the Node-facing half of obligation P5: a name declared native
                 must NOT also be in Node's registry, and everything a native
                 composes must be a tool Node really exposes and does not gate.

    WHY THE FIRST COMPARISON READS `bridged` AND NOT THE WHOLE DECLARATION.
    It is the same total equality it always was, in both directions, over the
    population that CLAIMS Node executes it. Nothing was relaxed: a name is bridged
    only because its declaration says Node runs it, and saying that while Node does
    not expose it still trips the `extra` arm with its original message. The
    alternative — comparing the whole list and teaching the check to overlook the
    names Node does not have — is the subset check that kills that arm, and with it
    the case of a misspelt bridged name reaching the model as a tool that always
    errors.
    """
    node = node_catalog(cmd)
    bridged = {n: h for n, h in GRAPH.tools.items() if h.runner == "node"}
    native = {n: h for n, h in GRAPH.tools.items() if h.runner == "python"}
    extra, missing = drift(bridged, node.names)
    declaring = frozenset(n for n, h in bridged.items() if h.checks_entitlement)
    gated_only = tuple(sorted(node.paywalled - declaring))
    declared_only = tuple(sorted(declaring - node.paywalled))
    # P5, Node-facing. Two dispatch paths for one name is the failure: the model
    # cannot tell which authority answered, and the entitlement question reopens for
    # the Node half. And a native composing a gated tool would be a native returning
    # paid content through the back door.
    shadowed = tuple(sorted(n for n in native if n in node.names))
    unknown_composed = tuple(sorted(
        f"{n} -> {c}" for n, h in native.items() for c in h.composes
        if c not in node.names))
    gated_composed = tuple(sorted(
        f"{n} -> {c}" for n, h in native.items() for c in h.composes
        if c in node.paywalled))

    lines: list[str] = []
    if extra or missing:
        lines.append(f"the declared bridged catalog ({len(bridged)}) and the one Node exposes "
                     f"({len(node.names)}) do not match")
        if missing:
            lines.append(f"  Node executes them and they are NOT declared here "
                         f"(nobody proves them): {', '.join(missing)}")
        if extra:
            lines.append(f"  declared here and Node does NOT expose them "
                         f"(the ontology is lying): {', '.join(extra)}")
    if gated_only or declared_only:
        lines.append("the paywall flag and `checks_entitlement` do not match")
        if gated_only:
            lines.append(f"  Node gates them and the ontology does NOT declare it "
                         f"(P4 cannot check what is not declared): {', '.join(gated_only)}")
        if declared_only:
            lines.append(f"  the ontology declares it and Node does NOT gate them "
                         f"(P4 is green over an open leak): {', '.join(declared_only)}")
    if shadowed or unknown_composed or gated_composed:
        lines.append("the native tools do not agree with Node's registry")
        if shadowed:
            lines.append(f"  declared native and Node ALSO exposes them "
                         f"(two dispatch paths for one name): {', '.join(shadowed)}")
        if unknown_composed:
            lines.append(f"  a native composes a tool Node does not expose "
                         f"(the call would answer herramienta_desconocida): "
                         f"{', '.join(unknown_composed)}")
        if gated_composed:
            lines.append(f"  a native composes a GATED tool (a native may never "
                         f"return paid content): {', '.join(gated_composed)}")
    if not lines:
        return ()
    lines.append(f"  source: {' '.join(cmd) if cmd is not None else ' '.join(EMITTER_CMD)}")
    return tuple(lines)


def payload() -> dict[str, Any]:
    g = GRAPH
    order, cycle = g.topological_order()
    body = {
        "generado_por": "ai/src/course_ai/ontology/export.py",
        "aviso": "ARTEFACTO GENERADO. No editar a mano: se regenera con `uv run ai-export`.",
        "version": 3,
        # AXIS 1, privacy. Two shapes on purpose: `clases` is the complete
        # per-column truth, `prohibidas` is the per-table list the runtime guard
        # (assertNoForbidden) consumes directly so it does not have to derive one.
        "prohibidas": {t: list(g.forbidden_columns(t)) for t in sorted(g.tables)},
        "clases": {f"{t}.{c}": x.sensitivity
                   for t, tab in sorted(g.tables.items())
                   for c, x in tab.columns.items()},
        # AXIS 2, entitlement — the same two shapes, and new to the artifact.
        #
        # It was absent, which left the two axes asymmetric where it hurts:
        # `assertNoForbidden` re-checks a returned row's actual keys against
        # `prohibidas`, so an incomplete `devuelve` declaration is still caught at
        # runtime for a `jamas` column. Nothing did that for `de_pago`, so the same
        # single mistake — a column added to a SELECT and not to `devuelve` — was
        # invisible to P4 (which reads `devuelve`) and invisible at runtime too,
        # unless the tool happened to carry the `paywalled` flag.
        #
        # Exporting it enforces nothing on its own; the runtime guard is api's
        # decision. This is the half that makes the fact available, and it is what
        # lets `ai-doc` render the paywall column of every table.
        "de_pago": {t: list(g.paywalled_columns(t)) for t in sorted(g.tables)},
        "muros": {f"{t}.{c}": x.paywall
                  for t, tab in sorted(g.tables.items())
                  for c, x in tab.columns.items()},
        # `ejecutor` is new, and it is here for the same reason the whole third axis
        # exists: this file's subject is «what Node executes», and an unlabelled
        # native name inside it is the drift bug in slow motion — a reader (or a
        # future guard) would take every entry for a bridged tool. Node types this
        # key `Record<string, unknown>` (api/src/ontology.ts:35) and consumes none of
        # its fields, so adding one is additive there.
        "herramientas": {n: {"alcance": h.scope, "usa": list(h.reads),
                             "devuelve": list(h.returns), "args": list(h.args),
                             "ejecutor": h.runner, "compone": list(h.composes)}
                         for n, h in sorted(g.tools.items())},
        "orden_borrado": list(reversed(order)),
        "ciclo_fk": list(cycle),
        "prompt_sha": {"es": fingerprint("es"), "en": fingerprint("en")},
        "violaciones": [{"herramienta": v.tool, "motivo": v.rule, "detalle": v.detail}
                        for v in g.prove_isolation()],
    }
    # The fingerprint covers the body, not the file: that is what lets the field
    # live inside it.
    raw = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    body["sha"] = sha256(raw.encode("utf-8")).hexdigest()[:16]
    return body


def main() -> int:
    """`uv run ai-export`. Exits 1 if the ontology has violations, or if the
    declared catalog does not match the one Node exposes: an artefact that
    documents a leak —or a proof run over the wrong list— does not get written."""
    # Drift is checked BEFORE the violations. If there are tools left to declare,
    # «0 violations» means nothing: it means nobody looked at them.
    try:
        problems = check_catalog()
    except CatalogDrift as e:
        print(f"NOT exporting: {e}")
        return 1
    if problems:
        print("NOT exporting: " + problems[0])
        for line in problems[1:]:
            print(line)
        return 1
    # The concept map is checked here, BEFORE payload(), for exactly the reason the
    # catalogue is: a precondition of writing the artefact, not a test somebody
    # remembers. The map routes questions to lesson numbers, and a number that no
    # longer exists in the index Node serves sends the model somewhere Node cannot
    # answer. Imported inside the function so `ai-export` still imports cleanly if
    # the retrieval package is being edited — the failure then is loud, below.
    from ..retrieval.check import check_concepts
    from ..retrieval.index import IndexUnreadable
    try:
        concept_problems = check_concepts()
    except IndexUnreadable as e:
        print(f"NOT exporting: could not read the lesson index ({e}).")
        print("A check that cannot run has FAILED.")
        return 1
    if concept_problems:
        print("NOT exporting: the concept map does not agree with the lesson index Node serves")
        for line in concept_problems:
            print(line)
        return 1
    d = payload()
    if d["violaciones"]:
        print(f"NOT exporting: {len(d['violaciones'])} isolation violation(s)")
        for v in d["violaciones"]:
            print(f"  [{v['herramienta']}] {v['motivo']}: {v['detalle']}")
        return 1
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(d, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                      encoding="utf-8")
    n = sum(len(v) for v in d["prohibidas"].values())
    print(f"wrote {TARGET.relative_to(TARGET.parents[2])}: "
          f"{n} forbidden columns, sha {d['sha']}, prompt es/{d['prompt_sha']['es']}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
