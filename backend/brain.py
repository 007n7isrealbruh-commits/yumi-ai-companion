"""
backend/brain.py
The provider-agnostic orchestrator: builds the prompt, calls whichever
LLM provider is currently active (backend/providers/factory.py), parses
the emotion/memory/action tags out of the raw reply, updates affection,
saves memory, executes PC actions, and tracks usage. None of this cares
whether the actual text came from Gemini, Groq, a local Ollama model, or
anything else — that's the whole point of the provider split.
"""

import re
from typing import List, Optional

from backend.config import settings
from backend.character import build_system_prompt
from backend.memory_manager import MemoryManager
from backend.providers.factory import get_active_provider, current_provider_capabilities
from backend import pc_actions
from backend import usage_tracker
from backend import heuristics
from backend.task_manager import task_manager
from backend.timer_manager import timer_manager

_EMOTION_TAG_PATTERN = re.compile(r"\[\s*emotion\s*:\s*(\w+)\s*\]", re.IGNORECASE)
_VALID_EMOTIONS = {"neutral", "happy", "angry", "sad", "surprised", "embarrassed"}

_ACTION_TAG_PATTERN = re.compile(r"\[\s*action\s*:\s*([\w\-]+)\s*\]", re.IGNORECASE)
_MEMORY_TAG_PATTERN = re.compile(r"\[\s*memory\s*:\s*(.*?)\]", re.IGNORECASE | re.DOTALL)
_TASK_TAG_PATTERN = re.compile(r"\[\s*task\s*:\s*(.*?)\]", re.IGNORECASE | re.DOTALL)
_TIMER_TAG_PATTERN = re.compile(r"\[\s*(?:timer|alarm)\s*:\s*(.*?)\]", re.IGNORECASE | re.DOTALL)


def _handle_task_tag(raw_task_str: str) -> Optional[dict]:
    parts = [p.strip() for p in raw_task_str.split("|")]
    if not parts:
        return None
    action = parts[0].lower()
    kwargs = {}
    for p in parts[1:]:
        if ":" in p:
            k, v = p.split(":", 1)
            kwargs[k.strip().lower()] = v.strip()

    if action == "create":
        title = kwargs.get("title", "New Task")
        due = kwargs.get("due", "")
        task = task_manager.create_task(title=title, due=due)
        return {"action": "create", "task": task}
    elif action == "complete":
        title = kwargs.get("title", "")
        task = task_manager.complete_task(title)
        return {"action": "complete", "task": task}
    elif action == "remove":
        title = kwargs.get("title", "")
        success = task_manager.remove_task(title)
        return {"action": "remove", "success": success}
    elif action == "list":
        tasks = task_manager.list_tasks()
        return {"action": "list", "tasks": tasks}
    return None


def _handle_timer_tag(raw_timer_str: str) -> Optional[dict]:
    parts = [p.strip() for p in raw_timer_str.split("|")]
    if not parts:
        return None
    action = parts[0].lower()
    kwargs = {}
    for p in parts[1:]:
        if ":" in p:
            k, v = p.split(":", 1)
            kwargs[k.strip().lower()] = v.strip()

    if action == "set":
        time_val = kwargs.get("time")
        if time_val:
            label = kwargs.get("label", "Alarm")
            alarm = timer_manager.set_alarm(time_val, label=label)
            return {"action": "set_alarm", "timer": alarm}
        else:
            try:
                seconds = int(kwargs.get("seconds", 300))
            except ValueError:
                seconds = 300
            label = kwargs.get("label", "Timer")
            timer = timer_manager.set_timer(seconds=seconds, label=label)
            return {"action": "set_timer", "timer": timer}
    elif action == "cancel":
        label = kwargs.get("label", "")
        success = timer_manager.cancel(label)
        return {"action": "cancel", "success": success}
    return None


def _split_tags(raw_text: str) -> tuple[str, str, Optional[str], List[str], Optional[dict], Optional[dict]]:
    """Strips [emotion], [memory], [action], [task], and [timer] tags out of raw output."""
    emotion = "neutral"
    action_name = None
    memory_facts: List[str] = []
    task_op = None
    timer_op = None

    # Strip reasoning / thought tags from reasoning models
    raw_text = re.sub(r"<think(?:ing)?>.*?</think(?:ing)?>", "", raw_text, flags=re.DOTALL | re.IGNORECASE)
    raw_text = re.sub(r"<thought>.*?</thought>", "", raw_text, flags=re.DOTALL | re.IGNORECASE)

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

    match = _TASK_TAG_PATTERN.search(raw_text)
    if match:
        task_op = _handle_task_tag(match.group(1).strip())
        raw_text = raw_text[: match.start()] + raw_text[match.end():]

    match = _TIMER_TAG_PATTERN.search(raw_text)
    if match:
        timer_op = _handle_timer_tag(match.group(1).strip())
        raw_text = raw_text[: match.start()] + raw_text[match.end():]

    match = _ACTION_TAG_PATTERN.search(raw_text)
    if match:
        candidate = match.group(1)
        if candidate in pc_actions.available_action_names():
            action_name = candidate
        raw_text = raw_text[: match.start()] + raw_text[match.end():]

    # Clean up any leftover or unclosed partial tags at the end of text
    raw_text = re.sub(r"\[\s*\w+\s*:.*?\]", "", raw_text)
    raw_text = re.sub(r"\[\s*(?:emotion|memory|action|task|timer|alarm).*?$", "", raw_text, flags=re.IGNORECASE)

    clean_text = raw_text.strip()
    if not clean_text or not re.search(r"[\w\u4e00-\u9fff]", clean_text):
        clean_text = "I'm right here with you! What's on your mind?"

    return clean_text, emotion, action_name, memory_facts, task_op, timer_op


