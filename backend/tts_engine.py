"""
backend/tts_engine.py
Sends text to the Fish Audio REST TTS endpoint and returns raw audio bytes
(mp3 by default; set FISH_AUDIO_FORMAT=pcm in .env for raw PCM streaming).

WHERE TO PUT YOUR VOICE ID
---------------------------------------------------------------------------
You have two options — use whichever is easier for you:

  1. (Recommended) Set FISH_AUDIO_VOICE_ID in your .env file.
  2. Paste it directly into HARDCODED_VOICE_ID right below this comment.
     If both are set, this hardcoded value wins.

Leave both blank to just use the default voice that comes with
"s2.1-pro-free" — you don't need a voice ID at all for that.
---------------------------------------------------------------------------
"""

import requests
from backend.config import settings
from backend import usage_tracker

# <<< PASTE YOUR FISH AUDIO VOICE REFERENCE ID HERE, e.g. "8ef4a238714b45718ce04243307c57a7" >>>
HARDCODED_VOICE_ID = ""

FISH_AUDIO_TTS_URL = "https://api.fish.audio/v1/tts"


def _resolve_voice_id() -> str:
    return HARDCODED_VOICE_ID.strip() or settings.fish_audio_voice_id.strip()


def synthesize_speech(text: str) -> bytes:
    """Returns raw audio bytes in the configured format, or empty bytes on failure."""
    if not text.strip():
        return b""

    headers = {
        "Authorization": f"Bearer {settings.fish_audio_api_key}",
        "Content-Type": "application/json",
        # required header, NOT a body field — e.g. "s2.1-pro-free" (free
        # tier, no latency/uptime guarantee) or "s2.1-pro" (paid, same
        # model, production SLAs).
        "model": settings.fish_audio_model,
    }
    payload = {
        "text": text,
        "format": settings.fish_audio_format,
        "normalize": True,
        "latency": "normal",
    }

    voice_id = _resolve_voice_id()
    if voice_id:
        payload["reference_id"] = voice_id
    # else: omitting reference_id entirely uses the model's built-in default voice.

    try:
        response = requests.post(FISH_AUDIO_TTS_URL, headers=headers, json=payload, timeout=30)

        if response.status_code == 401:
            print("[TTS] Fish Audio auth failed (401) — check FISH_AUDIO_API_KEY.")
            return b""
        if response.status_code == 404:
            print("[TTS] Fish Audio voice not found (404) — check your voice reference ID "
                  "(HARDCODED_VOICE_ID in this file, or FISH_AUDIO_VOICE_ID in .env).")
            return b""
        if response.status_code == 422:
            # Success responses are raw audio bytes with no JSON wrapper, but
            # error responses do come back as {"status": ..., "message": ...}
            # — surface that message instead of a generic HTTP error.
            detail = _extract_error_message(response)
            print(f"[TTS] Fish Audio rejected the request (422): {detail}")
            return b""

        response.raise_for_status()
        usage_tracker.add_tts_usage(len(text))
        return response.content

    except requests.exceptions.Timeout:
        print("[TTS] Fish Audio request timed out.")
        return b""
    except requests.exceptions.RequestException as e:
        print(f"[TTS] Fish Audio request failed: {e}")
        return b""


def _extract_error_message(response: requests.Response) -> str:
    try:
        body = response.json()
        return body.get("message", response.text)
    except ValueError:
        return response.text
