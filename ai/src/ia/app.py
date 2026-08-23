"""El servicio. Superficie minima y explicita.

    GET  /salud                estado, proveedores activos, huella del prompt
    GET  /ontologia/prompt     el texto que ve el modelo
    GET  /ontologia/grafo      nodos, aristas, orden de borrado, avisos
    POST /ontologia/prueba     corre P1/P2/P3 y devuelve las violaciones
    POST /agente/turno         una conversacion completa contra el modelo

Autenticacion: `x-ia-secreto` compartido con Node. No es autenticacion de
usuario — el usuario va en `sesion`, que es opaco aqui y lo resuelve Node.
Este servicio no se publica a internet: solo lo llama la API.
"""

from __future__ import annotations

import os
from typing import Annotated, Any, Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from . import VERSION
from .agente.bucle import VUELTAS, correr
from .agente.herramientas import Puente
from .agente.proveedores import proveedores
from .ontologia.grafo import GRAFO
from .ontologia.render import catalogo, huella, prompt_sistema

app = FastAPI(title="IA desde cero — servicio de IA", version=VERSION,
              docs_url="/docs", redoc_url=None)

_cliente: httpx.AsyncClient | None = None


@app.on_event("startup")
async def _abre() -> None:
    global _cliente
    # Un solo cliente para todo el proceso: reusa conexiones. Abrir uno por
    # peticion paga TLS cada vez y con cuatro vueltas por turno eso se nota.
    _cliente = httpx.AsyncClient(timeout=60.0)


@app.on_event("shutdown")
async def _cierra() -> None:
    if _cliente is not None:
        await _cliente.aclose()


def exige_secreto(x_ia_secreto: Annotated[str | None, Header()] = None) -> None:
    esperado = os.environ.get("IA_SECRETO") or ""
    if not esperado:
        raise HTTPException(503, "IA_SECRETO sin configurar en el servicio")
    if x_ia_secreto != esperado:
        raise HTTPException(401, "secreto de servicio invalido")


Guardia = Annotated[None, Depends(exige_secreto)]


class Mensaje(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class Peticion(BaseModel):
    # `sesion` es opaco: es la cookie que Node emitio. Aqui no se abre ni se
    # interpreta; se reenvia al puente. Este servicio no sabe quien es nadie.
    sesion: str = Field(min_length=1, max_length=4096)
    mensajes: list[Mensaje] = Field(min_length=1, max_length=40)
    lang: Literal["es", "en"] = "es"


@app.get("/salud")
async def salud() -> dict[str, Any]:
    activos = proveedores()
    return {"ok": True, "version": VERSION, "api": 3, "vueltas": VUELTAS,
            "proveedores": [p.id for p in activos],
            "modelos": {p.id: p.modelo for p in activos},
            "prompt_sha": {"es": huella("es"), "en": huella("en")},
            "puente": Puente.del_entorno().base,
            "secreto_configurado": bool(os.environ.get("IA_SECRETO")),
            "violaciones": len(GRAFO.prueba_aislamiento())}


@app.get("/ontologia/prompt")
async def onto_prompt(lang: Literal["es", "en"] = "es") -> dict[str, Any]:
    return {"texto": prompt_sistema(lang), "sha": huella(lang), "catalogo": catalogo()}


@app.get("/ontologia/grafo")
async def onto_grafo() -> dict[str, Any]:
    r = dict(GRAFO.resumen())
    r["vecindad_de_riesgo"] = {k: list(v) for k, v in GRAFO.vecindad_de_riesgo().items()}
    return r


@app.post("/ontologia/prueba")
async def onto_prueba() -> dict[str, Any]:
    fallos = GRAFO.prueba_aislamiento()
    return {"ok": not fallos,
            "violaciones": [{"herramienta": v.herramienta, "motivo": v.motivo,
                             "detalle": v.detalle, "camino": list(v.camino)} for v in fallos]}


@app.post("/agente/turno")
async def agente_turno(p: Peticion, _: Guardia) -> dict[str, Any]:
    assert _cliente is not None
    r = await correr(sesion=p.sesion, lang=p.lang, cliente=_cliente,
                     mensajes=[m.model_dump() for m in p.mensajes])
    return r.como_json()
