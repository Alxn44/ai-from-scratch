"""The harness: a small, explicit graph, walked in a loop.

    input -> [model] --text--> output
                |
             tool_use
                v
           [bridge] -> [Node executes] -> back to the model   (max. MAX_TURNS)

Ported from api/src/harness.js. What changes with respect to v2 is not the logic:
it is that the [guard] step is no longer here. In v2 the harness called
`ejecutar()` with `{userId}` in the same process; now it sends the name and the
args to the bridge and Node resolves the userId from the session. This service
NEVER sees a userId, and therefore cannot leak one even through a programming
mistake.

Complexity: MAX_TURNS * (1 model call + K tools). The loop is bounded on purpose
— with no cap, a model that insists on calling tools burns tokens up to the
billing limit.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..ontology.render import catalog as declared_catalog
from ..ontology.render import fingerprint, system_prompt
from ..retrieval.tools import NATIVE_HANDLERS, Handler, dispatch
from ..retrieval.tools import Ctx as NativeCtx
from .bridge import Bridge
from .providers import Provider, ProviderError, Turn, pick_chain, turn

MAX_TURNS = 4

# Same cap Node puts on the tool name it will accept (ESQ_HERRAMIENTA). A refused
# name is model-chosen text and ends up in the trace, so it is bounded here too.
MAX_NAME_LEN = 64

_log = logging.getLogger(__name__)

# Result field -> WIRE KEY. The keys stay Spanish because they are the contract
# with two other runtimes: api/src/ia.js declares them in its `TurnoIA` typedef
# (so `pnpm check` fails if one drifts) and web/src/pages/chat.astro reads
# `d.respuesta` and `d.traza` to paint the answer and the trace. Renaming a key is
# a coordinated change across three languages, not a rename.
_WIRE_KEYS = (("answer", "respuesta"), ("error", "error"), ("provider", "proveedor"),
              ("model", "modelo"), ("prompt", "prompt"))


@dataclass(slots=True)
class Result:
    answer: str | None = None
    error: str | None = None
    exhausted: bool = False
    provider: str | None = None
    model: str | None = None
    prompt: str | None = None
    trace: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"traza": self.trace}
        for attr, wire in _WIRE_KEYS:
            v = getattr(self, attr)
            if v is not None:
                d[wire] = v
        if self.exhausted:
            d["agotado"] = True
        return d


def _as_tool_result(fmt: str, call: Mapping[str, Any], output: Any) -> dict[str, Any]:
    import json
    text = json.dumps(output, ensure_ascii=False)
    if fmt == "anthropic":
        return {"role": "user",
                "content": [{"type": "tool_result", "tool_use_id": call["id"], "content": text}]}
    return {"role": "tool", "tool_call_id": call["id"], "name": call["nombre"], "content": text}


def _failure_for_trace(e: BaseException) -> str:
    """A provider failure, in a shape that is safe to hand to a client.

    The trace this returns is relayed by Node to the browser and rendered there,
    so nothing that came off the wire may go in it: `str(e)` on a 401 used to
    carry the upstream body, and several providers echo a truncated API key in
    that body. What is left is code-defined text only — the exception class name,
    plus the status code when the failure was an HTTP one. The full detail is in
    the server log, which is where an operator can read it and a user cannot.
    """
    if isinstance(e, ProviderError):
        return f"http_{e.status}"
    return type(e).__name__


def _as_assistant_turn(fmt: str, r: Turn) -> dict[str, Any]:
    if fmt == "anthropic":
        return {"role": "assistant", "content": r.raw}
    if isinstance(r.raw, dict) and r.raw:
        return {"role": "assistant", **r.raw}
    return {"role": "assistant", "content": r.text}


async def run(*, session: str, messages: Sequence[Mapping[str, Any]], lang: str = "es",
              bridge: Bridge | None = None, active: Sequence[Provider] | None = None,
              client: httpx.AsyncClient | None = None,
              native: Mapping[str, Handler] | None = None,
              provider_id: str | None = None, effort: str | None = None) -> Result:
    chain = pick_chain(provider_id, active, lang)
    if not chain:
        return Result(error="sin_proveedor",
                      trace=[{"paso": "proveedor", "detalle": "ninguna llave configurada"}])
    br = bridge or Bridge.from_env()
    # Injectable for the same reason `bridge` is: without a seam a native tool is
    # untestable, and «dispatched locally» is precisely the property that has to be
    # asserted — the existing FakeBridge accepts ANY name, so a native sent to the
    # bridge by mistake looks exactly like success.
    nat = NATIVE_HANDLERS if native is None else native
    cat = declared_catalog()
    # The catalog is what the model was OFFERED; this set is what it may reach.
    # Until now `cat` only built the schemas sent to the provider and nothing
    # checked the name coming back, so any name the model produced was forwarded
    # to the bridge — and Node's registry executes far more tools than the 7 this
    # ontology declares, mutating ones included. That gap matters most because
    # tool results are fed back to the model verbatim and some of them echo text
    # the user stored earlier, which makes them an injection path into exactly
    # this dispatch. An allowlist built from the declaration closes it: whatever
    # the injected text asks for, only a declared name can be called.
    declared = frozenset(str(h["nombre"]) for h in cat)
    system = system_prompt("en" if lang == "en" else "es")
    trace: list[dict[str, Any]] = []
    own = client is None
    cl = client or httpx.AsyncClient()
    try:
        for prov in chain:
            thread: list[dict[str, Any]] = [{"role": m["role"], "content": m["content"]}
                                            for m in messages]
            try:
                for turn_n in range(1, MAX_TURNS + 1):
                    t0 = time.perf_counter()
                    r = await turn(cl, prov, system=system, messages=thread, catalog=cat,
                                   effort=effort)
                    trace.append({"paso": "modelo", "proveedor": prov.id, "modelo": prov.model,
                                  "vuelta": turn_n,
                                  "ms": round((time.perf_counter() - t0) * 1000),
                                  "herramientas": [c["nombre"] for c in r.calls],
                                  "uso": r.usage})
                    if not r.calls:
                        return Result(answer=r.text, provider=prov.id, model=prov.model,
                                      prompt=fingerprint("en" if lang == "en" else "es"),
                                      trace=trace)
                    thread.append(_as_assistant_turn(prov.fmt, r))
                    for call in r.calls:
                        name = str(call["nombre"])
                        if name not in declared:
                            # Refused before the bridge is touched, and the model is
                            # told so in the same shape a real failure takes, so it
                            # can correct itself instead of retrying blind. The args
                            # are deliberately NOT traced: on a refused call they are
                            # whatever the injected text produced, and the trace is
                            # rendered in a browser.
                            _log.warning("refused undeclared tool %r from provider %s",
                                         name[:MAX_NAME_LEN], prov.id)
                            trace.append({"paso": "herramienta", "nombre": name[:MAX_NAME_LEN],
                                          "ms": 0, "ok": False, "rechazada": True})
                            thread.append(_as_tool_result(
                                prov.fmt, call, {"error": "herramienta_no_declarada"}))
                            continue
                        t1 = time.perf_counter()
                        # THE ONE BRANCH. Everything downstream is shape-agnostic
                        # already — the trace entry has no bridge-specific field and
                        # `_as_tool_result` json.dumps whatever it gets — so a native
                        # handler needs only to be awaitable and to return a dict,
                        # which is what `br.call` is to this code as well.
                        #
                        # It has to be here rather than «somewhere in the ontology»:
                        # without it a declared native is offered to the model, the
                        # model calls it, and Node answers `herramienta_desconocida`.
                        # A promise nothing keeps, plus a wasted turn.
                        #
                        # `dispatch` and not `nat[name](...)`: it is what puts the
                        # tool's declared `composes` allowlist in force around the
                        # bridge it is handed. Calling the handler directly here is
                        # exactly the shape this code had while the allowlist was
                        # decorative, so there is one way in and it is this one.
                        if name in nat:
                            output = await dispatch(
                                name,
                                NativeCtx(client=cl, session=session, bridge=br,
                                          lang="en" if lang == "en" else "es"),
                                call["args"], native=nat)
                        else:
                            output = await br.call(cl, session, name, call["args"])
                        # No `ignorado` field: api/src/tools/index.ts used to echo a
                        # rejected argument key back as `_ignorado`, and that was
                        # deliberately removed — telling the model which name was just
                        # refused invites it to try the next one. The rejection is
                        # written to the server log instead, so there is nothing left
                        # here to relay.
                        #
                        # `memo` IS relayed, and it had been lost. The tools still mark a
                        # cached answer `_memo: true` (api/src/tools/index.ts), and the
                        # chat renders it as «already had it» from `t.memo` — but the v2
                        # harness set that key and this loop never did, so the label had
                        # been unreachable since the port. Same boolean shape the harness
                        # used, so nothing downstream changes.
                        cached = isinstance(output, dict) and bool(output.get("_memo"))
                        trace.append({"paso": "herramienta", "nombre": call["nombre"],
                                      "args": call["args"],
                                      "ms": round((time.perf_counter() - t1) * 1000),
                                      "ok": not (isinstance(output, dict)
                                                 and output.get("error")),
                                      "memo": cached})
                        thread.append(_as_tool_result(prov.fmt, call, output))
                # The turns ran out: answer with what there is, without inventing.
                trace.append({"paso": "limite", "vueltas": MAX_TURNS})
                return Result(exhausted=True, provider=prov.id, trace=trace)
            except Exception as e:
                # Deliberately broad: any provider failure (network, 500, broken
                # JSON) has to leave room to try the next one instead of taking the
                # turn down. It is noted in the trace, never swallowed in silence.
                #
                # The log gets the whole exception (traceback and upstream body
                # included); the trace gets a summary with nothing from the wire
                # in it. See _failure_for_trace.
                _log.exception("provider %s failed", prov.id)
                trace.append({"paso": "fallo", "proveedor": prov.id,
                              "error": _failure_for_trace(e)})
        return Result(error="todos_fallaron", trace=trace)
    finally:
        if own:
            await cl.aclose()
