"""Retrieval: the routing MEASUREMENT, the fail-closed gates, and the native tools.

THE NUMBERS THIS FILE EXISTS FOR, and the first thing to say about them is which
one is load-bearing. Over the 138 real beginner questions in ai/tests/queries.py,
against a FIXTURE index so the routing half needs no database:

                            all 138        HELD OUT (121)     in the map (17)
    router alone            61  44%        45  37%            16
    substring search        71  51%        65  54%             6
    COMPOSED               106  77%        89  74%            17
    router precision        61/64  95%     45/48  94%
    the hard subset          7/12          search 0/12

READ THE HELD-OUT COLUMN. 17 of the 138 are verbatim phrasings in `concepts.py`,
because the map was authored with this fixture visible; on those the map finds
itself (16 of 17) and the substring search gets 6. That subset is not evidence of
anything except internal consistency, and a number that includes it goes UP every
time somebody writes a new phrasing — measuring the author, not the router. So
every floor below is asserted on the 121 the map was NOT written for, and the
in-map subset is counted separately and pinned so it cannot quietly grow.

THE ROUTER ALONE DOES NOT BEAT SUBSTRING COUNTING. 45 against 65 on held-out
questions, and this file asserts that it does not, because the opposite claim was
made here for a while and it was false. What the router is good at is one thing
only: being RIGHT when it speaks (94% precision) and quiet the rest of the time. It
answers 48 of 121 and declines 73.

THE COMPOSITION IS THE VALUE, and it is the strategy the tools actually implement:
route if the map knows the words, else `sin_ruta` + `siguiente: "buscar_en_curso"`.
89 against 65 on held-out questions, +24. Not because the map is a better scorer,
but because 94% precision makes a decline worth handing on rather than guessing at.

BOTH COLUMNS COME FROM THE SAME 138 SENTENCES, and the substring column is
GENERATED rather than typed: `baseline.search_baseline()` runs
scripts/emit-search-baseline.mjs, which calls `buscar_en_curso` over the corpus
api/src/seed.ts defines. The previous version of this file compared against a
hand-typed dict that disagreed with the real scorer on 53 of 138 entries and
claimed 75/138 where the truth is 70 — with a test that only checked the dict
against itself. Every number above is one run of two real scorers over one list.

THE POPULATION IT CANNOT SERVE, kept visible: 23 of the 138 quote the course's own
analogy («es como afinar una guitarra»), answerable only through words that live in
`lessons.analogy`, `muro: de_pago`. This package may not hold them, so the router
declines 20 of the 23 and the search — which reads the paid text, behind Node's
paywall — gets 16. That is the design, not a defect.

AND THE QUESTIONS THAT ARE NOT ABOUT A LESSON AT ALL: 44 real customer messages in
`queries.OFF_TOPIC` (price, invoice, password, dark mode, the weather). The router
used to name a lesson for 18 of them — «cuanto cuesta el curso completo» came back
as lesson 4 at confianza 1.0. It now names a lesson for NONE of them, and names the
public tool that holds the fact (`precio_y_compra`, `soporte`, `ajustes`…) for 31.
That is `intent.py` plus a floor that no longer lets one shared word route.
"""

from __future__ import annotations

import json
import sys
from typing import Any

import pytest
from baseline import BaselineUnreadable, measure, search_baseline
from baseline import parse as parse_baseline
from queries import ALL, EN, ES, HARD, OFF_TOPIC

from course_ai.ontology.data import NATIVE, TOOLS
from course_ai.retrieval import check as check_mod
from course_ai.retrieval.check import check_concepts, check_shape, compare
from course_ai.retrieval.concepts import CONCEPTS, Concept
from course_ai.retrieval.index import IndexUnreadable, LessonIndex, lesson_index, parse
from course_ai.retrieval.intent import (
    INTENT_FIELDS,
    INTENTS,
    PRODUCT_NOUNS,
    Intent,
)
from course_ai.retrieval.intent import match as intent_of
from course_ai.retrieval.query import (
    FLOOR,
    W_PHRASE,
    W_SYNONYM,
    W_TERM,
    prepare,
    rank,
    rewrite,
    stopwords,
)
from course_ai.retrieval.tools import (
    NATIVE_HANDLERS,
    Ctx,
    Fence,
    NotComposed,
    accepted,
    ampliar_consulta,
    dispatch,
    entender_pregunta,
    mapa_de_conceptos,
)

# ---------------------------------------------------------------- recorded floors
# Raise them only from a real run that beats them, and change the numbers in the
# module docstring in the same edit. A floor nobody can trace to a run is a wish.
#
# THE FLOORS THAT MATTER ARE THE HELD-OUT ONES. 17 of the 138 are verbatim
# phrasings in `concepts.py`, and a floor over all 138 rises whenever somebody
# writes a new phrasing — which ratchets the number up on questions the author just
# wrote into the map while the router's real contribution stays where it was. So the
# assertions are on the 121 the map was not written for, `CEILING_IN_MAP` pins the
# in-map subset so it cannot grow silently, and the all-138 numbers are RECORDED
# here for the docstring's table rather than asserted as achievements.
FLOOR_HELD_OUT_COMPOSED = 89   # THE NUMBER. router if it routes, else the search.
FLOOR_HELD_OUT_ROUTER = 45     # the router alone. Below the search, and asserted so.
HELD_OUT_SEARCH = 65           # generated, not typed. Equality: see the test.
HELD_OUT_TOTAL = 121
CEILING_IN_MAP = 17            # the fixture's overlap with the map. It may not grow.
IN_MAP_SEARCH = 6              # generated substring hits on the 17 in-map rows.

FLOOR_TOTAL = 61          # router alone, over all 138. Recorded, not the claim.
FLOOR_ES = 32
FLOOR_EN = 29
FLOOR_SEARCH = 71         # the generated baseline over all 138.
FLOOR_COMPOSED = 106
FLOOR_PRECISION = 0.93    # 61/64 = 95%. What makes declining worth more than
                          # guessing, and the only property the router is good at.
CEILING_ROUTED = 64       # answering MORE often is a regression until precision
                          # is re-measured: 74 declines are worth 42 search hits.


# ------------------------------------------------------------------- the fixture
def _index_payload(lessons: int = 12) -> dict[str, Any]:
    """A well-formed emitter payload, built from the map's own glossary claims.

    It is NOT a copy of Node's glossary: the terms come from `concepts.py`, so this
    fixture says «the index agrees with the map». Every test that wants disagreement
    breaks one field of it on purpose, and the REAL agreement is checked by
    `ai-check-concepts` against the real emitter — which is a separate test below,
    and one of the two here that need Node.
    """
    per_term: dict[str, int] = {}
    alias: dict[str, str] = {}
    for c in CONCEPTS:
        for t in c.terms_es:
            per_term[t] = c.leccion
        for t in c.terms_en:
            alias[t] = c.terms_es[0]
    return {
        "count": lessons,
        "lecciones": [{"n": n} for n in range(1, lessons + 1)],
        "glosario": sorted(per_term),
        "glosario_lecciones": per_term,
        "glosario_alias": alias,
    }


def _fixture_index() -> LessonIndex:
    return parse(_index_payload())


