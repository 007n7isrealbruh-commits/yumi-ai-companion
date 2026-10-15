"""
backend/providers/factory.py
Reads the current (possibly runtime-changed, via /settings PATCH)
provider selection and returns a ready-to-use provider instance. Called
fresh on every reply so a provider switch in the settings drawer takes
effect on the very next message, no restart needed.
"""

from backend.config import settings
from backend.providers.registry import get_provider_info
from backend.providers.gemini_provider import GeminiProvider
from backend.providers.openai_compatible import OpenAICompatibleProvider

_gemini_singleton = None  # reused across calls; OpenAI-compat ones are cheap to recreate
_gemini_key = ""
_gemini_model = ""


def reset_provider_cache():
    """Invalidates the cached Gemini provider instance so runtime key/model changes apply immediately."""
    global _gemini_singleton, _gemini_key, _gemini_model
    _gemini_singleton = None
    _gemini_key = ""
    _gemini_model = ""


def _resolve_model_for_provider(provider_id: str, configured_model: str, example_models: list) -> str:
    default_model = example_models[0] if example_models else ""
    m = (configured_model or "").strip()
    if not m:
        return default_model

    # Check if configured model belongs to a different provider
    if provider_id == "gemini":
        if not m.startswith("gemini-"):
            return default_model or "gemini-2.5-flash"
    elif provider_id == "nvidia":
        if not (m.startswith(("meta/", "nvidia/", "mistralai/", "google/", "microsoft/")) or "/" in m):
            return default_model or "meta/llama-3.2-11b-vision-instruct"
    elif provider_id == "openai":
        if not (m.startswith(("gpt-", "o1", "o3", "text-", "chatgpt-")) or m.startswith("ft:")):
            return default_model or "gpt-4o-mini"
    elif provider_id == "groq":
        if not any(k in m.lower() for k in ["llama", "mixtral", "gemma", "whisper", "deepseek", "qwen"]):
            return default_model or "llama-3.3-70b-versatile"
    elif provider_id == "deepseek":
        if not m.startswith("deepseek"):
            return default_model or "deepseek-chat"
    elif provider_id == "xai":
        if not m.startswith("grok"):
            return default_model or "grok-4"
    elif provider_id == "openrouter":
        if "/" not in m:
            return default_model or "meta-llama/llama-3.3-70b-instruct"

    return m


def get_active_provider():
    provider_id = settings.llm_provider

    if provider_id in ("mock", "offline"):
        from backend.providers.mock_provider import MockProvider
        return MockProvider()

    if provider_id == "gemini":
        global _gemini_singleton, _gemini_key, _gemini_model
        current_key = settings.gemini_api_key.strip()
        current_model = settings.gemini_model.strip()
        if _gemini_singleton is None or _gemini_key != current_key or _gemini_model != current_model:
            _gemini_singleton = GeminiProvider()
            _gemini_key = current_key
            _gemini_model = current_model
        return _gemini_singleton

    info = get_provider_info(provider_id)
    if info is None:
        print(f"[PROVIDERS] Unknown LLM_PROVIDER '{provider_id}' — falling back to gemini.")
        return get_active_provider_forced("gemini")

    base_url = settings.llm_base_url.strip() or info.default_base_url
    if not base_url:
        raise RuntimeError(
            f"Provider '{provider_id}' has no default base URL and LLM_BASE_URL isn't set. "
            "Set LLM_BASE_URL in .env or the settings drawer."
        )

    model = _resolve_model_for_provider(provider_id, settings.llm_model, info.example_models)
    if not model:
        raise RuntimeError(f"No model set for provider '{provider_id}'. Set LLM_MODEL.")

    return OpenAICompatibleProvider(
        base_url=base_url,
        api_key=settings.llm_api_key,
        model=model,
        supports_vision=info.supports_vision,
        provider_id=provider_id,
    )


def get_active_provider_forced(provider_id: str):
    """Escape hatch used only for the unknown-provider fallback above —
    avoids infinite recursion if someone typos LLM_PROVIDER."""
    if provider_id == "gemini":
        return GeminiProvider()
    raise RuntimeError(f"Cannot fall back to unknown provider '{provider_id}'.")


def current_provider_capabilities() -> dict:
    """Used by character.py to know whether to tell her vision/search are
    available — these vary per provider, not just per app version."""
    provider_id = settings.llm_provider
    if provider_id == "gemini":
        return {
            "supports_vision": True,
            "supports_search": settings.gemini_enable_search,
        }
    info = get_provider_info(provider_id)
    return {
        "supports_vision": bool(info and info.supports_vision),
        "supports_search": False,  # only Gemini's native search tool is wired up today
    }
