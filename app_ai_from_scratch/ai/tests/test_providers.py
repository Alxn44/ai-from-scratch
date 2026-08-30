"""The provider router: the default chain, and the body that does not propagate.

Two things are checked here. One, that the chain the product asked for is the one
that comes out with nothing configured: Haiku (flash) first, then cheap
fallbacks, then Sonnet and Grok for reasoning — never Opus. And two, that a 4xx
from a provider does not turn its body into something returnable: several of
them echo the truncated key in the text of a 401.
"""

from __future__ import annotations

import httpx
import pytest

from course_ai.agent.providers import (
    ProviderError,
    _upstream_error,
    effort_budget,
    pick_chain,
    providers,
    turn,
)

# Every key the router looks at. They are cleared in each test so the machine's real
# environment cannot change the result.
KEYS = (
    "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "KIMI_API_KEY",
    "MOONSHOT_API_KEY", "HF_TOKEN", "HUGGINGFACE_API_KEY", "TOGETHER_API_KEY",
    "API_KEY_TOGETHER", "OPENCODE_API_KEY", "XAI_API_KEY", "OMNIROUTE_API_KEY",
)
MODEL_VARS = ("ANTHROPIC_MODEL", "ANTHROPIC_SONNET_MODEL", "OPENROUTER_MODEL",
              "DEEPSEEK_MODEL", "KIMI_MODEL", "HF_MODEL", "TOGETHER_MODEL",
              "OPENCODE_MODEL", "XAI_MODEL")


@pytest.fixture
def clean_env(monkeypatch):
    for k in (*KEYS, *MODEL_VARS, "PROVEEDOR_ORDEN", "OPENCODE_BASE_URL",
              "PROVEEDOR_ORDEN_ES", "PROVEEDOR_ORDEN_EN", "XAI_BASE_URL", "OMNIROUTE_BASE_URL"):
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def test_the_default_chain_is_flash_then_reasoning(clean_env):
    for k in ("DEEPSEEK_API_KEY", "KIMI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"):
        clean_env.setenv(k, "x")
    ids = [p.id for p in providers()]
    assert ids == ["anthropic", "deepseek", "kimi", "grok", "sonnet"]
    lanes = {p.id: p.lane for p in providers()}
    assert lanes["anthropic"] == "flash"
    assert lanes["deepseek"] == "flash"
    assert lanes["kimi"] == "flash"
    assert lanes["grok"] == "razon"
    assert lanes["sonnet"] == "razon"


