"""
backend/stt_engine.py
Captures microphone audio with voice-activity detection and returns
a text transcript. Two selectable backends via STT_ENGINE in .env:

  "google"  -> speech_recognition's built-in free Google Web Speech API
               (needs internet, no API key required, good for prototyping)
  "whisper" -> faster-whisper running fully locally (offline, more setup)

Two entry points:
  listen_and_transcribe()   -> server opens the mic itself (legacy / good
                                 for a headless server-side test script).
  transcribe_wav_bytes()    -> transcribes a WAV clip the browser already
                                 recorded client-side via Silero VAD
                                 (see frontend/js/app.js). This is what the
                                 real-time app actually uses now — the
                                 browser decides when speech starts/stops
                                 (with barge-in support) and only ships us
                                 the finished clip, instead of the server
                                 blocking on its own mic loop per turn.
"""

import io
import speech_recognition as sr
from backend.config import settings

_recognizer = sr.Recognizer()
_recognizer.energy_threshold = settings.stt_energy_threshold
_recognizer.pause_threshold = settings.stt_pause_threshold
_recognizer.dynamic_energy_threshold = True

_whisper_model = None


def check_whisper_available() -> dict:
    """Checks if faster-whisper or openai-whisper is installed."""
    try:
        import faster_whisper
        return {"available": True, "engine": "faster-whisper", "error": None}
    except ImportError:
        pass
    try:
        import whisper
        return {"available": True, "engine": "openai-whisper", "error": None}
    except ImportError:
        return {
            "available": False,
            "engine": None,
            "error": "Neither faster-whisper nor openai-whisper is installed. Install via: pip install faster-whisper soundfile",
        }


def _get_whisper_model():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model

    model_size = getattr(settings, "whisper_model_size", "base") or "base"

    # Try faster-whisper first
    try:
        from faster_whisper import WhisperModel
        print(f"[STT] Loading faster-whisper model: {model_size} (int8/cpu)...")
        _whisper_model = ("faster-whisper", WhisperModel(model_size, device="cpu", compute_type="int8"))
        return _whisper_model
    except ImportError:
        pass
    except Exception as e:
        print(f"[STT] Failed to initialize faster-whisper ({model_size}): {e}")

    # Fallback to openai-whisper
    try:
        import whisper
        print(f"[STT] Loading openai-whisper model: {model_size}...")
        _whisper_model = ("openai-whisper", whisper.load_model(model_size))
        return _whisper_model
    except ImportError:
        pass
    except Exception as e:
        print(f"[STT] Failed to initialize openai-whisper ({model_size}): {e}")

    return None


def listen_and_transcribe(timeout: int = 8, phrase_time_limit: int = 15) -> str:
    """Blocks until the user speaks, applies VAD, and returns transcribed text."""
    try:
        with sr.Microphone() as source:
            _recognizer.adjust_for_ambient_noise(source, duration=0.6)
            print("[STT] Listening...")
            audio = _recognizer.listen(source, timeout=timeout, phrase_time_limit=phrase_time_limit)
    except sr.WaitTimeoutError:
        print("[STT] No speech detected before timeout.")
        return ""
    except OSError as e:
        print(f"[STT] No microphone available: {e}")
        return ""

    if settings.stt_engine == "whisper":
        return _transcribe_whisper(audio)
    return _transcribe_google(audio)


def _transcribe_google(audio: sr.AudioData) -> str:
    try:
        text = _recognizer.recognize_google(audio)
        print(f"[STT/google] Heard: {text}")
        return text
    except sr.UnknownValueError:
        print("[STT/google] Could not understand audio.")
        return ""
    except sr.RequestError as e:
        print(f"[STT/google] API request failed: {e}")
        return ""


def _transcribe_whisper(audio: sr.AudioData) -> str:
    backend_info = _get_whisper_model()
    if backend_info is None:
        print("[STT/whisper] Whisper unavailable. Falling back to Google Web Speech API.")
        return _transcribe_google(audio)

    engine_type, model = backend_info

    try:
        wav_bytes = audio.get_wav_data()
        if not wav_bytes:
            print("[STT/whisper] Audio buffer is empty.")
            return ""

        if engine_type == "faster-whisper":
            import numpy as np
            import soundfile as sf
            data, samplerate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
            if data.ndim > 1:
                data = np.mean(data, axis=1)
            segments, _ = model.transcribe(data, language="en", vad_filter=True)
            text = " ".join(segment.text.strip() for segment in segments).strip()
            print(f"[STT/faster-whisper] Heard: {text}")
            return text

        elif engine_type == "openai-whisper":
            import tempfile, os
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                f.write(wav_bytes)
                temp_path = f.name
            try:
                result = model.transcribe(temp_path, language="en")
                text = (result.get("text") or "").strip()
                print(f"[STT/openai-whisper] Heard: {text}")
                return text
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)

    except Exception as e:
        print(f"[STT/whisper] Transcription failed ({e}). Falling back to Google Speech.")
        return _transcribe_google(audio)

    return ""


def transcribe_wav_bytes(wav_bytes: bytes) -> str:
    """Transcribes a complete WAV clip (already speech-boundary-trimmed by
    the browser's client-side VAD) instead of opening the server's own mic.
    Returns an empty string on any decode/transcription failure."""
    if not wav_bytes:
        return ""
    try:
        with sr.AudioFile(io.BytesIO(wav_bytes)) as source:
            audio = _recognizer.record(source)
    except Exception as e:
        print(f"[STT] Could not read incoming WAV clip: {e}")
        return ""

    if settings.stt_engine == "whisper":
        return _transcribe_whisper(audio)
    return _transcribe_google(audio)
