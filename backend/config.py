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


def _require(key: str) -> str:
    value = os.getenv(key)
    if not value or value.strip() == "" or "your_" in value:
        print(f"[CONFIG ERROR] Missing or placeholder value for required env var: {key}")
        print("Copy .env.example to .env and fill in real values before running the server.")
        sys.exit(1)
    return value


def _optional(key: str, default: str) -> str:
    return os.getenv(key, default)


@dataclass
class Settings:
    # Gemini
    gemini_api_key: str
    gemini_model: str
    gemini_fallback_model: str
    gemini_max_output_tokens: int
    gemini_temperature: float
    gemini_thinking_budget: int
    gemini_enable_search: bool

    # Fish Audio
    fish_audio_api_key: str
    fish_audio_model: str
    fish_audio_voice_id: str
    fish_audio_format: str

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


def load_settings() -> Settings:
    return Settings(
        gemini_api_key=_require("GEMINI_API_KEY"),
        gemini_model=_optional("GEMINI_MODEL", "gemini-2.5-flash"),
        gemini_fallback_model=_optional("GEMINI_FALLBACK_MODEL", "gemini-2.0-flash"),
        gemini_max_output_tokens=int(_optional("GEMINI_MAX_OUTPUT_TOKENS", "200")),
        gemini_temperature=float(_optional("GEMINI_TEMPERATURE", "0.9")),
        # 0 = off, -1 = dynamic (model decides), or a fixed token budget.
        # Only 2.x-family models use this exact field (3.x models use
        # thinking_level instead — see gemini_engine.py's guard).
        gemini_thinking_budget=int(_optional("GEMINI_THINKING_BUDGET", "0")),
        gemini_enable_search=_optional("GEMINI_ENABLE_SEARCH", "true").lower() == "true",

        fish_audio_api_key=_require("FISH_AUDIO_API_KEY"),
        fish_audio_model=_optional("FISH_AUDIO_MODEL", "s2.1-pro-free"),
        # voice_id is optional: s2.1-pro-free's default voice needs none.
        fish_audio_voice_id=_optional("FISH_AUDIO_VOICE_ID", ""),
        fish_audio_format=_optional("FISH_AUDIO_FORMAT", "mp3"),

        stt_engine=_optional("STT_ENGINE", "google"),
        whisper_model_size=_optional("WHISPER_MODEL_SIZE", "base"),
        stt_energy_threshold=int(_optional("STT_ENERGY_THRESHOLD", "300")),
        stt_pause_threshold=float(_optional("STT_PAUSE_THRESHOLD", "0.8")),

        server_host=_optional("SERVER_HOST", "0.0.0.0"),
        server_port=int(_optional("SERVER_PORT", "8000")),

        character_name=_optional("CHARACTER_NAME", "Yumi"),
        memory_file_path=_optional("MEMORY_FILE_PATH", "./backend/memory_store.json"),
    )


settings = load_settings()
