"""Una orden que corre todo lo del servicio de IA: `uv run ia-verifica`.

Existe para que «esta verde» sea una sola cosa que se puede escribir de memoria,
en vez de cuatro ordenes que alguien recuerda a medias.
"""

from __future__ import annotations

import subprocess

PASOS = (
    ("ruff", ["ruff", "check", "src", "tests"]),
    ("pytest", ["pytest", "-q"]),
    ("aislamiento", ["ia-prueba-aislamiento"]),
    ("exporta", ["ia-exporta"]),
)


def main() -> int:
    fallos = []
    for nombre, orden in PASOS:
        # flush obligatorio: el hijo escribe DIRECTO al descriptor y mis print van
        # en buffer, asi que sin esto la salida de ruff aparece antes que su titulo.
        print(f"\n=== {nombre} ===", flush=True)
        r = subprocess.run(orden, check=False)
        if r.returncode != 0:
            fallos.append(nombre)
    if fallos:
        print(f"\nFALLA: {', '.join(fallos)}")
        return 1
    print("\ntodo verde: estilo, 33 pruebas, aislamiento y artefacto")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
