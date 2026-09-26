"""
backend/gemini_engine.py
Owns the Gemini chat session. Each call:
  1. Builds a fresh system prompt from current memory/affection state.
  2. Sends the user's message (+ optional screen/webcam frame) plus
     recent rolling history, with web search and thinking available.
  3. Applies a lightweight affection delta based on message sentiment cues.
  4. Parses out the emotion tag (always) and action tag (if she triggered
     one of the allowlisted PC actions from pc_actions.py).
  5. Persists the turn to memory and logs token usage.
"""

import re
from typing import List, Optional
from google.genai import types

from backend.config import settings
from backend.character import build_system_prompt
from backend.memory_manager import MemoryManager
from backend.gemini_client import client as _client
from backend import pc_actions
from backend import usage_tracker

_POSITIVE_CUES = ("thank", "love", "great job", "good girl", "amazing", "appreciate", "miss you", "sorry")
_NEGATIVE_CUES = ("shut up", "stupid", "hate you", "useless", "dumb")

_EMOTION_TAG_PATTERN = re.compile(r"\[\s*emotion\s*:\s*(\w+)\s*\]", re.IGNORECASE)
_VALID_EMOTIONS = {"neutral", "happy", "angry", "sad", "surprised", "embarrassed"}

_ACTION_TAG_PATTERN = re.compile(r"\[\s*action\s*:\s*([\w\-]+)\s*\]", re.IGNORECASE)

# Non-greedy up to the first "]" — facts are short and shouldn't contain
# brackets, so this is safe and avoids over-matching past the tag.
_MEMORY_TAG_PATTERN = re.compile(r"\[\s*memory\s*:\s*(.*?)\]", re.IGNORECASE | re.DOTALL)

# Models in the 3.x family use thinking_level (LOW/MEDIUM/HIGH) instead of
# a raw token budget. Anything else (2.5-flash, 2.0-flash, etc.) uses
# thinking_budget. This keeps GEMINI_MODEL swappable in .env without the
# thinking config silently erroring out on a mismatched model family.
_THINKING_LEVEL_MODEL_PREFIXES = ("gemini-3", "gemini-3.5")


def _sentiment_delta(user_text: str) -> int:
    lowered = user_text.lower()
    delta = 1  # small baseline gain just for interacting
    if any(cue in lowered for cue in _POSITIVE_CUES):
        delta += 3
    if any(cue in lowered for cue in _NEGATIVE_CUES):
        delta -= 4
    return delta


def _history_to_contents(memory: MemoryManager) -> list:
    contents = []
    for turn in memory.get_recent_history():
        role = "user" if turn["role"] == "user" else "model"
        contents.append(types.Content(role=role, parts=[types.Part(text=turn["text"])]))
    return contents


def _split_tags(raw_text: str) -> tuple[str, str, Optional[str], List[str]]:
    """Strips [emotion: X], [memory: ...], and (if present) [action: NAME]
    out of the model's raw output. Returns
    (spoken_text, emotion, action_name, new_memory_facts).
    Never lets a malformed/missing emotion tag through — defaults to
    'neutral'. An action name not in the allowlist is dropped entirely
    (see pc_actions.execute_action doing the same check again). This is
    also where the model decides what's worth remembering — see the
    memory tag rule in character.py's TAG_RULES."""
    emotion = "neutral"
    action_name = None
    memory_facts: List[str] = []

    match = _EMOTION_TAG_PATTERN.search(raw_text)
    if match:
        candidate = match.group(1).lower()
        if candidate in _VALID_EMOTIONS:
            emotion = candidate
        raw_text = raw_text[: match.start()] + raw_text[match.end():]

    match = _MEMORY_TAG_PATTERN.search(raw_text)
    if match:
        raw_facts = match.group(1).strip()
        if raw_facts and raw_facts.lower() not in ("none", "n/a", "nothing"):
            memory_facts = [f.strip() for f in raw_facts.split(";") if f.strip()]
        raw_text = raw_text[: match.start()] + raw_text[match.end():]

    match = _ACTION_TAG_PATTERN.search(raw_text)
    if match:
        candidate = match.group(1)
        if candidate in pc_actions.available_action_names():
            action_name = candidate
        raw_text = raw_text[: match.start()] + raw_text[match.end():]

    return raw_text.strip(), emotion, action_name, memory_facts


def _build_thinking_config() -> Optional[types.ThinkingConfig]:
    if settings.gemini_thinking_budget == 0:
        return None
    if settings.gemini_model.startswith(_THINKING_LEVEL_MODEL_PREFIXES):
        # Coarse mapping from a token budget onto the 3.x level enum, so
        # GEMINI_THINKING_BUDGET keeps meaning "more/less thinking"
        # regardless of which model family you're pointed at.
        level = types.ThinkingLevel.HIGH if settings.gemini_thinking_budget < 0 or settings.gemini_thinking_budget > 512 else types.ThinkingLevel.LOW
        return types.ThinkingConfig(thinking_level=level)
    return types.ThinkingConfig(thinking_budget=settings.gemini_thinking_budget)


