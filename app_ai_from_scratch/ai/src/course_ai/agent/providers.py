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

_log = logging.getLogger(__name__)


def _env(k: str) -> str | None:
    v = os.environ.get(k)
    return v.strip() if v and v.strip() else None


@dataclass(frozen=True, slots=True)
class Provider:
    id: str
    fmt: Format
    base: str
    key: str
    model: str


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

    Default chain, in this order (overridable with PROVEEDOR_ORDEN):
        deepseek  -> primary chat model
        kimi      -> fallback, the one asked for reasoning
        anthropic -> escalation, "call a specialist" (Sonnet)
    The rest stay behind them: they are spare wheels, not part of the chain.
    Every model id below is still the file's own default and is still overridable
    by the same env var it always used — the chain changed the ORDER, not the ids.
    """
    rows = [
        ("deepseek", "openai", "https://api.deepseek.com/chat/completions",
         _env("DEEPSEEK_API_KEY"), _env("DEEPSEEK_MODEL") or "deepseek-chat"),
        ("kimi", "openai", "https://api.moonshot.ai/v1/chat/completions",
         _env("KIMI_API_KEY") or _env("MOONSHOT_API_KEY"),
         # kimi-k3 verified with tool calling. The previous default
         # (kimi-k2-0905-preview) no longer shows up in Moonshot's /v1/models.
         _env("KIMI_MODEL") or "kimi-k3"),
        ("anthropic", "anthropic", "https://api.anthropic.com/v1/messages",
         _env("ANTHROPIC_API_KEY"), _env("ANTHROPIC_MODEL") or "claude-sonnet-5"),
        ("openrouter", "openai", "https://openrouter.ai/api/v1/chat/completions",
         _env("OPENROUTER_API_KEY"), _env("OPENROUTER_MODEL") or "anthropic/claude-sonnet-4.5"),
        ("huggingface", "openai", "https://router.huggingface.co/v1/chat/completions",
         _env("HF_TOKEN") or _env("HUGGINGFACE_API_KEY"),
         _env("HF_MODEL") or "Qwen/Qwen3-235B-A22B-Instruct"),
        # Together: default model verified with real tool calling. Qwen3.7-Plus does
        # NOT work here: Together answers «requires prompt storage» and the turn dies
        # — it is a model that routes to a third party and demands consent.
        ("together", "openai", "https://api.together.xyz/v1/chat/completions",
         _env("TOGETHER_API_KEY") or _env("API_KEY_TOGETHER"),
         _env("TOGETHER_MODEL") or "moonshotai/Kimi-K2.7-Code"),
        ("opencode", "openai",
         _env("OPENCODE_BASE_URL") or "http://127.0.0.1:4096/v1/chat/completions",
         _env("OPENCODE_API_KEY"), _env("OPENCODE_MODEL") or "claude-sonnet-5"),
    ]
    active = [Provider(i, f, b, k, m) for i, f, b, k, m in rows if k]  # type: ignore[arg-type]
    order = [s.strip() for s in (_env("PROVEEDOR_ORDEN") or "").split(",") if s.strip()]
    if not order:
        return tuple(active)
    return tuple(sorted(active, key=lambda p: order.index(p.id) if p.id in order else 99))


def has_provider() -> bool:
    return len(providers()) > 0


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
               max_tokens: int = 1024, timeout_s: float = 45.0) -> Turn:
    """One model turn, in a common shape so the loop knows nothing about providers."""
    if prov.fmt == "anthropic":
        r = await client.post(
            prov.base, timeout=timeout_s,
            headers={"content-type": "application/json", "x-api-key": prov.key,
                     "anthropic-version": "2023-06-01"},
            json={"model": prov.model, "max_tokens": max_tokens,
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
                  "tools": as_tools(catalog, "anthropic"), "messages": list(messages)})
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