def test_the_spares_go_behind_the_chain(clean_env):
    for k in ("OPENROUTER_API_KEY", "HF_TOKEN", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"):
        clean_env.setenv(k, "x")
    ids = [p.id for p in providers()]
    assert ids.index("anthropic") < ids.index("deepseek") < ids.index("openrouter")


def test_the_default_models_of_the_chain(clean_env):
    for k in ("DEEPSEEK_API_KEY", "KIMI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"):
        clean_env.setenv(k, "x")
    models = {p.id: p.model for p in providers()}
    assert models == {
        "anthropic": "claude-haiku-4-5",
        "deepseek": "deepseek-chat",
        "kimi": "kimi-k3",
        "grok": "grok-4.6",
        "sonnet": "claude-sonnet-5",
    }


def test_opus_is_never_selected(clean_env):
    clean_env.setenv("ANTHROPIC_API_KEY", "x")
    clean_env.setenv("ANTHROPIC_MODEL", "claude-opus-5")
    clean_env.setenv("ANTHROPIC_SONNET_MODEL", "claude-opus-4.8")
    models = {p.id: p.model for p in providers()}
    assert models["anthropic"] == "claude-haiku-4-5"
    assert models["sonnet"] == "claude-sonnet-5"
    assert all("opus" not in p.model.lower() for p in providers())


def test_the_explicit_order_still_wins(clean_env):
    """Reordering the list cannot have broken PROVEEDOR_ORDEN."""
    for k in ("DEEPSEEK_API_KEY", "KIMI_API_KEY", "ANTHROPIC_API_KEY"):
        clean_env.setenv(k, "x")
    clean_env.setenv("PROVEEDOR_ORDEN", "anthropic,kimi,deepseek")
    assert [p.id for p in providers()] == ["anthropic", "kimi", "deepseek", "sonnet"]


def test_every_model_can_be_overridden_from_the_environment(clean_env):
    for k in ("DEEPSEEK_API_KEY", "KIMI_API_KEY", "ANTHROPIC_API_KEY"):
        clean_env.setenv(k, "x")
    clean_env.setenv("DEEPSEEK_MODEL", "otro-deepseek")
    clean_env.setenv("KIMI_MODEL", "otro-kimi")
    clean_env.setenv("ANTHROPIC_MODEL", "otro-anthropic")
    models = {p.id: p.model for p in providers()}
    assert models["deepseek"] == "otro-deepseek"
    assert models["kimi"] == "otro-kimi"
    assert models["anthropic"] == "otro-anthropic"


def test_with_no_keys_there_are_no_providers(clean_env):
    assert providers() == ()


BODY_401 = '{"error":{"message":"invalid api key sk-ant-api03-FUGA"}}'


def test_pick_chain_puts_the_wanted_provider_first(clean_env):
    for k in ("DEEPSEEK_API_KEY", "KIMI_API_KEY", "ANTHROPIC_API_KEY", "TOGETHER_API_KEY"):
        clean_env.setenv(k, "x")
    chain = pick_chain("together")
    assert chain[0].id == "together"
    assert chain[0].model == "moonshotai/Kimi-K2.7-Code"
    rest = [p.id for p in chain[1:]]
    assert rest == [p.id for p in providers() if p.id != "together"]


def test_anthropic_alias_selects_sonnet_not_haiku(clean_env):
    clean_env.setenv("ANTHROPIC_API_KEY", "x")
    chain = pick_chain("anthropic")
    assert chain[0].id == "sonnet"
    assert chain[0].model == "claude-sonnet-5"
    assert pick_chain("sonnet")[0].id == "sonnet"


def test_unknown_or_unlisted_pick_keeps_the_full_chain(clean_env):
    clean_env.setenv("DEEPSEEK_API_KEY", "x")
    clean_env.setenv("XAI_API_KEY", "x")
    full = providers()
    assert pick_chain("opus") == full
    assert pick_chain("grok") == full
    assert pick_chain(None) == full


def test_language_order_prefers_the_measured_language_provider(clean_env):
    for k in ("DEEPSEEK_API_KEY", "KIMI_API_KEY", "ANTHROPIC_API_KEY"):
        clean_env.setenv(k, "x")
    clean_env.setenv("PROVEEDOR_ORDEN_EN", "sonnet,kimi,deepseek")
    clean_env.setenv("PROVEEDOR_ORDEN_ES", "kimi,sonnet,deepseek")
    assert [p.id for p in pick_chain(None, lang="en")] == ["sonnet", "kimi", "deepseek", "anthropic"]
    assert [p.id for p in pick_chain(None, lang="es")] == ["kimi", "sonnet", "deepseek", "anthropic"]


def test_explicit_provider_overrides_language_order(clean_env):
    for k in ("DEEPSEEK_API_KEY", "KIMI_API_KEY", "ANTHROPIC_API_KEY"):
        clean_env.setenv(k, "x")
    clean_env.setenv("PROVEEDOR_ORDEN_EN", "sonnet,kimi,deepseek")
    assert pick_chain("deepseek", lang="en")[0].id == "deepseek"


def test_effort_budget_maps_the_three_levels():
    assert effort_budget("bajo") == (768, 30.0, "low")
    assert effort_budget("medio") == (1536, 45.0, "medium")
    assert effort_budget("alto") == (4096, 90.0, "high")
    assert effort_budget(None) == (1536, 45.0, "medium")
    assert effort_budget("nope") == (1536, 45.0, "medium")


def test_the_upstream_error_does_not_carry_the_body(clean_env):
    clean_env.setenv("DEEPSEEK_API_KEY", "x")
    prov = providers()[0]
    r = httpx.Response(401, text=BODY_401, request=httpx.Request("POST", prov.base))
    e = _upstream_error(prov, r)
    assert isinstance(e, ProviderError)
    assert str(e) == "deepseek 401"
    assert (e.provider, e.status) == ("deepseek", 401)
    for leak in ("sk-ant", "FUGA", "invalid api key"):
        assert leak not in str(e), leak
        assert leak not in repr(e), leak


@pytest.mark.parametrize("fmt,pid", [("openai", "deepseek"), ("anthropic", "anthropic")])
async def test_a_real_4xx_raises_without_the_body(clean_env, fmt, pid):
    """Both paths of `turn` (openai and anthropic) had the same bug."""
    clean_env.setenv("DEEPSEEK_API_KEY" if pid == "deepseek" else "ANTHROPIC_API_KEY", "x")
    prov = next(p for p in providers() if p.id == pid)
    assert prov.fmt == fmt

    def answer(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text=BODY_401)

    async with httpx.AsyncClient(transport=httpx.MockTransport(answer)) as cl:
        with pytest.raises(ProviderError) as box:
            await turn(cl, prov, system="s", messages=[{"role": "user", "content": "x"}],
                       catalog=[])
    assert str(box.value) == f"{pid} 401"
    assert "FUGA" not in str(box.value)


async def test_the_full_body_does_stay_in_the_log(clean_env, caplog):
    """What is taken out of the response has to still be there for the operator."""
    clean_env.setenv("DEEPSEEK_API_KEY", "x")
    prov = providers()[0]
    r = httpx.Response(401, text=BODY_401, request=httpx.Request("POST", prov.base))
    with caplog.at_level("ERROR"):
        _upstream_error(prov, r)
    assert BODY_401 in caplog.text
