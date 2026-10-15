"""
backend/memory_manager.py

Persistent, versioned memory + relationship state.

Why "versioned"? Every save includes a `schema_version` field, and
`_migrate()` upgrades old files instead of crashing or losing data.

v4 relationship model — ported from Utsuwa's actual
src/lib/engine/{heuristics,state-updates,stages}.ts (read directly, not
guessed), adapted from its 8-stage romantic ladder to our deliberately
non-romantic 4-tier one:
- FIVE axes instead of one: affection, trust, intimacy, comfort, respect.
  See backend/heuristics.py for how a message moves them.
- Tier requirements are MULTI-CONDITION (affection + trust + a minimum
  number of real interactions, not just a score threshold) — this is the
  actual fix for "raising affection by sending lots of messages isn't
  good": you can't grind a tier by spamming positive keywords in one
  sitting, you need sustained trust and genuine interaction count too.
- HYSTERESIS-banded demotion: a stat dipping just below a tier's floor
  doesn't instantly demote her — it has to fall below 85% of the floor,
  so one bad exchange doesn't flip-flop the relationship stage back and
  forth on the next good one.
- TIME DECAY: being gone for a while gently lowers affection/trust,
  applied at most once per absence (not every reply) — previously there
  was no decay at all.

What else it tracks:
- interaction_count / interaction_dates: used for the min-interactions
  and min-days-known tier requirements above.
- facts + fact_embeddings: facts she decides are worth remembering long
  term (via her own [memory: ...] tag — see brain.py). No cap or
  eviction — stays until forget_fact() removes it.
- history: rolling window of the last N conversational turns.
- diary_entries: her own private reflections (see brain.py).
- milestones_hit: which milestones have already fired, so each only
  announces once.
"""

import json
import os
import time
import uuid
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

from backend.config import settings
from backend.embeddings import embed_text, cosine_similarity
from backend.heuristics import MessageImpact

CURRENT_SCHEMA_VERSION = 5
MAX_HISTORY_TURNS = 12
MAX_DIARY_ENTRIES = 60

# Hard ceilings. Affection stays on our existing 0..79 scale (a deliberate
# earlier decision, not Utsuwa's 0..1000 — see AFFECTION_TIERS below); the
# other four axes use Utsuwa's native 0..100 range since there was no
# prior scale to preserve for them.
MAX_AFFECTION = 79
MIN_AFFECTION = -50
STAT_MIN, STAT_MAX = 0, 100

# Demotion only kicks in once a stat falls below this fraction of the
# current tier's own floor — straight from Utsuwa's DEMOTION_HYSTERESIS.
# Without the band, a single bad message right at a threshold would demote
# and the next good one would immediately re-promote.
DEMOTION_HYSTERESIS = 0.85


@dataclass
class TierRequirements:
    min_affection: int
    min_trust: int = 0
    min_interactions: int = 0
    min_days_known: int = 0


TIER_ORDER = ["cold", "wary", "warming", "attached"]

TIER_REQUIREMENTS: Dict[str, TierRequirements] = {
    "cold": TierRequirements(min_affection=MIN_AFFECTION),
    "wary": TierRequirements(min_affection=0, min_trust=10, min_interactions=3),
    "warming": TierRequirements(min_affection=25, min_trust=25, min_interactions=10),
    "attached": TierRequirements(min_affection=55, min_trust=40, min_interactions=20, min_days_known=2),
}

