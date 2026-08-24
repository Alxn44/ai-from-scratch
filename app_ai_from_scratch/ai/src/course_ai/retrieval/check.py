"""`ai-check-concepts`: the concept map must agree with the index Node serves.

WHY THIS IS A GATE AND NOT A TEST SOMEBODY REMEMBERS

The map holds lesson NUMBERS. A number is the cheapest thing in the system to get
wrong and the most expensive to notice: nothing crashes, the tool answers, and the
model teaches lesson 7 to a question about lesson 9. Both directions are
load-bearing, for exactly the reason `drift()` gives about tools:

  · a concept pointing at a lesson that does not exist sends the model somewhere
    Node cannot serve — a broken promise the student sees as «that lesson is
    empty».
  · a lesson NO concept covers is a hole the router silently declines to fill, and
    then the model answers from memory. That is the failure `buscar_en_curso`'s own
    description tells it not to commit, arriving through the tool built to prevent
    it.

So it runs in `verify.STEPS` between «isolation» and «export», and `ai-export`
calls `check_concepts()` before `payload()` — the artefact cannot be regenerated
over a drifted map. That is the same leverage that makes the tool-catalogue check
non-negotiable rather than optional.

AND IF IT CANNOT RUN: that is a FAILURE. No emitter, no Node, unreadable JSON —
all of them exit 1 with «A check that cannot run has FAILED». A guard that reports
success when it inspected nothing is worse than no guard, because the review
passes.
"""

from __future__ import annotations

from collections.abc import Sequence

from .concepts import CONCEPT_FIELDS, CONCEPTS, declared_fields
from .index import EMITTER_CMD, IndexUnreadable, LessonIndex, lesson_index
from .query import words


def check_shape() -> tuple[str, ...]:
    """The map may hold six things and no seventh.

    This is the enforcement half of the module header of concepts.py. The tempting
    seventh field is a per-lesson list of «anchor» words — measured, they route
    beautifully, and every one of them is lifted verbatim out of `lessons.technical`,
    `lessons.analogy` or `lesson_text.*`, all `muro: de_pago`. A field for them would
    make this package a derivative of the paid corpus: a second place where paid
    content lives. An argument in a comment cannot stop that; a check can.
    """
    actual = declared_fields()
    if actual == CONCEPT_FIELDS:
        return ()
    extra = [f for f in actual if f not in CONCEPT_FIELDS]
    missing = [f for f in CONCEPT_FIELDS if f not in actual]
    lines = ["the shape of `Concept` changed"]
    if extra:
        lines.append(f"  fields that are not allowed on the map: {', '.join(extra)}. "
                     f"Lesson NUMBERS, beginner phrasings and public glossary terms only — "
                     f"nothing copied out of a `de_pago` column.")
    if missing:
        lines.append(f"  fields the checks below need and cannot find: {', '.join(missing)}")
    return tuple(lines)


