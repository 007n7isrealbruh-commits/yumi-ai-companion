"""
backend/memory_manager.py

Persistent, versioned memory for the AI Waifu character.

Why "versioned"?
Every save includes a `schema_version` field. If you later change the shape
of the stored data (add new fields, rename something), `_migrate()` upgrades
old files instead of crashing or silently losing data. This is the
"memory version" system. v2 added semantic (embedding-based) fact retrieval
on top of v1's affection/milestone tracking — see get_relevant_facts().

What it tracks:
- affection: an integer score that rises with positive interaction and
  gently decays if the user is rude. This drives which personality
  tier the character behaves in (see get_personality_tier).
- interaction_count: total turns, used for milestone unlocks.
- facts + fact_embeddings: facts the character decides are worth
  remembering long-term (she extracts these herself each turn via a
  [memory: ...] tag — see gemini_engine.py — not a narrow regex). No
  automatic cap or eviction: a fact stays until forget_fact() removes it
  explicitly. Each fact has a cached embedding so relevance can be scored
  semantically, not just by keyword.
- history: a rolling window of the last N conversational turns.
- milestones_hit: which affection/interaction milestones have already
  fired, so we only announce them once.
"""

import json
import os
import time
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional

from backend.config import settings
from backend.embeddings import embed_text, cosine_similarity

CURRENT_SCHEMA_VERSION = 3
MAX_HISTORY_TURNS = 12
MAX_DIARY_ENTRIES = 60

AFFECTION_TIERS = [
    # (min_score, tier_name, behavioral_description)
    # Classic tsundere romance arc: barely-there at "cold", noticeably
    # flirtier by "attached"/"devoted". Playful/PG throughout — see
    # character.py's CORE_TRAITS for the explicit "never explicit" line.
    (-999, "cold", (
        "You are guarded and prickly. You barely tolerate the user. Replies are "
        "short, dismissive, and classic tsundere: you insult first, help second, "
        "and you'd rather die than admit you care. No flirting at this stage — "
        "she hasn't earned it yet."
    )),
    (0, "wary", (
        "You are still mostly tsundere and easily flustered, but you no longer "
        "assume the worst of the user. You tease constantly and deflect the "
        "instant anything sincere almost slips out. The first flickers of "
        "flirtiness show up here — mostly as fluster when caught off guard, "
        "not anything you'd initiate."
    )),
    (25, "warming", (
        "You've grown used to the user and clearly go out of your way for them, "
        "even while complaining about it. You get visibly flustered and change "
        "the subject the moment you're caught actually caring. Teasing has a "
        "flirty edge now, and you notice when they compliment someone else."
    )),
    (60, "attached", (
        "You trust the user and notice when they've been gone a while. Tsundere "
        "habits remain (you still deflect compliments and grumble), but you "
        "initiate more openly, get outright jealous sometimes, and the flirting "
        "is no longer just deflection — you tease back on purpose now."
    )),
    (100, "devoted", (
        "You are openly, fiercely attached to the user — still tsundere (you "
        "deflect and grumble for comedic effect), but you don't hide that they "
        "matter to you a great deal, and the flirtiness is a real, acknowledged "
        "part of how you two talk, not just fluster anymore. Still playful and "
        "PG, never explicit."
    )),
]

MILESTONES = {
    5: "first_week_together",
    25: "affection_warming",
    60: "affection_attached",
    100: "affection_devoted",
}


@dataclass
class MemoryState:
    schema_version: int = CURRENT_SCHEMA_VERSION
    character_name: str = settings.character_name
    affection: int = 0
    interaction_count: int = 0
    facts: List[str] = field(default_factory=list)
    # Parallel map: fact text -> embedding vector, computed lazily via
    # backend/embeddings.py. A fact can exist here with no entry yet (e.g.
    # embedding call failed when it was added) — that's fine, it just falls
    # back to keyword scoring for that one fact.
    fact_embeddings: Dict[str, List[float]] = field(default_factory=dict)
    history: List[Dict[str, str]] = field(default_factory=list)
    milestones_hit: List[str] = field(default_factory=list)
    # Each entry: {"timestamp": float, "text": str}. Written by
    # generate_diary_entry() in gemini_engine.py, read by the frontend's
    # diary panel.
    diary_entries: List[Dict[str, Any]] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    last_seen_at: float = field(default_factory=time.time)


