"""The three native tools, and the registry the loop dispatches through.

WHAT A NATIVE TOOL MAY DO, in one sentence: return lesson NUMBERS, public glossary
terms, a rewritten query string, and the NAME of the bridged tool to call next.

WHAT IT MAY NOT DO, and why each one is a rule rather than a habit:

  · read a table. There is no database driver in this process, and that ABSENCE is
    the isolation guarantee (course_ai/__init__.py, agent/bridge.py). A native that
    wanted one would reopen «who filters by userId» in a second language.
  · return gated content, whatever it delegates to internally. A native that
    fetched `leccion_texto` and passed the prose through would attribute paid text
    to a tool declaring `returns=()`, and the model could no longer tell which
    authority answered. Content arrives through a bridged call the model makes
    itself — which is also why every handler here NAMES the next tool instead of
    calling it.
  · decide entitlement. `requisitos_leccion` already answers «can this person open
    lesson n», resolved from the session by Node. A native answering it would be a
    second copy of the paywall rule, which is the failure P4 exists for.

HOW «IT MAY NOT» IS ENFORCED, and this is the part that was missing. The second
rule above — a native may reach only the bridged tools it DECLARES it composes —
lived in `Tool.composes` and was read by graph.py, export.py and render.py, i.e.
by the proof, the artefact and the document. Nothing consulted it at the moment a
handler actually called the bridge, so the allowlist was a description rather than
a boundary. Measured: a handler edited to call `leccion_texto` and return the prose
passed `test_no_native_tool_can_be_made_to_touch_another_tool` (which drove every
native with an EMPTY call, so `entender_pregunta` returned `pregunta_corta` before
reaching anything and the assertion compared the empty set against the allowlist),
passed `ai-prove-isolation` and passed `check_catalog()` — while returning 16k of
`muro: de_pago` text from a tool declaring `returns=()`. Node still gated it, so it
was never a paywall bypass; it was a guard that approved what it never inspected.

`dispatch()` below is the fix. Every native is called through it, and the `Ctx` it
builds carries a `Fence` instead of the bridge: a name the tool does not declare
raises `NotComposed` before the request is made. The declaration is now the thing
that decides, which is what it always claimed to be.

HOW ARGUMENTS ARE HANDLED, and why it matches Node exactly. `api/src/tools/index.ts`
keeps only the DECLARED keys of a call and logs the rest server-side; it used to
echo the rejected key back to the model as `_ignorado` and that was deliberately
removed, because telling a model which name was just refused invites it to try the
next one. `accepted()` below is the same rule with the same silence: declared keys
in, everything else to the log, nothing about it in the answer.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, replace
from typing import Any, Protocol

from ..ontology.data import NATIVE, TOOLS
from .concepts import BY_SLUG, CONCEPTS
from .intent import match as intent_of
from .query import Lang, prepare, rank, rewrite

_log = logging.getLogger(__name__)


class BridgeLike(Protocol):
    """What a handler needs from the bridge: one call. Narrow on purpose — a native
    tool must not be able to reach anything else, and a Protocol says so in the type
    rather than in a comment."""

    async def call(self, client: Any, session: str, name: str,
                   args: Mapping[str, Any], timeout_s: float = 20.0) -> Any:
        ...  # pragma: no cover - structural typing only


@dataclass(frozen=True, slots=True)
class Ctx:
    """Everything a native handler is allowed to know about the turn.

    There is no userId in it and there cannot be: `session` is the opaque cookie
    this service forwards and never reads. That is the same thing `Bridge.call`
    receives, so a native tool has exactly the reach of a bridged one — through
    Node, resolved by Node — and not one field more.
    """

    client: Any
    session: str
    bridge: BridgeLike
    lang: Lang = "es"


Handler = Callable[[Ctx, Mapping[str, Any]], Awaitable[dict[str, Any]]]


class NotComposed(RuntimeError):
    """A native handler called a bridged tool it does not declare in `composes`.

    It is raised rather than returned as an `{"error": ...}` on purpose. An error
    dict is a value the model reads and can react to; this is a contract violation
    inside this service, and the caller that has to hear about it is the developer,
    not the model. loop.py turns any handler exception into the trace's failure
    shape, so the turn survives — but the wrong call never leaves the process.
    """


@dataclass(frozen=True, slots=True)
class Fence:
    """The bridge a native handler is given: one call, to a declared name only.

    This is the enforcement half of `Tool.composes` (see the module header). It is
    deliberately not a check inside each handler: a rule each handler has to
    remember to apply is a rule that will be forgotten by the next handler, and
    forgetting it here is silent.

    `allowed` is passed in rather than read from `TOOLS` inside `call`, so a test
    can fence a fixture handler against a fixture allowlist and the seam under test
    is the same one production uses.
    """

    inner: BridgeLike
    tool: str
    allowed: frozenset[str]

    async def call(self, client: Any, session: str, name: str,
                   args: Mapping[str, Any], timeout_s: float = 20.0) -> Any:
        if name not in self.allowed:
            raise NotComposed(
                f"the native tool «{self.tool}» tried to call «{name}», which it does not "
                f"declare in `composes` ({', '.join(sorted(self.allowed)) or 'nothing'}). "
                f"A native returns numbers, terms and the NAME of the next call; the content "
                f"itself arrives through a bridged tool the model calls, which Node executes "
                f"and gates. Declare it in ontology/data.py if it belongs there — "
                f"check_catalog() will then require it to be a tool Node exposes and does "
                f"not gate.")
        return await self.inner.call(client, session, name, args, timeout_s)


async def dispatch(name: str, ctx: Ctx, args: Mapping[str, Any], *,
                   native: Mapping[str, Handler] | None = None) -> dict[str, Any]:
    """Run one native tool with its declared composition allowance in force.

    THE ONLY WAY A NATIVE IS CALLED. loop.py goes through here rather than reaching
    into `NATIVE_HANDLERS`, because a second call site is a second place the fence
    can be forgotten — and the version of this code without the fence proved that a
    missing boundary is invisible to every gate in the repository.

    `native` is injectable for the same reason it is injectable in `loop.run`: a
    test has to be able to drive a HOSTILE handler through this exact seam. The
    allowlist still comes from `TOOLS[name].composes`, never from the caller, so an
    injected handler is fenced by the real declaration and not by a fixture's idea
    of one.

    A name that is not a native raises `KeyError`, which is the same fail-closed
    shape the loop's allowlist already has: an undeclared name never reaches a
    handler.
    """
    handler = (NATIVE_HANDLERS if native is None else native)[name]
    fenced = replace(ctx, bridge=Fence(inner=ctx.bridge, tool=name,
                                       allowed=frozenset(TOOLS[name].composes)))
    return await handler(fenced, args)


def accepted(name: str, args: Mapping[str, Any]) -> dict[str, Any]:
    """The declared keys of `args`, and only those. Rejections go to the log."""
    declared = TOOLS[name].args
    clean = {k: v for k, v in args.items() if k in declared}
    extra = sorted(k for k in args if k not in declared)
    if extra:
        # Server-side only. The model is told nothing about which key was dropped.
        _log.warning("native tool %s: discarded %d undeclared argument(s): %s",
                     name, len(extra), ", ".join(extra))
    return clean


def _lang(ctx: Ctx, asked: object) -> Lang:
    """The session's language unless the call names one. `«en»` and `en` both work:
    the model writes what the argument note shows it."""
    text = str(asked or "").strip().strip("«»\"'").lower()
    if text in ("es", "en"):
        return text  # type: ignore[return-value]
    return "en" if ctx.lang == "en" else "es"


async def _live_lessons(ctx: Ctx) -> tuple[frozenset[int], dict[str, Any] | None]:
    """The lesson numbers Node is serving THIS session, from the bridged
    `curso_indice`.

    This is the second layer of the same guarantee. `ai-check-concepts` compares the
    map against the index at gate time; this compares it against what Node actually
    answered inside the session. A map that agrees with a constant and disagrees
    with the database is caught here, and the model is told `mapa_desalineado`
    instead of being handed a number nobody can serve.

    `curso_indice` is `publico` and not paywalled — measured: identical bytes for a
    free and a paid account — so composing it cannot become an entitlement decision.
    """
    out = await ctx.bridge.call(ctx.client, ctx.session, "curso_indice", {})
    if not isinstance(out, dict) or out.get("error"):
        return frozenset(), out if isinstance(out, dict) else None
    rows = out.get("lecciones")
    if not isinstance(rows, list):
        return frozenset(), out
    live: set[int] = set()
    for row in rows:
        if isinstance(row, Mapping):
            n = row.get("n")
            if isinstance(n, bool) or not isinstance(n, int):
                continue
            live.add(n)
    return frozenset(live), out


def _title_of(payload: Mapping[str, Any] | None, n: int) -> str | None:
    """The lesson title, from the FETCHED index and nowhere else.

    The concept map stores numbers. Titles are `publico`, they live in Node, and
    they are read here out of the response that just arrived — never out of a
    constant in this package, which is the second-copy bug that started all of this.
    """
    if not isinstance(payload, Mapping):
        return None
    for row in payload.get("lecciones") or ():
        if isinstance(row, Mapping) and row.get("n") == n:
            t = row.get("title") or row.get("titulo")
            return str(t) if isinstance(t, str) and t else None
    return None


# --------------------------------------------------------------------- the tools
async def entender_pregunta(ctx: Ctx, args: Mapping[str, Any]) -> dict[str, Any]:
    """The router. The answer to «find whatever the customer asks for».

    THREE ANSWERS, and the first one is new: a product question (naming the public
    tool that holds the fact), a lesson (naming `leccion_texto`), or `sin_ruta`.
    """
    a = accepted("entender_pregunta", args)
    lang = _lang(ctx, a.get("idioma"))
    question = str(a.get("pregunta") or "").strip()
    if len(question) < 2:
        return {"error": "pregunta_corta"}

    # BEFORE RANKING, and the order is the whole point. Measured, all three of the
    # off-topic messages that still clear the floor are product questions that score
    # highly on a lesson: «cuanto cuesta el curso completo» -> lesson 4 at confianza
    # 1.0 (`cuesta` bridges to `inferencia`), «how much does the full course cost» ->
    # the same, «i forgot my password» -> lesson 8 at 1.0 (`forgot` bridges to
    # `contexto`). Consulting the intent table only when the ranking came back empty
    # would leave every one of them exactly as wrong as before, with the added
    # insult of a confident lesson number in the trace.
    product = intent_of(question)
    if product is not None:
        return {
            "intencion": product.intent.slug,
            "siguiente": product.intent.tool,
            "por_que": [f"producto: {m}" for m in product.markers]
                       + ([f"objeto: {product.noun}"] if product.noun else []),
            "nota": "Esta pregunta es del producto, no de una leccion. Llama "
                    f"`{product.intent.tool}`: ahi esta el dato. No lo respondas de "
                    "memoria y no lo expliques como si fuera parte del curso.",
        }

    ranked = rank(question, lang)
    prepared = prepare(question, lang)
    suggested = rewrite(question, lang)

    if not ranked:
        # The important answer, and the one the model must not paper over. Naming
        # the bridged tool to try anyway keeps the turn useful without inventing a
        # lesson: `buscar_en_curso` may still find a word the map does not know.
        return {
            "sin_ruta": True,
            "consulta_sugerida": suggested[0] if suggested else question,
            "siguiente": "buscar_en_curso",
            "nota": "No hay concepto del curso para esta pregunta. Dilo asi en vez de "
                    "responder de memoria; si insiste, busca con `buscar_en_curso`.",
        }

    live, payload = await _live_lessons(ctx)
    if not live:
        return {"error": "indice_ilegible",
                "nota": "No se pudo leer el indice del curso, asi que no hay leccion que "
                        "confirmar. No inventes el numero."}
    for r in ranked:
        if r.concept.leccion not in live:
            # The map points somewhere Node is not serving. A guess here is exactly
            # the failure this tool exists to remove, so it refuses instead.
            return {"error": "mapa_desalineado", "leccion": r.concept.leccion}

    conceptos = [{
        "concepto": r.concept.slug,
        "leccion": r.concept.leccion,
        "titulo": _title_of(payload, r.concept.leccion),
        "confianza": r.confidence,
        "por_que": [f"{x.kind}: {x.detail}" for x in r.reasons],
    } for r in ranked]
    return {
        "conceptos": conceptos,
        "consulta_sugerida": suggested[0] if suggested else question,
        "descartadas": list(prepared.dropped),
        # What to do NOW. `leccion_texto` is the teaching text for the routed
        # lesson; access is Node's to decide, and it will answer `requiere_compra`
        # if the person has not bought it. That refusal is the correct outcome —
        # this tool naming the tool is not the same as this tool granting access.
        "siguiente": "leccion_texto",
        "nota": "Los numeros de leccion salen del indice que acaba de responder Node. "
                "Para el texto llama `leccion_texto`; si la persona pregunta si puede "
                "abrirla, `requisitos_leccion`.",
    }


async def ampliar_consulta(ctx: Ctx, args: Mapping[str, Any]) -> dict[str, Any]:
    """Query preparation. Pure: no bridge call, no I/O, no state."""
    a = accepted("ampliar_consulta", args)
    lang = _lang(ctx, a.get("idioma"))
    original = str(a.get("consulta") or "").strip()
    if len(original) < 2:
        return {"error": "consulta_corta"}
    prepared = prepare(original, lang)
    if not prepared.surface:
        return {"error": "consulta_sin_palabras",
                "descartadas": list(prepared.dropped),
                "nota": "Toda la consulta eran palabras que aparecen en todas las lecciones. "
                        "Pide la pregunta con una palabra concreta."}
    return {
        "consulta": original,
        "terminos": list(prepared.surface),
        # Reported so the trace shows what was removed. A query that lost the wrong
        # word is unexplainable otherwise.
        "descartadas": list(prepared.dropped),
        "variantes": list(rewrite(original, lang)),
        "para": "buscar_en_curso",
    }


async def mapa_de_conceptos(ctx: Ctx, args: Mapping[str, Any]) -> dict[str, Any]:
    """The map itself, so «does the course cover X» is answered from it."""
    a = accepted("mapa_de_conceptos", args)
    asked = str(a.get("concepto") or "").strip()
    if asked:
        chosen = [BY_SLUG[asked]] if asked in BY_SLUG else [
            r.concept for r in rank(asked, _lang(ctx, None))]
        if not chosen:
            return {"conceptos": [], "total": 0,
                    "nota": "Ese concepto no esta en el mapa. Puede seguir estando en el "
                            "curso: busca con `buscar_en_curso` antes de decir que no."}
    else:
        chosen = list(CONCEPTS)

    live, payload = await _live_lessons(ctx)
    if not live:
        return {"error": "indice_ilegible"}
    conceptos = [{
        "concepto": c.slug,
        "leccion": c.leccion,
        "titulo": _title_of(payload, c.leccion),
        "terminos": list(c.terms_es + c.terms_en),
    } for c in chosen]
    covered = {c.leccion for c in CONCEPTS}
    return {
        "conceptos": conceptos,
        "total": len(conceptos),
        # Coverage is REPORTED, not asserted: a hole is visible to the model at
        # runtime as well as red at gate time.
        "cobertura": {"lecciones_cubiertas": len(covered & live),
                      "lecciones_totales": len(live),
                      "sin_concepto": sorted(live - covered)},
        "siguiente": "curso_indice",
    }


NATIVE_HANDLERS: Mapping[str, Handler] = {
    "entender_pregunta": entender_pregunta,
    "ampliar_consulta": ampliar_consulta,
    "mapa_de_conceptos": mapa_de_conceptos,
}

# BOTH DIRECTIONS, at import time, and a raise rather than an assert.
#
# A declared native with no handler reaches the model as a promise nothing keeps —
# it is offered in the prompt and then dispatched into a KeyError. A handler with no
# declaration is unreachable (the loop's allowlist is built from the catalogue) and
# unproved (P5 iterates the declarations). Neither is a state worth booting in, and
# `assert` is not the tool for it: python -O removes asserts, and this must hold in
# production too.
_declared, _implemented = set(NATIVE), set(NATIVE_HANDLERS)
if _declared != _implemented:
    raise RuntimeError(
        "the native tools and their handlers do not match.\n"
        f"  declared with runner=python and NOT implemented here: "
        f"{sorted(_declared - _implemented) or 'none'}\n"
        f"  implemented here and NOT declared in data.py: "
        f"{sorted(_implemented - _declared) or 'none'}")
