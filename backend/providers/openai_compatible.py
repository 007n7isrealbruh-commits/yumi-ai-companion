"""
backend/providers/openai_compatible.py

One implementation for every OpenAI-compatible "brain" provider: OpenAI,
Groq, NVIDIA NIM, DeepSeek, xAI, Ollama, LM Studio, and "custom". Only the
base_url/api_key/model differ between them — see registry.py.

Dual Engine Architecture:
- Uses direct HTTP requests (requires zero external SDK packages like openai)
- Seamlessly falls back to openai SDK if already installed
- Works out of the box with NVIDIA NIM, Groq, DeepSeek, Ollama, LM Studio, etc.
"""

from typing import List, Dict, Optional, Tuple
import base64
import requests

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

from backend.config import settings


class OpenAICompatibleProvider:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        supports_vision: bool = False,
        provider_id: str = "custom",
    ):
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = (api_key or "").strip()
        self.model = model.strip() if model else ""
        self.supports_vision = supports_vision
        self.provider_id = (provider_id or "custom").lower().strip()
        self.client = None
        if OpenAI is not None:
            try:
                self.client = OpenAI(base_url=self.base_url, api_key=self.api_key or "not-needed")
            except Exception:
                self.client = None

    def _build_messages(
        self,
        system_prompt: str,
        history: List[Dict[str, str]],
        user_text: str,
        image_bytes: Optional[bytes],
        image_mime: Optional[str],
    ) -> list:
        messages = [{"role": "system", "content": system_prompt}]
        for turn in history:
            role = "user" if turn["role"] == "user" else "assistant"
            messages.append({"role": role, "content": turn["text"]})

        if image_bytes and image_mime and self.supports_vision:
            b64 = base64.b64encode(image_bytes).decode("utf-8")
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {"type": "image_url", "image_url": {"url": f"data:{image_mime};base64,{b64}"}},
                ],
            })
        else:
            messages.append({"role": "user", "content": user_text})

        return messages

    def _generate_via_rest(self, messages: list) -> Tuple[str, Optional[dict]]:
        """Direct REST caller for OpenAI-compatible endpoints: NVIDIA, Groq, OpenAI, DeepSeek, xAI, OpenRouter, Ollama, LM Studio, etc."""
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "AI-Waifu-App/1.0",
        }
        # Provider-specific headers
        if self.provider_id == "openrouter":
            headers["HTTP-Referer"] = "https://ai-waifu.app"
            headers["X-Title"] = "AI Waifu App"

        # Only send authorization if key is non-empty and not a placeholder
        if self.api_key and self.api_key not in ("not-needed", "none"):
            headers["Authorization"] = f"Bearer {self.api_key}"

        max_tokens = getattr(settings, "gemini_max_output_tokens", 512) or 512
        max_tokens = max(100, min(max_tokens, 2048))
        temperature = getattr(settings, "gemini_temperature", 0.7) if hasattr(settings, "gemini_temperature") else 0.7

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=60)
            if resp.status_code == 200:
                data = resp.json()
                choices = data.get("choices", [])
                text = ""
                if choices:
                    msg = choices[0].get("message", {})
                    text = (msg.get("content") or "").strip()
                    if not text and "reasoning_content" in msg:
                        text = (msg.get("reasoning_content") or "").strip()
                usage_raw = data.get("usage")
                usage = None
                if usage_raw:
                    usage = {
                        "input_tokens": usage_raw.get("prompt_tokens", 0) or 0,
                        "output_tokens": usage_raw.get("completion_tokens", 0) or 0,
                    }
                return text or "...", usage

            # Extract detailed error message
            try:
                err_json = resp.json()
                err_msg = (
                    err_json.get("error", {}).get("message")
                    or err_json.get("error")
                    or err_json.get("message")
                    or str(err_json)
                )
            except Exception:
                err_msg = resp.text[:300] or f"HTTP {resp.status_code}"

            print(f"[{self.provider_id.upper()}] Error HTTP {resp.status_code} from {self.model}: {err_msg}")

            # Auto-healing 1: NVIDIA NIM retired/unavailable models (e.g. 410 Gone / 404 Not Found)
            if resp.status_code in (404, 410) and (self.provider_id == "nvidia" or "nvidia.com" in self.base_url):
                for fb in ["meta/llama-3.2-11b-vision-instruct", "meta/llama-3.2-90b-vision-instruct"]:
                    if fb != self.model:
                        print(f"[NVIDIA] Auto-switching from '{self.model}' to active model '{fb}'...")
                        self.model = fb
                        settings.llm_model = fb
                        try:
                            from backend.server import _update_env_file
                            _update_env_file({"LLM_MODEL": fb})
                        except Exception:
                            pass
                        payload["model"] = fb
                        try:
                            retry_resp = requests.post(url, json=payload, headers=headers, timeout=60)
                            if retry_resp.status_code == 200:
                                retry_data = retry_resp.json()
                                choices = retry_data.get("choices", [])
                                if choices:
                                    text = (choices[0].get("message", {}).get("content") or "").strip()
                                    return text or "...", None
                        except Exception as e:
                            print(f"[NVIDIA] Retry with fallback '{fb}' failed: {e}")

            # Auto-healing 2: Groq rate limit (429 TPM) on 70B -> fallback to instant 8B
            if resp.status_code == 429 and (self.provider_id == "groq" or "groq.com" in self.base_url):
                if self.model != "llama-3.1-8b-instant":
                    fb = "llama-3.1-8b-instant"
                    print(f"[GROQ] Rate limit on '{self.model}', auto-fallback to high-throughput '{fb}'...")
                    self.model = fb
                    settings.llm_model = fb
                    payload["model"] = fb
                    try:
                        retry_resp = requests.post(url, json=payload, headers=headers, timeout=60)
                        if retry_resp.status_code == 200:
                            retry_data = retry_resp.json()
                            choices = retry_data.get("choices", [])
                            if choices:
                                text = (choices[0].get("message", {}).get("content") or "").strip()
                                return text or "...", None
                    except Exception as e:
                        print(f"[GROQ] Retry with fallback '{fb}' failed: {e}")

            # Auto-healing 3: OpenAI quota/rate limit on gpt-4o -> fallback to gpt-4o-mini
            if resp.status_code in (404, 429) and (self.provider_id == "openai" or "openai.com" in self.base_url):
                if self.model != "gpt-4o-mini":
                    fb = "gpt-4o-mini"
                    print(f"[OPENAI] Switching from '{self.model}' to efficient '{fb}'...")
                    self.model = fb
                    settings.llm_model = fb
                    payload["model"] = fb
                    try:
                        retry_resp = requests.post(url, json=payload, headers=headers, timeout=60)
                        if retry_resp.status_code == 200:
                            retry_data = retry_resp.json()
                            choices = retry_data.get("choices", [])
                            if choices:
                                text = (choices[0].get("message", {}).get("content") or "").strip()
                                return text or "...", None
                    except Exception as e:
                        print(f"[OPENAI] Retry with fallback '{fb}' failed: {e}")

            if resp.status_code in (401, 403):
                return (
                    f"Authentication Failed (HTTP {resp.status_code}): Invalid API key for {self.provider_id.upper()} ({self.model}). "
                    "Please check your API key in Settings.",
                    None,
                )
            if resp.status_code == 410:
                return (
                    f"Model Retired (HTTP 410): '{self.model}' reached end-of-life on {self.provider_id.upper()}. "
                    "Please select an updated active model in Settings.",
                    None,
                )
            if resp.status_code == 404:
                return (
                    f"Model Not Found (HTTP 404): '{self.model}' is not available at {self.base_url}. "
                    "Please verify the model name in Settings.",
                    None,
                )
            if resp.status_code == 429:
                return (
                    f"Rate Limit / Quota Exceeded (HTTP 429): Provider rate limit reached for {self.model}. "
                    "Please wait a moment or try another model in Settings.",
                    None,
                )
            if resp.status_code == 422:
                return (
                    f"Request Error (HTTP 422): {err_msg}. "
                    f"Verify model parameters for '{self.model}'.",
                    None,
                )

            return f"Provider Error (HTTP {resp.status_code}): {err_msg}", None

        except requests.exceptions.Timeout:
            return f"Request timed out reaching {self.model} at {self.base_url}. Please check your connection.", None
        except requests.exceptions.ConnectionError:
            if self.provider_id == "ollama":
                return f"Ollama connection refused at {self.base_url}. Make sure Ollama is running (`ollama serve`).", None
            elif self.provider_id == "lmstudio":
                return f"LM Studio connection refused at {self.base_url}. Start LM Studio and turn on the Local Server.", None
            elif self.provider_id == "koboldcpp":
                return f"KoboldCPP connection refused at {self.base_url}. Make sure KoboldCPP is running on port 5001.", None
            elif self.provider_id == "vllm":
                return f"vLLM connection refused at {self.base_url}. Make sure your vLLM server is running.", None
            return f"Could not connect to {self.model} at {self.base_url}. Please verify the server address.", None
        except Exception as e:
            print(f"[{self.provider_id.upper()}] Request to '{self.model}' at {url} failed: {e}")
            return f"Failed connecting to {self.model}: {e}", None

    def generate(
        self,
        system_prompt: str,
        history: List[Dict[str, str]],
        user_text: str,
        image_bytes: Optional[bytes] = None,
        image_mime: Optional[str] = None,
    ) -> Tuple[str, Optional[dict]]:
        if not self.model:
            return "No model configured. Please enter a model name in Settings.", None

        messages = self._build_messages(system_prompt, history, user_text, image_bytes, image_mime)

        max_tokens = getattr(settings, "gemini_max_output_tokens", 512) or 512
        max_tokens = max(100, min(max_tokens, 2048))
        temperature = getattr(settings, "gemini_temperature", 0.7) if hasattr(settings, "gemini_temperature") else 0.7

        # Try official SDK first if installed
        if self.client is not None:
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                msg = response.choices[0].message
                text = (msg.content or "").strip()
                if not text and hasattr(msg, "reasoning_content"):
                    text = (getattr(msg, "reasoning_content") or "").strip()
                text = text or "..."
                usage = None
                if response.usage:
                    usage = {
                        "input_tokens": response.usage.prompt_tokens or 0,
                        "output_tokens": response.usage.completion_tokens or 0,
                    }
                return text, usage
            except Exception as sdk_err:
                print(f"[{self.provider_id.upper()}] SDK call failed ({sdk_err}), trying direct REST...")

        # Native REST fallback (zero external packages required)
        return self._generate_via_rest(messages)
