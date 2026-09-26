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

import base64
import asyncio
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.config import settings
from backend.memory_manager import MemoryManager
from backend.gemini_engine import generate_reply, generate_diary_entry
from backend.tts_engine import synthesize_speech
from backend.stt_engine import listen_and_transcribe, transcribe_wav_bytes
from backend import usage_tracker
from backend import pc_actions

app = FastAPI(title="AI Waifu Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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


class SettingsPatch(BaseModel):
    character_name: Optional[str] = None
    fish_audio_voice_id: Optional[str] = None
    fish_audio_model: Optional[str] = None
    gemini_model: Optional[str] = None


@app.get("/settings")
async def get_settings():
    return {
        "character_name": settings.character_name,
        "fish_audio_voice_id": settings.fish_audio_voice_id,
        "fish_audio_model": settings.fish_audio_model,
        "gemini_model": settings.gemini_model,
        "available_actions": pc_actions.available_action_names(),
    }


@app.patch("/settings")
async def patch_settings(patch: SettingsPatch):
    """Updates a few user-facing settings at runtime — no server restart
    needed. NOTE: this only changes the running process's in-memory
    settings; it does NOT rewrite your .env file, so a restart reverts to
    whatever's still in .env unless you also update it there."""
    if patch.character_name is not None:
        settings.character_name = patch.character_name
    if patch.fish_audio_voice_id is not None:
        settings.fish_audio_voice_id = patch.fish_audio_voice_id
    if patch.fish_audio_model is not None:
        settings.fish_audio_model = patch.fish_audio_model
    if patch.gemini_model is not None:
        settings.gemini_model = patch.gemini_model
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({
        "type": "status",
        "message": f"{settings.character_name} is online. Affection: {memory.state.affection}",
        "request_id": 0,
    })

    current_turn_task: Optional[asyncio.Task] = None

    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")
            request_id = message.get("request_id", 0)

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

            if msg_type == "text_input":
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
                current_turn_task = asyncio.create_task(_handle_audio_turn(websocket, wav_bytes, request_id))

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

            else:
                await websocket.send_json({"type": "error", "message": f"Unknown message type: {msg_type}", "request_id": request_id})

    except WebSocketDisconnect:
        print("[SERVER] Client disconnected.")
        if current_turn_task and not current_turn_task.done():
            current_turn_task.cancel()


async def _handle_audio_turn(websocket: WebSocket, wav_bytes: bytes, request_id: int) -> None:
    await websocket.send_json({"type": "status", "message": "transcribing", "request_id": request_id})
    transcript = await asyncio.to_thread(transcribe_wav_bytes, wav_bytes)
    if not transcript:
        await websocket.send_json({"type": "error", "message": "No speech understood, try again.", "request_id": request_id})
        return
    await websocket.send_json({"type": "transcript", "text": transcript, "request_id": request_id})
    await _handle_turn(websocket, transcript, request_id)


async def _handle_turn(websocket: WebSocket, user_text: str, request_id: int = 0) -> None:
    await websocket.send_json({"type": "status", "message": "thinking", "request_id": request_id})

    # Attach whatever the freshest vision frame is, then clear it — a
    # frame is context for the NEXT reply only, not a standing memory.
    frame_bytes, frame_mime = _latest_frame["bytes"], _latest_frame["mime"]
    _latest_frame["bytes"] = None

    result = await asyncio.to_thread(generate_reply, user_text, memory, frame_bytes, frame_mime)
    reply_text = result["text"]

    await websocket.send_json({"type": "status", "message": "synthesizing_voice", "request_id": request_id})
    audio_bytes = await asyncio.to_thread(synthesize_speech, reply_text)
    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else ""

    await websocket.send_json({
        "type": "reply",
        "text": reply_text,
        "emotion": result["emotion"],
        "action": result["action"],
        "action_result": result["action_result"],
        "new_facts": result["new_facts"],
        "audio_base64": audio_b64,
        "audio_format": settings.fish_audio_format,
        "affection": result["affection"],
        "milestones": result["milestones"],
        "request_id": request_id,
    })


async def _handle_diary(websocket: WebSocket, request_id: int) -> None:
    await websocket.send_json({"type": "status", "message": "writing diary", "request_id": request_id})
    entry_text = await asyncio.to_thread(generate_diary_entry, memory)
    await websocket.send_json({"type": "diary_entry", "text": entry_text, "request_id": request_id})
    await websocket.send_json({"type": "status", "message": "idle", "request_id": request_id})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.server:app", host=settings.server_host, port=settings.server_port, reload=True)
