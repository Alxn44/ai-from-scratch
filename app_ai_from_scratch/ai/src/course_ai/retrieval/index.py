"""The PUBLIC lesson index, read out of Node. Never transcribed, never partial.

Same shape and the same reasoning as `export.node_catalog()`: a subprocess that
imports api's own modules and prints JSON, so the contract is the code rather than
the formatting of the code. What it may print is lesson NUMBERS and glossary
TERMS — nothing behind `muro: de_pago` can travel through it, which is why the
gate that consumes it cannot leak paid prose no matter what it is later asked to
compare.

Every failure raises. There is no partial answer and no default: an unreadable
index means the concept map cannot be checked, and «cannot be checked» is a
FAILURE, not a pass. This module is the reason `ai-check-concepts` can say so.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
EMITTER = ROOT / "scripts" / "emit-lesson-index.mjs"

# `--experimental-strip-types` is not optional on Node 22: api/src is TypeScript
# and `process.features.typescript` is false there. The emitter says so too.
EMITTER_CMD: tuple[str, ...] = ("node", "--experimental-strip-types", str(EMITTER))

# The emitter opens no connection and reads two modules, so anything past a second
# is already pathological. Generous ceiling, but a hung Node must not hang CI.
EMITTER_TIMEOUT_S = 120.0


class IndexUnreadable(RuntimeError):
    """The public lesson index could not be obtained. NOT «the index is empty»."""


@dataclass(frozen=True, slots=True)
class LessonIndex:
    """What Node says exists. Numbers and public glossary keys, nothing else.

    `glossary` maps a canonical term to its lesson; `alias` maps every alias to its
    canonical term. The alias map is what makes an English concept term checkable:
    the English side of `alucinacion` only exists as the alias `hallucination`, and
    a map validated against the Spanish list alone would have to invent its own
    English vocabulary — which is the drift this file exists to prevent.
    """

    lessons: tuple[int, ...]
    glossary: Mapping[str, int]
    alias: Mapping[str, str]

    def lesson_of(self, term: str) -> int | None:
        """The lesson a term or alias belongs to, or None when it is not a term."""
        if term in self.glossary:
            return self.glossary[term]
        canonical = self.alias.get(term)
        return self.glossary.get(canonical) if canonical else None

    @property
    def terms(self) -> frozenset[str]:
        return frozenset(self.glossary) | frozenset(self.alias)


def _refuse(reason: str, stderr: str = "") -> IndexUnreadable:
    tail = f"\n--- emitter stderr ---\n{stderr.strip()}" if stderr.strip() else ""
    return IndexUnreadable(f"{reason}{tail}")


def lesson_index(cmd: Sequence[str] | None = None) -> LessonIndex:
    """Runs the emitter and parses its stdout, or raises. There is no third outcome.

    Note on stderr: Node always writes an ExperimentalWarning about type stripping
    there, so a non-empty stderr is not a failure signal. Success is the exit code
    plus a payload that agrees with itself.
    """
    argv = tuple(cmd) if cmd is not None else EMITTER_CMD
    try:
        proc = subprocess.run(argv, capture_output=True, text=True,
                              timeout=EMITTER_TIMEOUT_S, check=False)
    except FileNotFoundError as e:
        raise _refuse(
            f"cannot run the lesson-index emitter ({argv[0]} not found): {e}. Without the "
            f"index Node serves there is nothing to check the concept map against, and a "
            f"map checked against nothing is the hand-typed copy this avoids.") from e
    except OSError as e:
        raise _refuse(f"cannot run the lesson-index emitter {argv!r}: {e}.") from e
    except subprocess.TimeoutExpired as e:
        raise _refuse(
            f"the lesson-index emitter did not finish in {EMITTER_TIMEOUT_S:g}s. It opens no "
            f"connection, so a hang is a bug to look at rather than to wait out.",
            e.stderr or "") from e

    if proc.returncode != 0:
        raise _refuse(
            f"the lesson-index emitter exited {proc.returncode}. It refuses rather than "
            f"printing a partial index, so this is its answer, not a transport problem.",
            proc.stderr)
    try:
        doc = json.loads(proc.stdout)
    except ValueError as e:
        head = proc.stdout.strip()[:200] or "(nothing on stdout)"
        raise _refuse(f"the lesson-index emitter printed something that is not JSON ({e}). "
                      f"stdout began: {head!r}", proc.stderr) from e
    if not isinstance(doc, dict):
        raise _refuse(f"the emitter printed {type(doc).__name__}, not a JSON object.",
                      proc.stderr)
    return parse(doc, stderr=proc.stderr)


def parse(doc: Mapping[str, object], *, stderr: str = "") -> LessonIndex:
    """The validation, separated so a test can feed a payload without a subprocess.

    Every rule here is a way a payload can be WRONG while looking fine, and each one
    refuses rather than filling in: an empty lesson list, an entry with no number, a
    duplicate number, a self-contradicting count.
    """
    raw = doc.get("lecciones")
    if not isinstance(raw, list) or not raw:
        raise _refuse(
            f"the emitter payload has no usable «lecciones» list (got {type(raw).__name__}). "
            f"Checking a map against an empty index would pass every map.", stderr)

    numbers: list[int] = []
    for entry in raw:
        n = entry.get("n") if isinstance(entry, Mapping) else None
        # bool is an int in Python and `True` is not a lesson number.
        if isinstance(n, bool) or not isinstance(n, int) or n < 1:
            raise _refuse(f"a «lecciones» entry has no usable «n»: {entry!r}.", stderr)
        numbers.append(n)
    if len(set(numbers)) != len(numbers):
        dupes = sorted({n for n in numbers if numbers.count(n) > 1})
        raise _refuse(f"the emitter payload lists the same lesson twice: "
                      f"{', '.join(str(n) for n in dupes)}.", stderr)

    count = doc.get("count")
    if count != len(numbers):
        raise _refuse(
            f"the emitter says count={count!r} but printed {len(numbers)} lesson(s). A payload "
            f"that disagrees with itself cannot be compared against anything.", stderr)

    terms = doc.get("glosario")
    per_term = doc.get("glosario_lecciones")
    if not isinstance(terms, list) or not terms or any(not isinstance(t, str) or not t
                                                       for t in terms):
        raise _refuse(
            f"the emitter payload has no usable «glosario» list (got {type(terms).__name__}). "
            f"Without it the map's glossary terms cannot be checked at all.", stderr)
    if not isinstance(per_term, Mapping):
        raise _refuse(f"the emitter payload has no «glosario_lecciones» map (got "
                      f"{type(per_term).__name__}).", stderr)
    glossary: dict[str, int] = {}
    for term in terms:
        n = per_term.get(term)
        if isinstance(n, bool) or not isinstance(n, int) or n not in set(numbers):
            raise _refuse(f"the glossary term «{term}» points at lesson {n!r}, which is not "
                          f"one of the lessons the same payload lists.", stderr)
        glossary[term] = n

    alias_raw = doc.get("glosario_alias")
    alias: dict[str, str] = {}
    if isinstance(alias_raw, Mapping):
        for a, canonical in alias_raw.items():
            if not isinstance(a, str) or not isinstance(canonical, str):
                raise _refuse(f"the «glosario_alias» entry {a!r} -> {canonical!r} is not a "
                              f"pair of strings.", stderr)
            if canonical not in glossary:
                raise _refuse(f"the alias «{a}» points at «{canonical}», which the same "
                              f"payload does not list as a term.", stderr)
            alias[a] = canonical
    elif alias_raw is not None:
        raise _refuse(f"«glosario_alias» is {type(alias_raw).__name__}, not a map.", stderr)

    return LessonIndex(tuple(sorted(numbers)), glossary, alias)