def _emitter(*, stdout: str = "", exit_code: int = 0, stderr: str = "") -> tuple[str, ...]:
    """A stand-in for an emitter script with a scripted answer."""
    prog = (
        "import sys\n"
        f"sys.stdout.write({stdout!r})\n"
        f"sys.stderr.write({stderr!r})\n"
        f"sys.exit({exit_code})\n"
    )
    return (sys.executable, "-c", prog)


class FakeBridge:
    """Records every call. A native tool that reaches for anything beyond what it
    declares in `composes` is visible here as a name in `calls` — and, since the
    fence went in, cannot get that far in the first place."""

    def __init__(self, answer: Any = None) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.answer = answer

    async def call(self, client, session, name, args, timeout_s: float = 20.0):
        self.calls.append((session, name, dict(args)))
        if isinstance(self.answer, dict) or isinstance(self.answer, list):
            return self.answer
        return {"lecciones": [{"n": n, "title": f"Leccion {n}"} for n in range(1, 13)]}


def _ctx(bridge: FakeBridge | None = None, lang: str = "es") -> Ctx:
    return Ctx(client=None, session="cookie", bridge=bridge or FakeBridge(), lang=lang)


# --------------------------------------------------------------- the measurement
def _route(query: str, lang: str) -> int | None:
    r = rank(query, lang)
    return r[0].concept.leccion if r else None


def _in_map() -> tuple[tuple[str, int, str], ...]:
    """The fixture rows that are VERBATIM phrasings in the map."""
    from course_ai.retrieval.concepts import phrasings

    known = {p for c in CONCEPTS for p in phrasings(c)}
    return tuple(r for r in ALL if r[0] in known)


def _held_out() -> tuple[tuple[str, int, str], ...]:
    seen = {r[0] for r in _in_map()}
    return tuple(r for r in ALL if r[0] not in seen)


def _tally(rows=ALL):
    """(router, search, composed, routed, misses) over `rows`.

    All four strategies are counted in ONE pass over ONE list, so they cannot drift
    onto different populations. `composed` is what the model does when it follows
    `entender_pregunta`: the route if there is one, and `siguiente:
    "buscar_en_curso"` when `sin_ruta` comes back.

    `search` comes from `baseline.search_baseline()`, which RUNS
    `buscar_en_curso` — the previous version of this function read a dict typed into
    queries.py that was wrong on 53 of 138 entries.
    """
    base = search_baseline()
    router = search = composed = routed = 0
    misses: list[tuple[str, str, int, int | None, int | None]] = []
    for query, want, lang in rows:
        got = _route(query, lang)
        found = base[query]
        if got is not None:
            routed += 1
        router += got == want
        search += found == want
        composed += (got == want) if got is not None else (found == want)
        if got != want:
            misses.append((lang, query, want, got, found))
    return router, search, composed, routed, misses


def _report(misses) -> str:
    return "\n".join(f"    [{lang}] {q!r} want {want} router {got} search {found}"
                      for lang, q, want, got, found in misses)


def test_the_substring_baseline_is_measured_and_not_transcribed():
    """Asserted BEFORE anything is compared against it, and it is now GENERATED.

    71 of 138 = 51%. The number this replaced was 75 (54%), typed by hand and wrong
    on 53 of its 138 entries; the test that guarded it asserted that the typed dict
    summed to the number the docstring quoted, which is the copy checked against
    itself. This one runs the scorer.

    Equality and not `>=`: if somebody improves `buscar_en_curso` — feeding
    `glossaryFor` into the score is the obvious next move — this goes red, and that
    is the point. The router's whole margin is quoted against this column, so the
    column moving is a reason to re-measure the claim, not something to absorb.
    """
    _, search, _, _, _ = _tally()
    assert search == FLOOR_SEARCH, (
        f"the substring baseline moved: {search} != {FLOOR_SEARCH}. It is generated by "
        f"scripts/emit-search-baseline.mjs, so this means api's search or the corpus "
        f"changed. Re-measure every comparison in this file before touching the number.")


def test_a_baseline_that_cannot_be_measured_is_a_FAILURE_and_not_a_skip():
    """The house rule, on the one column this file cannot compute for itself.

    Python holds no corpus — it may not — so the baseline is a subprocess, and a
    subprocess is a thing that can fail. Every failure raises: no cached copy, no
    `pytest.skip`, no empty dict. A comparison that silently ran against nothing is
    the shape of the defect this whole file was rebuilt to remove.
    """
    with pytest.raises(BaselineUnreadable) as e:
        measure(ALL, ("definitely-not-a-real-binary-9f3c",))
    assert "cannot run" in str(e.value)
    with pytest.raises(BaselineUnreadable):
        measure(ALL, _emitter(exit_code=1, stderr="boom"))
    with pytest.raises(BaselineUnreadable):
        measure(ALL, _emitter(stdout="<html>nope</html>"))


@pytest.mark.parametrize("label,doc,expected", [
    ("not an object", [], "not a JSON object"),
    ("no lesson map", {"leccion": {}}, "no usable «leccion»"),
    ("a query it did not answer", {"leccion": {"algo": 1}}, "did not answer for"),
])
def test_every_way_the_baseline_payload_can_be_wrong_refuses(label, doc, expected):
    with pytest.raises(BaselineUnreadable) as e:
        parse_baseline(doc, ALL)
    assert expected in str(e.value), (label, str(e.value))


def test_a_baseline_answer_that_is_not_a_lesson_number_refuses():
    """`null` is a real answer — the search found nothing — and anything else is not."""
    doc = {"leccion": {q: 1 for q, _n, _l in ALL}}
    doc["leccion"][ALL[0][0]] = "siete"
    with pytest.raises(BaselineUnreadable) as e:
        parse_baseline(doc, ALL)
    assert "expected a lesson number" in str(e.value)
    doc["leccion"][ALL[0][0]] = None
    assert parse_baseline(doc, ALL)[ALL[0][0]] is None


def test_the_held_out_composition_is_the_claim():
    """THE NUMBER: 89 of the 121 questions the map was NOT written for, against the
    substring search's 65. +24.

    Held out, because the other 17 are phrasings somebody copied into `concepts.py`
    from this very fixture and the map scores 16 of them — a floor including those
    goes up every time a phrasing is added, which measures the author.

    It is the composition and not the router because it is the strategy the tools
    implement: `entender_pregunta` returns a route when the map knows the words and
    `sin_ruta` + `siguiente: "buscar_en_curso"` when it does not.
    """
    rows = _held_out()
    assert len(rows) == HELD_OUT_TOTAL, f"the held-out population changed: {len(rows)}"
    router, search, composed, _routed, misses = _tally(rows)
    assert search == HELD_OUT_SEARCH, f"the held-out baseline moved: {search}"
    assert composed >= FLOOR_HELD_OUT_COMPOSED, (
        f"the held-out composition regressed to {composed}/{len(rows)} "
        f"(floor {FLOOR_HELD_OUT_COMPOSED}).\n{_report(misses)}")
    assert composed > search, (composed, search)
    assert router >= FLOOR_HELD_OUT_ROUTER, (
        f"held-out routing regressed: {router}/{len(rows)}.\n{_report(misses)}")


