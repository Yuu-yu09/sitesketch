"""
Gemini client - structured JSON generation for SiteSketch.

Two jobs:
  * generate_plan()  -> pages + sections + written copy
  * generate_design() -> a design spec matching the v1 schema in static/js/design.js

The model never picks from an open field: it chooses from our curated palette /
font / layout-variant library, so every generation stays inside the taste guardrails
while still varying from run to run. Server-side only - the key never reaches the browser.
"""

from __future__ import annotations

import json
import pathlib
import random
import re

import requests

import config

BASE = "https://generativelanguage.googleapis.com/v1beta"
TIMEOUT = 25  # Vercel free-tier functions are short-lived; fail fast and degrade
DESIGN_JS = pathlib.Path(__file__).parent / "static" / "js" / "design.js"


class GeminiError(RuntimeError):
    """Key missing, quota/network failure, or malformed model output."""


# ----------------------------------------------------------------- library ids

def _design_js() -> str:
    try:
        return DESIGN_JS.read_text(encoding="utf-8")
    except OSError:
        return ""


def palette_ids() -> list[str]:
    src = _design_js()
    ids = re.findall(r'\{\s*id:\s*"([a-z0-9-]+)",\s*name:\s*"[^"]+",\s*mode:\s*"(?:light|dark)"', src)
    return ids or ["cobalt-cream", "forest-amber", "mono-rose", "deep-sea"]


def palette_modes() -> dict[str, str]:
    src = _design_js()
    pairs = re.findall(r'\{\s*id:\s*"([a-z0-9-]+)",\s*name:\s*"[^"]+",\s*mode:\s*"(light|dark)"', src)
    return dict(pairs)


def font_ids() -> list[str]:
    src = _design_js()
    ids = re.findall(r'\{\s*id:\s*"([a-z0-9]+)",\s*name:\s*"[^"]+",\s*vibe:', src)
    return ids or ["grotesk", "jakarta", "syne", "newsreader"]


def variant_names() -> list[str]:
    src = _design_js()
    names = sorted(set(re.findall(r'\{\s*n:\s*"([a-z]+)",\s*f:', src)))
    return names or ["split", "grid", "rows", "cards"]


# --------------------------------------------------------------------- plumbing

def generate_json(prompt: str, schema: dict, system: str | None = None) -> dict:
    """One-shot structured call. Returns parsed JSON or raises GeminiError."""
    if not config.GEMINI_API_KEY:
        raise GeminiError("GEMINI_API_KEY is not set")

    payload: dict = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.85,
            "topP": 0.95,
            "responseMimeType": "application/json",
            "responseSchema": schema,
        },
    }
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}

    url = f"{BASE}/models/{config.GEMINI_MODEL}:generateContent"
    try:
        resp = requests.post(
            url,
            params={"key": config.GEMINI_API_KEY},
            json=payload,
            timeout=TIMEOUT,
        )
    except requests.RequestException as exc:
        raise GeminiError(f"network failure: {exc}") from exc

    if resp.status_code != 200:
        raise GeminiError(f"{resp.status_code} from Gemini: {resp.text[:200]}")

    try:
        parts = resp.json()["candidates"][0]["content"]["parts"]
        return json.loads(parts[0]["text"])
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        raise GeminiError(f"unexpected response shape: {exc}") from exc


# ------------------------------------------------------------- design generation

DESIGN_SYSTEM = """You are the design director for small-business websites built in SiteSketch.
You produce ONE coherent design direction per request, then stay consistent with it.

Rules you never break:
- Choose palette, font pairing, and layout variants ONLY from the options given to you.
- Never use AI-purple, neon glow, glassmorphism, or a centered-everything layout.
- Never place an uppercase eyebrow label above more than a third of the sections.
- No two consecutive sections may share the same layout family.
- Sharp, confident copy. No em dashes anywhere. No buzzwords such as elevate, seamless, unleash.
- Prefer one strong accent colour used consistently across every section."""

DESIGN_RULES = """Layout families (never repeat a family twice in a row):
media-split (text beside imagery), media-overlay (full-bleed image with text on top),
type-first (big typography, no imagery), card-grid (grid of cards), list-rows
(rows separated by hairlines), shelf (horizontal scroll), menu-list, image-grid,
editorial (asymmetric columns), quote, centered, band (solid accent block), framed (bordered box)."""


def design_schema() -> dict:
    """Response schema: the model picks from the curated library, nothing is free-form."""
    return {
        "type": "object",
        "properties": {
            "design_name": {"type": "string"},
            "rationale": {"type": "string"},
            "palette": {"type": "string", "enum": palette_ids()},
            "font": {"type": "string", "enum": font_ids()},
            "radius": {"type": "string", "enum": ["0px", "4px", "10px", "999px"]},
            "space": {"type": "string", "enum": ["compact", "comfy", "airy"]},
            "shadow": {"type": "string", "enum": ["flat", "soft", "crisp"]},
            # NOTE: Gemini's schema subset only accepts string enums, so the two
            # numeric choices are unconstrained here and clamped in normalize_design().
            "reveal": {"type": "integer"},
            "nav": {"type": "string", "enum": ["bar", "minimal", "outline"]},
            "footer": {"type": "integer"},
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "variant": {"type": "string", "enum": variant_names()},
                    },
                    "required": ["id", "variant"],
                },
            },
        },
        "required": [
            "design_name", "palette", "font", "radius", "space",
            "shadow", "reveal", "nav", "footer", "sections",
        ],
    }


