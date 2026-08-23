"""El harness: un grafo pequeno y explicito, recorrido en bucle.

    entrada -> [modelo] --texto--> salida
                  |
               tool_use
                  v
             [puente] -> [Node ejecuta] -> vuelve al modelo   (max. VUELTAS)

Portado de api/src/harness.js. Lo que cambia respecto a v2 no es la logica: es
que el paso [guardia] ya no esta aqui. En v2 el harness llamaba a `ejecutar()`
con `{userId}` en el mismo proceso; ahora manda el nombre y los args al puente y
el userId lo resuelve Node desde la sesion. Este servicio NUNCA ve un userId, y
por tanto no puede filtrarlo ni por error de programacion.

Complejidad: VUELTAS * (1 llamada de modelo + K herramientas). Es un bucle
acotado a proposito — sin tope, un modelo que insiste en llamar herramientas gasta
tokens hasta el limite de facturacion.
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..ontologia.render import catalogo as catalogo_declarado
from ..ontologia.render import huella, prompt_sistema
from .herramientas import Puente
from .proveedores import Proveedor, Turno, proveedores, turno

VUELTAS = 4


@dataclass(slots=True)
class Resultado:
    respuesta: str | None = None
    error: str | None = None
    agotado: bool = False
    proveedor: str | None = None
    modelo: str | None = None
    prompt: str | None = None
    traza: list[dict[str, Any]] = field(default_factory=list)

    def como_json(self) -> dict[str, Any]:
        d = {"traza": self.traza}
        for k in ("respuesta", "error", "proveedor", "modelo", "prompt"):
            v = getattr(self, k)
            if v is not None:
                d[k] = v
        if self.agotado:
            d["agotado"] = True
        return d


def _como_resultado(formato: str, llamada: Mapping[str, Any], salida: Any) -> dict[str, Any]:
    import json
    texto = json.dumps(salida, ensure_ascii=False)
    if formato == "anthropic":
        return {"role": "user",
                "content": [{"type": "tool_result", "tool_use_id": llamada["id"], "content": texto}]}
    return {"role": "tool", "tool_call_id": llamada["id"], "name": llamada["nombre"], "content": texto}


def _como_asistente(formato: str, r: Turno) -> dict[str, Any]:
    if formato == "anthropic":
        return {"role": "assistant", "content": r.crudo}
    if isinstance(r.crudo, dict) and r.crudo:
        return {"role": "assistant", **r.crudo}
    return {"role": "assistant", "content": r.texto}


async def correr(*, sesion: str, mensajes: Sequence[Mapping[str, Any]], lang: str = "es",
                 puente: Puente | None = None, activos: Sequence[Proveedor] | None = None,
                 cliente: httpx.AsyncClient | None = None) -> Resultado:
    lista = tuple(activos) if activos is not None else proveedores()
    if not lista:
        return Resultado(error="sin_proveedor",
                         traza=[{"paso": "proveedor", "detalle": "ninguna llave configurada"}])
    pt = puente or Puente.del_entorno()
    cat = catalogo_declarado()
    sistema = prompt_sistema("en" if lang == "en" else "es")
    traza: list[dict[str, Any]] = []
    propio = cliente is None
    cl = cliente or httpx.AsyncClient()
    try:
        for prov in lista:
            hilo: list[dict[str, Any]] = [{"role": m["role"], "content": m["content"]}
                                          for m in mensajes]
            try:
                for vuelta in range(1, VUELTAS + 1):
                    t0 = time.perf_counter()
                    r = await turno(cl, prov, sistema=sistema, mensajes=hilo, catalogo=cat)
                    traza.append({"paso": "modelo", "proveedor": prov.id, "modelo": prov.modelo,
                                  "vuelta": vuelta, "ms": round((time.perf_counter() - t0) * 1000),
                                  "herramientas": [ll["nombre"] for ll in r.llamadas],
                                  "uso": r.uso})
                    if not r.llamadas:
                        return Resultado(respuesta=r.texto, proveedor=prov.id, modelo=prov.modelo,
                                         prompt=huella("en" if lang == "en" else "es"), traza=traza)
                    hilo.append(_como_asistente(prov.formato, r))
                    for lla in r.llamadas:
                        t1 = time.perf_counter()
                        salida = await pt.ejecutar(cl, sesion, str(lla["nombre"]), lla["args"])
                        traza.append({"paso": "herramienta", "nombre": lla["nombre"], "args": lla["args"],
                                      "ms": round((time.perf_counter() - t1) * 1000),
                                      "ok": not (isinstance(salida, dict) and salida.get("error")),
                                      "ignorado": (salida or {}).get("_ignorado")})
                        hilo.append(_como_resultado(prov.formato, lla, salida))
                # Se agotaron las vueltas: se responde con lo que hay, sin inventar.
                traza.append({"paso": "limite", "vueltas": VUELTAS})
                return Resultado(agotado=True, proveedor=prov.id, traza=traza)
            except Exception as e:
                # Amplio a proposito: cualquier fallo de un proveedor (red, 500,
                # JSON roto) tiene que dejar probar el siguiente en vez de tumbar
                # el turno. Queda anotado en la traza, no se traga en silencio.
                traza.append({"paso": "fallo", "proveedor": prov.id, "error": str(e)[:300]})
        return Resultado(error="todos_fallaron", traza=traza)
    finally:
        if propio:
            await cl.aclose()