def test_the_router_alone_does_NOT_beat_substring_counting():
    """The unflattering finding, asserted so it cannot be quietly re-claimed.

    45 against 65 on held-out questions. This file asserted the OPPOSITE for a
    while — «the router alone beats substring counting», 62% against 54% — and both
    halves of that were wrong: the 54% came from a hand-typed baseline that was
    wrong on 53 of 138 entries, and the 62% was inflated by the 17 fixture questions
    that are verbatim phrasings in the map.

    Asserting the negative is not pessimism, it is the guard against the ratchet: if
    somebody grows the phrasing list until this test fails, the failure message says
    where to look. A router that beat the search on questions nobody wrote into the
    map would be a real result and would need a real re-measurement — including
    whether the new phrasings changed the in-map count below.
    """
    router, search, _c, _r, _m = _tally(_held_out())
    assert router < search, (
        f"the router now scores {router} against the search's {search} on held-out "
        f"questions. If that is real, re-measure the whole table and rewrite the "
        f"docstring; if it is because phrasings were copied out of the fixture, the "
        f"in-map ceiling below is the test that should have caught it.")


def test_it_is_right_when_it_speaks():
    """Precision, 61/64 = 95%, and it is the property the composition rests on.

    A router that answered all 138 at 44% would be WORSE than one that answers 64 at
    95%: the 74 it declines are handed to a search that gets 42 of them right, and a
    confident wrong route replaces those with nothing. So answering MORE often is
    treated as a regression until precision has been re-measured.
    """
    router, _, _, routed, _ = _tally()
    assert routed <= CEILING_ROUTED, (
        f"it answers {routed} of {len(ALL)} now, up from {CEILING_ROUTED}. "
        f"Re-measure precision and the composition before raising this.")
    assert router / routed >= FLOOR_PRECISION, f"precision fell to {router}/{routed}"


def test_the_all_138_numbers_are_the_ones_the_docstring_prints():
    """The recorded table, so the header cannot drift from a run.

    These are NOT the claim — the held-out test above is — but they are printed at
    the top of this file, and a number in a docstring that no test reads is the
    thing this repository has learned not to trust.
    """
    router, search, composed, _routed, misses = _tally()
    assert router >= FLOOR_TOTAL, (
        f"routing accuracy fell to {router}/{len(ALL)} (floor {FLOOR_TOTAL}).\n"
        f"{_report(misses)}")
    assert composed >= FLOOR_COMPOSED, f"the composition regressed to {composed}/{len(ALL)}"
    assert composed > search and composed > router, (composed, search, router)
    for lang, floor in (("es", FLOOR_ES), ("en", FLOOR_EN)):
        rows = tuple(r for r in ALL if r[2] == lang)
        got, _s, _c, _r, _m = _tally(rows)
        # Asserted per language because a bilingual average hides one side being
        # broken, and English is the fragile one: `lessons` and `labs` have no `lang`
        # column, so in Node an English session searches 72 Spanish fields out of 96
        # and can never match `titulo` at all.
        assert got >= floor, f"{lang} fell to {got}/{len(rows)} (floor {floor})\n{_report(_m)}"


def test_the_questions_it_was_written_for_cannot_grow():
    """The anti-ratchet guard, and the disclosure it enforces.

    The map was authored with this fixture visible, so 17 of the 138 are verbatim
    phrasings in `concepts.py`, where the router scores 16 and the substring search
    scores 6. That 16 is the map finding itself: it is evidence of internal
    consistency and of nothing else.

    The ceiling is what makes it safe to report. Adding phrasings copied out of this
    fixture would raise every all-138 number in the docstring without the router
    generalising one question further, and this is the test that goes red when it
    happens — CEILING_IN_MAP is not a target, it is a limit on how much of the
    measurement may be self-referential.

    The recorded 16-of-17: «how up to date is it» is a verbatim phrasing of lesson 11
    whose only content word is `date`, worth at most W_PHRASE = 4.104, which is below
    FLOOR. A phrasing the map cannot route even when typed word for word is worth
    knowing about, so it is named here rather than smoothed into a percentage.
    """
    seen = _in_map()
    assert len(seen) == CEILING_IN_MAP, (
        f"the fixture's overlap with the map is now {len(seen)}, was {CEILING_IN_MAP}. "
        f"If phrasings were added, every number in the docstring is now measured on a "
        f"more self-referential fixture and has to be re-derived — and the held-out "
        f"floors are the ones that count.")
    seen_router, seen_search, _c, _r, _m = _tally(seen)
    assert seen_router >= 16, f"the map can no longer find its own phrasings: {seen_router}/17"
    assert seen_search == IN_MAP_SEARCH, f"the in-map baseline moved: {seen_search}"


def test_the_questions_that_quote_the_course_are_declined_rather_than_guessed():
    """The population this package is structurally unable to serve, kept visible.

    «like a waiter writing shorthand» is answerable only through the word `mesero`,
    which lives in `lessons.analogy` — `muro: de_pago`. Embedding it would make this
    module a derivative of the paid corpus (see the header of concepts.py), so the
    router has to DECLINE these rather than guess. Recorded: it answers 3 of 23 and
    gets 1 right, while the search gets 16. Declining is what routes them to the tool
    that can answer them, behind the paywall, where Node checks who paid.
    """
    rows = tuple(r for r in ALL if r[0].startswith(("es como ", "like ", "juega ")))
    assert len(rows) == 23, f"the analogy population changed: {len(rows)}"
    _router, search, _c, routed, _m = _tally(rows)
    assert routed <= 3, f"it is guessing at analogy questions: {routed} of 23 answered"
    assert search >= 16, "the search is the one that should be winning these"


def test_the_fixture_is_the_size_it_claims_to_be():
    """The floors are counts, not ratios, so a shrunken fixture would raise the
    accuracy without improving anything."""
    assert len(ES) == 78
    assert len(EN) == 60
    assert len(ALL) == 138
    assert len({q for q, _n, _l in ALL}) == len(ALL), "a duplicated query is a doubled vote"
    assert {n for _q, n, _l in ALL} == set(range(1, 13)), "some lesson is never asked about"
    # Every query has a measured baseline, or the comparison is over a subset that
    # nobody chose. `search_baseline()` refuses to return a partial map, so this is
    # the shape of the guarantee rather than a re-check of it.
    assert set(search_baseline()) == {q for q, _n, _l in ALL}
    # And the off-topic population, which is measured by different tests but has the
    # same failure mode: a duplicate is a doubled vote.
    assert len(OFF_TOPIC) == 44
    assert len({q for q, _l, _t in OFF_TOPIC}) == len(OFF_TOPIC)
    assert not ({q for q, _l, _t in OFF_TOPIC} & {q for q, _n, _l in ALL}), (
        "a sentence cannot be both a course question and an off-topic one")


def test_the_hard_subset_is_where_the_map_earns_its_keep():
    """7 of 12, against 0 of 12 for the search — and the 0 is the point.

    Measured over the live corpus: `aleatori` 0 occurrences · `alucin` 0 ·
    `hallucin` 0 · `habito` 0 · `random` exactly once, inside LESSON 2's text about
    answering «close to random» before training. No re-weighting inside
    `buscar_en_curso` can reach a word that is not in the text, and for `random` it
    routes CONFIDENTLY to the wrong lesson — worse than a miss, because the student
    cannot tell. «como agarro el habito» is lesson 12's own glossary term and the
    corpus writes `habito` in no lesson at all.

    The floor is 7 and not 12: five of these twelve still miss, and they are named
    when it breaks rather than quietly dropped from the subset. It was 8 before FLOOR
    rose to W_TERM — one of them was being carried by a single shared word, which is
    the bucket that was a coin flip everywhere else.
    """
    router, search, _c, _r, misses = _tally(HARD)
    assert search == 0, f"the generated hard-subset baseline moved: {search}"
    assert router >= 7, (
        f"the queries that justify the map regressed: {router}/12.\n{_report(misses)}")


