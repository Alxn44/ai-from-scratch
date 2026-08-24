"""The service. A minimal, explicit surface.

    GET  /salud                status, active providers, prompt fingerprint
    GET  /ontologia/prompt     the text the model sees            [secret]
    GET  /ontologia/grafo      nodes, edges, deletion order       [secret]
    POST /ontologia/prueba     runs P1..P4 and the violations     [secret]
    POST /agente/turno         one complete conversation          [secret]

Everything but /salud requires the shared secret. The three /ontologia/* routes
hand out the system prompt, the tool catalog and the table names — the map of
this service — and being unreachable from the internet was the only thing that
made publishing them survivable. That is a property of today's compose file, not
of the code, so the code now requires the secret too. /salud stays open because
the container healthcheck calls it with no headers; it reports whether a key is
configured, never a key, a model prompt or a table name.

Authentication: `x-ia-secreto`, shared with Node. It is not user authentication —
the user travels in `sesion`, which is opaque here and resolved by Node. This
service is not published to the internet: only the API calls it.

The ROUTE paths, the header names and the JSON keys below stay as they are: they
are the contract api/src/ia.js and web/src/pages/chat.astro are written against.
"""

from __future__ import annotations

import os
from itertools import pairwise
from typing import Annotated, Any, Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, model_validator

from . import VERSION
from .agent.bridge import Bridge
from .agent.loop import MAX_TURNS, run
from .agent.providers import providers
from .ontology.graph import GRAPH
from .ontology.render import catalog, fingerprint, system_prompt


def _docs_enabled() -> bool:
    """The schema UI is opt-in, and only for development.

    `/docs` and `/openapi.json` publish the whole surface of this service —
    every route, every field, every enum. Today nothing but the API can reach it
    because compose gives this container no host port, but that is one `ports:`
    line away from being wrong, and a request from a sibling container needs no
    port at all. So the default is off and turning it on takes saying so.
    """
    return (os.environ.get("IA_DOCS_DEV") or "").strip().lower() in {"1", "true", "yes"}


_DOCS = _docs_enabled()

# Both have to be gated: FastAPI keeps serving the OpenAPI document at
# `openapi_url` even when `docs_url` is None, and that document IS the schema.
app = FastAPI(title="IA desde cero — servicio de IA", version=VERSION,
              docs_url="/docs" if _DOCS else None, redoc_url=None,
              openapi_url="/openapi.json" if _DOCS else None)

_client: httpx.AsyncClient | None = None


@app.on_event("startup")
async def _open() -> None:
    global _client
    # One client for the whole process: it reuses connections. Opening one per
    # request pays for TLS every time, and with four turns per exchange that shows.
    _client = httpx.AsyncClient(timeout=60.0)


@app.on_event("shutdown")
async def _close() -> None:
    if _client is not None:
        await _client.aclose()


def require_secret(x_ia_secreto: Annotated[str | None, Header()] = None) -> None:
    expected = os.environ.get("IA_SECRETO") or ""
    if not expected:
        raise HTTPException(503, "IA_SECRETO sin configurar en el servicio")
    if x_ia_secreto != expected:
        raise HTTPException(401, "secreto de servicio invalido")


Guard = Annotated[None, Depends(require_secret)]


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8000)


class TurnRequest(BaseModel):
    # The ALIASES are the wire field names Node posts (`sesion`, `mensajes`) and
    # they do not move: api/src/ia.js builds this body. The attribute names are
    # English because that is what the rest of this file reads.
    #
    # `sesion` is opaque: it is the cookie Node issued. It is neither opened nor
    # interpreted here; it is forwarded to the bridge. This service does not know
    # who anybody is.
    session: str = Field(min_length=1, max_length=4096, alias="sesion")
    messages: list[Message] = Field(min_length=1, max_length=40, alias="mensajes")
    lang: Literal["es", "en"] = "es"

    @model_validator(mode="after")
    def _check_history_shape(self) -> TurnRequest:
        """Bound the shape of a history this service cannot authenticate.

        Assistant turns arrive from the caller and Node forwards the browser's
        copy of them verbatim, so a client can write whatever it likes into the
        assistant's mouth. Verifying them is not possible here: the service is
        stateless by design (Node holds the history) and Node does not sign the
        turns it relays, so there is nothing to check a turn against. What is
        possible is refusing the two shapes that read as instructions rather
        than as conversation — a fabricated final assistant turn that answers
        the question before the model does, and a run of consecutive assistant
        turns, which is how a block of invented "rules" gets stapled on. A
        leading assistant turn is allowed on purpose: Node trims history with
        `slice(-MAX_HIST)`, so an honest long conversation legitimately starts
        mid-exchange, and rejecting that would break real chats.

        Why this level is enough: what a forged turn can still reach is only the
        prompt's conversational rules, and nothing load-bearing rests on those.
        Isolation between users is enforced by Node resolving the userId from the
        session and by no tool accepting a person argument (IDENTITY_ARGS,
        checked by `ai-prove-isolation`), never by asking the model nicely.
        The "never reveal a lab solution" rule cannot be turned into an exfil
        either: `labs.solution` is class `jamas`, so it is absent from the prompt
        and from every tool's `returns` — no tool can return it, and a forged
        turn cannot conjure one. And since the loop now dispatches only declared
        tool names, a forged turn cannot widen tool reach. The residual risk is a
        caller talking their own assistant out of its own study rules, inside
        their own session — worth closing cheaply, not worth breaking chat over.
        """
        roles = [m.role for m in self.messages]
        if roles[-1] == "assistant":
            raise ValueError("the last message must be a user turn")
        if any(a == b == "assistant" for a, b in pairwise(roles)):
            raise ValueError("assistant turns cannot be consecutive")
        return self


@app.get("/salud")
async def health() -> dict[str, Any]:
    active = providers()
    return {"ok": True, "version": VERSION, "api": 3, "vueltas": MAX_TURNS,
            "proveedores": [p.id for p in active],
            "modelos": {p.id: p.model for p in active},
            "prompt_sha": {"es": fingerprint("es"), "en": fingerprint("en")},
            "puente": Bridge.from_env().base,
            "secreto_configurado": bool(os.environ.get("IA_SECRETO")),
            "violaciones": len(GRAPH.prove_isolation())}


@app.get("/ontologia/prompt")
async def onto_prompt(_: Guard, lang: Literal["es", "en"] = "es") -> dict[str, Any]:
    return {"texto": system_prompt(lang), "sha": fingerprint(lang), "catalogo": catalog()}


@app.get("/ontologia/grafo")
async def onto_graph(_: Guard) -> dict[str, Any]:
    r = dict(GRAPH.summary())
    r["vecindad_de_riesgo"] = {k: list(v) for k, v in GRAPH.risk_neighbourhood().items()}
    return r


@app.post("/ontologia/prueba")
async def onto_proof(_: Guard) -> dict[str, Any]:
    faults = GRAPH.prove_isolation()
    return {"ok": not faults,
            "violaciones": [{"herramienta": v.tool, "motivo": v.rule,
                             "detalle": v.detail, "camino": list(v.path)} for v in faults]}


@app.post("/agente/turno")
async def agent_turn(p: TurnRequest, _: Guard) -> dict[str, Any]:
    assert _client is not None
    r = await run(session=p.session, lang=p.lang, client=_client,
                  messages=[m.model_dump() for m in p.messages])
    return r.as_dict()
