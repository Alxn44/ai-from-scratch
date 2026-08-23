"""El bucle, sin red y sin base. Un proveedor de mentira y un puente de mentira.

Lo que se comprueba no es que el modelo responda bien: es que el bucle no pueda
filtrar un userId, que respete el tope de vueltas y que pase al siguiente
proveedor cuando uno falla.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from ia.agente import bucle
from ia.agente.bucle import VUELTAS, correr
from ia.agente.herramientas import Puente
from ia.agente.proveedores import Proveedor, Turno

PROV = Proveedor(id="falso", formato="anthropic", base="http://x", key="k", modelo="m")


class PuenteFalso:
    """Registra lo que le llega. Es donde se comprueba que el userId no viaja.

    No hereda de Puente a proposito: Puente es un dataclass frozen con slots, y
    heredarlo rompe `super().__init__` (la clase que ve `super()` no es la que
    dataclass acaba creando). El bucle solo llama `ejecutar`, asi que basta con
    tener ese metodo — y si algun dia el bucle necesita otro, el test falla, que
    es exactamente lo que se quiere de un doble.
    """

    base = "http://node"
    secreto = "s"

    def __init__(self) -> None:
        self.llamadas: list[tuple[str, str, dict[str, Any]]] = []

    async def ejecutar(self, cliente, sesion, nombre, args, timeout_s: float = 20.0):
        self.llamadas.append((sesion, nombre, dict(args)))
        return {"ok": True, "de": nombre}


def _guion(*turnos: Turno):
    """Sustituye `turno` por una lista de respuestas ya escritas."""
    it = iter(turnos)

    async def falso(cliente, prov, **kw):
        try:
            return next(it)
        except StopIteration:  # pragma: no cover
            return Turno("fin", (), [], None)

    return falso


async def test_responde_sin_herramientas(monkeypatch):
    monkeypatch.setattr(bucle, "turno", _guion(Turno("hola", (), [], None)))
    r = await correr(sesion="cookie", mensajes=[{"role": "user", "content": "hola"}],
                     activos=[PROV], puente=PuenteFalso())
    assert r.respuesta == "hola"
    assert r.error is None
    assert [p["paso"] for p in r.traza] == ["modelo"]


async def test_llama_una_herramienta_y_vuelve(monkeypatch):
    monkeypatch.setattr(bucle, "turno", _guion(
        Turno("", ({"id": "t1", "nombre": "mi_progreso", "args": {}},), [], None),
        Turno("vas por la 3", (), [], None)))
    pt = PuenteFalso()
    r = await correr(sesion="cookie", mensajes=[{"role": "user", "content": "como voy"}],
                     activos=[PROV], puente=pt)
    assert r.respuesta == "vas por la 3"
    assert [n for _, n, _ in pt.llamadas] == ["mi_progreso"]
    assert [p["paso"] for p in r.traza] == ["modelo", "herramienta", "modelo"]


async def test_el_bucle_no_puede_mandar_un_userid(monkeypatch):
    """Si el modelo cuela user_id en los args, viaja al puente y NODE lo descarta.
    Lo que se afirma aqui es lo que este servicio garantiza: que no ANADE ninguno
    por su cuenta, porque no tiene ninguno que anadir."""
    monkeypatch.setattr(bucle, "turno", _guion(
        Turno("", ({"id": "t1", "nombre": "mis_intentos",
                    "args": {"lab_id": "5.2", "user_id": 7}},), [], None),
        Turno("listo", (), [], None)))
    pt = PuenteFalso()
    await correr(sesion="cookie", mensajes=[{"role": "user", "content": "x"}],
                 activos=[PROV], puente=pt)
    sesion, _, args = pt.llamadas[0]
    assert sesion == "cookie"              # lo unico que identifica: la cookie opaca
    assert args == {"lab_id": "5.2", "user_id": 7}   # tal cual vino del modelo
    # Y el resultado NO trae ningun identificador inventado por el servicio.
    assert not any(k in args for k in ("userId", "id_usuario"))


async def test_respeta_el_tope_de_vueltas(monkeypatch):
    llamando = Turno("", ({"id": "t", "nombre": "mi_perfil", "args": {}},), [], None)
    monkeypatch.setattr(bucle, "turno", _guion(*[llamando] * (VUELTAS + 4)))
    pt = PuenteFalso()
    r = await correr(sesion="c", mensajes=[{"role": "user", "content": "x"}],
                     activos=[PROV], puente=pt)
    assert r.agotado is True
    assert r.respuesta is None
    assert len(pt.llamadas) == VUELTAS
    assert r.traza[-1] == {"paso": "limite", "vueltas": VUELTAS}


async def test_pasa_al_siguiente_proveedor_cuando_uno_falla(monkeypatch):
    otro = Proveedor(id="segundo", formato="openai", base="http://y", key="k", modelo="m2")
    estado = {"n": 0}

    async def falso(cliente, prov, **kw):
        estado["n"] += 1
        if prov.id == "falso":
            raise RuntimeError("falso 500: se cayo")
        return Turno("respondo yo", (), {}, None)

    monkeypatch.setattr(bucle, "turno", falso)
    r = await correr(sesion="c", mensajes=[{"role": "user", "content": "x"}],
                     activos=[PROV, otro], puente=PuenteFalso())
    assert r.respuesta == "respondo yo"
    assert r.proveedor == "segundo"
    assert [p["paso"] for p in r.traza] == ["fallo", "modelo"]
    assert "se cayo" in r.traza[0]["error"]


async def test_sin_proveedores_no_finge():
    r = await correr(sesion="c", mensajes=[{"role": "user", "content": "x"}],
                     activos=[], puente=PuenteFalso())
    assert r.error == "sin_proveedor"
    assert r.respuesta is None


async def test_todos_fallan(monkeypatch):
    async def falso(cliente, prov, **kw):
        raise RuntimeError("nope")
    monkeypatch.setattr(bucle, "turno", falso)
    r = await correr(sesion="c", mensajes=[{"role": "user", "content": "x"}],
                     activos=[PROV], puente=PuenteFalso())
    assert r.error == "todos_fallaron"


async def test_el_puente_real_no_llama_sin_secreto():
    pt = Puente(base="http://node", secreto="")
    async with httpx.AsyncClient() as cl:
        assert await pt.ejecutar(cl, "c", "mi_perfil", {}) == {"error": "sin_secreto_de_servicio"}


@pytest.mark.parametrize("lang", ["es", "en"])
async def test_el_idioma_llega_al_prompt(monkeypatch, lang):
    visto: dict[str, str] = {}

    async def falso(cliente, prov, *, sistema, **kw):
        visto["sistema"] = sistema
        return Turno("ok", (), [], None)

    monkeypatch.setattr(bucle, "turno", falso)
    await correr(sesion="c", lang=lang, mensajes=[{"role": "user", "content": "x"}],
                 activos=[PROV], puente=PuenteFalso())
    marca = "Responde en espanol" if lang == "es" else "Answer in English"
    assert marca in visto["sistema"]
