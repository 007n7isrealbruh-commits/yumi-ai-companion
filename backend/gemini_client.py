"""
backend/gemini_client.py
A single shared google-genai Client, imported by gemini_engine.py and
embeddings.py, so we don't open a separate client (and connection pool)
per module.
"""

from google import genai
from backend.config import settings

client = genai.Client(api_key=settings.gemini_api_key)
