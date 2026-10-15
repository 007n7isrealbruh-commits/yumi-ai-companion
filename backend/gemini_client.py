"""
backend/gemini_client.py
Lazily-built shared google-genai Client. Built on first use (not at
import) so that running the app on a non-Gemini brain provider without a
Gemini key doesn't crash at startup — the client is only needed for
(a) the Gemini provider itself and (b) optional semantic-memory embeddings.
"""
from typing import Optional

try:
    from google import genai
except ImportError:
    genai = None

from backend.config import settings

_client: Optional["genai.Client"] = None
_client_key: str = ""


def gemini_available() -> bool:
    return bool(settings.gemini_api_key.strip())


def get_client():
    """Returns a Client for the current GEMINI_API_KEY, or raises a clear
    error if none is configured."""
    global _client, _client_key
    key = settings.gemini_api_key.strip()
    if not key:
        raise RuntimeError("No GEMINI_API_KEY is set — add it to .env to use Gemini or semantic memory.")
    if _client is None or key != _client_key:
        _client = genai.Client(api_key=key)
        _client_key = key
    return _client
