"""The tool client: this service does NOT touch Postgres.

Execution is done by the Node API, which is the only side holding the session.
All that is sent from here is «run this tool with these args», together with the
session token Node issued, and Node resolves the userId on its own.

Why this way and not with direct database access: isolation between users lives
in the fact that no tool accepts a person identifier. If this service queried the
database, that rule would be implemented twice in two languages, and the day they
diverged the wrong copy would win. Same as what happened with the league metal
assignment: one implementation or none.

The service token (IA_SECRETO) is not user authentication: it is the proof that
the call comes from this service and not from the internet. The user is carried by
`sesion`, which is opaque to us.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True, slots=True)
class Bridge:
    base: str
    secret: str

    @classmethod
    def from_env(cls) -> Bridge:
        return cls(base=(os.environ.get("NODE_URL") or "http://127.0.0.1:8787").rstrip("/"),
                   secret=os.environ.get("IA_SECRETO") or "")

    async def call(self, client: httpx.AsyncClient, session: str, name: str,
                   args: Mapping[str, Any], timeout_s: float = 20.0) -> dict[str, Any]:
        if not self.secret:
            return {"error": "sin_secreto_de_servicio"}
        try:
            r = await client.post(
                f"{self.base}/api/v3/interno/herramienta", timeout=timeout_s,
                headers={"content-type": "application/json",
                         "x-ia-secreto": self.secret,
                         "x-ia-sesion": session},
                json={"nombre": name, "args": dict(args or {})})
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

    async def catalog(self, client: httpx.AsyncClient,
                      timeout_s: float = 10.0) -> list[dict[str, Any]]:
        """Node's catalog. It is fetched in order to CONTRAST it with the one the
        ontology declares: if Node adds a tool and it is not declared here, the
        ontology would be lying and the prompt would not mention it."""
        r = await client.get(f"{self.base}/api/v3/interno/catalogo", timeout=timeout_s,
                             headers={"x-ia-secreto": self.secret})
        r.raise_for_status()
        d = r.json()
        return list(d.get("catalogo") or [])
