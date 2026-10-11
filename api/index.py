"""
Vercel entrypoint.

Vercel's Python runtime imports `app` from this file. Everything else is routed
to here by vercel.json.
"""

from app import app  # noqa: F401  (re-exported for Vercel)