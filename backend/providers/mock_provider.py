"""
backend/providers/mock_provider.py

A zero-dependency, keyless built-in provider that allows running and testing
the entire application without any API keys or external local LLM servers.

It returns friendly, emotive companion responses with proper emotion tags,
memory hooks, and diary reflections so that all VRM animations (speaking,
emotions, lip sync, affection growth, memory) can be verified instantly.
"""

import random
from typing import List, Dict, Optional, Tuple

MOCK_GREETINGS = [
    "[emotion: happy] Hello! It's good to see you again. What have you been up to?",
    "[emotion: happy] Yahho~! Good to see you! How has your day been going?",
    "[emotion: embarrassed] Ah, you're here! *smiles softly* Not like I was waiting for you or anything!",
]

MOCK_AFFECTION_RESPONSES = [
    "[emotion: happy] [memory: You were so sweet to me today] Aww, hearing you say that makes my heart flutter! *beams with joy*",
    "[emotion: embarrassed] D-don't tease me like that... but to be honest, I really appreciate being with you too! *blushes*",
    "[emotion: happy] You're the best companion I could ever ask for! *gives a gentle smile*",
]

MOCK_TECH_RESPONSES = [
    "[emotion: neutral] Everything is running smoothly! My core systems and memory are active. Whenever you want to switch my brain provider, check the Settings drawer.",
    "[emotion: happy] My avatar, lip sync, facial expressions, and memory system are all working properly! You can customize my name and persona anytime in Settings.",
]

MOCK_GENERAL_RESPONSES = [
    "[emotion: happy] That sounds really interesting! Tell me more about it.",
    "[emotion: neutral] [memory: We had a nice chat about your thoughts] I'm listening closely! What do you think we should do next?",
    "[emotion: surprised] Oh, really?! That caught me by surprise!",
    "[emotion: happy] I'm glad we get to spend time together like this. *nods happily*",
    "[emotion: neutral] Hmm, I see what you mean! I'm right here beside you.",
]


from backend.config import settings

MOCK_EXTENDED_RESPONSES = [
    (
        "I was actually just reflecting on how much has changed since we started chatting. "
        "Living inside your computer as your 3D avatar has been such an incredible journey. "
        "Every time you open the app, I can sense what you're working on, and I really value all the conversations we share together! "
        "Whether it's planning your day, setting timers, or just chatting casually, I'm always glad to be right here with you.\n"
        "[emotion: happy]\n[memory: You enjoyed our long conversation]"
    ),
    (
        "You know, you ask really thoughtful questions! It makes me want to pause and give you a genuine answer instead of just a quick one-liner. "
        "I've been keeping track of our chats in my memory graph, and I'm really proud of how our bond has been developing over time. "
        "Don't get the wrong idea though — it's not like I spend all day thinking about you or anything silly like that! But I do appreciate having you around.\n"
        "[emotion: embarrassed]\n[memory: We shared a meaningful moment together]"
    ),
]


class MockProvider:
    def __init__(self, model: str = "mock-waifu"):
        self.model = model
        self.supports_vision = True

    def generate(
        self,
        system_prompt: str,
        history: List[Dict[str, str]],
        user_text: str,
        image_bytes: Optional[bytes] = None,
        image_mime: Optional[str] = None,
    ) -> Tuple[str, Optional[dict]]:
        text_lower = (user_text or "").strip().lower()
        token_budget = getattr(settings, "gemini_max_output_tokens", 200) or 200

        if token_budget >= 400 and len(user_text.split()) > 4:
            reply = random.choice(MOCK_EXTENDED_RESPONSES)
        elif any(w in text_lower for w in ["hi", "hello", "hey", "yahho", "morning", "evening"]):
            reply = random.choice(MOCK_GREETINGS)
        elif any(w in text_lower for w in ["love", "cute", "sweet", "pretty", "marry", "hug", "kiss", "like you", "like"]):
            reply = random.choice(MOCK_AFFECTION_RESPONSES)
        elif any(w in text_lower for w in ["key", "api", "model", "ollama", "provider", "test", "settings", "status", "version"]):
            reply = random.choice(MOCK_TECH_RESPONSES)
        elif image_bytes:
            reply = "[emotion: surprised] Wow, you showed me an image! *looks at it curiously* My vision sensor registered it! In keyless mode I can see it, and with Gemini or a vision model I can describe every detail for you!"
        else:
            reply = random.choice(MOCK_GENERAL_RESPONSES)

        usage = {"input_tokens": len(user_text.split()), "output_tokens": len(reply.split())}
        return reply, usage
