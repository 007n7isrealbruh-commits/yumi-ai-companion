"""
backend/server.py
FastAPI app exposing a WebSocket endpoint at /ws plus a few small REST
endpoints for things that don't need to be part of the real-time turn
loop (settings, diary history, usage totals).

WebSocket protocol (JSON messages, audio/images as base64). Every message
in both directions carries a `request_id` for barge-in (see the class
docstring further down) — EXCEPT the fire-and-forget frame updates below,
which don't get a reply at all.

Client -> Server:
  {"type": "text_input", "text": "hello", "request_id": 3}
  {"type": "audio_data", "audio_base64": "<wav, b64>", "request_id": 4}
  {"type": "listen", "request_id": 5}                    # legacy server-mic path
  {"type": "screen_frame", "image_base64": "<jpeg, b64>"}  # no request_id — fire and forget
  {"type": "webcam_frame", "image_base64": "<jpeg, b64>"}  # same
  {"type": "write_diary", "request_id": 6}

Server -> Client:
  {"type": "status", "message": "...", "request_id": N}
  {"type": "transcript", "text": "...", "request_id": N}
  {"type": "reply", "text": "...", "emotion": "happy", "action": "open_browser"|null,
   "audio_base64": "...", "audio_format": "mp3", "affection": 12,
   "new_facts": [...], "milestones": [...], "request_id": N}
  {"type": "diary_entry", "text": "...", "request_id": N}
  {"type": "error", "message": "...", "request_id": N}
"""

import os
import re
import base64
import asyncio
from typing import Optional, Dict, Any, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.config import settings
from backend.memory_manager import MemoryManager
from backend.brain import generate_reply, generate_diary_entry, generate_proactive_thought
from backend.tts_engine import synthesize_speech, synthesize_speech_with_error, split_into_speech_chunks
from backend.stt_engine import listen_and_transcribe, transcribe_wav_bytes, check_whisper_available
from backend import usage_tracker
from backend import pc_actions
from backend.providers import registry as providers_registry
from backend.providers.factory import reset_provider_cache
from backend.task_manager import task_manager
from backend.timer_manager import timer_manager
from backend.environment_manager import get_current_time_context, get_weather_telemetry

app = FastAPI(title="AI Waifu Backend")