def _build_tools() -> Optional[list]:
    if settings.gemini_enable_search:
        return [types.Tool(google_search=types.GoogleSearch())]
    return None


def generate_reply(
    user_text: str,
    memory: MemoryManager,
    image_bytes: Optional[bytes] = None,
    image_mime: Optional[str] = None,
) -> dict:
    """Returns {"text", "emotion", "action", "action_result", "new_facts",
    "milestones", "affection"}. image_bytes/image_mime, if provided, is the
    latest screen or webcam frame — see server.py's screen_frame/
    webcam_frame handling."""

    memory.adjust_affection(_sentiment_delta(user_text))
    memory.add_turn("user", user_text)

    available_actions = pc_actions.available_action_names()
    system_prompt = build_system_prompt(
        memory,
        current_message=user_text,
        available_actions=available_actions,
        has_vision=image_bytes is not None,
        has_search=settings.gemini_enable_search,
    )

    contents = _history_to_contents(memory)

    user_parts = [types.Part(text=user_text)]
    if image_bytes and image_mime:
        user_parts.append(types.Part.from_bytes(data=image_bytes, mime_type=image_mime))
    contents.append(types.Content(role="user", parts=user_parts))

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        max_output_tokens=settings.gemini_max_output_tokens,
        temperature=settings.gemini_temperature,
        thinking_config=_build_thinking_config(),
        tools=_build_tools(),
    )

    raw_reply, usage = _call_gemini(contents, config)
    reply_text, emotion, action_name, new_facts = _split_tags(raw_reply)

    # She decides what's worth remembering (via the [memory: ...] tag) —
    # this replaces the old fixed-pattern fact extractor. No cap, no
    # auto-eviction; see MemoryManager.remember_fact / forget_fact.
    for fact in new_facts:
        memory.remember_fact(fact)

    action_result = None
    if action_name:
        action_result = pc_actions.execute_action(action_name)

    if usage:
        usage_tracker.add_gemini_usage(usage.get("input_tokens", 0), usage.get("output_tokens", 0))

    memory.add_turn("assistant", reply_text)
    milestones = memory.check_new_milestones()
    memory.save()

    return {
        "text": reply_text,
        "emotion": emotion,
        "action": action_name,
        "action_result": action_result,
        "new_facts": new_facts,
        "milestones": milestones,
        "affection": memory.state.affection,
    }


def generate_diary_entry(memory: MemoryManager) -> str:
    """One-off Gemini call (separate from the normal reply flow) that has
    her reflect on the recent conversation in her own voice, then saves it
    to memory.state.diary_entries. Triggered by the frontend's diary
    button, not automatically — see server.py's "write_diary" message."""
    recent = memory.get_recent_history()
    if not recent:
        return "Nothing's happened yet today — no diary entry to write."

    transcript = "\n".join(f"{turn['role']}: {turn['text']}" for turn in recent)
    prompt = (
        "Here is a transcript of your recent conversation with the user:\n\n"
        f"{transcript}\n\n"
        "Write a short (3-5 sentence) private diary entry in your own voice, "
        "reflecting on how you're feeling about the user and anything that "
        "happened. This is private — no one is listening, so you can be more "
        "candid/earnest here than you'd ever be out loud. No emotion tags, no "
        "action tags, just the diary text."
    )

    system_prompt = build_system_prompt(memory, current_message="")
    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        max_output_tokens=250,
        temperature=settings.gemini_temperature,
    )
    contents = [types.Content(role="user", parts=[types.Part(text=prompt)])]

    entry_text, usage = _call_gemini(contents, config)
    if usage:
        usage_tracker.add_gemini_usage(usage.get("input_tokens", 0), usage.get("output_tokens", 0))

    # Belt-and-suspenders: strip any tags that slip through even though the
    # prompt above asks her not to include them (the system prompt's own
    # TAG_RULES still technically apply here, so this guards against her
    # following those instead of the diary-specific ask).
    entry_text, _, _, _ = _split_tags(entry_text)

    memory.add_diary_entry(entry_text)
    memory.save()
    return entry_text


def _extract_usage(response) -> Optional[dict]:
    meta = getattr(response, "usage_metadata", None)
    if not meta:
        return None
    return {
        "input_tokens": getattr(meta, "prompt_token_count", 0) or 0,
        "output_tokens": getattr(meta, "candidates_token_count", 0) or 0,
    }


def _call_gemini(contents: list, config: types.GenerateContentConfig) -> tuple[str, Optional[dict]]:
    try:
        response = _client.models.generate_content(
            model=settings.gemini_model,
            contents=contents,
            config=config,
        )
        return (response.text or "").strip() or "...", _extract_usage(response)
    except Exception as primary_error:
        print(f"[GEMINI] Primary model '{settings.gemini_model}' failed: {primary_error}")
        try:
            response = _client.models.generate_content(
                model=settings.gemini_fallback_model,
                contents=contents,
                config=config,
            )
            return (response.text or "").strip() or "...", _extract_usage(response)
        except Exception as fallback_error:
            print(f"[GEMINI] Fallback model also failed: {fallback_error}")
            return "Ugh, my head's fuzzy right now, give me a second and try again.", None
