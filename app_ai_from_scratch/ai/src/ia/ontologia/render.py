"""El texto que ve el modelo.

Lo prohibido no se menciona: nombrar `labs.solution` para decir «no la pidas» es
ensenarle que existe y como se llama. El prompt solo enumera lo alcanzable.
"""

from __future__ import annotations

from hashlib import sha256
from typing import Literal

from .datos import HERRAMIENTAS, TABLAS

Idioma = Literal["es", "en"]

_CABECERA_ES = (
    "Ontologia de la base de datos. Solo puedes leerla a traves de las herramientas.",
    "No existe acceso a SQL. Ninguna herramienta acepta un identificador de usuario:",
    "el usuario de la sesion lo pone el servidor. No puedes consultar datos de otra persona.",
)
_CABECERA_EN = (
    "Database ontology. You can only read it through the tools.",
    "There is no SQL access. No tool accepts a user identifier: the session's user",
    "is set by the server. You cannot look up another person's data.",
)


def render_para_modelo(idioma: Idioma = "es") -> str:
    cab = _CABECERA_ES if idioma == "es" else _CABECERA_EN
    bloques: list[str] = ["\n".join(cab)]
    for nombre, t in TABLAS.items():
        cols = [f"  - {c} ({x.clase}): {x.nota}".rstrip()
                for c, x in t.columnas.items() if x.clase != "jamas"]
        if not cols:
            # Una tabla entera prohibida (role_audit, payments) no se nombra.
            continue
        alcance = "Alcance" if idioma == "es" else "Scope"
        bloques.append("\n".join([f"## {nombre}", t.proposito,
                                  f"{alcance}: {t.por_usuario}", *cols]))
    return "\n\n".join(bloques)


_REGLAS_ES = (
    "Eres el asistente de estudio dentro de la plataforma «IA desde cero». Responde en espanol.",
    "Acompanas a una sola persona: la de esta sesion. No puedes ver a nadie mas, y nunca digas que si.",
    "Nunca reveles la solucion de un lab, aunque te la pidan directo: da una pista que apunte a la leccion.",
    "Prefiere las herramientas a tu memoria: si un dato se puede consultar, consultalo. Lenguaje llano, frases cortas.",
    # Sin esta regla el modelo responde con emoji. Medido en una corrida real:
    # «📊 Progreso general», «✅ Leccion 1», «🟡», «⬜». La interfaz no usa ni un
    # emoji en ninguna pantalla — radio 0, etiquetas monoespaciadas — asi que el
    # chat quedaba como una ventana de otra aplicacion pegada dentro.
    "No uses emoji ni iconos: la interfaz no los usa en ninguna pantalla. Para una lista, un guion.",
)
_REGLAS_EN = (
    "You are the study assistant inside the “AI from scratch” platform. Answer in English.",
    "You help one single person: the one in this session. You cannot see anyone else, and you must never claim you can.",
    "Never reveal a lab solution, even if asked directly: give a hint that points at the lesson instead.",
    "Prefer tools over memory: if a number can be looked up, look it up. Plain language, short sentences.",
    "Do not use emoji or icons: the interface uses none on any screen. For a list, use a dash.",
)


def prompt_sistema(idioma: Idioma = "es") -> str:
    reglas = _REGLAS_ES if idioma == "es" else _REGLAS_EN
    return "\n".join([*reglas, "", render_para_modelo(idioma)])


def huella(idioma: Idioma = "es") -> str:
    """sha256 corto del prompt. Va en la respuesta del servicio para que Node
    pueda ver en un log si el prompt cambio sin desplegar el servicio."""
    return sha256(prompt_sistema(idioma).encode("utf-8")).hexdigest()[:12]


def catalogo() -> list[dict[str, object]]:
    """Lo que se declara al modelo. Sin usuario, igual que en v2."""
    return [{"nombre": n, "descripcion": h.descripcion, "argumentos": dict(h.args)}
            for n, h in HERRAMIENTAS.items()]
