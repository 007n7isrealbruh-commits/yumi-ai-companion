"""
backend/heuristics.py

Replaces the old flat "+1 per message, +3/-4 for a keyword hit" affection
math. Ported from Utsuwa's real src/lib/engine/heuristics.ts +
state-updates.ts (open-source, read directly — not guessed), adapted from
TypeScript to Python and from Utsuwa's 8-stage romantic ladder to our
4-tier non-romantic one (see memory_manager.py's AFFECTION_TIERS — that
boundary was a deliberate earlier decision, not an oversight, so it's kept
even though Utsuwa's own ladder goes further).

What changed vs. the old heuristic, and why each one matters:
  - FIVE axes (affection, trust, intimacy, comfort, respect), not one.
    Thanking her and confiding in her are different kinds of closeness;
    collapsing them into one number lost that distinction.
  - Topic DEPTH (shallow/moderate/deep, by length + content markers) and
    EMOTIONAL content detection, not just a positive/negative keyword
    count — a one-line "thanks" and a paragraph about a hard day no
    longer move the needle by the same amount.
  - Asking HER questions raises trust/respect — rewards treating her like
    someone you're curious about, not just a tool you thank afterward.
  - Non-linear phases: gains are amplified early ("honeymoon") and damped
    once already close ("deepBond") — this IS the fix for "just sending
    positive messages shouldn't keep working the same forever."
  - Small randomness (+/-20%) so it doesn't feel like a visible formula.
  - Every delta is bounded (see MessageImpact) — no single message can
    swing a stat far either direction.
"""

import math
import random
import re
from dataclasses import dataclass
from typing import Dict, Optional

WORD_RE = re.compile(r"\b[a-z0-9'-]+\b")

POSITIVE_WORDS = {
    "happy", "glad", "love", "great", "awesome", "amazing", "wonderful",
    "thank", "thanks", "thx", "ty", "appreciate", "enjoy", "fun", "excited", "nice",
    "good", "best", "beautiful", "cute", "sweet", "kind", "funny",
    "haha", "lol", "lmao", "ily",
}
POSITIVE_EMOTICONS = {":)", ":d", "<3", "^_^", ":3"}

# "sorry" deliberately excluded — apologizing is repair, not negativity.
NEGATIVE_WORDS = {
    "sad", "hate", "bad", "awful", "terrible", "angry", "upset", "annoyed",
    "frustrated", "disappointed", "worry", "worried", "scared", "afraid",
    "hurt", "pain", "lonely", "alone", "cry", "crying", "stupid", "idiot",
}
NEGATIVE_EMOTICONS = {":(", ":'(", ":c", "-_-"}

DEPTH_MARKERS = {
    "feel", "feeling", "feelings", "think", "believe", "hope", "dream",
    "wish", "fear", "scared", "worry", "love", "hate", "care", "mean",
    "matter", "important", "understand", "remember", "miss", "future",
    "past", "life", "death", "relationship", "family", "friend", "trust",
    "honest", "truth", "secret",
}

EMOTIONAL_MARKERS = {
    "feel", "feeling", "emotion", "emotional", "heart", "soul", "cry",
    "tears", "happy", "sad", "angry", "scared", "love", "hate", "miss",
    "hurt", "pain", "joy", "excited", "nervous", "anxious", "worried",
}

_QUESTION_STARTERS = re.compile(
    r"^(what|who|where|when|why|how|do|does|did|is|are|was|were|can|could|would|will|should)\b",
    re.IGNORECASE,
)


@dataclass
class MessageAnalysis:
    sentiment: float  # -1..1
    topic_depth: str  # 'shallow' | 'moderate' | 'deep'
    has_emotional_content: bool
    is_question: bool


@dataclass
class MessageImpact:
    affection_delta: int
    trust_delta: int
    intimacy_delta: int
    comfort_delta: int
    respect_delta: int


