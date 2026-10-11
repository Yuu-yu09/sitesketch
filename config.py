"""
Environment settings for SiteSketch.

Values come from real environment variables (Vercel) and fall back to the
local `.env` file (development). Nothing here is ever committed.
"""

from __future__ import annotations

import os
import pathlib


def _load_dotenv() -> None:
    """Minimal .env loader: existing env vars win, so Vercel overrides .env."""
    path = pathlib.Path(__file__).parent / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()


def _get(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


NODE_ENV = _get("NODE_ENV", "development")
IS_PROD = NODE_ENV == "production"
PORT = int(_get("PORT", "3000") or 3000)
APP_URL = _get("APP_URL", f"http://localhost:{PORT}")

# database + storage
DATABASE_URL = _get("DATABASE_URL")
SUPABASE_URL = _get("SUPABASE_URL")
SUPABASE_KEY = _get("SUPABASE_KEY")          # service_role - server-side only

# AI
GEMINI_API_KEY = _get("GEMINI_API_KEY")
GEMINI_MODEL = _get("GEMINI_MODEL", "gemini-2.5-flash")

# auth
JWT_SECRET = _get("JWT_SECRET")
SECRET_KEY = _get("SECRET_KEY") or JWT_SECRET
GOOGLE_CLIENT_ID = _get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = _get("GOOGLE_CLIENT_SECRET")
GITHUB_CLIENT_ID = _get("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = _get("GITHUB_CLIENT_SECRET")

# storage bucket for compiled sites
SITES_BUCKET = _get("SITES_BUCKET", "sites")

# ?demo=1 one-click sign-in: development only, never in production
DEMO_MODE = _get("DEMO_MODE", "0").lower() not in ("0", "", "false", "no")


def missing() -> list[str]:
    """Names of required-but-empty settings (used by /api/health)."""
    out = []
    for name, value in (
        ("DATABASE_URL", DATABASE_URL),
        ("SUPABASE_KEY", SUPABASE_KEY),
        ("GEMINI_API_KEY", GEMINI_API_KEY),
        ("JWT_SECRET", JWT_SECRET),
    ):
        if not value:
            out.append(name)
    return out