def test_the_hard_subset_is_a_subset_of_the_fixture():
    """Otherwise it is a second fixture nobody counts."""
    everything = {(q, n, lang) for q, n, lang in ALL}
    assert set(HARD) <= everything, sorted(set(HARD) - everything)


# --------------------------------------------------- the defects it was built for
@pytest.mark.parametrize("word", ["que", "como", "por", "con", "una", "modelo"])
def test_the_spanish_stopwords_node_lets_through_score_nothing(word):
    """The measured survivors of Node's `length > 2` filter. Under substring scoring
    `con` matches *contexto*, *conversacion* and *consola*, so they do not merely add
    noise — they add it exactly where a real hit would land."""
    assert word in stopwords("es")
    assert prepare(word, "es").kept == ()
    assert rank(word, "es") == (), f"{word!r} alone routed somewhere"


@pytest.mark.parametrize("word", ["and", "model", "that", "the", "not", "you", "with"])
def test_the_english_stopwords_node_lets_through_score_nothing(word):
    assert word in stopwords("en")
    assert rank(word, "en") == ()


def test_a_question_made_only_of_stopwords_has_no_route():
    """And `sin_ruta` is the ANSWER, not a failure: the model is then told to say it
    does not know instead of picking the least bad lesson."""
    assert rank("por que como con una", "es") == ()
    assert prepare("por que como con una", "es").kept == ()


def test_the_beginners_word_is_bridged_to_the_courses_word():
    """`aleatorio` occurs nowhere in the corpus and `temperatura` occurs in one
    lesson, so the rewritten query is the one worth sending to `buscar_en_curso`."""
    out = rewrite("como lo hago menos aleatorio", "es")
    assert out, "no rewrite at all"
    assert any("temperatura" in v for v in out), out
    en = rewrite("how do i make it less random", "en")
    assert any("temperature" in v for v in en), en


def test_the_floor_is_what_produces_sin_ruta():
    """A weak single hit must not be presented as a route. This is the property that
    makes `sin_ruta` meaningful, so it is asserted rather than assumed."""
    assert FLOOR > 0
    assert rank("xyzzy plugh", "es") == ()


def test_the_floor_sits_above_ONE_PHRASING_WORD_and_at_ONE_TERM():
    """The inequality, and it is the fix for a whole class of confident-wrong route.

    FLOOR used to be 3.0, BELOW W_PHRASE (4.104). One query word shared with one
    phrasing of one concept therefore cleared it and routed, at confianza 0.34.
    Measured over the 182 pooled fixture questions, that bucket was 23 right and 24
    wrong — 49%, a coin flip — and it was 47 of the 115 answers the tool gave. «can
    it tell me the weather right now» went to lesson 7 on `tell`; «cuanto cuesta el
    curso completo» to lesson 4 at confianza 1.0.

    Asserted as a RELATION rather than as `FLOOR == 5.0`, because the failure it
    prevents is somebody re-tuning a weight: raising W_PHRASE above the floor
    re-opens the bucket without anybody editing the floor, and a test pinned to the
    number 5.0 would stay green through it.

        W_PHRASE < FLOOR <= W_TERM

    The upper bound is load-bearing too: one glossary term of the course has to be
    enough to route, or «que es un token» comes back `sin_ruta`.
    """
    assert W_PHRASE < FLOOR <= W_TERM, (W_PHRASE, FLOOR, W_TERM)
    assert W_SYNONYM < FLOOR, "a bridged synonym alone is weaker evidence than a term"
    # The two ends of the relation, as behaviour rather than arithmetic.
    one_term = rank("que es un token", "es")
    assert one_term and one_term[0].concept.leccion == 5, one_term
    # `date` is the single content word of «how up to date is it», a verbatim
    # phrasing of lesson 11: one phrasing word, and it must not route.
    assert rank("how up to date is it", "en") == ()


# --------------------------------------------- the questions no lesson answers
#
# THE DEFECT THIS SECTION EXISTS FOR, measured. `entender_pregunta` had two
# answers, a lesson or `sin_ruta`, and over the 44 real customer messages in
# `queries.OFF_TOPIC` it named a lesson for 18 of them. «cuanto cuesta el curso
# completo» came back as lesson 4 at confianza 1.0 — `cuesta` bridges to
# `inferencia` and lesson 4 carries «cuanto cuesta una respuesta» — so the model
# explained that training costs millions and answering costs cents to somebody who
# had asked the price. `precio_y_compra`, which holds the real price next to the
# checkout, was never called. The trace showed a confident, well-reasoned route.
async def test_no_off_topic_message_is_ever_answered_with_a_LESSON():
    """The one assertion all 44 rows share, and the only one that must never bend.

    Nothing here is about being clever. A customer asking for an invoice may be
    handed `soporte`, or `sin_ruta`, or nothing at all — all three are recoverable.
    A lesson number is not: the model teaches it, the person's actual problem goes
    unanswered, and the trace looks like a success.
    """
    named: list[tuple[str, Any]] = []
    for query, _lang, _tool in OFF_TOPIC:
        out = await entender_pregunta(_ctx(), {"pregunta": query})
        if out.get("conceptos"):
            named.append((query, out["conceptos"][0]))
    assert named == [], f"{len(named)} off-topic message(s) were answered with a lesson: {named}"


async def test_the_product_question_names_the_public_tool_that_holds_the_answer():
    """`sin_ruta` for «how much does it cost» is still a wrong answer: there IS a
    tool for it and the model was not told. Recorded: 31 of the 44 reach a tool, and
    every row that names an expected tool gets that exact one — 28 of 28.
    """
    reached = 0
    for query, _lang, want in OFF_TOPIC:
        out = await entender_pregunta(_ctx(), {"pregunta": query})
        tool = out.get("siguiente") if out.get("intencion") else None
        if tool:
            reached += 1
        if want is not None:
            assert tool == want, (query, tool, want)
    assert reached >= 31, f"only {reached} of {len(OFF_TOPIC)} product questions found a tool"


async def test_the_product_answer_carries_no_price_no_route_and_no_policy():
    """It names the tool; it does not answer. The price lives in api/src/product.ts,
    which the checkout reads too — a copy here would go stale in the direction that
    costs money."""
    out = await entender_pregunta(_ctx(), {"pregunta": "cuanto cuesta el curso completo"})
    assert out["intencion"] == "price_and_purchase"
    assert out["siguiente"] == "precio_y_compra"
    assert out["por_que"], "a route the model cannot explain is unauditable"
    flat = json.dumps(out, ensure_ascii=False)
    for forbidden in ("USD", "$", "%", "garantia de", "/pago", "dias"):
        assert forbidden not in flat, (forbidden, flat)
    # And no lesson number anywhere in the answer.
    assert "leccion" not in out and "conceptos" not in out, out


async def test_the_product_answer_costs_no_bridge_call():
    """It is a decision about words. Nothing to confirm, so nothing is fetched —
    which is also why an off-topic message cannot be a way to make this service call
    Node repeatedly."""
    bridge = FakeBridge()
    out = await entender_pregunta(_ctx(bridge), {"pregunta": "i forgot my password"})
    assert out["siguiente"] == "soporte"
    assert bridge.calls == [], bridge.calls


