"""The provider router: the default chain, and the body that does not propagate.

Two things are checked here. One, that the chain the product asked for is the one
that comes out with nothing configured: deepseek -> kimi -> anthropic. And two,
that a 4xx from a provider does not turn its body into something returnable:
several of them echo the truncated key in the text of a 401.
"""

from __future__ import annotations

import httpx
import pytest

from course_ai.agent.providers import (
    ProviderError,
    _upstream_error,
    providers,
    turn,
)

# Every key the router looks at. They are cleared in each test so the machine's real
# environment cannot change the result.
KEYS = (
    "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "KIMI_API_KEY",
    "MOONSHOT_API_KEY", "HF_TOKEN", "HUGGINGFACE_API_KEY", "TOGETHER_API_KEY",
    "API_KEY_TOGETHER", "OPENCODE_API_KEY",
)
MODEL_VARS = ("ANTHROPIC_MODEL", "OPENROUTER_MODEL", "DEEPSEEK_MODEL", "KIMI_MODEL",
              "HF_MODEL", "TOGETHER_MODEL", "OPENCODE_MODEL")


@pytest.fixture
def clean_env(monkeypatch):
    for k in (*KEYS, *MODEL_VARS, "PROVEEDOR_ORDEN", "OPENCODE_BASE_URL"):
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def test_the_default_chain_is_deepseek_kimi_anthropic(clean_env):
    for k in ("DEEPSEEK_API_KEY", "KIMI_API_KEY", "ANTHROPIC_API_KEY"):
        clean_env.setenv(k, "x")
    assert [p.id for p in providers()] == ["deepseek", "kimi", "anthropic"]


def test_the_spares_go_behind_the_chain(clean_env):
    for k in ("OPENROUTER_API_KEY", "HF_TOKEN", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY"):
        clean_env.setenv(k, "x")
    ids = [p.id for p in providers()]
    assert ids.index("deepseek") < ids.index("anthropic") < ids.index("openrouter")


def test_the_default_models_of_the_chain(clean_env):
    for k in ("DEEPSEEK_API_KEY", "KIMI_API_KEY", "ANTHROPIC_API_KEY"):
        clean_env.setenv(k, "x")
    models = {p.id: p.model for p in providers()}
    assert models == {"deepseek": "deepseek-chat", "kimi": "kimi-k3",
                      "anthropic": "claude-sonnet-5"}


def test_the_explicit_order_still_wins(clean_env):
    """Reordering the list cannot have broken PROVEEDOR_ORDEN."""
    for k in ("DEEPSEEK_API_KEY", "KIMI_API_KEY", "ANTHROPIC_API_KEY"):
        clean_env.setenv(k, "x")
    clean_env.setenv("PROVEEDOR_ORDEN", "anthropic,kimi,deepseek")
    assert [p.id for p in providers()] == ["anthropic", "kimi", "deepseek"]


def test_every_model_can_be_overridden_from_the_environment(clean_env):
    for k in ("DEEPSEEK_API_KEY", "KIMI_API_KEY", "ANTHROPIC_API_KEY"):
        clean_env.setenv(k, "x")
    clean_env.setenv("DEEPSEEK_MODEL", "otro-deepseek")
    clean_env.setenv("KIMI_MODEL", "otro-kimi")
    clean_env.setenv("ANTHROPIC_MODEL", "otro-anthropic")
    models = {p.id: p.model for p in providers()}
    assert models == {"deepseek": "otro-deepseek", "kimi": "otro-kimi",
                      "anthropic": "otro-anthropic"}


def test_with_no_keys_there_are_no_providers(clean_env):
    assert providers() == ()


BODY_401 = '{"error":{"message":"invalid api key sk-ant-api03-FUGA"}}'


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
