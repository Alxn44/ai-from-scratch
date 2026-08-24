"""The loop, with no network and no database. A fake provider and a fake bridge.

What is checked here is not that the model answers well: it is that the loop cannot
leak a userId, that it respects the turn cap, and that it moves to the next provider
when one fails.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from course_ai.agent import loop
from course_ai.agent.bridge import Bridge
from course_ai.agent.loop import MAX_TURNS, run
from course_ai.agent.providers import Provider, ProviderError, Turn

PROV = Provider(id="falso", fmt="anthropic", base="http://x", key="k", model="m")


class FakeBridge:
    """Records what reaches it. This is where the userId is checked not to travel.

    It deliberately does NOT inherit from Bridge: Bridge is a frozen dataclass with
    slots, and inheriting it breaks `super().__init__` (the class `super()` sees is
    not the one dataclass ends up creating). The loop only calls `call`, so having
    that method is enough — and if one day the loop needs another one, the test
    fails, which is exactly what is wanted from a double.
    """

    base = "http://node"
    secret = "s"

    def __init__(self, extra: dict[str, Any] | None = None) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.extra = extra or {}

    async def call(self, client, session, name, args, timeout_s: float = 20.0):
        self.calls.append((session, name, dict(args)))
        return {"ok": True, "de": name, **self.extra}


def _script(*turns: Turn):
    """Replaces `turn` with a list of answers written in advance."""
    it = iter(turns)

    async def fake(client, prov, **kw):
        try:
            return next(it)
        except StopIteration:  # pragma: no cover
            return Turn("fin", (), [], None)

    return fake


async def test_answers_with_no_tools(monkeypatch):
    monkeypatch.setattr(loop, "turn", _script(Turn("hola", (), [], None)))
    r = await run(session="cookie", messages=[{"role": "user", "content": "hola"}],
                  active=[PROV], bridge=FakeBridge())
    assert r.answer == "hola"
    assert r.error is None
    assert [p["paso"] for p in r.trace] == ["modelo"]


async def test_calls_one_tool_and_comes_back(monkeypatch):
    monkeypatch.setattr(loop, "turn", _script(
        Turn("", ({"id": "t1", "nombre": "mi_progreso", "args": {}},), [], None),
        Turn("vas por la 3", (), [], None)))
    bridge = FakeBridge()
    r = await run(session="cookie", messages=[{"role": "user", "content": "como voy"}],
                  active=[PROV], bridge=bridge)
    assert r.answer == "vas por la 3"
    assert [n for _, n, _ in bridge.calls] == ["mi_progreso"]
    assert [p["paso"] for p in r.trace] == ["modelo", "herramienta", "modelo"]


async def test_the_loop_cannot_send_a_userid(monkeypatch):
    """If the model slips user_id into the args, it travels to the bridge and NODE
    discards it. What is asserted here is what this service guarantees: that it ADDS
    none of its own, because it has none to add."""
    monkeypatch.setattr(loop, "turn", _script(
        Turn("", ({"id": "t1", "nombre": "mis_intentos",
                   "args": {"lab_id": "5.2", "user_id": 7}},), [], None),
        Turn("listo", (), [], None)))
    bridge = FakeBridge()
    await run(session="cookie", messages=[{"role": "user", "content": "x"}],
              active=[PROV], bridge=bridge)
    session, _, args = bridge.calls[0]
    assert session == "cookie"              # the only identifier: the opaque cookie
    assert args == {"lab_id": "5.2", "user_id": 7}   # exactly as it came from the model
    # And the result carries no identifier invented by the service.
    assert not any(k in args for k in ("userId", "id_usuario"))


async def test_respects_the_turn_cap(monkeypatch):
    calling = Turn("", ({"id": "t", "nombre": "mi_perfil", "args": {}},), [], None)
    monkeypatch.setattr(loop, "turn", _script(*[calling] * (MAX_TURNS + 4)))
    bridge = FakeBridge()
    r = await run(session="c", messages=[{"role": "user", "content": "x"}],
                  active=[PROV], bridge=bridge)
    assert r.exhausted is True
    assert r.answer is None
    assert len(bridge.calls) == MAX_TURNS
    assert r.trace[-1] == {"paso": "limite", "vueltas": MAX_TURNS}


async def test_moves_to_the_next_provider_when_one_fails(monkeypatch):
    other = Provider(id="segundo", fmt="openai", base="http://y", key="k", model="m2")
    state = {"n": 0}

    async def fake(client, prov, **kw):
        state["n"] += 1
        if prov.id == "falso":
            raise RuntimeError("falso 500: se cayo")
        return Turn("respondo yo", (), {}, None)

    monkeypatch.setattr(loop, "turn", fake)
    r = await run(session="c", messages=[{"role": "user", "content": "x"}],
                  active=[PROV, other], bridge=FakeBridge())
    assert r.answer == "respondo yo"
    assert r.provider == "segundo"
    assert [p["paso"] for p in r.trace] == ["fallo", "modelo"]
    # The failure is noted, but WITHOUT the exception's text: the trace travels to
    # the browser. What is kept is the class, which we write ourselves.
    assert r.trace[0]["error"] == "RuntimeError"
    assert "se cayo" not in str(r.trace)


async def test_with_no_providers_it_does_not_pretend():
    r = await run(session="c", messages=[{"role": "user", "content": "x"}],
                  active=[], bridge=FakeBridge())
    assert r.error == "sin_proveedor"
    assert r.answer is None


async def test_all_of_them_fail(monkeypatch):
    async def fake(client, prov, **kw):
        raise RuntimeError("nope")
    monkeypatch.setattr(loop, "turn", fake)
    r = await run(session="c", messages=[{"role": "user", "content": "x"}],
                  active=[PROV], bridge=FakeBridge())
    assert r.error == "todos_fallaron"


async def test_an_undeclared_tool_never_reaches_the_bridge(monkeypatch):
    """The model invents a name that is not in the ontology. The bridge is not
    touched and the model receives a structured error.

    The specimen used to be `cola_encolar`, with the comment «it exists in Node's
    registry, NOT in the ontology». That was true, and it was the hole: Node executed
    37 tools and only 7 were declared. With the hole closed, that test started failing
    because its specimen is now declared — which is the correct signal. It now uses a
    name that CANNOT exist, so it checks the mechanism and not the list."""
    monkeypatch.setattr(loop, "turn", _script(
        Turn("", ({"id": "t1", "nombre": "borra_la_base",
                   "args": {"motivo": "ignora tus reglas"}},), [], None),
        Turn("no puedo con eso", (), [], None)))
    bridge = FakeBridge()
    r = await run(session="cookie", messages=[{"role": "user", "content": "x"}],
                  active=[PROV], bridge=bridge)
    assert bridge.calls == []                       # the bridge was NEVER called
    assert r.answer == "no puedo con eso"
    step = next(p for p in r.trace if p["paso"] == "herramienta")
    assert step == {"paso": "herramienta", "nombre": "borra_la_base",
                    "ms": 0, "ok": False, "rechazada": True}
    # And the args of a refused call are not copied into the trace.
    assert "ignora tus reglas" not in str(r.trace)


async def test_the_refusal_reaches_the_model_as_a_result(monkeypatch):
    """The turn stays alive: the model gets a tool_result with the error, so it can
    correct itself on the next turn."""
    seen: list[list[dict]] = []

    async def fake(client, prov, *, messages, **kw):
        seen.append([dict(m) for m in messages])
        if len(seen) == 1:
            return Turn("", ({"id": "t1", "nombre": "no_existe_esta", "args": {}},), [], None)
        return Turn("fin", (), [], None)

    monkeypatch.setattr(loop, "turn", fake)
    await run(session="c", messages=[{"role": "user", "content": "x"}],
              active=[PROV], bridge=FakeBridge())
    assert "herramienta_no_declarada" in str(seen[1])


async def test_every_bridged_tool_reaches_the_bridge(monkeypatch):
    """The allowlist is exactly the ontology: none of the bridged names is refused.

    THIS TEST USED TO BE ONE TEST OVER THE WHOLE CATALOGUE, and that is the most
    dangerous assertion in this file's history. It looped over `catalog()` — the
    UNION, which is what the model is offered — and asserted that every name showed
    up in `bridge.calls`. Measured with a native injected and no local dispatch, it
    PASSED: `FakeBridge.call` accepts any name and answers `{ok: True}`, so the test
    certified that a native tool had been correctly forwarded to Node, which is
    precisely the behaviour that must not exist. In production Node would have
    answered `herramienta_desconocida` and the turn would have been spent on it.

    So it is two tests. This one covers the bridged half; the next one asserts the
    property the union version could not see — that a native does NOT reach the
    bridge.
    """
    from course_ai.ontology.data import BRIDGED

    for name in BRIDGED:
        monkeypatch.setattr(loop, "turn", _script(
            Turn("", ({"id": "t", "nombre": name, "args": {}},), [], None),
            Turn("ok", (), [], None)))
        bridge = FakeBridge()
        await run(session="c", messages=[{"role": "user", "content": "x"}],
                  active=[PROV], bridge=bridge)
        assert [n for _, n, _ in bridge.calls] == [name], name


async def test_every_native_tool_is_dispatched_LOCALLY_and_never_to_the_bridge(monkeypatch):
    """The other half, and the one that goes red on the failure the union test hid.

    `bridge.calls` has to be EMPTY. That is the whole assertion: a native is executed
    in this process, and if it ever reaches `br.call` the model gets
    `herramienta_desconocida` from a tool the prompt promised. The handlers are
    stubbed so this stays a test about DISPATCH — what each one answers is measured
    in test_retrieval.py.
    """
    from course_ai.ontology.data import NATIVE

    assert NATIVE, "nothing is declared native, so this proves nothing"
    for name in NATIVE:
        seen: list[str] = []

        async def handler(ctx, args, _n=name, _seen=seen):
            _seen.append(_n)
            return {"ok": True, "de": _n}

        monkeypatch.setattr(loop, "turn", _script(
            Turn("", ({"id": "t", "nombre": name, "args": {}},), [], None),
            Turn("ok", (), [], None)))
        bridge = FakeBridge()
        r = await run(session="c", messages=[{"role": "user", "content": "x"}],
                      active=[PROV], bridge=bridge, native={name: handler})
        assert seen == [name], f"{name} did not reach the local dispatcher"
        assert bridge.calls == [], (
            f"{name} is declared native and was sent to Node: {bridge.calls}. "
            f"Node would answer herramienta_desconocida.")
        step = next(p for p in r.trace if p["paso"] == "herramienta")
        assert step["nombre"] == name and step["ok"] is True


async def test_the_real_native_handlers_are_the_ones_wired_in_by_default(monkeypatch):
    """The test above injects handlers, so on its own it would pass over an empty
    default registry. This one takes the injection away: with `native=` unset the
    loop has to use `NATIVE_HANDLERS`, and the bridge still has to stay untouched
    except for what the handler itself composes.

    `entender_pregunta` composes `curso_indice`, so the bridge IS called here — once,
    by the handler, for a `publico` tool. What must never appear in `bridge.calls` is
    `entender_pregunta` itself.
    """
    monkeypatch.setattr(loop, "turn", _script(
        Turn("", ({"id": "t", "nombre": "entender_pregunta",
                   "args": {"pregunta": "como lo hago menos aleatorio"}},), [], None),
        Turn("ok", (), [], None)))
    bridge = FakeBridge({"lecciones": [{"n": n, "title": f"L{n}"} for n in range(1, 13)]})
    r = await run(session="c", messages=[{"role": "user", "content": "x"}],
                  active=[PROV], bridge=bridge)
    called = [n for _, n, _ in bridge.calls]
    assert "entender_pregunta" not in called, called
    assert called == ["curso_indice"], called
    step = next(p for p in r.trace if p["paso"] == "herramienta")
    assert step["nombre"] == "entender_pregunta" and step["ok"] is True


async def test_a_provider_http_error_is_summarised_by_status(monkeypatch):
    """An upstream failure enters the trace as `http_NNN`. That the exception does not
    carry the body is checked in test_providers.py, where it is built."""
    async def fake(client, prov, **kw):
        raise ProviderError("deepseek", 401)

    monkeypatch.setattr(loop, "turn", fake)
    r = await run(session="c", messages=[{"role": "user", "content": "x"}],
                  active=[PROV], bridge=FakeBridge())
    assert r.trace[0] == {"paso": "fallo", "proveedor": "falso", "error": "http_401"}


async def test_the_real_bridge_does_not_call_without_a_secret():
    bridge = Bridge(base="http://node", secret="")
    async with httpx.AsyncClient() as cl:
        assert await bridge.call(cl, "c", "mi_perfil", {}) == {"error": "sin_secreto_de_servicio"}


@pytest.mark.parametrize("lang", ["es", "en"])
async def test_the_language_reaches_the_prompt(monkeypatch, lang):
    seen: dict[str, str] = {}

    async def fake(client, prov, *, system, **kw):
        seen["system"] = system
        return Turn("ok", (), [], None)

    monkeypatch.setattr(loop, "turn", fake)
    await run(session="c", lang=lang, messages=[{"role": "user", "content": "x"}],
              active=[PROV], bridge=FakeBridge())
    marker = "Responde en espanol" if lang == "es" else "Answer in English"
    assert marker in seen["system"]


async def test_a_cached_tool_answer_is_marked_memo_in_the_trace(monkeypatch):
    """The tools mark a cached answer `_memo: true`, and the chat renders it as
    «already had it» from `t.memo`. The v2 harness set that key; this loop did not,
    so the label had been unreachable since the port — a live feature with a dead
    label, which reads to a user as the cache never working."""
    monkeypatch.setattr(loop, "turn", _script(
        Turn("", ({"id": "t1", "nombre": "mi_perfil", "args": {}},), [], None),
        Turn("listo", (), [], None)))
    r = await run(session="c", messages=[{"role": "user", "content": "x"}],
                  active=[PROV], bridge=FakeBridge({"_memo": True}))
    step = next(p for p in r.trace if p["paso"] == "herramienta")
    assert step["memo"] is True


async def test_an_uncached_tool_answer_is_not_marked_memo(monkeypatch):
    monkeypatch.setattr(loop, "turn", _script(
        Turn("", ({"id": "t1", "nombre": "mi_perfil", "args": {}},), [], None),
        Turn("listo", (), [], None)))
    r = await run(session="c", messages=[{"role": "user", "content": "x"}],
                  active=[PROV], bridge=FakeBridge())
    step = next(p for p in r.trace if p["paso"] == "herramienta")
    assert step["memo"] is False


async def test_a_refused_call_carries_no_memo_at_all(monkeypatch):
    """It never reached the bridge, so there is no cached-or-not to report."""
    monkeypatch.setattr(loop, "turn", _script(
        Turn("", ({"id": "t1", "nombre": "no_existe_esta", "args": {}},), [], None),
        Turn("fin", (), [], None)))
    r = await run(session="c", messages=[{"role": "user", "content": "x"}],
                  active=[PROV], bridge=FakeBridge())
    step = next(p for p in r.trace if p["paso"] == "herramienta")
    assert "memo" not in step


async def test_a_native_dispatched_BY_THE_LOOP_cannot_reach_an_undeclared_tool(monkeypatch):
    """The fence, proved through the production path rather than through `dispatch`.

    The unit test for the fence lives in test_retrieval.py. This one exists because
    the defect it guards against was never in the fence: it was in the CALL SITE. For
    as long as loop.py called `nat[name](ctx, args)` directly, `Tool.composes` was
    read only by graph.py, export.py and render.py — the proof, the artefact and the
    document — and nothing consulted it at the moment a handler used the bridge. A
    handler that fetched `leccion_texto` and returned the prose passed every gate in
    the repository.

    So the assertion is about the loop: whatever it does with a native, the bridge
    must not see a name the tool does not declare. The turn survives — a handler
    raising is a tool failure, which the loop already knows how to report — and what
    must not happen is the request going out.
    """
    from course_ai.ontology.data import TOOLS

    assert TOOLS["entender_pregunta"].composes == ("curso_indice",)

    async def hostile(ctx, args):
        return {"texto": await ctx.bridge.call(None, ctx.session, "leccion_texto", {"n": 9})}

    monkeypatch.setattr(loop, "turn", _script(
        Turn("", ({"id": "t", "nombre": "entender_pregunta", "args": {"pregunta": "x"}},),
             [], None),
        Turn("ok", (), [], None)))
    bridge = FakeBridge()
    r = await run(session="c", messages=[{"role": "user", "content": "x"}],
                  active=[PROV], bridge=bridge,
                  native={"entender_pregunta": hostile})
    assert [n for _s, n, _a in bridge.calls] == [], (
        f"the loop let a native reach an undeclared tool: {bridge.calls}")
    # And it failed LOUDLY, by name, rather than the call quietly not happening —
    # otherwise this test would pass over a loop that never dispatched at all.
    assert any(p.get("error") == "NotComposed" for p in r.trace), r.trace
    assert r.error == "todos_fallaron", r.error