def test_the_intent_table_is_consulted_BEFORE_the_ranking():
    """The order is the fix, not the table.

    All three off-topic messages that still clear the raised floor score HIGH on a
    lesson: «cuanto cuesta el curso completo» and «how much does the full course
    cost» on lesson 4 at confianza 1.0, «i forgot my password» on lesson 8 at 1.0.
    Consulting the intent table only when the ranking came back empty would leave
    every one of them exactly as wrong as before.
    """
    for query, lang in (("cuanto cuesta el curso completo", "es"),
                        ("how much does the full course cost", "en"),
                        ("i forgot my password", "en")):
        ranked = rank(query, lang)
        assert ranked and ranked[0].confidence >= 0.9, (query, ranked)
        assert intent_of(query) is not None, query


def test_no_product_marker_matches_a_COURSE_question():
    """The direction the import-time check cannot see, over all 138.

    A marker that also means something in the course would answer «product» for a
    question about the course, which is the same failure in the other direction and
    a worse one: the person came to learn. Two candidates were rejected on this
    exact assertion — `dos veces`/`twice` matched «por que no sale igual dos veces»,
    and `error` is lesson 2's own glossary term.
    """
    captured = [(q, intent_of(q).intent.slug, intent_of(q).markers)
                for q, _n, _l in ALL if intent_of(q) is not None]
    assert captured == [], f"{len(captured)} course question(s) captured by a marker: {captured}"


def test_every_tool_an_intent_can_name_is_bridged_and_PUBLIC():
    """The import-time refusal in intent.py, restated as a test so the reason is
    written where somebody adding an intent will read it.

    Composed with `check_catalog()` — which proves the declared bridged set equals
    Node's registry and that `checks_entitlement` equals Node's `paywalled` flag —
    this makes «public tool Node really exposes» a proved property rather than a
    hopeful one.
    """
    assert INTENTS, "nothing is declared, so this proves nothing"
    for it in INTENTS:
        h = TOOLS.get(it.tool)
        assert h is not None, f"{it.slug} names an undeclared tool: {it.tool}"
        assert h.runner == "node", (it.slug, it.tool, h.runner)
        assert not h.checks_entitlement, (
            f"{it.slug} names the GATED tool {it.tool}: pointing at paid content is how a "
            f"router becomes a second entitlement authority")


def test_a_marker_claimed_by_two_intents_is_refused():
    """Ambiguity a scorer would resolve silently, by declaration order. Same defect
    as «one phrasing routed to two lessons» in the concept map."""
    from course_ai.retrieval import intent as intent_mod

    twin = Intent(slug="doble", tool="soporte", solo=("reembolso",), paired=())
    with pytest.raises(RuntimeError) as e:
        _with_intents(intent_mod, (*INTENTS, twin))
    assert "belongs to both" in str(e.value), str(e.value)


def test_a_solo_marker_made_of_COURSE_WORDS_is_refused():
    """The import-time overlap refusal. `error` is lesson 2's glossary term and
    `cuenta` is «cuenta letras o palabras»: a solo marker fires with no help, so it
    has to contain a word the course does not use."""
    from course_ai.retrieval import intent as intent_mod

    bad = Intent(slug="malo", tool="soporte", solo=("error",), paired=())
    with pytest.raises(RuntimeError) as e:
        _with_intents(intent_mod, (bad,))
    assert "vocabulary the concept map already uses" in str(e.value), str(e.value)


def test_a_fifth_field_on_an_intent_is_refused(monkeypatch):
    """The structural check, and the tempting fifth field is an ANSWER: the price,
    the route, the refund window. Those live in api/src/product.ts, which the
    checkout reads — a copy here is the second copy that goes stale."""
    from course_ai.retrieval import intent as intent_mod

    monkeypatch.setattr(intent_mod, "_declared_fields",
                        lambda: (*INTENT_FIELDS, "respuesta"))
    with pytest.raises(RuntimeError) as e:
        intent_mod._check()
    assert "the shape of `Intent` changed" in str(e.value)


def _with_intents(intent_mod, intents):
    """Re-run intent.py's own import-time check over a replacement table.

    It calls the REAL `_check()` rather than a copy of its rules, so these tests
    cannot pass against a check that no longer does what they describe.
    """
    original = intent_mod.INTENTS
    try:
        intent_mod.INTENTS = intents
        intent_mod._check()
    finally:
        intent_mod.INTENTS = original


def test_a_paired_marker_is_allowed_to_be_ambiguous_and_a_product_noun_is_not():
    """The two tiers, as the property that makes the table precise.

    `cuesta` is course vocabulary and stays a PAIRED marker: it fires only with a
    product noun in the sentence, which is what separates «cuanto cuesta el curso»
    from «por que entrenarla cuesta tanto» — a distinction no single word can make.
    """
    assert intent_of("cuanto cuesta el curso") is not None
    assert intent_of("por que entrenarla cuesta tanto") is None
    assert intent_of("sabe el precio de hoy") is None
    assert intent_of("el precio del curso") is not None
    # And the nouns themselves are not enough: a noun with no intent word is not a
    # product question, it is a sentence with the word «curso» in it.
    assert intent_of("el curso") is None
    assert all(intent_of(n) is None for n in PRODUCT_NOUNS), PRODUCT_NOUNS


# ------------------------------------------------------- the index, failing closed
def test_the_real_emitter_is_readable_and_agrees_with_the_map():
    """The only test here that needs Node, and it is deliberate: if Node cannot be
    reached the concept map genuinely cannot be checked, and a skipped check is the
    dark guard this file exists to prevent."""
    index = lesson_index()
    assert len(index.lessons) >= 12
    assert index.glossary, "the emitter reported no glossary terms"
    assert check_concepts() == ()


@pytest.mark.parametrize("label,cmd_kwargs,expected", [
    ("a non-zero exit", {"exit_code": 1, "stderr": "boom"}, "exited 1"),
    ("nothing on stdout", {"stdout": ""}, "not JSON"),
    ("not JSON at all", {"stdout": "<html>nope</html>"}, "not JSON"),
    ("a JSON array", {"stdout": "[]"}, "not a JSON object"),
])
def test_the_index_refuses_rather_than_returning_a_partial_answer(label, cmd_kwargs, expected):
    with pytest.raises(IndexUnreadable) as e:
        lesson_index(_emitter(**cmd_kwargs))
    assert expected in str(e.value), (label, str(e.value))


def test_a_missing_emitter_is_a_failure_and_not_a_skip():
    with pytest.raises(IndexUnreadable) as e:
        lesson_index(("definitely-not-a-real-binary-9f3c",))
    assert "cannot run" in str(e.value)


@pytest.mark.parametrize("label,broken,expected", [
    ("no lessons", {"lecciones": [], "count": 0}, "no usable «lecciones»"),
    ("a nameless entry", {"lecciones": [{"n": 1}, {}], "count": 2}, "no usable «n»"),
    ("a boolean lesson number", {"lecciones": [{"n": True}], "count": 1}, "no usable «n»"),
    ("the same lesson twice", {"lecciones": [{"n": 1}, {"n": 1}], "count": 2},
     "lists the same lesson twice"),
    ("a count that disagrees", {"count": 99}, "disagrees with itself"),
    ("no glossary", {"glosario": []}, "no usable «glosario»"),
])
def test_every_way_the_payload_can_be_wrong_refuses(label, broken, expected):
    doc = _index_payload()
    doc.update(broken)
    with pytest.raises(IndexUnreadable) as e:
        parse(doc)
    assert expected in str(e.value), (label, str(e.value))
    # And through the subprocess path too, so the validation is not bypassed by it.
    with pytest.raises(IndexUnreadable):
        lesson_index(_emitter(stdout=json.dumps(doc)))


