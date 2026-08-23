"""Router de proveedores. Portado de api/src/proveedores.js sin cambiar la logica.

La lista se arma con las llaves que existan en el entorno: si falta una, ese
proveedor no esta. Se intenta en orden y el primero que responda gana.

Dos formatos de cable, no seis clientes:
    anthropic  -> /v1/messages con tools nativos
    openai     -> /chat/completions (OpenRouter, DeepSeek, Kimi, HF, opencode)
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import httpx

Formato = Literal["anthropic", "openai"]


def _env(k: str) -> str | None:
    v = os.environ.get(k)
    return v.strip() if v and v.strip() else None


@dataclass(frozen=True, slots=True)
class Proveedor:
    id: str
    formato: Formato
    base: str
    key: str
    modelo: str


@dataclass(frozen=True, slots=True)
class Turno:
    texto: str
    llamadas: tuple[Mapping[str, Any], ...]
    crudo: Any
    uso: Mapping[str, Any] | None


def proveedores() -> tuple[Proveedor, ...]:
    """Catalogo declarativo. Orden = prioridad."""
    crudo = [
        ("anthropic", "anthropic", "https://api.anthropic.com/v1/messages",
         _env("ANTHROPIC_API_KEY"), _env("ANTHROPIC_MODEL") or "claude-sonnet-5"),
        ("openrouter", "openai", "https://openrouter.ai/api/v1/chat/completions",
         _env("OPENROUTER_API_KEY"), _env("OPENROUTER_MODEL") or "anthropic/claude-sonnet-4.5"),
        ("deepseek", "openai", "https://api.deepseek.com/chat/completions",
         _env("DEEPSEEK_API_KEY"), _env("DEEPSEEK_MODEL") or "deepseek-chat"),
        ("kimi", "openai", "https://api.moonshot.ai/v1/chat/completions",
         _env("KIMI_API_KEY") or _env("MOONSHOT_API_KEY"),
         # kimi-k3 comprobado con tool calling. El anterior por defecto
         # (kimi-k2-0905-preview) ya no aparece en /v1/models de Moonshot.
         _env("KIMI_MODEL") or "kimi-k3"),
        ("huggingface", "openai", "https://router.huggingface.co/v1/chat/completions",
         _env("HF_TOKEN") or _env("HUGGINGFACE_API_KEY"),
         _env("HF_MODEL") or "Qwen/Qwen3-235B-A22B-Instruct"),
        # Together: modelo por defecto comprobado con tool calling real. Qwen3.7-Plus
        # NO sirve aqui: Together responde «requires prompt storage» y el turno
        # muere — es un modelo que enruta a un tercero y exige consentimiento.
        ("together", "openai", "https://api.together.xyz/v1/chat/completions",
         _env("TOGETHER_API_KEY") or _env("API_KEY_TOGETHER"),
         _env("TOGETHER_MODEL") or "moonshotai/Kimi-K2.7-Code"),
        ("opencode", "openai",
         _env("OPENCODE_BASE_URL") or "http://127.0.0.1:4096/v1/chat/completions",
         _env("OPENCODE_API_KEY"), _env("OPENCODE_MODEL") or "claude-sonnet-5"),
    ]
    activos = [Proveedor(i, f, b, k, m) for i, f, b, k, m in crudo if k]  # type: ignore[arg-type]
    orden = [s.strip() for s in (_env("PROVEEDOR_ORDEN") or "").split(",") if s.strip()]
    if not orden:
        return tuple(activos)
    return tuple(sorted(activos, key=lambda p: orden.index(p.id) if p.id in orden else 99))


def hay_proveedor() -> bool:
    return len(proveedores()) > 0


_NUMERO = re.compile(r"entero|n[uú]mero", re.IGNORECASE)


def _esquema(args: Mapping[str, str]) -> dict[str, Any]:
    """El texto del argumento («entero 1..12») ES la descripcion, y de ahi sale el
    tipo. Todos los declarados son obligatorios: no hay argumento opcional."""
    props: dict[str, Any] = {}
    for k, nota in (args or {}).items():
        props[k] = {"type": "integer" if _NUMERO.search(str(nota)) else "string",
                    "description": str(nota)}
    return {"type": "object", "properties": props, "required": list(props)}


def como_tools(catalogo: Sequence[Mapping[str, Any]], formato: Formato) -> list[dict[str, Any]]:
    if formato == "anthropic":
        return [{"name": h["nombre"], "description": h["descripcion"],
                 "input_schema": _esquema(h.get("argumentos", {}))} for h in catalogo]
    return [{"type": "function",
             "function": {"name": h["nombre"], "description": h["descripcion"],
                          "parameters": _esquema(h.get("argumentos", {}))}} for h in catalogo]


async def turno(cliente: httpx.AsyncClient, prov: Proveedor, *, sistema: str,
                mensajes: Sequence[Mapping[str, Any]], catalogo: Sequence[Mapping[str, Any]],
                max_tokens: int = 1024, timeout_s: float = 45.0) -> Turno:
    """Una vuelta de modelo, en forma comun para que el bucle no sepa de proveedores."""
    if prov.formato == "anthropic":
        r = await cliente.post(
            prov.base, timeout=timeout_s,
            headers={"content-type": "application/json", "x-api-key": prov.key,
                     "anthropic-version": "2023-06-01"},
            json={"model": prov.modelo, "max_tokens": max_tokens,
                  # El prompt de sistema y los esquemas de herramientas no cambian
                  # entre vueltas del MISMO turno ni entre turnos. Sin cache se
                  # re-facturan enteros cada vez: medido, 2816 input_tokens en la
                  # vuelta 1 y 3371 en la 2, con cache_read en 0. El marcador va en
                  # el bloque de sistema porque el orden de cacheo es
                  # tools -> system -> messages: marcar system cubre tambien las
                  # herramientas, que son la mitad de esos bytes.
                  #
                  # Si el prompt queda por debajo del minimo cacheable del modelo,
                  # el campo se ignora sin error — no hay riesgo en pedirlo.
                  "system": [{"type": "text", "text": sistema,
                              "cache_control": {"type": "ephemeral"}}],
                  "tools": como_tools(catalogo, "anthropic"), "messages": list(mensajes)})
        if r.status_code >= 400:
            raise RuntimeError(f"{prov.id} {r.status_code}: {r.text[:300]}")
        d = r.json()
        piezas = d.get("content") or []
        texto = "".join(c.get("text", "") for c in piezas if c.get("type") == "text").strip()
        llamadas = tuple({"id": c.get("id"), "nombre": c.get("name"), "args": c.get("input") or {}}
                         for c in piezas if c.get("type") == "tool_use")
        return Turno(texto, llamadas, piezas, d.get("usage"))

    cab = {"content-type": "application/json", "authorization": f"Bearer {prov.key}"}
    if prov.id == "openrouter":
        # OpenRouter usa estas dos para atribuir el trafico. Sin ellas la cuenta
        # figura como anonima y algunos modelos de la lista quedan fuera.
        cab["HTTP-Referer"] = _env("PUBLIC_SITE") or "http://localhost:4321"
        cab["X-Title"] = "IA desde cero"
    r = await cliente.post(
        prov.base, timeout=timeout_s, headers=cab,
        json={"model": prov.modelo, "max_tokens": max_tokens,
              "messages": [{"role": "system", "content": sistema}, *mensajes],
              "tools": como_tools(catalogo, "openai"), "tool_choice": "auto"})
    if r.status_code >= 400:
        raise RuntimeError(f"{prov.id} {r.status_code}: {r.text[:300]}")
    d = r.json()
    m = ((d.get("choices") or [{}])[0]).get("message") or {}
    llamadas = []
    for c in m.get("tool_calls") or []:
        fn = c.get("function") or {}
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        llamadas.append({"id": c.get("id"), "nombre": fn.get("name"), "args": args})
    return Turno((m.get("content") or "").strip(), tuple(llamadas), m, d.get("usage"))