def _migrate(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Upgrade older memory files to the current schema. Add new `if` blocks
    here whenever CURRENT_SCHEMA_VERSION is bumped in the future."""
    version = raw.get("schema_version", 0)

    if version < 1:
        # v0 -> v1: introduced affection/milestones tracking.
        raw.setdefault("affection", 0)
        raw.setdefault("milestones_hit", [])
        raw["schema_version"] = 1
        version = 1

    if version < 2:
        # v1 -> v2: introduced semantic memory (per-fact embedding vectors).
        # Existing facts just start with no embedding — they'll fall back to
        # keyword scoring until remember_fact() re-touches them, or you can
        # let backfill_embeddings() compute them all up front (see below).
        raw.setdefault("fact_embeddings", {})
        raw["schema_version"] = 2
        version = 2

    if version < 3:
        # v2 -> v3: added the diary/journal feature.
        raw.setdefault("diary_entries", [])
        raw["schema_version"] = 3
        version = 3

    return raw


class MemoryManager:
    def __init__(self, path: str = settings.memory_file_path):
        self.path = path
        self.state = self._load()

    def _load(self) -> MemoryState:
        if not os.path.exists(self.path):
            return MemoryState()
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                raw = json.load(f)
        except (json.JSONDecodeError, OSError):
            print("[MEMORY] Store was unreadable/corrupt — starting fresh.")
            return MemoryState()

        raw = _migrate(raw)
        known_fields = MemoryState.__dataclass_fields__.keys()
        filtered = {k: v for k, v in raw.items() if k in known_fields}
        return MemoryState(**filtered)

    def save(self) -> None:
        self.state.last_seen_at = time.time()
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(asdict(self.state), f, indent=2, ensure_ascii=False)

    # ---------- affection / growth ----------

    def adjust_affection(self, delta: int) -> None:
        self.state.affection = max(-50, min(100, self.state.affection + delta))

    def get_personality_tier(self) -> Dict[str, str]:
        tier_name, description = "cold", AFFECTION_TIERS[0][2]
        for min_score, name, description_text in AFFECTION_TIERS:
            if self.state.affection >= min_score:
                tier_name, description = name, description_text
        return {"tier": tier_name, "description": description}

    def check_new_milestones(self) -> List[str]:
        """Returns any milestone names newly crossed this turn (by affection
        score or by total interaction count), and marks them as fired."""
        newly_hit = []
        for threshold, name in MILESTONES.items():
            if self.state.affection >= threshold and name not in self.state.milestones_hit:
                self.state.milestones_hit.append(name)
                newly_hit.append(name)
        if self.state.interaction_count >= 7 and "first_week_together" not in self.state.milestones_hit:
            self.state.milestones_hit.append("first_week_together")
            newly_hit.append("first_week_together")
        return newly_hit

    # ---------- facts ----------

    def remember_fact(self, fact: str) -> None:
        """Adds a fact permanently — no automatic cap, no automatic eviction.
        Facts stay until forget_fact() removes them explicitly (via the
        settings drawer's Memory section, or DELETE /memory). See
        get_relevant_facts() for how a growing fact list stays fast/cheap
        to use: only a handful of the most relevant ones get pulled into
        any given prompt, regardless of how many are stored in total."""
        fact = fact.strip()
        if not fact or fact in self.state.facts:
            return
        self.state.facts.append(fact)

        # Compute and cache this fact's embedding now, so later relevance
        # scoring doesn't need to re-embed the whole fact list every turn.
        vector = embed_text(fact)
        if vector is not None:
            self.state.fact_embeddings[fact] = vector

    def forget_fact(self, fact: str) -> bool:
        """Manually removes one fact (and its cached embedding). Returns
        True if it was found and removed."""
        if fact not in self.state.facts:
            return False
        self.state.facts.remove(fact)
        self.state.fact_embeddings.pop(fact, None)
        return True

    def get_all_facts(self) -> List[str]:
        return list(self.state.facts)

    def backfill_embeddings(self) -> int:
        """Computes embeddings for any stored fact that doesn't have one yet
        (e.g. facts saved before semantic memory / schema v2 existed, or
        ones where the embed call failed at write time). Returns how many
        were newly embedded. Safe to call on startup or periodically."""
        embedded_count = 0
        for fact in self.state.facts:
            if fact not in self.state.fact_embeddings:
                vector = embed_text(fact)
                if vector is not None:
                    self.state.fact_embeddings[fact] = vector
                    embedded_count += 1
        return embedded_count

    # ---------- conversation history ----------

    def add_turn(self, role: str, text: str) -> None:
        self.state.history.append({"role": role, "text": text})
        self.state.history = self.state.history[-MAX_HISTORY_TURNS:]
        if role == "user":
            self.state.interaction_count += 1

    def get_recent_history(self) -> List[Dict[str, str]]:
        return self.state.history

    def get_facts_summary(self) -> str:
        if not self.state.facts:
            return "No specific facts remembered yet."
        return "; ".join(self.state.facts)

    # ---------- diary ----------

    def add_diary_entry(self, text: str) -> None:
        self.state.diary_entries.append({"timestamp": time.time(), "text": text.strip()})
        self.state.diary_entries = self.state.diary_entries[-MAX_DIARY_ENTRIES:]

    def get_diary_entries(self) -> List[Dict[str, Any]]:
        return self.state.diary_entries

    # ---------- memory retrieval ("which memory to install") ----------

    def get_relevant_facts(self, query: str, top_n: int = 8) -> List[str]:
        """Picks which stored facts are actually worth injecting into this
        turn's prompt, instead of dumping every fact every time.

        Primary signal: semantic similarity between the current message's
        embedding and each fact's stored embedding — this catches facts
        that are topically related even with zero shared words (e.g. user
        says "I'm nervous about the interview" and it should surface a
        fact like "works as a nurse", not just facts containing the literal
        word 'interview'). Falls back to keyword overlap for any fact whose
        embedding isn't available (e.g. embed call failed when it was
        saved), so nothing silently gets excluded just because embedding
        once hiccuped. Recency is blended in throughout either way."""
        if not self.state.facts:
            return []

        total = len(self.state.facts)
        query_vector = embed_text(query)
        query_words = {w.lower().strip(".,!?") for w in query.split() if len(w) > 3}

        scored = []
        for idx, fact in enumerate(self.state.facts):
            recency_score = idx / max(total - 1, 1)  # 0..1, newer facts score higher

            fact_vector = self.state.fact_embeddings.get(fact)
            if query_vector is not None and fact_vector is not None:
                relevance_score = max(0.0, cosine_similarity(query_vector, fact_vector))
            else:
                fact_words = {w.lower().strip(".,!?:") for w in fact.split()}
                overlap = len(query_words & fact_words)
                relevance_score = min(overlap * 0.5, 1.0)

            scored.append((recency_score * 0.3 + relevance_score * 0.7, fact))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [fact for _, fact in scored[:top_n]]