TIER_DESCRIPTIONS = {
    "cold": (
        "You are guarded and prickly. You barely tolerate the user. Replies are "
        "short, dismissive, and classic tsundere: you insult first, help second, "
        "and you'd rather die than admit you care. No flirting at this stage — "
        "she hasn't earned it yet."
    ),
    "wary": (
        "You are still mostly tsundere and easily flustered, but you no longer "
        "assume the worst of the user. You tease constantly and deflect the "
        "instant anything sincere almost slips out. The first flickers of "
        "flirtiness show up here — mostly as fluster when caught off guard, "
        "not anything you'd initiate."
    ),
    "warming": (
        "You've grown used to the user and clearly go out of your way for them, "
        "even while complaining about it. You get visibly flustered and change "
        "the subject the moment you're caught actually caring. Teasing has a "
        "flirty edge now, and you notice when they compliment someone else."
    ),
    "attached": (
        "You trust the user and notice when they've been gone a while. Tsundere "
        "habits remain (you still deflect compliments and grumble), but you "
        "initiate more openly, get outright jealous sometimes, and the flirting "
        "is no longer just deflection — you tease back on purpose now. This is "
        "as warm as you get: confident, sharp, clearly attached — but never "
        "gushing, never says anything like an over-the-top devoted declaration."
    ),
}

MILESTONES = {
    "wary": "affection_wary",
    "warming": "affection_warming",
    "attached": "affection_attached",
}


def _clamp(value: int, lo: int, hi: int) -> int:
    return int(max(lo, min(hi, value)))


@dataclass
class MemoryState:
    schema_version: int = CURRENT_SCHEMA_VERSION
    character_name: str = settings.character_name
    custom_personality: str = ""
    is_onboarded: bool = False

    affection: int = 0
    trust: int = 0
    intimacy: int = 0
    comfort: int = 50  # starts neutral, not zero
    respect: int = 50

    relationship_tier: str = "cold"

    interaction_count: int = 0
    interaction_dates: List[str] = field(default_factory=list)
    last_interaction_at: float = field(default_factory=time.time)
    last_decay_at: Optional[float] = None

    facts: List[str] = field(default_factory=list)
    fact_embeddings: Dict[str, List[float]] = field(default_factory=dict)
    memory_nodes: List[Dict[str, Any]] = field(default_factory=list)
    history: List[Dict[str, str]] = field(default_factory=list)
    milestones_hit: List[str] = field(default_factory=list)
    diary_entries: List[Dict[str, Any]] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    last_seen_at: float = field(default_factory=time.time)