def generate_design(ctx: dict) -> dict:
    """
    ctx: { siteName, type, goal, description, sections: [{id, type, title}] }

    Returns a design spec shaped exactly like DESIGN.generateSpec() in the browser,
    so preview, builder and published site render it with zero extra mapping.
    """
    sections = ctx.get("sections") or []
    listing = "\n".join(
        f'- id "{s["id"]}" type "{s["type"]}" working title "{s.get("title", "")}"'
        for s in sections
    )

    prompt = f"""Design a website for this business.

Site name: {ctx.get("siteName", "My Website")}
Site type: {ctx.get("type", "business")}
Main goal: {ctx.get("goal", "get-contact")}
Owner's description: {ctx.get("description", "(none given)")}

Sections the design must cover (keep these exact ids, choose one layout variant each):
{listing}

{DESIGN_RULES}

Available palettes: {", ".join(palette_ids())}
Available font pairings: {", ".join(font_ids())}
Available layout variants: {", ".join(variant_names())}

Design name should read like a real art direction, two or three words, no buzzwords.
Rationale is one short sentence about who this design is for."""

    raw = generate_json(prompt, design_schema(), system=DESIGN_SYSTEM)
    return normalize_design(raw, sections)


def normalize_design(raw: dict, sections: list[dict]) -> dict:
    """Validate model output against the local library; drop anything invalid."""
    modes = palette_modes()
    valid_palettes, valid_fonts = palette_ids(), font_ids()

    palette = raw.get("palette") if raw.get("palette") in valid_palettes else random.choice(valid_palettes)
    font = raw.get("font") if raw.get("font") in valid_fonts else random.choice(valid_fonts)

    by_id = {s["id"]: s for s in sections}
    allowed = _variants_for_types({s["type"] for s in sections})

    picks: dict[str, dict] = {}
    for row in raw.get("sections", []) or []:
        sid, variant = row.get("id"), row.get("variant")
        if sid in by_id and variant in allowed.get(by_id[sid]["type"], ()):
            picks[sid] = {"variant": variant}

    missing = [s["id"] for s in sections if s["id"] not in picks]

    return {
        "v": 1,
        "seed": random.randint(1, 2_000_000_000),
        "name": str(raw.get("design_name") or "Generated design")[:60],
        "mode": modes.get(palette, "light"),
        "tokens": {
            "palette": palette,
            "font": font,
            "radius": raw.get("radius") if raw.get("radius") in ("0px", "4px", "10px", "999px") else "8px",
            "space": raw.get("space") if raw.get("space") in ("compact", "comfy", "airy") else "comfy",
            "shadow": raw.get("shadow") if raw.get("shadow") in ("flat", "soft", "crisp") else "soft",
        },
        "motion": {"reveal": raw.get("reveal") if raw.get("reveal") in (1, 2, 3) else 2},
        "nav": raw.get("nav") if raw.get("nav") in ("bar", "minimal", "outline") else "bar",
        "footer": 1 if raw.get("footer") in (0, 1) else 1,
        "sections": picks,
        "source": "gemini",
        "model": config.GEMINI_MODEL,
        "rationale": str(raw.get("rationale") or "")[:220],
        "unassigned": missing,
    }


def _variants_for_types(types: set[str]) -> dict[str, tuple[str, ...]]:
    """Read the variant registry straight out of design.js so both sides agree."""
    src = _design_js()
    registry: dict[str, list[str]] = {}
    for block_type, body in re.findall(r'^\s{4}([a-z]+):\s*\[(.*?)\]', src, re.S | re.M):
        names = re.findall(r'\{\s*n:\s*"([a-z]+)"', body)
        if names:
            registry[block_type] = names
    return {t: tuple(registry.get(t, ("split",))) for t in types}


# -------------------------------------------------------------- plan generation

def generate_plan(ctx: dict) -> dict:
    """
    ctx: { siteName, type, goal, description, sections: [section type ids] }
    Returns: { pages: [{ name, sections: [{ type, title, subtitle, fields }] }], meta }
    """
    types = ctx.get("sections") or ["hero", "about", "contact"]
    listing = "\n".join(f"- {t}" for t in types)

    prompt = f"""Write a website plan for this business.

Site name: {ctx.get("siteName", "My Website")}
Site type: {ctx.get("type", "business")}
Main goal: {ctx.get("goal", "get-contact")}
Owner's description: {ctx.get("description", "(none given)")}

Include exactly these section types, in this order:
{listing}

Rules:
- Write real, specific copy a local business would actually use. No lorem ipsum, no
  placeholder text, no em dashes.
- Headlines under 8 words. Subtitles under 20 words.
- If a description is vague, invent plausible, concrete detail rather than hedging.
"""

    schema = {
        "type": "object",
        "properties": {
            "headline": {"type": "string"},
            "tagline": {"type": "string"},
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string"},
                        "title": {"type": "string"},
                        "subtitle": {"type": "string"},
                        "buttonText": {"type": "string"},
                    },
                    "required": ["type", "title", "subtitle"],
                },
            },
        },
        "required": ["headline", "tagline", "sections"],
    }

    raw = generate_json(prompt, schema, system=DESIGN_SYSTEM)
    return raw