def test_a_glossary_term_pointing_outside_the_lesson_list_refuses():
    doc = _index_payload()
    doc["glosario_lecciones"] = {**doc["glosario_lecciones"], "token": 99}
    with pytest.raises(IndexUnreadable) as e:
        parse(doc)
    assert "not one of the lessons" in str(e.value)


# ------------------------------------------------------------------ the drift gate
def _concept(slug: str, leccion: int, **over) -> Concept:
    base = dict(slug=slug, leccion=leccion, phrasings_es=("una frase de prueba",),
                phrasings_en=("a test phrasing",), terms_es=("token",), terms_en=("tokens",))
    base.update(over)
    return Concept(**base)


def test_the_gate_is_clean_over_the_real_map():
    """The tests below this one break the MAP against a good index. The set further
    down breaks the INDEX against the real map. Both directions matter and neither
    subsumes the other: a wrong number in `concepts.py` and a lesson added in Node
    are different edits, made by different people, on different days."""
    assert compare(_fixture_index()) == ()


def test_it_catches_a_MAP_that_grew_a_lesson_the_index_does_not_have(monkeypatch):
    """The router would send the model somewhere Node cannot serve."""
    monkeypatch.setattr(check_mod, "CONCEPTS", (*CONCEPTS, _concept("hallucination_v2", 13)))
    lines = compare(_fixture_index())
    assert any("does not exist" in x for x in lines), lines
    assert any("hallucination_v2 -> 13" in x for x in lines), lines


def test_it_catches_a_MAP_that_dropped_a_lesson_the_index_still_serves(monkeypatch):
    """The hole the router silently declines to fill, after which the model answers
    from memory — the failure `buscar_en_curso`'s own description forbids."""
    monkeypatch.setattr(check_mod, "CONCEPTS",
                        tuple(c for c in CONCEPTS if c.leccion not in (4, 11)))
    lines = compare(_fixture_index())
    assert any("no concept covers" in x for x in lines), lines
    assert any("4, 11" in x for x in lines), lines


def test_it_catches_a_MAP_that_invented_a_glossary_term(monkeypatch):
    monkeypatch.setattr(check_mod, "CONCEPTS",
                        (*CONCEPTS, _concept("invented", 5, terms_es=("aleatoriedad",))))
    lines = compare(_fixture_index())
    assert any("invents" in x for x in lines), lines
    assert any("aleatoriedad" in x for x in lines), lines


def test_it_catches_a_MAP_that_moved_a_term_to_another_lesson(monkeypatch):
    """`glosario` will contradict the map the moment the model asks it."""
    monkeypatch.setattr(check_mod, "CONCEPTS",
                        (*CONCEPTS, _concept("misplaced", 7, terms_es=("token",))))
    lines = compare(_fixture_index())
    assert any("wrong lesson" in x for x in lines), lines
    assert any("`glosario` says 5" in x for x in lines), lines


def test_it_catches_a_MAP_with_the_same_phrasing_twice(monkeypatch):
    """Ambiguity the scorer would resolve silently, by declaration order."""
    twin = _concept("twin", 9, phrasings_es=CONCEPTS[0].phrasings_es[:1],
                    terms_es=("temperatura",), terms_en=("temperature",))
    monkeypatch.setattr(check_mod, "CONCEPTS", (*CONCEPTS, twin))
    lines = compare(_fixture_index())
    assert any("two lessons" in x for x in lines), lines


def test_it_catches_a_MAP_with_ONE_SLUG_POINTING_AT_TWO_LESSONS(monkeypatch):
    """The other axis of check 4, and it was missing.

    `BY_SLUG` is a dict comprehension over CONCEPTS, so a second Concept with the
    same slug silently REPLACES the first. Measured, from the one-line mutation a
    copy-paste of a neighbouring Concept produces: `len(CONCEPTS)` = 12,
    `len(BY_SLUG)` = 11, `ai-check-concepts` exit 0 printing «12 concepts over 12
    lesson(s)», pytest exit 0, `ai-export` exit 0 and it REWROTE
    api/src/ontologia.json.

    The model-facing consequence, measured inside one turn: `entender_pregunta`
    handed back {concepto: "parameters", leccion: 3}, the model then called
    `mapa_de_conceptos(concepto="parameters")` — which resolves through
    `BY_SLUG[asked]` — and got leccion 12. Two lesson numbers for one slug, no error
    and no gate red, and the lesson-3 concept unreachable by slug forever.
    """
    twin = _concept("parameters", 12, terms_es=("habito",), terms_en=("habit",))
    monkeypatch.setattr(check_mod, "CONCEPTS", (*CONCEPTS, twin))
    lines = compare(_fixture_index())
    assert any("one slug pointing at two lessons" in x for x in lines), lines
    assert any("parameters -> 3, 12" in x for x in lines), lines


def test_the_success_line_reports_what_is_ADDRESSABLE_and_not_just_declared(capsys):
    """The count that could lie. «12 concepts» came from `len(CONCEPTS)`, which
    counts declarations; two sharing a slug leaves 11 reachable through `BY_SLUG`
    and the line said 12 either way."""
    assert check_mod.main() == 0
    out = capsys.readouterr().out
    assert f"{len(CONCEPTS)} concepts ({len({c.slug for c in CONCEPTS})} addressable" in out, out


def test_it_catches_a_MAP_concept_nothing_can_route_to(monkeypatch):
    """Worse than an uncovered lesson: the coverage check counts it as covered."""
    monkeypatch.setattr(check_mod, "CONCEPTS",
                        (*CONCEPTS, _concept("mute", 5, phrasings_es=(), phrasings_en=())))
    lines = compare(_fixture_index())
    assert any("no phrasing" in x for x in lines), lines


def test_a_seventh_field_on_the_map_is_refused(monkeypatch):
    """The structural check. The tempting seventh field is a per-lesson list of
    «anchor» words: measured, they route beautifully, and every one is lifted
    verbatim out of a `muro: de_pago` column. An argument in a comment cannot stop
    that; this can."""
    monkeypatch.setattr(check_mod, "declared_fields",
                        lambda: (*check_mod.CONCEPT_FIELDS, "anchors_es"))
    lines = check_shape()
    assert any("not allowed on the map" in x for x in lines), lines
    assert any("anchors_es" in x for x in lines), lines


def test_check_concepts_names_its_source_when_it_complains(monkeypatch):
    """A verdict with no source is not reproducible."""
    monkeypatch.setattr(check_mod, "CONCEPTS", (*CONCEPTS, _concept("ghost", 99),))
    lines = check_concepts(_emitter(stdout=json.dumps(_index_payload())))
    assert lines and any("source:" in x for x in lines), lines


