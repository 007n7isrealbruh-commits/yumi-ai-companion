"""
backend/providers/registry.py

Single source of truth for every LLM "brain" provider this app can talk
to — one place to look up a provider's default base URL, whether it needs
an API key, whether it's local, and roughly whether its models support
vision. Base URLs below are each independently verified (not guessed):

- OpenAI, Groq, NVIDIA NIM, Ollama, and LM Studio all expose an
  OpenAI-compatible /v1/chat/completions endpoint, so ONE provider
  implementation (openai_compatible.py) covers all of them — only the
  base URL, key, and model differ. "custom" reuses the same code path for
  anything not listed here (Together AI, Perplexity, a self-hosted NIM
  container, etc.) — set LLM_BASE_URL yourself.
- Gemini keeps its own native implementation (gemini_provider.py) instead
  of going through its OpenAI-compat shim, because that's what preserves
  Gemini-only features already built elsewhere in this app: live web
  search, a thinking budget, and the embeddings used for semantic memory.
"""

from dataclasses import dataclass, field
from typing import Dict, Optional


@dataclass
class ProviderInfo:
    id: str
    name: str
    requires_api_key: bool
    default_base_url: str = ""
    is_local: bool = False
    supports_vision: bool = False
    supports_search: bool = False
    supports_thinking: bool = False
    example_models: list = field(default_factory=list)
    notes: str = ""


PROVIDERS: Dict[str, ProviderInfo] = {
    "mock": ProviderInfo(
        id="mock", name="Offline Companion (Local)", requires_api_key=False, is_local=True,
        supports_vision=True,
        example_models=["offline-waifu"],
        notes="Runs 100% locally and offline without external API keys. Instant responses.",
    ),
    "gemini": ProviderInfo(
        id="gemini", name="Google Gemini", requires_api_key=True,
        supports_vision=True, supports_search=True, supports_thinking=True,
        example_models=["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"],
        notes="Native implementation — search/thinking/vision all work here.",
    ),
    "openai": ProviderInfo(
        id="openai", name="OpenAI", requires_api_key=True,
        default_base_url="https://api.openai.com/v1",
        supports_vision=True,
        example_models=["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    ),
    "groq": ProviderInfo(
        id="groq", name="Groq", requires_api_key=True,
        default_base_url="https://api.groq.com/openai/v1",
        example_models=["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
        notes="OpenAI-compatible. Known for very fast/cheap inference; some models on Groq support vision.",
    ),
    "nvidia": ProviderInfo(
        id="nvidia", name="NVIDIA NIM", requires_api_key=True,
        default_base_url="https://integrate.api.nvidia.com/v1",
        supports_vision=True,
        example_models=[
            "meta/llama-3.2-11b-vision-instruct",
            "meta/llama-3.2-90b-vision-instruct",
        ],
        notes="NVIDIA NIM cloud catalog (build.nvidia.com). Requires API key starting with 'nvapi-'. Recommended active model: meta/llama-3.2-11b-vision-instruct (supports vision & chat).",
    ),
    "deepseek": ProviderInfo(
        id="deepseek", name="DeepSeek", requires_api_key=True,
        default_base_url="https://api.deepseek.com",
        example_models=["deepseek-chat", "deepseek-reasoner"],
    ),
    "xai": ProviderInfo(
        id="xai", name="xAI (Grok)", requires_api_key=True,
        default_base_url="https://api.x.ai/v1",
        supports_vision=True,
        example_models=["grok-4", "grok-4-mini"],
    ),
    "openrouter": ProviderInfo(
        id="openrouter", name="OpenRouter (cloud)", requires_api_key=True,
        default_base_url="https://openrouter.ai/api/v1",
        supports_vision=True,
        example_models=["anthropic/claude-3.5-sonnet", "meta-llama/llama-3.3-70b-instruct", "deepseek/deepseek-chat", "google/gemini-2.0-flash-001"],
        notes="Unified cloud router for Claude, Llama 3, DeepSeek, Mistral, and hundreds more via one API key.",
    ),
    "ollama": ProviderInfo(
        id="ollama", name="Ollama (local)", requires_api_key=False, is_local=True,
        default_base_url="http://localhost:11434/v1",
        example_models=["llama3.2", "qwen2.5", "deepseek-r1:8b", "mistral", "phi3", "gemma2"],
        notes="Free, fully offline. Run `ollama run llama3.2` or `ollama serve`.",
    ),
    "lmstudio": ProviderInfo(
        id="lmstudio", name="LM Studio (local)", requires_api_key=False, is_local=True,
        default_base_url="http://localhost:1234/v1",
        example_models=["local-model", "qwen2.5-7b-instruct", "llama-3.2-3b-instruct", "mistral-7b-instruct"],
        notes="Free, fully offline. Start LM Studio local server and load your preferred model.",
    ),
    "koboldcpp": ProviderInfo(
        id="koboldcpp", name="KoboldCPP (local)", requires_api_key=False, is_local=True,
        default_base_url="http://localhost:5001/v1",
        example_models=["local-model"],
        notes="Free, fully offline. Popular lightweight GGUF runner for AI companions & roleplay.",
    ),
    "vllm": ProviderInfo(
        id="vllm", name="vLLM (local)", requires_api_key=False, is_local=True,
        default_base_url="http://localhost:8000/v1",
        example_models=["meta-llama/Llama-3.2-3B-Instruct", "Qwen/Qwen2.5-7B-Instruct"],
        notes="High-throughput local LLM server.",
    ),
    "custom": ProviderInfo(
        id="custom", name="Custom (OpenAI-compatible)", requires_api_key=True,
        notes="Any other OpenAI-compatible endpoint — set LLM_BASE_URL and LLM_MODEL yourself.",
    ),
}


def get_provider_info(provider_id: str) -> Optional[ProviderInfo]:
    return PROVIDERS.get(provider_id)


def list_providers() -> list:
    """Serializable list for the /settings API and the settings UI."""
    return [
        {
            "id": p.id,
            "name": p.name,
            "requires_api_key": p.requires_api_key,
            "is_local": p.is_local,
            "supports_vision": p.supports_vision,
            "supports_search": p.supports_search,
            "supports_thinking": p.supports_thinking,
            "default_base_url": p.default_base_url,
            "example_models": p.example_models,
            "notes": p.notes,
        }
        for p in PROVIDERS.values()
    ]