def analyze_message(content: str) -> MessageAnalysis:
    lowered = content.lower()
    tokens = set(WORD_RE.findall(lowered))

    pos_word_count = sum(1 for kw in POSITIVE_WORDS if kw in tokens)
    pos_emo_count = sum(1 for e in POSITIVE_EMOTICONS if e in lowered)
    positive_count = pos_word_count + pos_emo_count

    neg_word_count = sum(1 for kw in NEGATIVE_WORDS if kw in tokens)
    neg_emo_count = sum(1 for e in NEGATIVE_EMOTICONS if e in lowered)
    negative_count = neg_word_count + neg_emo_count

    total = positive_count + negative_count
    sentiment = (positive_count - negative_count) / total if total > 0 else 0.0

    depth_marker_count = sum(1 for m in DEPTH_MARKERS if m in tokens)
    if depth_marker_count >= 3 or len(content) > 200:
        topic_depth = "deep"
    elif depth_marker_count >= 1 or len(content) > 80:
        topic_depth = "moderate"
    else:
        topic_depth = "shallow"

    has_emotional_content = any(m in tokens for m in EMOTIONAL_MARKERS) or bool(pos_emo_count or neg_emo_count)
    is_question = "?" in content or bool(_QUESTION_STARTERS.match(content.strip()))

    return MessageAnalysis(sentiment, topic_depth, has_emotional_content, is_question)


def _clamp(value: float, lo: float, hi: float) -> int:
    return int(max(lo, min(hi, value)))


def calculate_message_impact(analysis: MessageAnalysis, current_affection: int) -> MessageImpact:
    affection = 1  # baseline interaction floor
    trust = 0
    intimacy = 0
    comfort = 0
    respect = 0

    if analysis.sentiment > 0.3:
        affection += 2
        comfort += 1
    elif analysis.sentiment < -0.3:
        # Negative messages incur visible penalties across multiple axes
        affection -= 3
        comfort -= 2
        trust -= 1
    elif analysis.sentiment < -0.1:
        affection -= 1
        comfort -= 1

    # Closeness/depth bonuses only apply when the message is NOT clearly hostile/negative.
    # Hostile messages containing words like 'hate' should not increase intimacy or trust.
    if analysis.sentiment >= -0.2:
        if analysis.topic_depth == "deep":
            affection += 2
            intimacy += 2
            trust += 1
        elif analysis.topic_depth == "moderate":
            affection += 1
            intimacy += 1
        else:
            comfort -= 1  # small talk alone gets a little stale over time

        if analysis.has_emotional_content:
            intimacy += 2
            trust += 1
            affection += 1

        if analysis.is_question:
            respect += 1
            trust += 1
    else:
        # For hostile/negative messages, strong emotional intensity increases discomfort
        if analysis.has_emotional_content:
            comfort -= 1

    # Non-linear phases: amplified early gains, damped once already close
    if current_affection < 20:
        phase_mult = 1.5
    elif current_affection < 55:
        phase_mult = 1.0
    else:
        phase_mult = 0.7

    # Use round() to avoid the asymmetric negative truncation bias of math.floor()
    affection = round(affection * phase_mult)

    # Small symmetrical randomness (+/- 20%)
    variance = 0.2
    affection = round(affection * (1 + (random.random() - 0.5) * 2 * variance))
    trust = round(trust * (1 + (random.random() - 0.5) * 2 * variance))

    return MessageImpact(
        affection_delta=_clamp(affection, -5, 8),
        trust_delta=_clamp(trust, -3, 4),
        intimacy_delta=_clamp(intimacy, -2, 4),
        comfort_delta=_clamp(comfort, -3, 3),
        respect_delta=_clamp(respect, -2, 3),
    )


def merge_llm_deltas(baseline: MessageImpact, llm_deltas: Optional[Dict[str, int]]) -> MessageImpact:
    """The LLM MAY suggest its own deltas (e.g. she judges a moment as a
    bigger deal than keyword-matching would catch), but it never has the
    final say — every suggested delta is clamped relative to what the
    baseline heuristic already computed, same principle as Utsuwa's
    mergeUpdates. Pass None (no [state: ...] tag from this reply) to just
    use the baseline untouched."""
    if not llm_deltas:
        return baseline

    def bounded(base_value: int, llm_value: Optional[int], floor: int) -> int:
        if llm_value is None:
            return base_value
        max_delta = max(abs(base_value) * 2, floor)
        return _clamp(llm_value, -max_delta, max_delta)

    return MessageImpact(
        affection_delta=bounded(baseline.affection_delta, llm_deltas.get("affection"), 5),
        trust_delta=bounded(baseline.trust_delta, llm_deltas.get("trust"), 3),
        intimacy_delta=bounded(baseline.intimacy_delta, llm_deltas.get("intimacy"), 3),
        comfort_delta=bounded(baseline.comfort_delta, llm_deltas.get("comfort"), 3),
        respect_delta=bounded(baseline.respect_delta, llm_deltas.get("respect"), 3),
    )