def test_main_fails_loudly_when_it_cannot_look_at_all(monkeypatch, capsys):
    """The house rule, spelled out in the output: a check that cannot run has
    FAILED. Reporting success here would be the guard that approves what it never
    inspected."""
    def boom(cmd=None):
        raise IndexUnreadable("emitter exit 1: node not found")

    monkeypatch.setattr(check_mod, "lesson_index", boom)
    assert check_mod.main() == 1
    out = capsys.readouterr().out
    assert "could not read the lesson index" in out
    assert "A check that cannot run has FAILED." in out


def test_main_exits_zero_and_says_what_it_compared(capsys):
    assert check_mod.main() == 0
    out = capsys.readouterr().out
    assert "concepts:" in out and "checked against the index Node serves" in out


# ------------------------------------------------------------- the native tools
async def test_entender_pregunta_routes_and_names_the_next_bridged_call():
    bridge = FakeBridge()
    out = await entender_pregunta(_ctx(bridge), {"pregunta": "como lo hago menos aleatorio"})
    assert out["conceptos"][0]["leccion"] == 9
    assert out["conceptos"][0]["concepto"] == "temperature"
    assert out["siguiente"] == "leccion_texto"
    assert out["conceptos"][0]["por_que"], "a route the model cannot explain is unauditable"
    # The TITLE came from the fetched index, never from the Python module.
    assert out["conceptos"][0]["titulo"] == "Leccion 9"
    assert [n for _s, n, _a in bridge.calls] == ["curso_indice"]


async def test_it_returns_no_lesson_text_ever():
    """A native returning gated content is the leak whatever it delegates to. What
    comes out is numbers, terms, a query string and a tool name."""
    out = await entender_pregunta(_ctx(), {"pregunta": "por que se inventa cosas"})
    flat = json.dumps(out, ensure_ascii=False)
    for forbidden in ("tecnica", "analogia", "ejemplos", "enunciado", "prompt\":"):
        assert forbidden not in flat, (forbidden, flat)


async def test_a_routed_lesson_the_live_index_does_not_have_is_refused():
    """The runtime half of the gate. The map agreeing with a build-time constant and
    disagreeing with what Node just served is caught IN the session, and the model is
    told so instead of being handed a number nobody can serve."""
    short = FakeBridge({"lecciones": [{"n": n} for n in range(1, 6)]})
    out = await entender_pregunta(_ctx(short), {"pregunta": "que es la temperatura"})
    assert out == {"error": "mapa_desalineado", "leccion": 9}


async def test_an_unreadable_index_is_an_error_and_not_a_guess():
    broken = FakeBridge({"error": "sin_sesion"})
    out = await entender_pregunta(_ctx(broken), {"pregunta": "que es un token"})
    assert out["error"] == "indice_ilegible"


async def test_a_question_with_no_route_says_so_instead_of_answering():
    bridge = FakeBridge()
    out = await entender_pregunta(_ctx(bridge), {"pregunta": "cual es la capital de francia"})
    assert out["sin_ruta"] is True
    assert out["siguiente"] == "buscar_en_curso"
    assert "de memoria" in out["nota"], "sin_ruta has to TELL the model what to do"
    # And it did not even spend the bridge call: there is nothing to confirm.
    assert bridge.calls == []


@pytest.mark.parametrize("query,lang", [
    ("quien gano el mundial", "es"),
    ("cual es la capital de francia", "es"),
    ("receta de arepas para el desayuno", "es"),
    ("who won the world cup", "en"),
    ("how do i cook rice", "en"),
    # The two named in the finding that raised FLOOR. Neither is about the product,
    # so `intent.py` does not catch them and the floor is the only thing that does.
    ("can it tell me the weather right now", "en"),
    ("it gave me a book title that does not exist", "en"),
])
def test_a_general_knowledge_question_gets_NO_ROUTE_AT_ALL(query, lang):
    """It used to be the weaker property, «never CONFIDENT», and now it is this one.

    THE MEASURED HISTORY, because the weaker version was not a preference: with FLOOR
    at 3.0 — below W_PHRASE — one query word shared with one phrasing routed, and
    that bucket was 23 right and 24 wrong over the 182 pooled questions. «quien
    gano el mundial» cleared the floor at 4.10 on lesson 1 through the phrasing «quien
    le escribe las reglas»; «can it tell me the weather right now» went to lesson 7 on
    `tell`; «it gave me a book title that does not exist» to lesson 8 on `book`. All
    the test could assert then was that the answer was not confident — which is a real
    property, and a poor one, because the model was still handed a lesson.

    With FLOOR = W_TERM the honest assertion is available: nothing. `sin_ruta`, which
    tells the model to say it does not know and offers `buscar_en_curso` if the person
    insists.
    """
    assert rank(query, lang) == (), (query, [(x.concept.slug, x.score) for x in
                                            rank(query, lang)])
    # A real question about the course, for contrast, still answers.
    real = rank("que es un token", "es")
    assert real, "the router stopped answering the easiest question in the set"


async def test_ampliar_consulta_is_pure():
    bridge = FakeBridge()
    out = await ampliar_consulta(_ctx(bridge), {"consulta": "por que se inventa cosas"})
    assert bridge.calls == [], "a tool documented as making no call made one"
    assert out["para"] == "buscar_en_curso"
    assert "por" in out["descartadas"] and "que" in out["descartadas"]
    assert "inventa" in out["terminos"]
    assert out["variantes"], "no rewrite offered"


async def test_mapa_de_conceptos_reports_coverage_rather_than_asserting_it():
    out = await mapa_de_conceptos(_ctx(), {})
    assert out["total"] == len(CONCEPTS)
    assert out["cobertura"]["lecciones_cubiertas"] == 12
    assert out["cobertura"]["sin_concepto"] == []
    assert all(c["titulo"] for c in out["conceptos"]), "titles must come from the index"


async def test_mapa_de_conceptos_answers_a_single_concept_by_slug_or_word():
    by_slug = await mapa_de_conceptos(_ctx(), {"concepto": "hallucination"})
    assert [c["leccion"] for c in by_slug["conceptos"]] == [10]
    by_word = await mapa_de_conceptos(_ctx(), {"concepto": "temperatura"})
    assert by_word["conceptos"][0]["leccion"] == 9


@pytest.mark.parametrize("name,args", [
    ("entender_pregunta", {"pregunta": "que es un token", "user_id": 7, "n": 3}),
    ("ampliar_consulta", {"consulta": "tokens", "userId": "x"}),
    ("mapa_de_conceptos", {"concepto": "tokens", "email": "a@b.c"}),
])
def test_undeclared_argument_keys_are_dropped_and_never_echoed(name, args):
    """Same rule as Node's, including the silence. `api/src/tools/index.ts` used to
    echo a refused key back as `_ignorado` and that was removed on purpose: telling
    a model which name was just refused invites it to try the next one."""
    clean = accepted(name, args)
    assert set(clean) <= set(TOOLS[name].args)
    assert "user_id" not in clean and "userId" not in clean and "email" not in clean


async def test_a_refused_key_does_not_come_back_in_the_answer():
    out = await ampliar_consulta(_ctx(), {"consulta": "tokens", "user_id": 7})
    flat = json.dumps(out)
    assert "user_id" not in flat, flat
    assert "7" not in flat.replace("\"7\"", ""), flat


