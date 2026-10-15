"""
backend/providers/gemini_provider.py
Native Gemini implementation (not the OpenAI-compat shim) — preserves live
web search, the thinking budget, vision, and semantic memory.

Dual-Engine Architecture:
- Uses google.genai SDK if installed.
- Automatically falls back to high-performance direct Gemini REST API if google.genai
  is not installed or during pip dependency setup, ensuring zero downtime and no
  "google-genai is not installed" blocking errors on mobile/Termux environments.
"""

from typing import List, Dict, Optional, Tuple
import base64
import re
import requests

try:
    from google.genai import types
except ImportError:
    types = None

from backend.config import settings
from backend.gemini_client import get_client

# Models in the 3.x family use thinking_level (LOW/MEDIUM/HIGH) instead of
# a raw token budget. Anything else (2.5-flash, 2.0-flash, etc.) uses
# thinking_budget. This keeps GEMINI_MODEL swappable in .env without the
# thinking config silently erroring out on a mismatched model family.
_THINKING_LEVEL_MODEL_PREFIXES = ("gemini-3", "gemini-3.5")


class GeminiProvider:
    supports_vision = True

    def _history_to_contents(self, history: List[Dict[str, str]]) -> list:
        contents = []
        for turn in history:
            role = "user" if turn.get("role") == "user" else "model"
            contents.append(types.Content(role=role, parts=[types.Part(text=turn.get("text", ""))]))
        return contents

    def _build_thinking_config(self) -> Optional[types.ThinkingConfig]:
        if not types or settings.gemini_thinking_budget == 0:
            return None
        if settings.gemini_model.startswith(_THINKING_LEVEL_MODEL_PREFIXES):
            level = (
                types.ThinkingLevel.HIGH
                if settings.gemini_thinking_budget < 0 or settings.gemini_thinking_budget > 512
                else types.ThinkingLevel.LOW
            )
            return types.ThinkingConfig(thinking_level=level)
        if settings.gemini_thinking_budget < 0:
            return types.ThinkingConfig()  # dynamic budget (model decides)
        return types.ThinkingConfig(thinking_budget=settings.gemini_thinking_budget)

    def _build_tools(self) -> Optional[list]:
        if types and settings.gemini_enable_search:
            return [types.Tool(google_search=types.GoogleSearch())]
        return None

    def _extract_usage(self, response) -> Optional[dict]:
        meta = getattr(response, "usage_metadata", None)
        if not meta:
            return None
        return {
            "input_tokens": getattr(meta, "prompt_token_count", 0) or 0,
            "output_tokens": getattr(meta, "candidates_token_count", 0) or 0,
        }

    def _generate_via_rest(
        self,
        system_prompt: str,
        history: List[Dict[str, str]],
        user_text: str,
        image_bytes: Optional[bytes] = None,
        image_mime: Optional[str] = None,
    ) -> Tuple[str, Optional[dict]]:
        """Direct Google Gemini REST implementation requiring zero external SDKs."""
        key = settings.gemini_api_key.strip()
        if not key:
            return "No GEMINI_API_KEY is configured. Please enter your API key in Settings.", None

        contents = []
        for turn in history:
            role = "user" if turn.get("role") == "user" else "model"
            contents.append({"role": role, "parts": [{"text": turn.get("text", "")}]})

        user_parts = []
        if image_bytes and image_mime:
            user_parts.append({
                "inline_data": {
                    "mime_type": image_mime,
                    "data": base64.b64encode(image_bytes).decode("utf-8"),
                }
            })
        user_parts.append({"text": user_text})
        contents.append({"role": "user", "parts": user_parts})

        models_to_try = []
        if settings.gemini_model and settings.gemini_model.strip():
            models_to_try.append(settings.gemini_model.strip())
        if settings.gemini_fallback_model and settings.gemini_fallback_model.strip() not in models_to_try:
            models_to_try.append(settings.gemini_fallback_model.strip())
        for std_fallback in [
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash-lite",
            "gemini-2.5-pro",
            "gemini-3.5-flash",
            "gemini-3.6-flash",
            "gemini-3.8-flash",
        ]:
            if std_fallback not in models_to_try:
                models_to_try.append(std_fallback)

        last_error = None
        had_quota_429 = False
        had_auth_error = False
        attempted = set()

        while models_to_try:
            model = models_to_try.pop(0)
            if model in attempted:
                continue
            attempted.add(model)

            # Build model-specific generationConfig
            gen_config = {
                "temperature": settings.gemini_temperature,
                "maxOutputTokens": settings.gemini_max_output_tokens,
            }
            if settings.gemini_thinking_budget != 0:
                if model.startswith(_THINKING_LEVEL_MODEL_PREFIXES):
                    level = (
                        "HIGH"
                        if settings.gemini_thinking_budget < 0 or settings.gemini_thinking_budget > 512
                        else "LOW"
                    )
                    gen_config["thinkingConfig"] = {"thinkingLevel": level}
                elif model.startswith(("gemini-2.0-flash-thinking", "gemini-2.5-flash")) and settings.gemini_thinking_budget > 0:
                    gen_config["thinkingConfig"] = {"thinkingBudget": settings.gemini_thinking_budget}

            payload = {
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": contents,
                "generationConfig": gen_config,
            }
            if settings.gemini_enable_search and not model.startswith("gemini-1.5-flash-8b"):
                payload["tools"] = [{"googleSearch": {}}]

            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
            try:
                resp = requests.post(url, json=payload, timeout=60)
                data = resp.json()
                if resp.status_code == 200:
                    text_parts = []
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for p in parts:
                            if "text" in p:
                                text_parts.append(p["text"])
                    full_text = "".join(text_parts).strip()
                    usage = None
                    meta = data.get("usageMetadata")
                    if meta:
                        usage = {
                            "input_tokens": meta.get("promptTokenCount", 0) or 0,
                            "output_tokens": meta.get("candidatesTokenCount", 0) or 0,
                        }
                    # Update active settings so subsequent calls use the working model directly
                    settings.gemini_model = model
                    try:
                        from backend.server import _update_env_file
                        _update_env_file({"GEMINI_MODEL": model})
                    except Exception:
                        pass
                    return full_text or "...", usage
                else:
                    err_msg = data.get("error", {}).get("message", f"HTTP {resp.status_code}")
                    print(f"[GEMINI/REST] Model '{model}' error {resp.status_code}: {err_msg}")
                    last_error = err_msg

                    if resp.status_code == 429 or "RESOURCE_EXHAUSTED" in err_msg or "quota" in err_msg.lower():
                        had_quota_429 = True
                    elif resp.status_code in (401, 403) or "API_KEY_INVALID" in err_msg or "API key not valid" in err_msg:
                        had_auth_error = True
                        break

                    # If Google suggests a newer model in the error message, auto-enqueue it
                    for rec_model in re.findall(r"models/([a-zA-Z0-9.-]+)", err_msg):
                        if rec_model != model and rec_model not in attempted and rec_model not in models_to_try:
                            print(f"[GEMINI/REST] Auto-detected recommended model from API: {rec_model}")
                            models_to_try.insert(0, rec_model)
            except Exception as e:
                print(f"[GEMINI/REST] Model '{model}' request failed: {e}")
                last_error = str(e)

        if had_auth_error:
            return "Gemini Authentication Failed: Invalid API Key. Please verify your key at aistudio.google.com.", None
        if had_quota_429:
            return (
                "Google AI Studio Quota Limit (HTTP 429): Google's free-tier rate limit has been reached on this project. "
                "In Google AI Studio, free accounts have rolling rate limits (15 requests/min) or zero quota for unbilled models. "
                "Please wait 1 minute for the rolling window to reset, or switch to NVIDIA NIM or Local/Offline in Settings.",
                None,
            )
        return f"Gemini error: {last_error or 'Could not reach Gemini service'}", None

    def generate(
        self,
        system_prompt: str,
        history: List[Dict[str, str]],
        user_text: str,
        image_bytes: Optional[bytes] = None,
        image_mime: Optional[str] = None,
    ) -> Tuple[str, Optional[dict]]:
        # If google.genai SDK is available, try SDK first
        if types is not None:
            try:
                contents = self._history_to_contents(history)

                user_parts = [types.Part(text=user_text)]
                if image_bytes and image_mime:
                    user_parts.append(types.Part.from_bytes(data=image_bytes, mime_type=image_mime))
                contents.append(types.Content(role="user", parts=user_parts))

                config = types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    max_output_tokens=settings.gemini_max_output_tokens,
                    temperature=settings.gemini_temperature,
                    thinking_config=self._build_thinking_config(),
                    tools=self._build_tools(),
                )

                response = get_client().models.generate_content(
                    model=settings.gemini_model, contents=contents, config=config,
                )
                return (response.text or "").strip() or "...", self._extract_usage(response)
            except Exception as sdk_err:
                print(f"[GEMINI] SDK generate failed ({sdk_err}), trying REST fallback...")

        # Native REST fallback (requires no SDK)
        return self._generate_via_rest(
            system_prompt=system_prompt,
            history=history,
            user_text=user_text,
            image_bytes=image_bytes,
            image_mime=image_mime,
        )