def compare(index: LessonIndex) -> tuple[str, ...]:
    """The six directions, as plain lines. Empty = the map and the index agree."""
    lines: list[str] = []
    lessons = frozenset(index.lessons)

    # 1. the map points at a lesson that does not exist.
    ghosts = [(c.slug, c.leccion) for c in CONCEPTS if c.leccion not in lessons]
    if ghosts:
        lines.append("  concepts pointing at a lesson that does not exist: "
                     + ", ".join(f"{slug} -> {n}" for slug, n in ghosts))

    # 2. a lesson no concept covers. The hole the router declines to fill.
    covered = {c.leccion for c in CONCEPTS}
    uncovered = sorted(lessons - covered)
    if uncovered:
        lines.append("  lessons no concept covers (a question about them routes to memory): "
                     + ", ".join(str(n) for n in uncovered))

    # 3. a glossary term the map invented, or pinned to the wrong lesson. Both are
    #    the same defect seen from two sides: the map claiming vocabulary that
    #    `glosario` will not corroborate when the model asks it.
    invented: list[str] = []
    misplaced: list[str] = []
    for c in CONCEPTS:
        for t in c.terms_es + c.terms_en:
            n = index.lesson_of(t)
            if n is None:
                invented.append(f"{t} ({c.slug})")
            elif n != c.leccion:
                misplaced.append(f"{t} -> map says {c.leccion}, `glosario` says {n}")
    if invented:
        lines.append("  glossary terms the map invents (not in `glosario`): "
                     + ", ".join(invented))
    if misplaced:
        lines.append("  glossary terms attached to the wrong lesson: " + ", ".join(misplaced))

    # 4. one phrasing routed to two lessons. Ambiguity the scorer cannot resolve and
    #    would resolve silently, by whichever concept happens to be declared first.
    seen: dict[tuple[str, ...], list[tuple[str, int]]] = {}
    for c in CONCEPTS:
        for p in c.phrasings_es + c.phrasings_en:
            key = words(p)
            seen.setdefault(key, []).append((p, c.leccion))
    for _key, owners in sorted(seen.items()):
        targets = sorted({n for _, n in owners})
        if len(targets) > 1:
            lines.append(f"  one phrasing routed to two lessons: \"{owners[0][0]}\" -> "
                         + ", ".join(str(n) for n in targets))

    # 5. an empty concept. It can never be routed to, so its lesson is covered on
    #    paper and unreachable in fact — which is worse than an uncovered lesson,
    #    because check 2 above reports it as covered.
    silent = [c.slug for c in CONCEPTS
              if not (c.phrasings_es or c.phrasings_en) or not (c.terms_es or c.terms_en)]
    if silent:
        lines.append("  concepts with no phrasing or no term (nothing can ever route to them): "
                     + ", ".join(silent))

    # 6. one SLUG pointing at two lessons. Check 4 above is the same defect on the
    #    other axis — one phrasing, two lessons — and this one was missing, which is
    #    how it stayed invisible: `BY_SLUG` is a dict comprehension over CONCEPTS,
    #    so the second Concept with a given slug silently REPLACES the first.
    #
    #    MEASURED, from the mutation a copy-paste of a neighbouring Concept produces
    #    (`slug="daily_habit", leccion=12` -> `slug="parameters", leccion=12`):
    #    len(CONCEPTS) = 12, len(BY_SLUG) = 11, `ai-check-concepts` exit 0 printing
    #    «12 concepts over 12 lesson(s)», pytest exit 0, `ai-export` exit 0 and it
    #    REWROTE api/src/ontologia.json. Inside one turn `rank('donde guarda lo que
    #    aprendio')` answered concepto=parameters leccion=3 while
    #    `mapa_de_conceptos(concepto="parameters")` — which resolves through
    #    `BY_SLUG[asked]` — answered leccion=12. Two lesson numbers for one slug, no
    #    error, no gate red, and the lesson-3 concept unreachable by slug forever.
    owners: dict[str, list[int]] = {}
    for c in CONCEPTS:
        owners.setdefault(c.slug, []).append(c.leccion)
    twins = [(slug, ns) for slug, ns in owners.items() if len(ns) > 1]
    if twins:
        lines.append("  one slug pointing at two lessons (BY_SLUG keeps only the last): "
                     + ", ".join(f"{slug} -> {', '.join(str(n) for n in ns)}"
                                 for slug, ns in twins))
    return tuple(lines)


def check_concepts(cmd: Sequence[str] | None = None) -> tuple[str, ...]:
    """Every problem, in plain language. Empty = the map is accepted.

    Raises `IndexUnreadable` rather than returning a partial verdict: «I could not
    look» and «I looked and it was fine» must never be the same value.
    """
    shape = check_shape()
    index = lesson_index(cmd)
    problems = compare(index)
    if not (shape or problems):
        return ()
    source = " ".join(cmd) if cmd is not None else " ".join(EMITTER_CMD)
    return (*shape, *problems, f"  source: {source}")


def main() -> int:
    """`uv run ai-check-concepts`. Exit 1 on disagreement, and exit 1 when it could
    not look at all."""
    try:
        problems = check_concepts()
    except IndexUnreadable as e:
        print(f"NOT accepting the concept map: could not read the lesson index ({e}).")
        print("A check that cannot run has FAILED.")
        return 1
    if problems:
        print("NOT accepting the concept map: it does not agree with the lesson index "
              "Node serves")
        for line in problems:
            print(line)
        return 1
    # Says WHAT was compared and over how much, because «ok» over nothing is the
    # sentence this repository has learned not to trust.
    lessons = {c.leccion for c in CONCEPTS}
    phr = sum(len(c.phrasings_es) + len(c.phrasings_en) for c in CONCEPTS)
    trm = sum(len(c.terms_es) + len(c.terms_en) for c in CONCEPTS)
    # ADDRESSABLE, not declared. `len(CONCEPTS)` counted the declarations, and two
    # Concepts sharing a slug make one of them unreachable through `BY_SLUG` while
    # this line still said «12 concepts». Printing the number of distinct slugs
    # beside it means the count cannot lie even for the moment before check 6 in
    # `compare()` refuses the run.
    addressable = len({c.slug for c in CONCEPTS})
    print(f"concepts: {len(CONCEPTS)} concepts ({addressable} addressable by slug) over "
          f"{len(lessons)} lesson(s), {phr} phrasings, {trm} glossary term(s) — all checked "
          f"against the index Node serves (numbers and glossary keys only; no lesson text "
          f"crosses this line)")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
