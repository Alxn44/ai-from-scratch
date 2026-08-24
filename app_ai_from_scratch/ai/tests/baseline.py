"""WHERE NODE'S SEARCH LANDS on each of the fixture questions — fetched, not typed.

WHY THIS FILE REPLACED A DICT. `queries.py` used to carry the column as literal
data, documented as «the measured output of the real ranking over the real content,
frozen». Measured against the real scorer it disagreed on 53 of its 138 entries.
The real substring hit rate is 70 of 138 (51%), not the 75 (54%) every docstring in
this package quoted, so every «+N points» here was computed against a column no run
produces — and the test that was supposed to protect it only checked that the typed
dict still summed to the number the docstring claimed. It compared the copy against
itself and never invoked a scorer.

That is house rule 4 in the file whose entire job is an honest comparison, so the
column is now GENERATED: `scripts/emit-search-baseline.mjs` imports
`api/src/tools/content.ts` and calls `buscar_en_curso` over the corpus
`api/src/seed.ts` defines, then prints one lesson number per query. It cannot drift
from the tool it measures, because it calls it.

WHAT CROSSES THE LINE: integers. The corpus is loaded in the emitter's process to
score against and no character of it is printed — the same structural property
`scripts/emit-lesson-index.mjs` has, and the reason this file can exist at all
without making the test suite a derivative of `muro: de_pago` prose.

IT NEEDS NODE, AND A RUN THAT CANNOT MEASURE HAS FAILED. There is no cached copy to
fall back on and no `pytest.skip`: a skipped comparison is indistinguishable from a
passing one, and this repository has been bitten by exactly that. `BaselineUnreadable`
is raised, the tests that need it go red, and the message says what to run.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Mapping, Sequence
from functools import lru_cache
from pathlib import Path

from queries import ALL

ROOT = Path(__file__).resolve().parents[2]
EMITTER = ROOT / "scripts" / "emit-search-baseline.mjs"

# Same invocation shape as course_ai.retrieval.index: `--experimental-strip-types`
# is not optional on Node 22, because api/src is TypeScript.
EMITTER_CMD: tuple[str, ...] = ("node", "--experimental-strip-types", str(EMITTER))

# It loads the corpus and scores 138 short queries against it in one process. A
# second is already pathological; two minutes is a ceiling for a cold CI machine,
# not a wait anybody should ever see.
EMITTER_TIMEOUT_S = 120.0


class BaselineUnreadable(RuntimeError):
    """The substring baseline could not be obtained. NOT «the baseline is empty»."""


def _refuse(reason: str, stderr: str = "") -> BaselineUnreadable:
    tail = f"\n--- emitter stderr ---\n{stderr.strip()}" if stderr.strip() else ""
    return BaselineUnreadable(
        f"{reason}\nRun it by hand to see why:\n"
        f"  python3 -c \"import sys;sys.path.insert(0,'ai/tests');import json,queries;"
        f"print(json.dumps({{'consultas':[{{'q':q,'lang':l}} for q,_n,l in queries.ALL]}}))\" "
        f"| node --experimental-strip-types scripts/emit-search-baseline.mjs{tail}")


def measure(rows: Sequence[tuple[str, int, str]],
            cmd: Sequence[str] | None = None) -> Mapping[str, int | None]:
    """query -> the lesson `buscar_en_curso` lands on, or None when it finds nothing.

    Raises rather than returning a partial answer, for the same reason
    `retrieval.index.lesson_index` does: «I could not look» and «I looked and it was
    fine» must never be the same value.
    """
    argv = tuple(cmd) if cmd is not None else EMITTER_CMD
    payload = json.dumps({"consultas": [{"q": q, "lang": lang} for q, _n, lang in rows]})
    try:
        proc = subprocess.run(argv, input=payload, capture_output=True, text=True,
                              timeout=EMITTER_TIMEOUT_S, check=False)
    except FileNotFoundError as e:
        raise _refuse(f"cannot run the search-baseline emitter ({argv[0]} not found): {e}. "
                      f"Without it there is nothing to compare the router against, and a "
                      f"comparison against nothing is the hand-typed copy this replaced.") from e
    except OSError as e:
        raise _refuse(f"cannot run the search-baseline emitter {argv!r}: {e}.") from e
    except subprocess.TimeoutExpired as e:
        raise _refuse(f"the search-baseline emitter did not finish in {EMITTER_TIMEOUT_S:g}s.",
                      e.stderr or "") from e

    if proc.returncode != 0:
        raise _refuse(f"the search-baseline emitter exited {proc.returncode}. It refuses rather "
                      f"than printing a partial baseline, so this is its answer.", proc.stderr)
    try:
        doc = json.loads(proc.stdout)
    except ValueError as e:
        head = proc.stdout.strip()[:200] or "(nothing on stdout)"
        raise _refuse(f"the emitter printed something that is not JSON ({e}). stdout began: "
                      f"{head!r}", proc.stderr) from e
    return parse(doc, rows, stderr=proc.stderr)


def parse(doc: object, rows: Sequence[tuple[str, int, str]], *,
          stderr: str = "") -> Mapping[str, int | None]:
    """The validation, separated so a test can feed a payload without a subprocess.

    Every rule is a way the payload can be WRONG while looking fine: not an object,
    no `leccion` map, a query missing from it, a lesson number that is not one.
    """
    if not isinstance(doc, Mapping):
        raise _refuse(f"the emitter printed {type(doc).__name__}, not a JSON object.", stderr)
    got = doc.get("leccion")
    if not isinstance(got, Mapping) or not got:
        raise _refuse(f"the payload has no usable «leccion» map (got {type(got).__name__}). "
                      f"Comparing against an empty baseline would flatter any change.", stderr)
    out: dict[str, int | None] = {}
    for q, _n, _lang in rows:
        if q not in got:
            raise _refuse(f"the emitter did not answer for «{q}». A baseline over a subset "
                          f"nobody chose is not the same experiment.", stderr)
        v = got[q]
        if v is None:
            out[q] = None
            continue
        if isinstance(v, bool) or not isinstance(v, int) or v < 1:
            raise _refuse(f"the emitter answered {v!r} for «{q}»; expected a lesson number "
                          f"or null.", stderr)
        out[q] = v
    return out


@lru_cache(maxsize=1)
def search_baseline() -> Mapping[str, int | None]:
    """The whole fixture's baseline, measured once per process.

    Cached because it is one subprocess and a dozen tests read it. Not cached to
    disk: a file would be the frozen copy again, one release behind whatever
    `buscar_en_curso` does now.
    """
    return measure(ALL)


def main() -> int:
    """`python ai/tests/baseline.py` — print the baseline and what it scores.

    Here so the number in a docstring can be re-derived by hand in one command,
    without reading a test.
    """
    try:
        base = search_baseline()
    except BaselineUnreadable as e:
        print(f"NOT measuring the substring baseline: {e}")
        print("A check that cannot run has FAILED.")
        return 1
    right = sum(1 for q, n, _l in ALL if base[q] == n)
    blind = sum(1 for q in base if base[q] is None)
    print(f"substring baseline: {right}/{len(ALL)} correct "
          f"({right / len(ALL):.0%}), {blind} question(s) with no hit at all — "
          f"generated by {' '.join(EMITTER_CMD)}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
