"""
backend/tts_engine.py
Sends text to the Fish Audio REST TTS endpoint and returns raw audio bytes
(mp3 by default; set FISH_AUDIO_FORMAT=pcm in .env for raw PCM streaming).
Also supports ElevenLabs and offline/browser fallbacks.

WHERE TO PUT YOUR VOICE ID
---------------------------------------------------------------------------
You have two options — use whichever is easier for you:

  1. (Recommended) Set FISH_AUDIO_VOICE_ID in your .env file or Settings drawer.
  2. Paste it directly into HARDCODED_VOICE_ID right below this comment.
     If both are set, this hardcoded value wins.

Leave both blank to just use the default voice that comes with
"s2.1-pro-free" — you don't need a voice ID at all for that.
---------------------------------------------------------------------------
"""

import re
from typing import List, Tuple, Optional
import requests
from backend.config import settings
from backend import usage_tracker

# <<< OPTIONAL: PASTE YOUR FISH AUDIO VOICE REFERENCE ID HERE, e.g. "8ef4a238714b45718ce04243307c57a7" >>>
HARDCODED_VOICE_ID = ""

FISH_AUDIO_TTS_URL = "https://api.fish.audio/v1/tts"


def _resolve_fish_voice_id(custom_id: str = "") -> str:
    if custom_id and custom_id.strip():
        return custom_id.strip()
    return HARDCODED_VOICE_ID.strip() or settings.fish_audio_voice_id.strip()


def split_into_speech_chunks(text: str, target_words: int = 18) -> List[str]:
    """Splits reply text into natural sentence chunks for low-latency, expressive streaming."""
    text = (text or "").strip()
    if not text:
        return []

    # Strip reasoning tags, stage directions, asterisks, brackets, and markdown symbols
    cleaned = re.sub(r"<think(?:ing)?>.*?</think(?:ing)?>", "", text, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r"<thought>.*?</thought>", "", cleaned, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r'\*[^*]+\*', '', cleaned)
    cleaned = re.sub(r'\[[^\]]+\]', '', cleaned)
    cleaned = re.sub(r'[*_~`#]', '', cleaned).strip()
    if not cleaned:
        cleaned = text.strip()

    # Split on sentence boundaries: periods, exclamation marks, question marks, newlines, CJK punctuation
    raw_sentences = re.split(r'([.!?。\n！？]+)', cleaned)
    sentences = []
    current = ""
    for part in raw_sentences:
        if not part:
            continue
        current += part
        if re.search(r'[.!?。\n！？]$', part):
            s = current.strip()
            if s and re.search(r'[\w\u4e00-\u9fff]', s):
                # If a single sentence is very long (> 28 words), split on clause punctuation
                if len(s.split()) > 28:
                    clauses = re.split(r'([,;，、—]+)', s)
                    sub_curr = ""
                    for cl in clauses:
                        sub_curr += cl
                        if len(sub_curr.split()) >= 12:
                            sub_clean = re.sub(r'^[,\s;:—\-]+', '', sub_curr).strip()
                            if sub_clean and re.search(r'[\w\u4e00-\u9fff]', sub_clean):
                                sentences.append(sub_clean)
                            sub_curr = ""
                    if sub_curr.strip():
                        sub_clean = re.sub(r'^[,\s;:—\-]+', '', sub_curr).strip()
                        if sub_clean and re.search(r'[\w\u4e00-\u9fff]', sub_clean):
                            sentences.append(sub_clean)
                else:
                    sentences.append(s)
            current = ""
    if current.strip() and re.search(r'[\w\u4e00-\u9fff]', current.strip()):
        sentences.append(current.strip())

    if not sentences:
        return [cleaned] if re.search(r'[\w\u4e00-\u9fff]', cleaned) else []

    # Bundle very short sentences together for natural prosody
    chunks: List[str] = []
    bundle = ""
    for s in sentences:
        s_clean = re.sub(r'^[,\s;:—\-]+', '', s).strip()
        if not s_clean:
            continue
        if not bundle:
            bundle = s_clean
        else:
            bundle_words = len(bundle.split())
            if bundle_words < 8:
                bundle = f"{bundle} {s_clean}"
            elif bundle_words + len(s_clean.split()) <= target_words:
                bundle = f"{bundle} {s_clean}"
            else:
                chunks.append(bundle.strip())
                bundle = s_clean

    if bundle.strip():
        chunks.append(bundle.strip())

    return [c for c in chunks if re.search(r'[\w\u4e00-\u9fff]', c)]


