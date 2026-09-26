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


def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        _whisper_model = WhisperModel(settings.whisper_model_size, compute_type="int8")
    return _whisper_model


def listen_and_transcribe(timeout: int = 8, phrase_time_limit: int = 15) -> str:
    """Blocks until the user speaks (or times out), applies VAD via
    pause_threshold/energy_threshold, and returns the transcribed text.
    Returns an empty string if nothing usable was captured."""
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
    import io
    import numpy as np
    import soundfile as sf

    wav_bytes = audio.get_wav_data()
    data, samplerate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
    if data.ndim > 1:
        data = np.mean(data, axis=1)

    model = _get_whisper_model()
    segments, _ = model.transcribe(data, language="en", vad_filter=True)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    print(f"[STT/whisper] Heard: {text}")
    return text


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