def generate_reply(
    user_text: str,
    memory: MemoryManager,
    image_bytes: Optional[bytes] = None,
    image_mime: Optional[str] = None,
) -> dict:
    """Returns {"text", "emotion", "action", "action_result", "new_facts",
    "milestones", "affection"}. image_bytes/image_mime, if provided, is the
    latest screen or webcam frame — see server.py's screen_frame/
    webcam_frame handling. Silently ignored if the active provider/model
    doesn't support vision (see providers/registry.py)."""

    # Absence decay must be checked BEFORE this message updates
    # last_interaction_at, or every reply would look like "just talked".
    memory.apply_time_decay_if_needed()

    analysis = heuristics.analyze_message(user_text)
    impact = heuristics.calculate_message_impact(analysis, memory.state.affection)
    memory.apply_message_impact(impact)
    # Note: user turn is added to memory history AFTER provider.generate()
    # because provider.generate() takes history AND user_text separately,
    # and providers append user_text as the final turn. Adding it here
    # caused the prompt to contain the user's message twice.
    memory.resolve_tier_transition()

    provider = get_active_provider()
    caps = current_provider_capabilities()
    available_actions = pc_actions.available_action_names()

    system_prompt = build_system_prompt(
        memory,
        current_message=user_text,
        available_actions=available_actions,
        has_vision=caps["supports_vision"] and image_bytes is not None,
        has_search=caps["supports_search"],
    )

    raw_reply, usage = provider.generate(
        system_prompt, memory.get_recent_history(), user_text, image_bytes, image_mime,
    )
    reply_text, emotion, action_name, new_facts, task_op, timer_op = _split_tags(raw_reply)

    # She decides what's worth remembering (via the [memory: ...] tag) —
    # no cap, no auto-eviction; see MemoryManager.remember_fact/forget_fact.
    for fact in new_facts:
        memory.remember_fact(fact, emotion=emotion, context="conversation")

    action_result = None
    if action_name:
        action_result = pc_actions.execute_action(action_name)

    if usage:
        usage_tracker.add_gemini_usage(usage.get("input_tokens", 0), usage.get("output_tokens", 0))

    # Only persist genuine character dialogues to memory, never API failure or quota messages
    is_error_reply = any(
        reply_text.startswith(prefix)
        for prefix in (
            "Gemini error:",
            "Gemini Authentication Failed",
            "Gemini Quota Exceeded",
            "Gemini Model Unavailable",
            "Error:",
            "No GEMINI_API_KEY",
        )
    )
    if not is_error_reply:
        memory.add_turn("user", user_text)
        memory.add_turn("assistant", reply_text)
        milestones = memory.check_new_milestones()
        memory.save()
    else:
        milestones = []

    return {
        "text": reply_text,
        "emotion": emotion,
        "action": action_name,
        "action_result": action_result,
        "new_facts": new_facts,
        "task_op": task_op,
        "timer_op": timer_op,
        "milestones": milestones,
        "affection": memory.state.affection,
        "trust": memory.state.trust,
        "intimacy": memory.state.intimacy,
        "comfort": memory.state.comfort,
        "respect": memory.state.respect,
        "relationship_tier": memory.state.relationship_tier,
    }


def generate_diary_entry(memory: MemoryManager) -> str:
    """One-off call (separate from the normal reply flow, same active
    provider) that has her reflect on the recent conversation in her own
    voice, then saves it to memory.state.diary_entries. Triggered by the
    frontend's diary button, not automatically."""
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

    provider = get_active_provider()
    system_prompt = build_system_prompt(memory, current_message="")
    entry_text, usage = provider.generate(system_prompt, [], prompt)

    if usage:
        usage_tracker.add_gemini_usage(usage.get("input_tokens", 0), usage.get("output_tokens", 0))

    # Belt-and-suspenders: strip any tags that slip through even though the
    # prompt above asks her not to include them.
    entry_text, _, _, _, _, _ = _split_tags(entry_text)

    memory.add_diary_entry(entry_text)
    memory.save()
    return entry_text


def generate_proactive_thought(memory: MemoryManager, trigger_context: str = "inactivity") -> dict:
    """Generates an unprompted proactive message from the companion (e.g. idle check-in, alarm notification)."""
    provider = get_active_provider()
    system_prompt = build_system_prompt(memory, current_message="")

    if trigger_context == "inactivity":
        instruction = (
            "[SYSTEM NOTICE: The user has been quiet for a while. Initiate a short, casual conversation turn in your persona. "
            "Don't be needy or annoying; maybe tease them, ask what they're up to, or mention the time of day. "
            "Keep it 1 to 2 sentences max. Include [emotion: ...] tag.]"
        )
    else:
        instruction = (
            f"[SYSTEM EVENT: {trigger_context}. Comment on this naturally in your persona. "
            "Keep it brief and in character. Include [emotion: ...] tag.]"
        )

    history = memory.get_recent_history()
    reply_text, usage = provider.generate(system_prompt, history, instruction)
    if usage:
        usage_tracker.add_gemini_usage(usage.get("input_tokens", 0), usage.get("output_tokens", 0))

    clean_text, emotion, action_name, memory_facts, _, _ = _split_tags(reply_text)
    memory.add_turn("assistant", clean_text)
    memory.save()

    return {
        "text": clean_text,
        "emotion": emotion,
        "action": action_name,
        "affection": memory.state.affection,
        "trust": memory.state.trust,
        "intimacy": memory.state.intimacy,
        "comfort": memory.state.comfort,
        "respect": memory.state.respect,
        "relationship_tier": memory.state.relationship_tier,
    }

