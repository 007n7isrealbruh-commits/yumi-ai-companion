"""
backend/embeddings.py

Turns text into a vector so memory can be ranked by actual semantic
similarity ("is this fact about the same *topic* as what the user just
said") instead of only exact keyword overlap.

Model choice: "gemini-embedding-001", NOT "gemini-embedding-2-preview".
The -2-preview family has a known SDK batching bug (googleapis/python-genai
issue #2523) where passing a list of strings silently returns only one
embedding back no matter how many inputs you sent — gemini-embedding-001
does not have that problem, so it's the safe choice here. We also only
ever embed one string at a time in this app, so the bug wouldn't bite us
either way, but -001 is the more stable pick.

Every call is wrapped so a network hiccup or quota error degrades to
`None` rather than crashing the conversation — callers fall back to
keyword+recency scoring (see MemoryManager.get_relevant_facts).
"""

import math
from typing import List, Optional

from google.genai import types
from backend.gemini_client import client

EMBEDDING_MODEL = "gemini-embedding-001"
# Truncated (Matryoshka) output instead of the full-size vector: plenty of
# accuracy for ranking a few dozen short facts, at a fraction of the disk
# space in memory_store.json (768 floats/fact instead of ~3072).
EMBEDDING_DIMENSIONS = 768


def embed_text(text: str) -> Optional[List[float]]:
    text = (text or "").strip()
    if not text:
        return None
    try:
        response = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=text,
            config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIMENSIONS),
        )
        return list(response.embeddings[0].values)
    except Exception as e:
        print(f"[EMBEDDINGS] embed_text failed, falling back to keyword scoring: {e}")
        return None


def cosine_similarity(vec_a: Optional[List[float]], vec_b: Optional[List[float]]) -> float:
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
