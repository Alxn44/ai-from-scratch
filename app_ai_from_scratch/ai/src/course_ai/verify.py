"""One command that runs everything in the AI service: `uv run ai-verify`.

It exists so that «it is green» is a single thing that can be typed from memory,
instead of four commands somebody half-remembers.
"""

from __future__ import annotations

import subprocess

STEPS = (
    ("ruff", ["ruff", "check", "src", "tests"]),
    ("pytest", ["pytest", "-q"]),
    ("isolation", ["ai-prove-isolation"]),
    # Between isolation and export on purpose: the concept map is checked
    # BEFORE the artefact is written, and `ai-export` refuses over it too, so a
    # drifted map cannot reach api/src/ontologia.json by way of a green run.
    ("concepts", ["ai-check-concepts"]),
    ("export", ["ai-export"]),
    # The document is generated too, so it belongs in the same gate as the
    # artifact: a generated file nobody regenerates is the drift this replaced.
    ("doc", ["ai-doc"]),
)


def main() -> int:
    faults = []
    for name, cmd in STEPS:
        # The flush is mandatory: the child writes STRAIGHT to the descriptor while
        # my prints are buffered, so without it ruff's output shows up before its
        # own heading.
        print(f"\n=== {name} ===", flush=True)
        r = subprocess.run(cmd, check=False)
        if r.returncode != 0:
            faults.append(name)
    if faults:
        print(f"\nFAILED: {', '.join(faults)}")
        return 1
    print("\nall green: style, tests, isolation and artefact")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
