"""
backend/config.py
Loads and validates all environment variables for the AI Waifu app.
Import `settings` from this module anywhere else in the backend.
"""

import os
import sys
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()  # reads ".env" in the project root

LOCAL_PROVIDERS = {"ollama", "lmstudio", "koboldcpp", "vllm", "mock", "offline"}  # no API key needed for these


def _require(key: str) -> str:
    value = os.getenv(key)
    if not value or value.strip() == "" or "your_" in value:
        print(f"[CONFIG WARNING] No key found for {key} in environment. You can configure it in the Settings UI.")
        return ""
    return value


def _optional(key: str, default: str) -> str:
    return os.getenv(key, default)


@dataclass
class Settings:
    # Brain / LLM provider selection. "gemini" keeps using the fields below
    # unchanged; any other value routes through backend/providers/registry.py
    # + openai_compatible.py instead. See .env.example for the full list.
    llm_provider: str
    llm_model: str        # used when llm_provider != "gemini"
    llm_api_key: str      # used when llm_provider != "gemini"
    llm_base_url: str     # "" = use the registry's default for llm_provider

    # Gemini (also still used for embeddings/semantic memory regardless of
    # llm_provider, if a key is present — see backend/embeddings.py)
    gemini_api_key: str
    gemini_model: str
    gemini_fallback_model: str
    gemini_max_output_tokens: int
    gemini_temperature: float
    gemini_thinking_budget: int
    gemini_enable_search: bool

    # Voice / TTS
    tts_provider: str
    fish_audio_api_key: str
    fish_audio_model: str
    fish_audio_voice_id: str
    fish_audio_format: str
    elevenlabs_api_key: str
    elevenlabs_voice_id: str
    elevenlabs_model: str

    # STT
    stt_engine: str
    whisper_model_size: str
    stt_energy_threshold: int
    stt_pause_threshold: float

    # Server
    server_host: str
    server_port: int

    # Character / Memory
    character_name: str
    memory_file_path: str

    # Proactive & Hands-Free Interaction
    proactive_enabled: bool = True
    proactive_idle_seconds: int = 120
    wake_word_enabled: bool = False


def load_settings() -> Settings:
    llm_provider = _optional("LLM_PROVIDER", "mock").strip().lower()

    # Only require the key that's actually needed for the active provider —
    # picking Groq shouldn't force you to also have a Gemini key, and vice
    # versa. Gemini's own key stays optional (not required) when it isn't
    # the active brain, but if you happen to set it anyway, embeddings/
    # semantic memory will still use it (see embeddings.py) — it's just no
    # longer mandatory to run the app at all.
    if llm_provider == "gemini":
        gemini_api_key = _require("GEMINI_API_KEY")
        llm_api_key = _optional("LLM_API_KEY", "")
    else:
        gemini_api_key = _optional("GEMINI_API_KEY", "")
        if llm_provider in LOCAL_PROVIDERS or llm_provider == "custom":
            llm_api_key = _optional("LLM_API_KEY", "not-needed")
        else:
            llm_api_key = _require("LLM_API_KEY")

    return Settings(
        llm_provider=llm_provider,
        llm_model=_optional("LLM_MODEL", ""),
        llm_api_key=llm_api_key,
        llm_base_url=_optional("LLM_BASE_URL", ""),

        gemini_api_key=gemini_api_key,
        gemini_model=_optional("GEMINI_MODEL", "gemini-2.5-flash"),
        gemini_fallback_model=_optional("GEMINI_FALLBACK_MODEL", "gemini-2.5-flash-lite"),
        gemini_max_output_tokens=int(_optional("GEMINI_MAX_OUTPUT_TOKENS", "200")),
        gemini_temperature=float(_optional("GEMINI_TEMPERATURE", "0.9")),
        # 0 = off, -1 = dynamic (model decides), or a fixed token budget.
        # Only 2.x-family models use this exact field (3.x models use
        # thinking_level instead — see providers/gemini_provider.py's guard).
        gemini_thinking_budget=int(_optional("GEMINI_THINKING_BUDGET", "0")),
        gemini_enable_search=_optional("GEMINI_ENABLE_SEARCH", "true").lower() == "true",

        tts_provider=_optional("TTS_PROVIDER", "browser").strip().lower(),
        fish_audio_api_key=_optional("FISH_AUDIO_API_KEY", ""),
        fish_audio_model=_optional("FISH_AUDIO_MODEL", "s2.1-pro-free"),
        # voice_id is optional: s2.1-pro-free's default voice needs none.
        fish_audio_voice_id=_optional("FISH_AUDIO_VOICE_ID", ""),
        fish_audio_format=_optional("FISH_AUDIO_FORMAT", "mp3"),

        elevenlabs_api_key=_optional("ELEVENLABS_API_KEY", ""),
        elevenlabs_voice_id=_optional("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"),
        elevenlabs_model=_optional("ELEVENLABS_MODEL", "eleven_multilingual_v2"),

        stt_engine=_optional("STT_ENGINE", "browser"),
        whisper_model_size=_optional("WHISPER_MODEL_SIZE", "base"),
        stt_energy_threshold=int(_optional("STT_ENERGY_THRESHOLD", "300")),
        stt_pause_threshold=float(_optional("STT_PAUSE_THRESHOLD", "0.8")),

        server_host=_optional("SERVER_HOST", "127.0.0.1"),
        server_port=int(_optional("SERVER_PORT", "8000")),

        character_name=_optional("CHARACTER_NAME", "Yumi"),
        memory_file_path=_optional("MEMORY_FILE_PATH", "./backend/memory_store.json"),

        proactive_enabled=_optional("PROACTIVE_ENABLED", "true").lower() == "true",
        proactive_idle_seconds=int(_optional("PROACTIVE_IDLE_SECONDS", "120")),
        wake_word_enabled=_optional("WAKE_WORD_ENABLED", "false").lower() == "true",
    )


settings = load_settings()