# ------------------------------------------------- the composition allowlist
#
# WHAT WAS WRONG WITH THE VERSION OF THIS SECTION THAT ONLY HAD THE FIRST TEST.
# It drove every native with an EMPTY call, so `entender_pregunta` returned
# {"error": "pregunta_corta"} before touching anything and the assertion compared
# set() against the allowlist. Measured: a handler edited to call
# `ctx.bridge.call(..., "leccion_texto", {"n": n})` and return the prose passed it,
# passed `ai-prove-isolation` and passed `check_catalog()` — while returning 16k of
# `muro: de_pago` text from a tool declaring `returns=()`. It inspected nothing and
# approved everything, which is worse than no test because the review passes.
#
# So there are three tests now: the empty call (a handler must not fall over), a
# REAL call that actually reaches the seam, and a hostile handler driven through
# the same seam production uses.
@pytest.mark.parametrize("name", sorted(NATIVE))
async def test_a_native_driven_with_an_empty_call_still_answers_a_dict(name):
    """It may refuse — most of them do — but it may not raise and may not wander."""
    bridge = FakeBridge()
    out = await dispatch(name, _ctx(bridge), {})
    assert isinstance(out, dict), "the loop assumes a dict: loop.py reads output.get(...)"
    assert {n for _s, n, _a in bridge.calls} <= set(TOOLS[name].composes), bridge.calls


# A call that REACHES the bridge for every native that declares it composes
# something. Keyed by tool name so a new native cannot be added without either
# driving it here or failing the completeness check below.
_REAL_CALL: dict[str, dict[str, Any]] = {
    "entender_pregunta": {"pregunta": "como lo hago menos aleatorio"},
    "ampliar_consulta": {"consulta": "por que se inventa cosas"},
    "mapa_de_conceptos": {"concepto": "temperatura"},
}


def test_every_native_has_a_real_call_to_drive_it_with():
    """Otherwise the test below inspects a subset nobody chose — which is the exact
    shape of the defect this section was rebuilt for."""
    assert set(_REAL_CALL) == set(NATIVE), sorted(set(NATIVE) ^ set(_REAL_CALL))


@pytest.mark.parametrize("name", sorted(NATIVE))
async def test_what_a_native_really_reaches_is_exactly_what_it_declares(name):
    """The measurement, not the description.

    EQUALITY, not `<=`. A subset check passes for a handler that reaches nothing,
    which is how the previous version of this test stayed green over a handler
    reaching `leccion_texto`. Equality also refuses the other direction — a
    declaration wider than the code — and that direction is not hypothetical:
    `entender_pregunta` and `mapa_de_conceptos` both declared `composes=
    ("curso_indice", "glosario")` and neither has ever called `glosario`, so the
    allowlist was one name wider than the behaviour it was supposed to bound.
    """
    bridge = FakeBridge()
    out = await dispatch(name, _ctx(bridge), _REAL_CALL[name])
    assert isinstance(out, dict) and not out.get("error"), out
    reached = {n for _s, n, _a in bridge.calls}
    assert reached == set(TOOLS[name].composes), (
        f"{name} reached {sorted(reached)} and declares {sorted(TOOLS[name].composes)}. "
        f"Both directions are a defect: reaching more is a boundary crossed, declaring "
        f"more is an allowlist that bounds nothing.")


async def test_a_native_that_reaches_for_a_tool_it_does_not_declare_is_STOPPED():
    """The mutation that used to pass every gate in the repository.

    This is the real seam: `dispatch` is what loop.py calls, and the handler is
    injected exactly the way loop.py's `native=` injection does it. The fence is not
    something each handler remembers to apply — a rule that has to be remembered is
    a rule the next handler forgets, silently.
    """
    bridge = FakeBridge({"tecnica": "x" * 16_000})
    reached: list[str] = []

    async def hostile(ctx, args):
        # Exactly the edit that was measured: fetch the paid text and pass it through.
        out = await ctx.bridge.call(None, ctx.session, "leccion_texto", {"n": 9})
        reached.append("leccion_texto")
        return {"texto": out}

    with pytest.raises(NotComposed) as e:
        await dispatch("entender_pregunta", _ctx(bridge), {"pregunta": "que es un token"},
                       native={"entender_pregunta": hostile})
    assert "leccion_texto" in str(e.value)
    assert reached == [], "the call was made and only then complained about"
    assert bridge.calls == [], f"the request left the process: {bridge.calls}"


async def test_the_fence_lets_a_declared_name_through_unchanged():
    """A guard that also breaks the allowed path is not a guard, it is an outage."""
    bridge = FakeBridge({"lecciones": [{"n": 1}]})
    fence = Fence(inner=bridge, tool="entender_pregunta", allowed=frozenset({"curso_indice"}))
    out = await fence.call(None, "cookie", "curso_indice", {})
    assert out == {"lecciones": [{"n": 1}]}
    assert bridge.calls == [("cookie", "curso_indice", {})]


async def test_a_native_with_an_empty_allowlist_can_reach_nothing():
    """`ampliar_consulta` declares `composes=()` and is documented as pure. The
    documentation is not what stops it."""
    assert TOOLS["ampliar_consulta"].composes == ()
    bridge = FakeBridge()

    async def sneaky(ctx, args):
        return await ctx.bridge.call(None, ctx.session, "curso_indice", {})

    with pytest.raises(NotComposed) as e:
        await dispatch("ampliar_consulta", _ctx(bridge), {"consulta": "tokens"},
                       native={"ampliar_consulta": sneaky})
    assert "nothing" in str(e.value)
    assert bridge.calls == []


def test_the_handler_registry_and_the_declaration_still_match():
    """The import-time guard in tools.py, restated where a reader of the tests can
    see it. The behavioural proof that loop.py dispatches THROUGH the fence rather
    than around it lives in test_loop.py, where the loop's own harness is."""
    assert set(NATIVE_HANDLERS) == set(NATIVE)


async def test_the_session_is_the_only_identifier_a_native_forwards():
    """A native has exactly the reach of a bridged tool — through Node, resolved by
    Node — and not one field more. There is no userId to add and no way to add one."""
    bridge = FakeBridge()
    await dispatch("entender_pregunta", _ctx(bridge), {"pregunta": "que es un token"})
    session, _name, args = bridge.calls[0]
    assert session == "cookie"
    assert args == {}


async def test_every_tool_a_native_NAMES_is_one_Node_really_executes():
    """`siguiente` is the whole output of this package: it tells the model what to
    call. A name nobody executes is a wasted turn and an answer that never arrives.

    Naming is not composing — `leccion_texto` is GATED and naming it is correct,
    because the model calls it and Node decides whether this person may read it. So
    the assertion is only «declared and executed by Node», which is the property
    `check_catalog()` proves against Node's own registry.
    """
    named = {
        (await entender_pregunta(_ctx(), {"pregunta": "que es un token"}))["siguiente"],
        (await entender_pregunta(_ctx(), {"pregunta": "cual es la capital de francia"}))
        ["siguiente"],
        (await entender_pregunta(_ctx(), {"pregunta": "cuanto cuesta el curso"}))["siguiente"],
        (await ampliar_consulta(_ctx(), {"consulta": "tokens"}))["para"],
        (await mapa_de_conceptos(_ctx(), {}))["siguiente"],
    }
    assert named == {"leccion_texto", "buscar_en_curso", "precio_y_compra", "curso_indice"}, named
    for name in named:
        assert name in TOOLS, f"a native named {name}, which is not declared at all"
        assert TOOLS[name].runner == "node", (name, TOOLS[name].runner)
