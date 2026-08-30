"""The provider router. Ported from api/src/proveedores.js without changing the logic.

The list is built from whichever keys exist in the environment: if one is missing,
that provider is not there. They are tried in order and the first that answers wins.

Two wire formats, not six clients:
    anthropic  -> /v1/messages with native tools
    openai     -> /chat/completions (OpenRouter, DeepSeek, Kimi, HF, opencode)
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import httpx

Format = Literal["anthropic", "openai"]
Lane = Literal["flash", "razon"]
Effort = Literal["bajo", "medio", "alto"]

# `anthropic` is accepted as an ALIAS for the sonnet lane: the button shows
# claude-sonnet-5, not Haiku. It is an alias, not a catalog.
#
# THERE IS NO HAND-WRITTEN LIST OF SELECTABLE IDS ANY MORE. There was one:
#
#     SELECTABLE = frozenset({"sonnet", "deepseek", "kimi", "together", "anthropic"})
#
# and it went stale exactly the way house rule 4 says a copy does. providers()
# below declares eleven ids today; that set knew five. `grok` is the FIRST
# provider of the "razon" lane, so a UI that offers "reasoning" resolves it to
# grok, sends grok, and pick_chain silently ignored it — answering from a flash
# model while the screen said the other thing. Nothing failed; it just lied.
#
# The catalog is providers(). An id is selectable when it is IN the chain, which
# is a check against the live catalog and cannot drift from it. It also still
# fails closed: an id that is not there is ignored and the full chain stands.
ALIAS = {"anthropic": "sonnet"}
_EFFORT = {
    "bajo": (768, 30.0, "low"),
    "medio": (1536, 45.0, "medium"),
    "alto": (4096, 90.0, "high"),
}

# Haiku is the fast default (the "flash" slot). Sonnet and Grok reason.
# Opus is never a default and is rewritten away if someone pastes it.
FLASH = "claude-haiku-4-5"
SONNET = "claude-sonnet-5"

_log = logging.getLogger(__name__)


def _env(k: str) -> str | None:
    v = os.environ.get(k)
    return v.strip() if v and v.strip() else None


def _model(raw: str | None, fallback: str) -> str:
    """Opus is refused: it is not in this product. Anything else, including an
    explicit env override, is kept."""
    m = (raw or fallback).strip() or fallback
    return fallback if "opus" in m.lower() else m


@dataclass(frozen=True, slots=True)
class Provider:
    id: str
    fmt: Format
    base: str
    key: str
    model: str
    lane: Lane = "flash"


@dataclass(frozen=True, slots=True)
class Turn:
    text: str
    calls: tuple[Mapping[str, Any], ...]
    raw: Any
    usage: Mapping[str, Any] | None


class ProviderError(RuntimeError):
    """An upstream 4xx/5xx, carrying the provider id and the status code ONLY.

    The response body of a failing provider is not safe to move around: several
    of them echo a truncated API key in the text of a 401, and every trace this
    service builds is relayed by Node all the way to the browser. So the body is
    written to the server log and dropped here — `str(e)` is `"deepseek 401"`,
    which is all a client ever needs to retry or report.
    """

    def __init__(self, provider: str, status: int) -> None:
        super().__init__(f"{provider} {status}")
        self.provider = provider
        self.status = status


def _upstream_error(prov: Provider, r: httpx.Response) -> ProviderError:
    """Log the full upstream body, return an exception that does not carry it."""
    _log.error("provider %s returned HTTP %s: %s", prov.id, r.status_code, r.text)
    return ProviderError(prov.id, r.status_code)


def providers() -> tuple[Provider, ...]:
    """A declarative catalog. Order = priority.

    Two lanes, flash first:
        anthropic  -> Haiku, the default (fast / cheap, the "flash" slot)
        deepseek   -> flash fallback
        kimi       -> flash fallback
        grok       -> reasoning
        sonnet     -> reasoning (same Anthropic key, Claude Sonnet 5)
    Opus is not a lane. The rest stay behind as spare wheels.
    PROVEEDOR_ORDEN still wins when set.
    """
    ant = _env("ANTHROPIC_API_KEY")
    rows: list[tuple[str, Format, str, str | None, str, Lane]] = [
        ("anthropic", "anthropic", "https://api.anthropic.com/v1/messages",
         ant, _model(_env("ANTHROPIC_MODEL"), FLASH), "flash"),
        ("deepseek", "openai", "https://api.deepseek.com/chat/completions",
         _env("DEEPSEEK_API_KEY"), _model(_env("DEEPSEEK_MODEL"), "deepseek-chat"), "flash"),
        ("kimi", "openai", "https://api.moonshot.ai/v1/chat/completions",
         _env("KIMI_API_KEY") or _env("MOONSHOT_API_KEY"),
         # kimi-k3 verified with tool calling. The previous default
         # (kimi-k2-0905-preview) no longer shows up in Moonshot's /v1/models.
         _model(_env("KIMI_MODEL"), "kimi-k3"), "flash"),
        ("grok", "openai", _env("XAI_BASE_URL") or "https://api.x.ai/v1/chat/completions",
         _env("XAI_API_KEY"), _model(_env("XAI_MODEL"), "grok-4.6"), "razon"),
        ("sonnet", "anthropic", "https://api.anthropic.com/v1/messages",
         ant, _model(_env("ANTHROPIC_SONNET_MODEL"), SONNET), "razon"),
        ("omniroute", "openai", _env("OMNIROUTE_BASE_URL") or "http://127.0.0.1:20128/v1/chat/completions",
         _env("OMNIROUTE_API_KEY"), _model(_env("OMNIROUTE_MODEL"), "openrouter/auto"), "flash"),
        ("openrouter", "openai", _env("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1/chat/completions",
         _env("OPENROUTER_API_KEY"), _model(_env("OPENROUTER_MODEL"), "openrouter/auto"), "flash"),
        ("huggingface", "openai", "https://router.huggingface.co/v1/chat/completions",
         _env("HF_TOKEN") or _env("HUGGINGFACE_API_KEY"),
         _model(_env("HF_MODEL"), "Qwen/Qwen3-235B-A22B-Instruct"), "flash"),
        # Together: default model verified with real tool calling. Qwen3.7-Plus does
        # NOT work here: Together answers «requires prompt storage» and the turn dies
        # — it is a model that routes to a third party and demands consent.
        ("together", "openai", "https://api.together.xyz/v1/chat/completions",
         _env("TOGETHER_API_KEY") or _env("API_KEY_TOGETHER"),
         _model(_env("TOGETHER_MODEL"), "moonshotai/Kimi-K2.7-Code"), "flash"),
        ("opencode", "openai",
         _env("OPENCODE_BASE_URL") or "http://127.0.0.1:4096/v1/chat/completions",
         _env("OPENCODE_API_KEY"), _model(_env("OPENCODE_MODEL"), FLASH), "flash"),
    ]
    active = [Provider(i, f, b, k, m, lane) for i, f, b, k, m, lane in rows if k]
    order = [s.strip() for s in (_env("PROVEEDOR_ORDEN") or "").split(",") if s.strip()]
    if not order:
        return tuple(active)
    return tuple(sorted(active, key=lambda p: order.index(p.id) if p.id in order else 99))


def has_provider() -> bool:
    return len(providers()) > 0


def _language_order(lang: str | None) -> tuple[str, ...]:
    """Configured quality order for a language, never a request-controlled model.

    Operators measure provider quality for their own configured models and set
    `PROVEEDOR_ORDEN_ES` and/or `PROVEEDOR_ORDEN_EN`. The global
    `PROVEEDOR_ORDEN` remains the fallback order for languages without a
    measured ranking. Empty means the product's established cost/latency order
    is retained.
    """
    key = "PROVEEDOR_ORDEN_EN" if lang == "en" else "PROVEEDOR_ORDEN_ES" if lang == "es" else ""
    return tuple(s.strip() for s in (_env(key) or "").split(",") if s.strip()) if key else ()


def pick_chain(wanted: str | None, active: Sequence[Provider] | None = None,
               lang: str | None = None) -> tuple[Provider, ...]:
    """Put a student-selected provider first; otherwise prefer the configured
    best provider order for the session language. Unknown names are ignored and
    the complete fallback chain stays. `anthropic` means the Sonnet lane."""
    chain = tuple(active) if active is not None else providers()
    if wanted:
        name = ALIAS.get(wanted.strip().lower(), wanted.strip().lower())
        chosen = next((p for p in chain if p.id == name), None)
        if chosen is not None:
            return (chosen, *tuple(p for p in chain if p.id != chosen.id))
    ranked = _language_order(lang)
    if not ranked:
        return chain
    order = {provider: i for i, provider in enumerate(ranked)}
    return tuple(sorted(chain, key=lambda p: order.get(p.id, len(order))))


def effort_budget(effort: str | None) -> tuple[int, float, str]:
    """max_tokens, timeout_s, native effort name. Unknown → medium."""
    return _EFFORT.get(effort or "", _EFFORT["medio"])


_NUMBER = re.compile(r"entero|n[uú]mero", re.IGNORECASE)


def _schema(args: Mapping[str, str]) -> dict[str, Any]:
    """The argument's text («entero 1..12») IS the description, and the type comes
    out of it. Everything declared is required: there is no optional argument."""
    props: dict[str, Any] = {}
    for k, note in (args or {}).items():
        props[k] = {"type": "integer" if _NUMBER.search(str(note)) else "string",
                    "description": str(note)}
    return {"type": "object", "properties": props, "required": list(props)}


def as_tools(catalog: Sequence[Mapping[str, Any]], fmt: Format) -> list[dict[str, Any]]:
    if fmt == "anthropic":
        return [{"name": h["nombre"], "description": h["descripcion"],
                 "input_schema": _schema(h.get("argumentos", {}))} for h in catalog]
    return [{"type": "function",
             "function": {"name": h["nombre"], "description": h["descripcion"],
                          "parameters": _schema(h.get("argumentos", {}))}} for h in catalog]


async def turn(client: httpx.AsyncClient, prov: Provider, *, system: str,
               messages: Sequence[Mapping[str, Any]], catalog: Sequence[Mapping[str, Any]],
               max_tokens: int = 1024, timeout_s: float = 45.0,
               effort: str | None = None) -> Turn:
    """One model turn, in a common shape so the loop knows nothing about providers."""
    # El tercer valor es el nombre nativo del esfuerzo. Aqui NO se usa: ver
    # abajo, la API de Anthropic rechaza el campo. effort_budget lo sigue
    # devolviendo porque es su contrato y hay pruebas sobre el.
    tokens, timeout, _ = effort_budget(effort)
    if effort:
        max_tokens, timeout_s = tokens, timeout
    if prov.fmt == "anthropic":
        body: dict[str, Any] = {
            "model": prov.model, "max_tokens": max_tokens,
            # The system prompt and the tool schemas do not change between
            # turns of the SAME exchange, nor between exchanges. Without the
            # cache they are re-billed in full every time: measured, 2816
            # input_tokens on turn 1 and 3371 on turn 2, with cache_read at 0.
            # The marker goes on the system block because the cache order is
            # tools -> system -> messages: marking system covers the tools too,
            # and those are half of those bytes.
            #
            # If the prompt falls below the model's minimum cacheable size the
            # field is ignored without an error — there is no risk in asking.
            "system": [{"type": "text", "text": system,
                        "cache_control": {"type": "ephemeral"}}],
            "tools": as_tools(catalog, "anthropic"), "messages": list(messages),
        }
        # NO `effort` FIELD. It used to send one:
        #
        #     if prov.lane == "razon" or "sonnet" in prov.model:
        #         body["effort"] = effort_name
        #
        # The Messages API has no such top-level parameter, and it does not
        # ignore it — it rejects the whole request. Measured against the real
        # endpoint, verbatim:
        #
        #     HTTP 400 {"type":"error","error":{"type":"invalid_request_error",
        #      "message":"effort: Extra inputs are not permitted"}}
        #
        # So EVERY call on the "razon" lane died, the loop fell through to the
        # next provider, and the answer came back from Haiku on the flash lane.
        # Nothing failed out loud: the screen said one thing and the fallback
        # quietly did another. Same shape as the stale SELECTABLE set above.
        #
        # The effort knob keeps the effect it can actually have here — it is
        # already applied above as max_tokens and timeout_s via effort_budget(),
        # which is a real difference in how long and how far a turn may go.
        # Wiring it to extended thinking (`thinking.budget_tokens`) is a
        # separate change with its own constraints (budget < max_tokens, a 1024
        # floor, and its interaction with tool use); it does not get bolted on
        # blind on the way out the door.
        r = await client.post(
            prov.base, timeout=timeout_s,
            headers={"content-type": "application/json", "x-api-key": prov.key,
                     "anthropic-version": "2023-06-01"},
            json=body)
        if r.status_code >= 400:
            raise _upstream_error(prov, r)
        d = r.json()
        pieces = d.get("content") or []
        text = "".join(c.get("text", "") for c in pieces if c.get("type") == "text").strip()
        calls = tuple({"id": c.get("id"), "nombre": c.get("name"), "args": c.get("input") or {}}
                      for c in pieces if c.get("type") == "tool_use")
        return Turn(text, calls, pieces, d.get("usage"))

    headers = {"content-type": "application/json", "authorization": f"Bearer {prov.key}"}
    if prov.id == "openrouter":
        # OpenRouter uses these two to attribute the traffic. Without them the account
        # shows up as anonymous and some models on the list become unavailable.
        headers["HTTP-Referer"] = _env("PUBLIC_SITE") or "http://localhost:4321"
        headers["X-Title"] = "IA desde cero"
    r = await client.post(
        prov.base, timeout=timeout_s, headers=headers,
        json={"model": prov.model, "max_tokens": max_tokens,
              "messages": [{"role": "system", "content": system}, *messages],
              "tools": as_tools(catalog, "openai"), "tool_choice": "auto"})
    if r.status_code >= 400:
        raise _upstream_error(prov, r)
    d = r.json()
    m = ((d.get("choices") or [{}])[0]).get("message") or {}
    calls = []
    for c in m.get("tool_calls") or []:
        fn = c.get("function") or {}
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        calls.append({"id": c.get("id"), "nombre": fn.get("name"), "args": args})
    return Turn((m.get("content") or "").strip(), tuple(calls), m, d.get("usage"))
