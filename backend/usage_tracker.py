"""
backend/usage_tracker.py
In-memory running totals for the cost/usage dashboard. Resets when the
server restarts (this is a "what have I used this session" counter, not a
billing system) — good enough to catch "oh, I've sent way more than I
thought" without needing a database.
"""

from dataclasses import dataclass, asdict
from threading import Lock


@dataclass
class UsageTotals:
    gemini_input_tokens: int = 0
    gemini_output_tokens: int = 0
    gemini_calls: int = 0
    fish_audio_characters: int = 0
    fish_audio_calls: int = 0


_totals = UsageTotals()
_lock = Lock()


def add_gemini_usage(input_tokens: int, output_tokens: int) -> None:
    with _lock:
        _totals.gemini_input_tokens += max(0, input_tokens)
        _totals.gemini_output_tokens += max(0, output_tokens)
        _totals.gemini_calls += 1


def add_tts_usage(character_count: int) -> None:
    with _lock:
        _totals.fish_audio_characters += max(0, character_count)
        _totals.fish_audio_calls += 1


def get_summary() -> dict:
    with _lock:
        return asdict(_totals)