cors_allowed_raw = os.getenv("CORS_ALLOWED_ORIGINS", "").strip()
if cors_allowed_raw == "*":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # Restrict to local development origins and null (Electron local file protocol)
    explicit_origins = [o.strip() for o in cors_allowed_raw.split(",") if o.strip()] if cors_allowed_raw else [
        "http://localhost:5500", "http://127.0.0.1:5500",
        "http://localhost:8000", "http://127.0.0.1:8000",
        "null",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=explicit_origins,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

memory = MemoryManager()

_backfilled = memory.backfill_embeddings()
if _backfilled:
    memory.save()
    print(f"[MEMORY] Backfilled embeddings for {_backfilled} previously-unembedded fact(s).")

# Latest vision frame, held in memory only (never persisted) — whatever's
# freshest gets attached to the NEXT reply, then is not reused after that,
# so a stale frame from ten minutes ago never quietly gets re-sent.
_latest_frame: dict = {"bytes": None, "mime": None, "source": None}


@app.get("/health")
async def health():
    return {"status": "ok", "character": settings.character_name, "affection": memory.state.affection}


@app.get("/diary")
async def get_diary():
    return {"entries": memory.get_diary_entries()}


@app.get("/memory")
async def get_memory():
    return {"facts": memory.get_all_facts()}


class ForgetFactBody(BaseModel):
    fact: str


@app.delete("/memory")
async def delete_memory_fact(body: ForgetFactBody):
    removed = memory.forget_fact(body.fact)
    if removed:
        memory.save()
    return {"removed": removed}


@app.get("/usage")
async def get_usage():
    return usage_tracker.get_summary()


@app.get("/providers")
async def get_providers():
    """List of every LLM brain provider the settings UI can offer, with
    enough metadata (requires_api_key, is_local, supports_vision, example
    models) to build the picker without hardcoding provider details
    twice. See backend/providers/registry.py."""
    return {"providers": providers_registry.list_providers(), "active": settings.llm_provider}


class SettingsPatch(BaseModel):
    character_name: Optional[str] = None
    custom_personality: Optional[str] = None
    # TTS
    tts_provider: Optional[str] = None
    fish_audio_voice_id: Optional[str] = None
    fish_audio_model: Optional[str] = None
    fish_audio_api_key: Optional[str] = None
    elevenlabs_api_key: Optional[str] = None
    elevenlabs_voice_id: Optional[str] = None
    elevenlabs_model: Optional[str] = None
    # STT
    stt_engine: Optional[str] = None
    whisper_model_size: Optional[str] = None
    # Brain/LLM provider switching
    gemini_api_key: Optional[str] = None
    gemini_model: Optional[str] = None
    gemini_temperature: Optional[float] = None
    gemini_max_output_tokens: Optional[int] = None
    gemini_enable_search: Optional[bool] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    llm_base_url: Optional[str] = None
    llm_api_key: Optional[str] = None  # write-only — never returned by GET
    # Proactive & Hands-Free Interaction
    proactive_enabled: Optional[bool] = None
    proactive_idle_seconds: Optional[int] = None
    wake_word_enabled: Optional[bool] = None


class TaskCreateBody(BaseModel):
    title: str
    due: Optional[str] = None
    reminder_seconds: Optional[int] = None
    notes: Optional[str] = None


class TaskUpdateBody(BaseModel):
    title: Optional[str] = None
    due: Optional[str] = None
    notes: Optional[str] = None
    completed: Optional[bool] = None


class TimerCreateBody(BaseModel):
    seconds: Optional[int] = None
    time: Optional[str] = None
    label: str = "Timer"


class MemoryNodeCreateBody(BaseModel):
    text: str
    emotion: Optional[str] = "neutral"
    context: Optional[str] = "general"
    event: Optional[str] = "conversation"


@app.get("/settings")
async def get_settings():
    return {
        "character_name": settings.character_name,
        "custom_personality": getattr(memory.state, "custom_personality", ""),
        "is_onboarded": memory.is_onboarded(),
        "tts_provider": settings.tts_provider,
        "fish_audio_voice_id": settings.fish_audio_voice_id,
        "fish_audio_model": settings.fish_audio_model,
        "fish_audio_api_key_set": bool(settings.fish_audio_api_key),
        "elevenlabs_voice_id": settings.elevenlabs_voice_id,
        "elevenlabs_model": settings.elevenlabs_model,
        "elevenlabs_api_key_set": bool(settings.elevenlabs_api_key),
        "stt_engine": settings.stt_engine,
        "whisper_model_size": settings.whisper_model_size,
        "whisper_status": check_whisper_available(),
        "gemini_model": settings.gemini_model,
        "gemini_temperature": settings.gemini_temperature,
        "gemini_max_output_tokens": settings.gemini_max_output_tokens,
        "gemini_enable_search": settings.gemini_enable_search,
        "gemini_api_key_set": bool(settings.gemini_api_key),
        "available_actions": pc_actions.available_action_names(),
        "affection": memory.state.affection,
        "trust": memory.state.trust,
        "intimacy": memory.state.intimacy,
        "comfort": memory.state.comfort,
        "respect": memory.state.respect,
        "relationship_tier": memory.state.relationship_tier,
        "llm_provider": settings.llm_provider,
        "llm_model": settings.llm_model,
        "llm_base_url": settings.llm_base_url,
        "llm_api_key_set": bool(
            (settings.llm_api_key and settings.llm_api_key != "not-needed")
            or (settings.llm_provider == "gemini" and bool(settings.gemini_api_key))
        ),
        "proactive_enabled": getattr(settings, "proactive_enabled", True),
        "proactive_idle_seconds": getattr(settings, "proactive_idle_seconds", 120),
        "wake_word_enabled": getattr(settings, "wake_word_enabled", False),
    }


def _update_env_file(updates: dict):
    """Safely updates existing keys in .env without deleting unrelated settings or comments."""
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if not os.path.exists(env_path):
        env_path = ".env"
    try:
        lines = []
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        
        updated_keys = set()
        new_lines = []
        for line in lines:
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                k, _ = stripped.split("=", 1)
                k = k.strip()
                if k in updates:
                    new_lines.append(f"{k}={updates[k]}\n")
                    updated_keys.add(k)
                    continue
            new_lines.append(line)

        for k, v in updates.items():
            if k not in updated_keys:
                new_lines.append(f"{k}={v}\n")

        with open(env_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
    except Exception as e:
        print(f"[ENV_UPDATE] Could not write to .env: {e}")


@app.patch("/settings")
async def patch_settings(patch: SettingsPatch):
    """Updates user-facing settings at runtime with robust local vs cloud handling."""
    if patch.character_name is not None:
        name = patch.character_name.strip()
        settings.character_name = name
        memory.state.character_name = name
        memory.save()
    if patch.custom_personality is not None:
        memory.state.custom_personality = patch.custom_personality.strip()
        memory.save()

    # Voice / TTS
    if patch.tts_provider is not None:
        settings.tts_provider = patch.tts_provider.strip().lower()
    if patch.fish_audio_voice_id is not None:
        settings.fish_audio_voice_id = patch.fish_audio_voice_id
    if patch.fish_audio_model is not None:
        settings.fish_audio_model = patch.fish_audio_model
    if patch.fish_audio_api_key is not None and patch.fish_audio_api_key.strip():
        settings.fish_audio_api_key = patch.fish_audio_api_key.strip()
    if patch.elevenlabs_api_key is not None and patch.elevenlabs_api_key.strip():
        settings.elevenlabs_api_key = patch.elevenlabs_api_key.strip()
    if patch.elevenlabs_voice_id is not None:
        settings.elevenlabs_voice_id = patch.elevenlabs_voice_id
    if patch.elevenlabs_model is not None:
        settings.elevenlabs_model = patch.elevenlabs_model

    # STT
    if patch.stt_engine is not None:
        settings.stt_engine = patch.stt_engine.strip().lower()
    if patch.whisper_model_size is not None:
        settings.whisper_model_size = patch.whisper_model_size.strip().lower()

    # Brain / LLM
    if patch.gemini_api_key is not None and patch.gemini_api_key.strip():
        settings.gemini_api_key = patch.gemini_api_key.strip()
        settings.llm_api_key = patch.gemini_api_key.strip()
        os.environ["GEMINI_API_KEY"] = patch.gemini_api_key.strip()
    if patch.gemini_model is not None:
        settings.gemini_model = patch.gemini_model
    if patch.gemini_temperature is not None:
        settings.gemini_temperature = max(0.0, min(2.0, patch.gemini_temperature))
    if patch.gemini_max_output_tokens is not None:
        settings.gemini_max_output_tokens = max(50, min(2048, patch.gemini_max_output_tokens))
    if patch.gemini_enable_search is not None:
        settings.gemini_enable_search = patch.gemini_enable_search

    if patch.llm_provider is not None:
        provider_id = patch.llm_provider.strip().lower()
        info = providers_registry.get_provider_info(provider_id)
        if info is None:
            return {"status": "error", "message": f"Unknown provider '{provider_id}'"}

        if provider_id == "gemini":
            key_candidate = (
                (patch.gemini_api_key or "").strip()
                or (patch.llm_api_key or "").strip()
                or settings.gemini_api_key.strip()
                or os.environ.get("GEMINI_API_KEY", "").strip()
            )
            if not key_candidate:
                return {"status": "error", "message": "No GEMINI_API_KEY provided. Please supply an API key for Gemini."}
            settings.gemini_api_key = key_candidate
            settings.llm_api_key = key_candidate
            os.environ["GEMINI_API_KEY"] = key_candidate
            if patch.llm_model:
                settings.gemini_model = patch.llm_model.strip()
        elif info.is_local:
            # Local providers NEVER require an API key
            settings.llm_api_key = "not-needed"
        settings.llm_provider = provider_id

    if patch.llm_model is not None:
        settings.llm_model = patch.llm_model
        if settings.llm_provider == "gemini":
            settings.gemini_model = patch.llm_model
    if patch.llm_base_url is not None:
        settings.llm_base_url = patch.llm_base_url
    if patch.llm_api_key is not None and patch.llm_api_key.strip():
        settings.llm_api_key = patch.llm_api_key.strip()
        if settings.llm_provider == "gemini":
            settings.gemini_api_key = patch.llm_api_key.strip()
            os.environ["GEMINI_API_KEY"] = patch.llm_api_key.strip()

    # Proactive & Hands-Free Interaction
    if patch.proactive_enabled is not None:
        settings.proactive_enabled = patch.proactive_enabled
    if patch.proactive_idle_seconds is not None:
        settings.proactive_idle_seconds = max(30, min(1800, patch.proactive_idle_seconds))
    if patch.wake_word_enabled is not None:
        settings.wake_word_enabled = patch.wake_word_enabled

    # Persist critical keys and settings to .env file
    env_updates = {}
    if patch.character_name is not None:
        env_updates["CHARACTER_NAME"] = settings.character_name
    if patch.llm_provider is not None:
        env_updates["LLM_PROVIDER"] = settings.llm_provider
    if patch.llm_model is not None:
        env_updates["LLM_MODEL"] = settings.llm_model
    if patch.llm_base_url is not None:
        env_updates["LLM_BASE_URL"] = settings.llm_base_url
    if patch.llm_api_key is not None and patch.llm_api_key.strip():
        env_updates["LLM_API_KEY"] = settings.llm_api_key
    if patch.gemini_api_key is not None and patch.gemini_api_key.strip():
        env_updates["GEMINI_API_KEY"] = settings.gemini_api_key
    if patch.gemini_model is not None:
        env_updates["GEMINI_MODEL"] = settings.gemini_model
    if patch.tts_provider is not None:
        env_updates["TTS_PROVIDER"] = settings.tts_provider
    if patch.gemini_max_output_tokens is not None:
        env_updates["GEMINI_MAX_OUTPUT_TOKENS"] = str(settings.gemini_max_output_tokens)
    if patch.gemini_temperature is not None:
        env_updates["GEMINI_TEMPERATURE"] = str(settings.gemini_temperature)
    if patch.fish_audio_api_key is not None and patch.fish_audio_api_key.strip():
        env_updates["FISH_AUDIO_API_KEY"] = settings.fish_audio_api_key
    if patch.elevenlabs_api_key is not None and patch.elevenlabs_api_key.strip():
        env_updates["ELEVENLABS_API_KEY"] = settings.elevenlabs_api_key
    if env_updates:
        _update_env_file(env_updates)

    reset_provider_cache()
    return {"status": "ok"}


@app.post("/companion/nudge")
async def nudge_companion():
    """Manual trigger to solicit an immediate proactive thought from Yumi."""
    try:
        res = await asyncio.to_thread(generate_proactive_thought, memory, "user_nudged")
        audio_bytes = await asyncio.to_thread(synthesize_speech, res["text"])
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else ""
        return {
            "status": "ok",
            "text": res["text"],
            "emotion": res["emotion"],
            "action": res["action"],
            "audio_base64": audio_b64,
            "format": settings.fish_audio_format,
            "affection": res["affection"],
            "relationship_tier": res["relationship_tier"],
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ---------- Tasks API ----------

@app.get("/tasks")
async def get_tasks(filter: str = "all"):
    return {"tasks": task_manager.list_tasks(filter_status=filter)}


@app.post("/tasks")
async def create_task_endpoint(body: TaskCreateBody):
    task = task_manager.create_task(
        title=body.title, due=body.due, reminder_seconds=body.reminder_seconds, notes=body.notes
    )
    return {"status": "ok", "task": task}


@app.patch("/tasks/{task_id}")
async def patch_task_endpoint(task_id: str, body: TaskUpdateBody):
    if body.completed is True:
        task = task_manager.complete_task(task_id)
    else:
        task = task_manager.edit_task(task_id, title=body.title, due=body.due, notes=body.notes)
    if task:
        return {"status": "ok", "task": task}
    return {"status": "error", "message": "Task not found"}


@app.delete("/tasks/{task_id}")
async def delete_task_endpoint(task_id: str):
    removed = task_manager.remove_task(task_id)
    return {"status": "ok", "removed": removed}


# ---------- Timers & Alarms API ----------

@app.get("/timers")
async def get_timers_endpoint():
    return {"timers": timer_manager.list_all(), "active": timer_manager.list_active()}


@app.post("/timers")
async def create_timer_endpoint(body: TimerCreateBody):
    if body.time:
        item = timer_manager.set_alarm(body.time, label=body.label)
    else:
        item = timer_manager.set_timer(body.seconds or 300, label=body.label)
    return {"status": "ok", "item": item}


@app.delete("/timers/{identifier}")
async def delete_timer_endpoint(identifier: str):
    removed = timer_manager.cancel(identifier)
    return {"status": "ok", "removed": removed}


# ---------- Environment Telemetry ----------

@app.get("/environment")
async def get_environment_endpoint():
    return {
        "time": get_current_time_context(),
        "weather": get_weather_telemetry(),
    }


# ---------- Memory Graph & Portability ----------

@app.get("/memory/export")
async def export_memory_graph_endpoint():
    return memory.export_memory_graph()


@app.post("/memory/import")
async def import_memory_graph_endpoint(data: Dict[str, Any], merge: bool = True):
    try:
        res = memory.import_memory_graph(data, merge=merge)
        return res
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/memory/nodes")
async def get_memory_nodes_endpoint():
    return {"nodes": memory.get_all_memory_nodes()}


@app.post("/memory/node")
async def create_memory_node_endpoint(body: MemoryNodeCreateBody):
    memory.remember_fact(body.text, emotion=body.emotion or "neutral", context=body.context or "general", event=body.event or "manual")
    memory.save()
    return {"status": "ok", "nodes": memory.get_all_memory_nodes()}


@app.delete("/memory/node/{node_id}")
async def delete_memory_node_endpoint(node_id: str):
    removed = memory.delete_memory_node(node_id)
    return {"status": "ok", "removed": removed}


@app.post("/onboarding/complete")
async def complete_onboarding_endpoint():
    memory.set_onboarded(True)
    return {"status": "ok", "is_onboarded": True}


@app.get("/profile/export")
async def export_profile():
    """Exports full companion state, memories, relationship, and personality as JSON."""
    return memory.export_profile()


@app.post("/profile/import")
async def import_profile(data: Dict[str, Any]):
    """Imports and restores companion profile from a previously exported JSON backup."""
    try:
        memory.import_profile(data)
        settings.character_name = memory.state.character_name
        return {
            "status": "ok",
            "message": "Profile successfully imported",
            "character_name": memory.state.character_name,
            "custom_personality": memory.state.custom_personality,
            "affection": memory.state.affection,
            "trust": memory.state.trust,
            "intimacy": memory.state.intimacy,
            "comfort": memory.state.comfort,
            "respect": memory.state.respect,
            "relationship_tier": memory.state.relationship_tier,
            "interaction_count": memory.state.interaction_count,
            "history": memory.get_recent_history(),
            "facts": memory.get_all_facts(),
            "diary_entries": memory.get_diary_entries(),
        }
    except Exception as e:
        return {"status": "error", "message": f"Failed to import profile: {str(e)}"}


@app.post("/profile/reset")
async def reset_profile():
    """Resets companion to a fresh new companion state."""
    memory.reset_profile()
    settings.character_name = "Yumi"
    return {"status": "ok", "message": "Profile reset to default"}


class AddFactBody(BaseModel):
    fact: str


@app.post("/memory/fact")
async def add_memory_fact(body: AddFactBody):
    """Allows user to manually add a fact to memory from the UI."""
    text = body.fact.strip()
    if text:
        memory.add_custom_fact(text)
        return {"status": "ok", "fact": text, "facts": memory.get_all_facts()}
    return {"status": "error", "message": "Fact cannot be empty"}


@app.post("/history/clear")
async def clear_chat_history():
    """Clears conversation turns while preserving relationship stats and facts."""
    memory.clear_history()
    return {"status": "ok", "message": "Conversation history cleared"}


class TtsTestBody(BaseModel):
    text: str = "Hello! My voice is working properly."
    provider: Optional[str] = None
    api_key: Optional[str] = None
    voice_id: Optional[str] = None
    model: Optional[str] = None


@app.post("/tts/test")
async def test_tts(body: TtsTestBody):
    """Synthesizes a short test phrase and returns audio to test voice in UI with detailed errors."""
    audio_bytes, err = await asyncio.to_thread(
        synthesize_speech_with_error,
        body.text,
        provider=body.provider,
        custom_key=body.api_key or "",
        custom_voice_id=body.voice_id or "",
        custom_model=body.model or "",
    )
    if audio_bytes:
        # If test parameters were provided and verified, update active settings
        if body.provider:
            settings.tts_provider = body.provider.strip().lower()
        if body.api_key and body.api_key.strip():
            if (body.provider or settings.tts_provider) == "elevenlabs":
                settings.elevenlabs_api_key = body.api_key.strip()
            else:
                settings.fish_audio_api_key = body.api_key.strip()
        if body.voice_id is not None:
            if (body.provider or settings.tts_provider) == "elevenlabs":
                settings.elevenlabs_voice_id = body.voice_id.strip()
            else:
                settings.fish_audio_voice_id = body.voice_id.strip()
        if body.model:
            if (body.provider or settings.tts_provider) == "elevenlabs":
                settings.elevenlabs_model = body.model.strip()
            else:
                settings.fish_audio_model = body.model.strip()

        b64 = base64.b64encode(audio_bytes).decode("utf-8")
        return {"status": "ok", "audio_base64": b64, "format": "mp3"}

    error_msg = err or "TTS generation returned empty audio. Check API key and voice ID."
    return {"status": "error", "message": error_msg}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({
        "type": "status",
        "message": f"{settings.character_name} is online. Affection: {memory.state.affection}",
        "request_id": 0,
        "character_name": settings.character_name,
        "custom_personality": getattr(memory.state, "custom_personality", ""),
        "interaction_count": memory.state.interaction_count,
        "history": memory.get_recent_history(),
        "relationship_tier": memory.state.relationship_tier,
        "affection": memory.state.affection,
        "trust": memory.state.trust,
        "intimacy": memory.state.intimacy,
        "comfort": memory.state.comfort,
        "respect": memory.state.respect,
    })

    activity_state = [asyncio.get_event_loop().time()]
    bg_worker_task = asyncio.create_task(_run_background_checks(websocket, activity_state))
    current_turn_task: Optional[asyncio.Task] = None

    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")
            request_id = message.get("request_id", 0)
            activity_state[0] = asyncio.get_event_loop().time()

            # Fire-and-forget vision frame updates — no barge-in logic,
            # no reply, just refresh what's "currently visible" to her.
            if msg_type in ("screen_frame", "webcam_frame"):
                image_b64 = message.get("image_base64", "")
                try:
                    _latest_frame["bytes"] = base64.b64decode(image_b64) if image_b64 else None
                    _latest_frame["mime"] = "image/jpeg"
                    _latest_frame["source"] = msg_type
                except Exception:
                    pass
                continue

            # Barge-in: see server.py's original comment block (kept from
            # v1) — cancelling an in-flight turn when a new one arrives.
            if current_turn_task and not current_turn_task.done():
                current_turn_task.cancel()

            if msg_type in ("text_input", "text"):
                user_text = (message.get("text") or "").strip()
                if not user_text:
                    await websocket.send_json({"type": "error", "message": "Empty text_input received.", "request_id": request_id})
                    continue
                current_turn_task = asyncio.create_task(_handle_turn(websocket, user_text, request_id))

            elif msg_type == "audio_data":
                audio_b64_in = message.get("audio_base64", "")
                try:
                    wav_bytes = base64.b64decode(audio_b64_in) if audio_b64_in else b""
                except Exception:
                    wav_bytes = b""
                current_turn_task = asyncio.create_task(_handle_audio_turn(websocket, wav_bytes, request_id, activity_state))

            elif msg_type == "listen":
                await websocket.send_json({"type": "status", "message": "listening", "request_id": request_id})
                transcript = await asyncio.to_thread(listen_and_transcribe)
                if not transcript:
                    await websocket.send_json({"type": "error", "message": "No speech understood, try again.", "request_id": request_id})
                    continue
                await websocket.send_json({"type": "transcript", "text": transcript, "request_id": request_id})
                current_turn_task = asyncio.create_task(_handle_turn(websocket, transcript, request_id))

            elif msg_type == "write_diary":
                current_turn_task = asyncio.create_task(_handle_diary(websocket, request_id))

            elif msg_type == "interrupt":
                if current_turn_task and not current_turn_task.done():
                    current_turn_task.cancel()
                    print(f"[SERVER] Interrupted ongoing turn via client barge-in (request_id={request_id}).")

            elif msg_type == "nudge":
                current_turn_task = asyncio.create_task(_handle_nudge(websocket, request_id))

            else:
                await websocket.send_json({"type": "error", "message": f"Unknown message type: {msg_type}", "request_id": request_id})

    except WebSocketDisconnect:
        print("[SERVER] Client disconnected.")
        bg_worker_task.cancel()
        if current_turn_task and not current_turn_task.done():
            current_turn_task.cancel()
    finally:
        bg_worker_task.cancel()


async def _run_background_checks(websocket: WebSocket, activity_state: List[float]):
    """Background monitor checking expired timers, due task reminders, and triggering proactive messages."""
    last_proactive = asyncio.get_event_loop().time()
    try:
        while True:
            await asyncio.sleep(2.0)
            now = asyncio.get_event_loop().time()

            # 1. Check expired timers
            expired_timers = timer_manager.check_expired()
            for t in expired_timers:
                msg = f"Timer finished: {t.get('label', 'Timer')}!"
                audio_bytes = await asyncio.to_thread(synthesize_speech, f"Your timer for {t.get('label', 'timer')} is done!")
                audio_b64 = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else ""
                await websocket.send_json({
                    "type": "timer_expired",
                    "timer": t,
                    "text": msg,
                    "audio_base64": audio_b64,
                    "audio_format": settings.fish_audio_format,
                    "emotion": "surprised",
                })

            # 2. Check due task reminders
            due_tasks = task_manager.check_due_reminders()
            for task in due_tasks:
                msg = f"Reminder: {task.get('title', 'Task')}"
                audio_bytes = await asyncio.to_thread(synthesize_speech, f"Don't forget: {task.get('title', 'your task')}!")
                audio_b64 = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else ""
                await websocket.send_json({
                    "type": "task_reminder",
                    "task": task,
                    "text": msg,
                    "audio_base64": audio_b64,
                    "audio_format": settings.fish_audio_format,
                    "emotion": "happy",
                })

            # 3. Proactive companion messages after inactivity (Feature 2)
            last_act = activity_state[0]
            idle_thresh = getattr(settings, "proactive_idle_seconds", 120)
            is_proactive = getattr(settings, "proactive_enabled", True)
            if is_proactive and (now - last_act >= idle_thresh) and (now - last_proactive >= max(45, idle_thresh * 1.2)):
                last_proactive = now
                activity_state[0] = now
                try:
                    res = await asyncio.to_thread(generate_proactive_thought, memory, "inactivity")
                    audio_bytes = await asyncio.to_thread(synthesize_speech, res["text"])
                    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else ""
                    await websocket.send_json({
                        "type": "proactive_message",
                        "text": res["text"],
                        "emotion": res["emotion"],
                        "action": res["action"],
                        "audio_base64": audio_b64,
                        "audio_format": settings.fish_audio_format,
                        "affection": res["affection"],
                        "trust": res["trust"],
                        "intimacy": res["intimacy"],
                        "comfort": res["comfort"],
                        "respect": res["respect"],
                        "relationship_tier": res["relationship_tier"],
                    })
                except Exception as ex:
                    print(f"[SERVER] Proactive thought error: {ex}")

    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"[SERVER] Background worker error: {e}")


async def _handle_nudge(websocket: WebSocket, request_id: int) -> None:
    try:
        await websocket.send_json({"type": "status", "message": "thinking", "request_id": request_id})
        res = await asyncio.to_thread(generate_proactive_thought, memory, "user_nudged")
        audio_bytes = await asyncio.to_thread(synthesize_speech, res["text"])
        audio_b64 = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else ""
        await websocket.send_json({
            "type": "proactive_message",
            "text": res["text"],
            "emotion": res["emotion"],
            "action": res["action"],
            "audio_base64": audio_b64,
            "audio_format": settings.fish_audio_format,
            "affection": res["affection"],
            "trust": res["trust"],
            "intimacy": res["intimacy"],
            "comfort": res["comfort"],
            "respect": res["respect"],
            "relationship_tier": res["relationship_tier"],
            "request_id": request_id,
        })
    except Exception as ex:
        print(f"[SERVER] Error handling nudge: {ex}")


async def _handle_audio_turn(websocket: WebSocket, wav_bytes: bytes, request_id: int, activity_state: Optional[List[float]] = None) -> None:
    await websocket.send_json({"type": "status", "message": "transcribing", "request_id": request_id})
    transcript = await asyncio.to_thread(transcribe_wav_bytes, wav_bytes)
    if not transcript:
        await websocket.send_json({"type": "error", "message": "No speech understood, try again.", "request_id": request_id})
        return

    # Feature 3: Wake Word Activation filtering
    if getattr(settings, "wake_word_enabled", False):
        t_lower = transcript.lower().strip()
        char_name_lower = (settings.character_name or "yumi").lower()
        has_wake_word = (char_name_lower in t_lower) or ("hey" in t_lower) or (t_lower.startswith("yumi"))
        is_recent_convo = False
        if activity_state:
            is_recent_convo = (asyncio.get_event_loop().time() - activity_state[0] < 18.0)
        if not has_wake_word and not is_recent_convo:
            print(f"[WAKE_WORD] Ignored utterance '{transcript}' (wake word '{char_name_lower}' not detected).")
            await websocket.send_json({"type": "wake_word_ignored", "text": transcript, "request_id": request_id})
            return

    await websocket.send_json({"type": "transcript", "text": transcript, "request_id": request_id})
    await _handle_turn(websocket, transcript, request_id)


async def _handle_turn(websocket: WebSocket, user_text: str, request_id: int = 0) -> None:
    try:
        await websocket.send_json({"type": "status", "message": "thinking", "request_id": request_id})

        # Attach whatever the freshest vision frame is, then clear it — a
        # frame is context for the NEXT reply only, not a standing memory.
        frame_bytes, frame_mime = _latest_frame["bytes"], _latest_frame["mime"]
        _latest_frame["bytes"] = None

        result = await asyncio.to_thread(generate_reply, user_text, memory, frame_bytes, frame_mime)
        reply_text = result["text"]

        # 1. Send reply_start immediately: user gets text and caption with ZERO latency!
        await websocket.send_json({
            "type": "reply_start",
            "text": reply_text,
            "emotion": result["emotion"],
            "action": result["action"],
            "action_result": result["action_result"],
            "new_facts": result["new_facts"],
            "affection": result["affection"],
            "trust": result["trust"],
            "intimacy": result["intimacy"],
            "comfort": result["comfort"],
            "respect": result["respect"],
            "relationship_tier": result["relationship_tier"],
            "milestones": result["milestones"],
            "request_id": request_id,
        })

        provider = (settings.tts_provider or "fish_audio").lower().strip()
        first_audio_b64 = ""

        # 2. If TTS is active, chunk text into sentences and stream audio chunks
        if provider not in ("browser", "none", "off", "disabled"):
            chunks = split_into_speech_chunks(reply_text)
            chunks = [c for c in chunks if re.search(r"[\w\u4e00-\u9fff]", c)]
            if not chunks and reply_text.strip():
                if re.search(r"[\w\u4e00-\u9fff]", reply_text):
                    chunks = [reply_text.strip()]

            # Synthesize chunks (capped at 8 natural chunks for responsive streaming)
            chunks_to_speak = chunks[:8] if chunks else []
            for i, chunk in enumerate(chunks_to_speak):
                chunk_audio, tts_err = await asyncio.to_thread(synthesize_speech_with_error, chunk)
                if tts_err:
                    print(f"[TTS] Warning for chunk {i}: {tts_err}")
                if chunk_audio:
                    chunk_b64 = base64.b64encode(chunk_audio).decode("utf-8")
                    if not first_audio_b64:
                        first_audio_b64 = chunk_b64
                    await websocket.send_json({
                        "type": "audio_chunk",
                        "chunk_index": i,
                        "total_chunks": len(chunks_to_speak),
                        "text_chunk": chunk,
                        "audio_base64": chunk_b64,
                        "audio_format": settings.fish_audio_format,
                        "is_last": (i == len(chunks_to_speak) - 1),
                        "request_id": request_id,
                    })

        # 3. Also send standard reply message for full backwards-compatibility with tests/clients
        await websocket.send_json({
            "type": "reply",
            "text": reply_text,
            "emotion": result["emotion"],
            "action": result["action"],
            "action_result": result["action_result"],
            "new_facts": result["new_facts"],
            "audio_base64": first_audio_b64,
            "audio_format": settings.fish_audio_format,
            "affection": result["affection"],
            "trust": result["trust"],
            "intimacy": result["intimacy"],
            "comfort": result["comfort"],
            "respect": result["respect"],
            "relationship_tier": result["relationship_tier"],
            "milestones": result["milestones"],
            "request_id": request_id,
        })
    except asyncio.CancelledError:
        raise
    except Exception as e:
        print(f"[SERVER] Error in _handle_turn: {e}")
        await websocket.send_json({
            "type": "error",
            "message": f"Sorry, I had trouble thinking of a reply: {e}",
            "request_id": request_id,
        })


async def _handle_diary(websocket: WebSocket, request_id: int) -> None:
    try:
        await websocket.send_json({"type": "status", "message": "writing diary", "request_id": request_id})
        entry_text = await asyncio.to_thread(generate_diary_entry, memory)
        await websocket.send_json({"type": "diary_entry", "text": entry_text, "request_id": request_id})
        await websocket.send_json({"type": "status", "message": "idle", "request_id": request_id})
    except asyncio.CancelledError:
        raise
    except Exception as e:
        print(f"[SERVER] Error in _handle_diary: {e}")
        await websocket.send_json({
            "type": "error",
            "message": f"Could not write diary entry: {e}",
            "request_id": request_id,
        })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.server:app", host=settings.server_host, port=settings.server_port, reload=True)
