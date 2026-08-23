"""Emite ontologia.json para que Node lea la MISMA verdad.

Node necesita dos cosas de la ontologia: las columnas `jamas` (para su guardia
`assertSinProhibidas`) y el orden de borrado. Ninguna de las dos es logica: son
datos. Asi que Python — que es donde se autoriza y se verifica la ontologia —
los emite, y Node los importa.

Esto es lo contrario de duplicar: hay una fuente (datos.py), un artefacto
generado (ontologia.json) y dos lectores. Si alguien edita el JSON a mano, el
test de Node lo detecta porque la huella no cuadra.
"""

from __future__ import annotations

import json
from hashlib import sha256
from pathlib import Path
from typing import Any

from ..ontologia.grafo import GRAFO
from ..ontologia.render import huella

DESTINO = Path(__file__).resolve().parents[4] / "api" / "src" / "ontologia.json"


def payload() -> dict[str, Any]:
    g = GRAFO
    orden, ciclo = g.orden_topologico()
    cuerpo = {
        "generado_por": "ai/src/ia/ontologia/exporta.py",
        "aviso": "ARTEFACTO GENERADO. No editar a mano: se regenera con `uv run ia-exporta`.",
        "version": 3,
        "prohibidas": {t: list(g.columnas_prohibidas(t)) for t in sorted(g.tablas)},
        "clases": {f"{t}.{c}": x.clase
                   for t, tab in sorted(g.tablas.items())
                   for c, x in tab.columnas.items()},
        "herramientas": {n: {"alcance": h.alcance, "usa": list(h.usa),
                             "devuelve": list(h.devuelve), "args": list(h.args)}
                         for n, h in sorted(g.herramientas.items())},
        "orden_borrado": list(reversed(orden)),
        "ciclo_fk": list(ciclo),
        "prompt_sha": {"es": huella("es"), "en": huella("en")},
        "violaciones": [{"herramienta": v.herramienta, "motivo": v.motivo, "detalle": v.detalle}
                        for v in g.prueba_aislamiento()],
    }
    # La huella cubre el cuerpo, no el archivo: asi el campo puede ir dentro.
    crudo = json.dumps(cuerpo, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    cuerpo["sha"] = sha256(crudo.encode("utf-8")).hexdigest()[:16]
    return cuerpo


def main() -> int:
    """`uv run ia-exporta`. Sale 1 si la ontologia tiene violaciones: un artefacto
    que documenta una fuga no se escribe."""
    d = payload()
    if d["violaciones"]:
        print(f"NO se exporta: {len(d['violaciones'])} violacion(es) de aislamiento")
        for v in d["violaciones"]:
            print(f"  [{v['herramienta']}] {v['motivo']}: {v['detalle']}")
        return 1
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(json.dumps(d, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                       encoding="utf-8")
    n = sum(len(v) for v in d["prohibidas"].values())
    print(f"escrito {DESTINO.relative_to(DESTINO.parents[2])}: "
          f"{n} columnas prohibidas, sha {d['sha']}, prompt es/{d['prompt_sha']['es']}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