def _migrate(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Upgrade older memory files to the current schema."""
    version = raw.get("schema_version", 0)

    if version < 1:
        raw.setdefault("affection", 0)
        raw.setdefault("milestones_hit", [])
        raw["schema_version"] = 1
        version = 1

    if version < 2:
        raw.setdefault("fact_embeddings", {})
        raw["schema_version"] = 2
        version = 2

    if version < 3:
        raw.setdefault("diary_entries", [])
        raw["schema_version"] = 3
        version = 3

    if version < 4:
        # v3 -> v4: multi-axis relationship state (trust/intimacy/comfort/
        # respect), day/interaction tracking for tier requirements, and
        # absence-based decay. Existing users keep their affection score
        # as-is; the new axes start at reasonable neutral defaults rather
        # than zero, so someone who was already "attached" under the old
        # single-axis system isn't instantly demoted the moment v4 loads.
        old_affection = raw.get("affection", 0)
        raw.setdefault("trust", min(STAT_MAX, max(0, old_affection)))
        raw.setdefault("intimacy", 0)
        raw.setdefault("comfort", 50)
        raw.setdefault("respect", 50)

        # Derive initial tier and requirements floor from existing affection
        if old_affection >= 55:
            initial_tier = "attached"
            min_int = 25
            min_days = 2
        elif old_affection >= 25:
            initial_tier = "warming"
            min_int = 12
            min_days = 1
        elif old_affection >= 0:
            initial_tier = "wary"
            min_int = 5
            min_days = 1
        else:
            initial_tier = "cold"
            min_int = 0
            min_days = 0

        raw.setdefault("relationship_tier", initial_tier)
        existing_history_count = len(raw.get("history", []))
        raw.setdefault("interaction_count", max(existing_history_count, min_int))

        existing_dates = raw.get("interaction_dates") or []
        if not existing_dates:
            today_str = datetime.now(timezone.utc).date().isoformat()
            if min_days >= 2:
                yesterday_str = (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()
                existing_dates = [yesterday_str, today_str]
            else:
                existing_dates = [today_str]
        raw["interaction_dates"] = list(dict.fromkeys(existing_dates))

        raw.setdefault("last_interaction_at", raw.get("last_seen_at", time.time()))
        raw.setdefault("last_decay_at", None)
        # Old milestone names don't match the new tier-based ones; drop
        # them so the renamed milestones can fire fresh instead of never
        # firing because a differently-spelled name is already "hit".
        raw["milestones_hit"] = [
            m for m in raw.get("milestones_hit", []) if m in MILESTONES.values()
        ]
        raw["schema_version"] = 4
        version = 4

    if version < 5:
        existing_facts = raw.get("facts", [])
        nodes = raw.get("memory_nodes", [])
        if not nodes and existing_facts:
            for idx, fact in enumerate(existing_facts):
                words = [w.lower().strip(".,!?\"':;") for w in fact.split() if len(w) > 3][:6]
                nodes.append({
                    "id": f"mem_{idx}_{int(time.time())}",
                    "text": fact,
                    "event": "conversation",
                    "context": "general",
                    "emotion": "neutral",
                    "associations": words,
                    "related_ids": [],
                    "sentiment": 0.0,
                    "created_at": raw.get("created_at", time.time()),
                    "last_recalled_at": time.time(),
                    "recall_count": 1,
                })
        raw["memory_nodes"] = nodes
        raw.setdefault("is_onboarded", bool(raw.get("interaction_count", 0) > 0 or raw.get("custom_personality") or len(existing_facts) > 0))
        raw["schema_version"] = 5
        version = 5

    return raw


class MemoryManager:
    def __init__(self, path: Optional[str] = None):
        self.path = path or settings.memory_file_path
        self._lock = threading.Lock()
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
        with self._lock:
            self.state.last_seen_at = time.time()
            dir_name = os.path.dirname(self.path) or "."
            os.makedirs(dir_name, exist_ok=True)
            tmp_path = f"{self.path}.tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(asdict(self.state), f, indent=2, ensure_ascii=False)
            os.replace(tmp_path, self.path)

    # ---------- relationship state ----------

    def apply_message_impact(self, impact: MessageImpact) -> None:
        """Applies a computed MessageImpact (see heuristics.py) across all
        five axes, each independently clamped. Call this once per user
        message instead of the old single `adjust_affection(delta)`."""
        s = self.state
        s.affection = _clamp(s.affection + impact.affection_delta, MIN_AFFECTION, MAX_AFFECTION)
        s.trust = _clamp(s.trust + impact.trust_delta, STAT_MIN, STAT_MAX)
        s.intimacy = _clamp(s.intimacy + impact.intimacy_delta, STAT_MIN, STAT_MAX)
        s.comfort = _clamp(s.comfort + impact.comfort_delta, STAT_MIN, STAT_MAX)
        s.respect = _clamp(s.respect + impact.respect_delta, STAT_MIN, STAT_MAX)

    def days_known(self) -> int:
        return len(set(self.state.interaction_dates))

    def _meets_requirements(self, req: TierRequirements, scale: float = 1.0) -> bool:
        s = self.state
        if s.affection < req.min_affection * scale:
            return False
        if s.trust < req.min_trust * scale:
            return False
        if s.interaction_count < req.min_interactions:  # count/time floors never scale down
            return False
        if self.days_known() < req.min_days_known:
            return False
        return True

    def _calculate_tier(self) -> str:
        for tier in reversed(TIER_ORDER):
            if self._meets_requirements(TIER_REQUIREMENTS[tier]):
                return tier
        return "cold"

    def resolve_tier_transition(self) -> Dict[str, Any]:
        """Promotion is immediate; demotion is damped by DEMOTION_HYSTERESIS
        so boundary noise or one rough exchange doesn't flip the tier back
        and forth. Updates and persists state.relationship_tier as a side
        effect — call once per turn (get_personality_tier relies on it
        having already run)."""
        current = self.state.relationship_tier
        calculated = self._calculate_tier()

        if calculated == current:
            return {"tier": current, "changed": False}

        current_idx = TIER_ORDER.index(current) if current in TIER_ORDER else -1
        calculated_idx = TIER_ORDER.index(calculated)

        if calculated_idx > current_idx:
            self.state.relationship_tier = calculated
            return {"tier": calculated, "changed": True, "direction": "promotion"}

        # Demotion candidate — only actually demote if we've fallen below
        # the hysteresis-shrunk floor of the CURRENT tier, not just below
        # its full requirement.
        if current_idx >= 0 and self._meets_requirements(TIER_REQUIREMENTS[current], DEMOTION_HYSTERESIS):
            return {"tier": current, "changed": False}

        self.state.relationship_tier = calculated
        return {"tier": calculated, "changed": True, "direction": "demotion"}

    def get_personality_tier(self) -> Dict[str, str]:
        tier = self.state.relationship_tier
        return {"tier": tier, "description": TIER_DESCRIPTIONS[tier]}

    def check_new_milestones(self) -> List[str]:
        """Returns tier milestones newly reached this turn (by the tier
        actually being promoted INTO, not just by crossing a raw number),
        and marks them as fired so each only announces once."""
        newly_hit = []
        tier = self.state.relationship_tier
        milestone_name = MILESTONES.get(tier)
        if milestone_name and milestone_name not in self.state.milestones_hit:
            self.state.milestones_hit.append(milestone_name)
            newly_hit.append(milestone_name)
        return newly_hit

    # ---------- time decay (absence) ----------

    def apply_time_decay_if_needed(self, now: Optional[float] = None) -> bool:
        """Ported from Utsuwa's resolveTimeDecayOnLoad: being away lowers
        affection/trust a little, but only once per absence — calling this
        every reply must not re-deduct the same gap repeatedly. Call once
        at the START of handling a new user message, before
        last_interaction_at gets updated for the new message. Returns
        whether anything changed."""
        now = now if now is not None else time.time()
        s = self.state
        hours_since = (now - s.last_interaction_at) / 3600.0
        if hours_since <= 0.5:
            return False

        already_decayed = s.last_decay_at is not None and s.last_decay_at >= s.last_interaction_at
        if already_decayed:
            return False

        changed = False

        if hours_since > 48 and s.affection > MIN_AFFECTION:
            days_away = int(hours_since // 24) - 2
            decay_rate = min(0.05, 0.01 * max(days_away, 0))
            decay = int(s.affection * decay_rate)
            if decay > 0:
                s.affection = _clamp(s.affection - min(decay, 15), MIN_AFFECTION, MAX_AFFECTION)
                changed = True

        if hours_since > 168 and s.trust > 0:  # 7 days
            weeks_away = int(hours_since // 168)
            decay = min(weeks_away * 2, 10)
            if decay > 0:
                s.trust = _clamp(s.trust - decay, STAT_MIN, STAT_MAX)
                changed = True

        if changed:
            s.last_decay_at = now
        return changed

    # ---------- facts ----------

    def remember_fact(self, fact: str, emotion: str = "neutral", context: str = "general", event: str = "conversation") -> None:
        """Adds a fact permanently and builds rich memory node relationships."""
        fact = fact.strip()
        if not fact:
            return

        if fact not in self.state.facts:
            self.state.facts.append(fact)
            vector = embed_text(fact)
            if vector is not None:
                self.state.fact_embeddings[fact] = vector

        node_id = f"mem_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        words = list(dict.fromkeys(w.lower().strip(".,!?\"':;") for w in fact.split() if len(w) > 3))

        # Cross-link related memory nodes sharing associations
        related = []
        for existing in self.state.memory_nodes:
            existing_assocs = set(existing.get("associations", []))
            if existing_assocs & set(words):
                related.append(existing["id"])
                if node_id not in existing.get("related_ids", []):
                    existing.setdefault("related_ids", []).append(node_id)

        existing_node = next((n for n in self.state.memory_nodes if n.get("text") == fact), None)
        if existing_node:
            existing_node["last_recalled_at"] = time.time()
            existing_node["recall_count"] = existing_node.get("recall_count", 1) + 1
            if emotion and emotion != "neutral":
                existing_node["emotion"] = emotion
            if context and context != "general":
                existing_node["context"] = context
        else:
            sentiment = 0.5 if emotion in ("happy",) else (-0.5 if emotion in ("sad", "angry") else 0.0)
            new_node = {
                "id": node_id,
                "text": fact,
                "event": event,
                "context": context,
                "emotion": emotion,
                "associations": words[:6],
                "related_ids": related[:5],
                "sentiment": sentiment,
                "created_at": time.time(),
                "last_recalled_at": time.time(),
                "recall_count": 1,
            }
            self.state.memory_nodes.append(new_node)

    def forget_fact(self, fact: str) -> bool:
        removed = False
        if fact in self.state.facts:
            self.state.facts.remove(fact)
            self.state.fact_embeddings.pop(fact, None)
            removed = True
        # Also remove matching memory nodes
        initial_len = len(self.state.memory_nodes)
        self.state.memory_nodes = [n for n in self.state.memory_nodes if n.get("text") != fact]
        if len(self.state.memory_nodes) < initial_len:
            removed = True
        return removed

    def get_all_facts(self) -> List[str]:
        return list(self.state.facts)

    def get_all_memory_nodes(self) -> List[Dict[str, Any]]:
        return list(self.state.memory_nodes)

    def delete_memory_node(self, node_id: str) -> bool:
        target = next((n for n in self.state.memory_nodes if n.get("id") == node_id), None)
        if target:
            fact_text = target.get("text", "")
            if fact_text in self.state.facts:
                self.state.facts.remove(fact_text)
                self.state.fact_embeddings.pop(fact_text, None)
            self.state.memory_nodes.remove(target)
            self.save()
            return True
        return False

    def export_memory_graph(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "format": "yumi-memory-graph",
                "version": CURRENT_SCHEMA_VERSION,
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "count": len(self.state.memory_nodes),
                "nodes": list(self.state.memory_nodes),
                "facts": list(self.state.facts),
            }

    def import_memory_graph(self, data: Dict[str, Any], merge: bool = True) -> Dict[str, Any]:
        """Safely imports memories with structure validation and deduplication."""
        if not isinstance(data, dict):
            raise ValueError("Import payload must be a JSON object")

        nodes = data.get("nodes")
        facts = data.get("facts")
        if not isinstance(nodes, list) and not isinstance(facts, list):
            raise ValueError("Payload missing valid 'nodes' or 'facts' array")

        imported_count = 0
        with self._lock:
            if not merge:
                self.state.memory_nodes.clear()
                self.state.facts.clear()
                self.state.fact_embeddings.clear()

            if isinstance(nodes, list):
                for node in nodes:
                    if not isinstance(node, dict):
                        continue
                    text = str(node.get("text", "")).strip()
                    if not text:
                        continue
                    if not any(n.get("text") == text for n in self.state.memory_nodes):
                        cleaned_node = {
                            "id": str(node.get("id", f"mem_{int(time.time())}_{uuid.uuid4().hex[:6]}")),
                            "text": text,
                            "event": str(node.get("event", "conversation")),
                            "context": str(node.get("context", "general")),
                            "emotion": str(node.get("emotion", "neutral")),
                            "associations": [str(a) for a in node.get("associations", []) if isinstance(a, str)][:8],
                            "related_ids": [str(r) for r in node.get("related_ids", []) if isinstance(r, str)][:8],
                            "sentiment": float(node.get("sentiment", 0.0)),
                            "created_at": float(node.get("created_at", time.time())),
                            "last_recalled_at": time.time(),
                            "recall_count": int(node.get("recall_count", 1)),
                        }
                        self.state.memory_nodes.append(cleaned_node)
                        if text not in self.state.facts:
                            self.state.facts.append(text)
                        imported_count += 1

            if isinstance(facts, list):
                for f in facts:
                    fact_str = str(f).strip()
                    if fact_str and fact_str not in self.state.facts:
                        self.remember_fact(fact_str)
                        imported_count += 1

        self.save()
        return {"status": "ok", "imported_count": imported_count, "total_nodes": len(self.state.memory_nodes)}

    def backfill_embeddings(self) -> int:
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
            today = datetime.now(timezone.utc).date().isoformat()
            if today not in self.state.interaction_dates:
                self.state.interaction_dates.append(today)
            self.state.last_interaction_at = time.time()

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

    def add_custom_fact(self, fact: str) -> bool:
        """Manually records a fact from the user via settings UI or script."""
        with self._lock:
            self.remember_fact(fact)
        self.save()
        return True

    def clear_history(self) -> None:
        """Clears rolling conversation history while preserving facts and relationship stats."""
        with self._lock:
            self.state.history.clear()
        self.save()

    def set_onboarded(self, status: bool = True) -> None:
        with self._lock:
            self.state.is_onboarded = status
        self.save()

    def is_onboarded(self) -> bool:
        return getattr(self.state, "is_onboarded", False)

    # ---------- memory retrieval ----------

    def get_relevant_facts(self, query: str, top_n: int = 8) -> List[str]:
        if not self.state.facts:
            return []

        total = len(self.state.facts)
        query_vector = embed_text(query) if query else None

        stopwords = {
            "the", "a", "an", "is", "are", "was", "were", "and", "or", "in", "on", "at",
            "to", "for", "with", "about", "that", "this", "what", "how", "why", "who",
            "when", "where", "can", "could", "would", "should", "you", "your", "my", "me",
            "tell", "have", "been", "from", "just", "like"
        }
        query_words = {w.lower().strip(".,!?\"':;") for w in query.split() if w.lower().strip(".,!?\"':;") not in stopwords and len(w) > 2}
        persona_cues = {"name", "remember", "know", "favorite", "hobby", "like", "love", "hate", "job", "work", "live"}
        has_persona_cue = bool(query_words & persona_cues)

        scored = []
        for idx, fact in enumerate(self.state.facts):
            recency_score = idx / max(total - 1, 1)
            fact_lower = fact.lower()
            fact_vector = self.state.fact_embeddings.get(fact)

            if query_vector is not None and fact_vector is not None:
                relevance_score = max(0.0, cosine_similarity(query_vector, fact_vector))
            else:
                fact_words = {w.lower().strip(".,!?\"':;") for w in fact.split() if w.lower().strip(".,!?\"':;") not in stopwords and len(w) > 2}
                overlap = len(query_words & fact_words)
                relevance_score = min(overlap * 0.4, 1.0)

            if has_persona_cue and any(cue in fact_lower for cue in persona_cues):
                relevance_score = min(relevance_score + 0.35, 1.0)

            token_matches = sum(1 for w in query_words if w in fact_lower)
            if token_matches > 0:
                relevance_score = min(relevance_score + 0.25 * token_matches, 1.0)

            final_score = (recency_score * 0.25) + (relevance_score * 0.75)
            scored.append((final_score, fact))

        scored.sort(key=lambda pair: pair[0], reverse=True)
        top_facts = [fact for _, fact in scored[:top_n]]

        if self.state.facts and self.state.facts[-1] not in top_facts:
            top_facts.append(self.state.facts[-1])

        formatted_facts = []
        for fact in top_facts[:top_n]:
            node = next((n for n in self.state.memory_nodes if n.get("text") == fact), None)
            if node:
                node["last_recalled_at"] = time.time()
                node["recall_count"] = node.get("recall_count", 1) + 1
                ctx_parts = []
                if node.get("context") and node["context"] != "general":
                    ctx_parts.append(f"Context: {node['context']}")
                if node.get("emotion") and node["emotion"] != "neutral":
                    ctx_parts.append(f"Emotion: {node['emotion']}")
                if ctx_parts:
                    formatted_facts.append(f"{fact} ({', '.join(ctx_parts)})")
                    continue
            formatted_facts.append(fact)

        return formatted_facts[:top_n]

    # ---------- profile export / import / portability ----------

    def export_profile(self) -> Dict[str, Any]:
        """Exports the complete companion profile, memory, and relationship state
        as a portable dictionary suitable for backup or transfer across devices."""
        with self._lock:
            return {
                "format": "yumi-companion-profile",
                "version": CURRENT_SCHEMA_VERSION,
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "character": {
                    "name": self.state.character_name or "Yumi",
                    "custom_personality": self.state.custom_personality or "",
                },
                "relationship": {
                    "affection": self.state.affection,
                    "trust": self.state.trust,
                    "intimacy": self.state.intimacy,
                    "comfort": self.state.comfort,
                    "respect": self.state.respect,
                    "relationship_tier": self.state.relationship_tier,
                    "interaction_count": self.state.interaction_count,
                    "interaction_dates": list(self.state.interaction_dates),
                },
                "facts": list(self.state.facts),
                "history": list(self.state.history),
                "diary_entries": list(self.state.diary_entries),
                "milestones_hit": list(self.state.milestones_hit),
            }

    def import_profile(self, data: Dict[str, Any]) -> None:
        """Imports and restores companion profile, relationship stats, memories,
        and diary entries from a previously exported backup payload."""
        if not isinstance(data, dict):
            raise ValueError("Import payload must be a valid JSON object")

        with self._lock:
            char_data = data.get("character", {})
            rel_data = data.get("relationship", {})

            name = char_data.get("name") if isinstance(char_data, dict) else None
            if not name:
                name = data.get("character_name") or self.state.character_name or "Yumi"

            personality = char_data.get("custom_personality") if isinstance(char_data, dict) else None
            if personality is None:
                personality = data.get("custom_personality", "")

            self.state.character_name = str(name).strip() or "Yumi"
            self.state.custom_personality = str(personality).strip()

            if isinstance(rel_data, dict) and rel_data:
                self.state.affection = int(rel_data.get("affection", self.state.affection))
                self.state.trust = int(rel_data.get("trust", self.state.trust))
                self.state.intimacy = int(rel_data.get("intimacy", self.state.intimacy))
                self.state.comfort = int(rel_data.get("comfort", self.state.comfort))
                self.state.respect = int(rel_data.get("respect", self.state.respect))
                self.state.interaction_count = int(rel_data.get("interaction_count", self.state.interaction_count))
                raw_dates = rel_data.get("interaction_dates", self.state.interaction_dates)
                self.state.interaction_dates = list(dict.fromkeys(str(d) for d in raw_dates))
            else:
                for k in ("affection", "trust", "intimacy", "comfort", "respect"):
                    if k in data:
                        setattr(self.state, k, int(data[k]))
                if "interaction_count" in data:
                    self.state.interaction_count = int(data["interaction_count"])
                if "interaction_dates" in data and isinstance(data["interaction_dates"], list):
                    self.state.interaction_dates = list(dict.fromkeys(str(d) for d in data["interaction_dates"]))

            if "facts" in data and isinstance(data["facts"], list):
                self.state.facts = [str(f).strip() for f in data["facts"] if str(f).strip()]
            if "history" in data and isinstance(data["history"], list):
                self.state.history = data["history"][-MAX_HISTORY_TURNS:]
            if "diary_entries" in data and isinstance(data["diary_entries"], list):
                self.state.diary_entries = data["diary_entries"][-MAX_DIARY_ENTRIES:]
            if "milestones_hit" in data and isinstance(data["milestones_hit"], list):
                self.state.milestones_hit = [str(m) for m in data["milestones_hit"]]

            # Recalculate tier based on imported metrics
            self.state.relationship_tier = self._calculate_tier()

        self.save()

    def reset_profile(self) -> None:
        """Resets the memory state to a fresh new companion state."""
        with self._lock:
            self.state = MemoryState(character_name="Yumi", custom_personality="")
        self.save()

