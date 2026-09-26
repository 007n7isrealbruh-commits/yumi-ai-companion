"""
backend/persona_loader.py
Loads backend/persona_examples.yaml and hands build_system_prompt() a
small, tier-appropriate slice of few-shot examples — not the whole file
every turn (that would bloat every prompt for no benefit once you've
added a lot of examples).

Loaded once and cached; if you edit the YAML while the server's running,
call reload() (or just restart) to pick up the change.
"""

import os
import random
from typing import Dict, List, Optional

try:
    import yaml
except ImportError:
    yaml = None

_YAML_PATH = os.path.join(os.path.dirname(__file__), "persona_examples.yaml")
_cache: Optional[Dict[str, List[dict]]] = None


def _load() -> Dict[str, List[dict]]:
    global _cache
    if _cache is not None:
        return _cache

    if yaml is None:
        print("[PERSONA] PyYAML isn't installed — few-shot examples are disabled. "
              "Run: pip install PyYAML")
        _cache = {}
        return _cache

    if not os.path.exists(_YAML_PATH):
        print(f"[PERSONA] {_YAML_PATH} not found — few-shot examples are disabled.")
        _cache = {}
        return _cache

    try:
        with open(_YAML_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        _cache = data
    except Exception as e:
        print(f"[PERSONA] Failed to parse {_YAML_PATH}: {e}")
        _cache = {}

    return _cache


def reload() -> None:
    global _cache
    _cache = None
    _load()


def get_examples_for_tier(tier_name: str, count: int = 3) -> List[dict]:
    """Returns up to `count` {situation, user, yumi} examples for the given
    tier, picked to cover a spread of situations rather than always the
    same first few (a little randomness per call keeps her from sounding
    like she's reciting the same canned lines every session)."""
    data = _load()
    examples = data.get(tier_name, [])
    if len(examples) <= count:
        return examples
    return random.sample(examples, count)


def format_examples_block(tier_name: str, character_name: str, count: int = 3) -> str:
    examples = get_examples_for_tier(tier_name, count)
    if not examples:
        return ""

    lines = ["Examples of how you actually talk at this relationship stage "
             "(match this voice and rhythm, don't reuse these lines verbatim):"]
    for ex in examples:
        lines.append(f'User: "{ex["user"]}"\n{character_name}: "{ex["yumi"]}"')
    return "\n\n".join(lines)
