"""Cliente de herramientas: este servicio NO toca Postgres.

La ejecucion la hace la API de Node, que es la unica que tiene la sesion. Aqui
solo se manda «ejecuta esta herramienta con estos args» junto con el token de
sesion que Node emitio, y Node resuelve el userId por su cuenta.

Por que asi y no con acceso directo a la base: el aislamiento entre usuarios
vive en que ninguna herramienta acepte un identificador de persona. Si este
servicio consultara la base, esa regla estaria implementada dos veces en dos
lenguajes, y el dia que divergieran ganaria la copia equivocada. Lo mismo que
paso con el reparto de metales de ligas: una sola implementacion o ninguna.

El token de servicio (IA_SECRETO) no es autenticacion de usuario: es la prueba
de que la llamada viene de este servicio y no de internet. El usuario lo pone
`sesion`, que es opaco para nosotros.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True, slots=True)
class Puente:
    base: str
    secreto: str

    @classmethod
    def del_entorno(cls) -> Puente:
        return cls(base=(os.environ.get("NODE_URL") or "http://127.0.0.1:8787").rstrip("/"),
                   secreto=os.environ.get("IA_SECRETO") or "")

    async def ejecutar(self, cliente: httpx.AsyncClient, sesion: str, nombre: str,
                       args: Mapping[str, Any], timeout_s: float = 20.0) -> dict[str, Any]:
        if not self.secreto:
            return {"error": "sin_secreto_de_servicio"}
        try:
            r = await cliente.post(
                f"{self.base}/api/v3/interno/herramienta", timeout=timeout_s,
                headers={"content-type": "application/json",
                         "x-ia-secreto": self.secreto,
                         "x-ia-sesion": sesion},
                json={"nombre": nombre, "args": dict(args or {})})
        except httpx.HTTPError as e:
            return {"error": "puente_caido", "detalle": str(e)[:200]}
        if r.status_code == 401:
            return {"error": "sesion_invalida"}
        if r.status_code >= 400:
            return {"error": "puente_error", "estado": r.status_code, "detalle": r.text[:200]}
        try:
            return r.json()
        except ValueError:
            return {"error": "puente_no_json"}

    async def catalogo(self, cliente: httpx.AsyncClient, timeout_s: float = 10.0) -> list[dict[str, Any]]:
        """El catalogo de Node. Se pide para poder CONTRASTARLO con el declarado en
        la ontologia: si Node anade una herramienta y aqui no se declara, la
        ontologia estaria mintiendo y el prompt no la mencionaria."""
        r = await cliente.get(f"{self.base}/api/v3/interno/catalogo", timeout=timeout_s,
                              headers={"x-ia-secreto": self.secreto})
        r.raise_for_status()
        d = r.json()
        return list(d.get("catalogo") or [])