def _synthesize_fish_audio(
    text: str,
    custom_key: str = "",
    custom_voice_id: str = "",
    custom_model: str = "",
) -> Tuple[bytes, Optional[str]]:
    api_key = (custom_key or settings.fish_audio_api_key).strip()
    if not api_key:
        return b"", "Fish Audio API key is missing. Please enter your API key in the Voice settings."

    model = (custom_model or settings.fish_audio_model or "s2.1-pro-free").strip()
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "model": model,
    }
    # Note: Fish Audio API accepts latency as "balanced" or "normal" (not "fast", which causes 422).
    payload = {
        "text": text,
        "format": settings.fish_audio_format or "mp3",
        "normalize": True,
        "latency": "balanced",
    }

    voice_id = _resolve_fish_voice_id(custom_voice_id)
    if voice_id:
        payload["reference_id"] = voice_id

    try:
        response = requests.post(FISH_AUDIO_TTS_URL, headers=headers, json=payload, timeout=30)
        if response.status_code == 401:
            return b"", "Fish Audio Authentication Failed (401): Invalid API Key. Please verify your key at fish.audio."
        if response.status_code == 404:
            return b"", f"Fish Audio Voice Reference ID '{voice_id}' not found (404). Please verify your Reference ID."
        if response.status_code == 402:
            return b"", "Fish Audio Insufficient Balance (402): Account quota exceeded or requires credits. Switch to s2.1-pro-free or recharge."
        if response.status_code == 422:
            detail = _extract_error_message(response)
            return b"", f"Fish Audio Rejected Request (422): {detail}"
        if response.status_code != 200:
            detail = _extract_error_message(response)
            return b"", f"Fish Audio Error ({response.status_code}): {detail}"

        usage_tracker.add_tts_usage(len(text))
        return response.content, None

    except requests.exceptions.Timeout:
        return b"", "Fish Audio request timed out (30s). Please check your internet connection."
    except requests.exceptions.RequestException as e:
        return b"", f"Fish Audio network request failed: {e}"


def _synthesize_elevenlabs(
    text: str,
    custom_key: str = "",
    custom_voice_id: str = "",
    custom_model: str = "",
) -> Tuple[bytes, Optional[str]]:
    api_key = (custom_key or settings.elevenlabs_api_key).strip()
    if not api_key:
        return b"", "ElevenLabs API key is missing. Add your xi-api-key in Voice settings."

    voice_id = (custom_voice_id or settings.elevenlabs_voice_id or "21m00Tcm4TlvDq8ikWAM").strip()
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"

    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": text,
        "model_id": (custom_model or settings.elevenlabs_model or "eleven_multilingual_v2").strip(),
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
        },
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        if response.status_code == 401:
            return b"", "ElevenLabs Authentication Failed (401): Invalid API Key."
        if response.status_code == 404:
            return b"", f"ElevenLabs Voice ID '{voice_id}' not found (404)."
        if response.status_code == 422:
            detail = _extract_error_message(response)
            return b"", f"ElevenLabs Rejected Request (422): {detail}"
        if response.status_code != 200:
            detail = _extract_error_message(response)
            return b"", f"ElevenLabs Error ({response.status_code}): {detail}"

        usage_tracker.add_tts_usage(len(text))
        return response.content, None

    except requests.exceptions.Timeout:
        return b"", "ElevenLabs request timed out (30s)."
    except requests.exceptions.RequestException as e:
        return b"", f"ElevenLabs request failed: {e}"


def synthesize_speech_with_error(
    text: str,
    provider: Optional[str] = None,
    custom_key: str = "",
    custom_voice_id: str = "",
    custom_model: str = "",
) -> Tuple[bytes, Optional[str]]:
    """Synthesizes speech and returns (audio_bytes, error_message)."""
    text = (text or "").strip()
    if not text:
        return b"", "Text cannot be empty."

    active_provider = (provider or settings.tts_provider or "fish_audio").lower().strip()
    if active_provider == "elevenlabs":
        return _synthesize_elevenlabs(text, custom_key=custom_key, custom_voice_id=custom_voice_id, custom_model=custom_model)
    elif active_provider in ("browser", "none", "off", "disabled"):
        return b"", None
    else:
        return _synthesize_fish_audio(text, custom_key=custom_key, custom_voice_id=custom_voice_id, custom_model=custom_model)


def synthesize_speech(text: str) -> bytes:
    """Dispatches TTS synthesis to the active provider and returns audio bytes (b'' on failure)."""
    audio, _ = synthesize_speech_with_error(text)
    return audio


def _extract_error_message(response: requests.Response) -> str:
    try:
        body = response.json()
        if isinstance(body, dict):
            return body.get("message") or body.get("detail") or str(body)
        return str(body)
    except ValueError:
        return response.text[:300]
