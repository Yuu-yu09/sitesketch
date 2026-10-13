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
import threading

import config

BASE = "https://generativelanguage.googleapis.com/v1beta"
# gemini-3.8-flash is slow to first byte from serverless regions (20s+ timeouts),
# and the 2.5 line is retired for new keys. flash-lite answers a structured JSON
# spec in ~2s, which fits a Vercel function comfortably.
TIMEOUT = 20          # primary attempt
RETRY_TIMEOUT = 45    # heavier model, only if the fast one fails
FALLBACK_MODEL = "gemini-3.8-flash"
# Classification is a cheap question with a working keyword fallback, so it
# gets one short attempt. Stacked behind the plan call it doubled the worst
# case for a spinner nobody waits out.
CLASSIFY_TIMEOUT = 8
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

def _call(model: str, prompt: str, schema: dict, system: str | None, timeout: int) -> dict:
    """One Gemini request, bounded by a wall-clock deadline.

    requests' `timeout` is a socket read timeout: it bounds how long the
    server may be silent *between* chunks, not the request as a whole. A
    server that holds the connection open and trickles bytes can run for many
    times the timeout without ever tripping it. Measured here with timeout=20
    set, a trivial "reply with ok=true" call took 161s and returned
    successfully.

    That defeats the point of the budget, and it is not hypothetical: on Vercel
    it means the function runs until the platform kills it, and the user
    watches a spinner for minutes.

    So the request runs on a worker thread and the caller waits with a real
    deadline. On timeout the worker is abandoned rather than cancelled -
    Python cannot kill a thread - but it holds no lock and writes nowhere, so
    the cost is one dangling socket per timeout.
    """
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

    url = f"{BASE}/models/{model}:generateContent"
    outcome: dict = {}

    def worker() -> None:
        try:
            resp = requests.post(
                url,
                params={"key": config.GEMINI_API_KEY},
                json=payload,
                # still set: bounds a genuinely dead socket, which is the
                # common case and much cheaper than leaking threads
                timeout=(10, timeout),
            )
        except requests.RequestException as exc:
            outcome["error"] = GeminiError(f"network failure: {exc}")
            return
        except Exception as exc:                        # pragma: no cover
            outcome["error"] = GeminiError(f"unexpected failure: {exc}")
            return

        if resp.status_code != 200:
            outcome["error"] = GeminiError(f"{resp.status_code} from Gemini: {resp.text[:200]}")
            return

        try:
            parts = resp.json()["candidates"][0]["content"]["parts"]
            outcome["data"] = json.loads(parts[0]["text"])
        except (KeyError, IndexError, json.JSONDecodeError) as exc:
            outcome["error"] = GeminiError(f"unexpected response shape: {exc}")

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    thread.join(timeout)

    if thread.is_alive():
        raise GeminiError(f"no answer within {timeout}s")
    if "error" in outcome:
        raise outcome["error"]
    if "data" not in outcome:
        raise GeminiError("the request finished but produced nothing")
    return outcome["data"]


def generate_json(prompt: str, schema: dict, system: str | None = None,
                  attempts: list[tuple[str, int]] | None = None) -> dict:
    """
    Structured call with one retry on a lighter model.

    Vercel's serverless functions occasionally lose the first Gemini request
    (cold start plus a new region), so a single timeout should not surface as
    a broken feature. Raises GeminiError only if every attempt fails.

    `attempts` lets a caller that can cheaply recover on its own ask for a
    shorter budget. Picking a site type from keywords is worth a few seconds
    and not worth a 65-second wait - see classify_site.
    """
    if not config.GEMINI_API_KEY:
        raise GeminiError("GEMINI_API_KEY is not set")

    attempts = attempts or [(config.GEMINI_MODEL, TIMEOUT), (FALLBACK_MODEL, RETRY_TIMEOUT)]
    last: Exception | None = None
    for model, timeout in attempts:
        try:
            return _call(model, prompt, schema, system, timeout)
        except GeminiError as exc:
            last = exc
    raise GeminiError(f"all Gemini attempts failed; last error: {last}")


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
    # Palettes are interleaved light/dark so the model does not always reach for
    # the first light entry in the list.
    palettes: list[str] = []
    modes = palette_modes()
    for want in ("light", "dark"):
        palettes.extend(p for p in palette_ids() if modes.get(p) == want)

    return {
        "type": "object",
        "properties": {
            "design_name": {"type": "string"},
            "rationale": {"type": "string"},
            "palette": {"type": "string", "enum": palettes},
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

Dark palettes suit evening hours, premium or tech brands. Light suits warmth and
local trust. Pick whichever actually fits the brief.

Design name should read like a real art direction, two or three words, no buzzwords.
Rationale is one short sentence about who this design is for."""

    try:
        raw = generate_json(prompt, design_schema(), system=DESIGN_SYSTEM)
    except GeminiError as exc:
        # Never surface a broken feature: hand back a curated design instead.
        return local_spec(ctx, reason=f"AI unavailable ({exc})")

    spec = normalize_design(raw, sections)
    _complete_variants(spec, sections)
    spec["unassigned"] = [s["id"] for s in sections if s["id"] not in spec["sections"]]
    return spec


def _variant_registry() -> dict[str, list[tuple[str, str]]]:
    """type -> [(variant name, layout family)] straight out of design.js."""
    src = _design_js()
    registry: dict[str, list[tuple[str, str]]] = {}
    for block_type, body in re.findall(r"^\s{4}([a-z]+):\s*\[(.*?)\]", src, re.S | re.M):
        pairs = re.findall(r'\{\s*n:\s*"([a-z]+)",\s*f:\s*"([a-z-]+)"', body)
        if pairs:
            registry[block_type] = pairs
    return registry


def _complete_variants(spec: dict, sections: list[dict]) -> None:
    """
    Fill any section the model left out, so every section has a layout.

    The model is good at art direction and usually names a few layouts, but it
    answers for only part of the list. The rest are chosen here: stable for a
    given design seed, and never two sections of the same layout family in a row
    (the anti-repetition rule from the design system).
    """
    registry = _variant_registry()
    rng = random.Random(spec.get("seed") or 0)

    last_family = ""
    last_variant = ""
    for section in sections:
        chosen = (spec["sections"].get(section["id"]) or {}).get("variant")
        options = registry.get(section["type"])

        if not chosen and options:
            alternatives = [
                (name, fam)
                for name, fam in options
                if fam != last_family and name != last_variant
            ] or options
            chosen, family = alternatives[rng.randrange(len(alternatives))]
            last_family = family
            last_variant = chosen
        elif options:
            for name, fam in options:
                if name == chosen:
                    last_family = fam
                    last_variant = name
                    break

        if chosen:
            spec["sections"].setdefault(section["id"], {})["variant"] = chosen


def local_spec(ctx: dict, reason: str = "") -> dict:
    """
    Deterministic design built from the same curated library, with no AI call.

    Used when Gemini is unreachable so the builder still opens a designed site.
    Same shape as a Gemini result, flagged so the UI can be honest about it.
    """
    sections = ctx.get("sections") or []
    modes = palette_modes()
    by_type = _variants_for_types({s["type"] for s in sections})

    seed = random.randint(1, 2_000_000_000)
    # type affinity, mirroring DESIGN.TYPE_VIBES on the client
    palette_pool = palette_ids()[:4]
    if ctx.get("type") == "restaurant":
        palette_pool = ["terracotta", "newsprint", "pine-bone", "black-tan"]

    picks: dict[str, dict] = {}
    for s in sections:
        options = by_type.get(s["type"]) or ("split",)
        picks[s["id"]] = {"variant": options[random.randrange(len(options))]}

    spec = {
        "v": 1,
        "seed": seed,
        "name": "Curated pick",
        "mode": modes.get(random.choice(palette_pool), "light"),
        "tokens": {
            "palette": random.choice(palette_pool),
            "font": random.choice(font_ids()),
            "radius": random.choice(["0px", "4px", "10px"]),
            "space": random.choice(["compact", "comfy", "airy"]),
            "shadow": random.choice(["flat", "soft", "crisp"]),
        },
        "motion": {"reveal": random.choice([1, 2, 2, 3])},
        "nav": random.choice(["bar", "minimal", "outline"]),
        "footer": 1,
        "sections": picks,
        "source": "fallback",
        "model": "curated-library",
        "rationale": "Picked from the curated library because the AI call was unavailable.",
        "unassigned": [],
    }
    if reason:
        spec["warning"] = reason
    return spec


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

PLAN_SYSTEM = """You are the copywriter for small-business websites built in SiteSketch.
You write concrete, specific copy that a real owner would recognise as their own.

Rules you never break:
- No lorem ipsum, no placeholder text, no bracketed notes.
- No em dashes anywhere.
- No buzzwords such as elevate, seamless, unleash, cutting edge, game changing.
- Headlines under 8 words. Subtitles under 20 words.
- If the description is vague, invent plausible concrete detail rather than hedging.
- Never drift away from what the site is actually for. A programming course site
  must read like a course site, not like a cafe."""

SITE_TYPES = ["business", "portfolio", "restaurant", "store", "school", "blog"]

CLASSIFY_SYSTEM = """You read a short description of a website and decide what kind of site it is.
Answer with one word from the list and nothing else. Judge by what the site is FOR,
not by any word that happens to appear in the text."""


def classify_site(description: str) -> tuple[str, str]:
    """
    Ask the model what kind of site this is.

    The old approach matched keywords in the browser, which got this badly wrong:
    "full stack web programming course" contains no food words, so it silently
    fell back to "business" - and a business page then used restaurant
    interiors as its photography.

    Returns (type, goal). Falls back to a keyword guess, then to business.

    The fallback is only reachable if this call gives up quickly, so it gets a
    single short attempt rather than the usual 20s + 45s pair. /api/plan calls
    this and then generate_plan, and the two budgets stacked: a cold serverless
    region could leave someone staring at a spinner for over two minutes
    before the keyword guess finally kicked in. Classification is a cheap
    question with a good fallback - an answer in 40 seconds is worth nothing.
    """
    attempts = [(config.GEMINI_MODEL, CLASSIFY_TIMEOUT)]
    description = (description or "").strip()
    if not description:
        return "business", "get-contact"

    schema = {
        "type": "object",
        "properties": {
            "type": {"type": "string", "enum": SITE_TYPES},
            "goal": {"type": "string"},
            "reason": {"type": "string"},
        },
        "required": ["type", "goal"],
    }
    prompt = (
        f'Description: "{description}"\n\n'
        "What kind of website is this? Pick the closest type and the goal that "
        "site should be optimised for."
    )

    try:
        raw = generate_json(prompt, schema, system=CLASSIFY_SYSTEM, attempts=attempts)
    except GeminiError:
        return _guess_type(description)

    kind = raw.get("type")
    if kind not in SITE_TYPES:
        return _guess_type(description)

    goal = str(raw.get("goal") or "").strip()
    if goal not in goals_for(kind):
        goal = goals_for(kind)[0]
    return kind, goal


def goals_for(kind: str) -> list[str]:
    """Goal ids offered for a site type, read from the seeded taxonomy."""
    from db import query  # local import: db pulls in config
    try:
        rows = query("select id from goals where type_id = %s order by sort_order", (kind,))
    except Exception:
        return []
    return [r["id"] for r in rows] if rows else []


def _guess_type(description: str) -> tuple[str, str]:
    """Keyword fallback, used only when the model cannot be reached."""
    text = description.lower()
    if re.search(r"\b(food|restaurant|menu|dish|cafe|kitchen|eat|cook|bakery|pizza|sushi|ramen)\b", text):
        kind = "restaurant"
    elif re.search(r"\b(shop|store|sell|product|price|buy|ecommerce|boutique|order)\b", text):
        kind = "store"
    elif re.search(r"\b(portfolio|photograph|designer|illustrat|creative|showcase)\b", text):
        kind = "portfolio"
    elif re.search(r"\b(school|course|class|curriculum|student|teacher|tutor|learn|training|seminar)\b", text):
        kind = "school"
    elif re.search(r"\b(blog|article|post|write|news|newsletter)\b", text):
        kind = "blog"
    else:
        kind = "business"
    goals = goals_for(kind)
    return kind, (goals[0] if goals else "get-contact")


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

    raw = generate_json(prompt, schema, system=PLAN_SYSTEM)
    return {
        "source": "ai",
        "headline": str(raw.get("headline") or "")[:120],
        "tagline": str(raw.get("tagline") or "")[:180],
        "sections": [
            {
                "type": str(row.get("type") or ""),
                "title": str(row.get("title") or "")[:120],
                "subtitle": str(row.get("subtitle") or "")[:220],
                "buttonText": str(row.get("buttonText") or "")[:40],
            }
            for row in (raw.get("sections") or [])
            if row.get("type")
        ],
    }


# ------------------------------------------------------------- offline copy
#
# Written by hand, not generated, so it exists the moment the network does
# not. Measured during development: a trivial Gemini call took 161s and
# succeeded, which means the first run of the wizard could sit on a spinner
# for two and a half minutes. generate_design already had a fallback;
# generate_plan only had a 502, so the whole signup flow broke.
#
# The same rules the model is given, because the fallback copy is still copy
# somebody has to look at: no lorem ipsum, no em dashes, headlines under eight
# words, subtitles under twenty. "{name}" is substituted with the site name.
#
# Two or three variants each, chosen by a seed taken from the description, so
# two bakeries do not receive word-for-word the same page. It is still visibly
# templated - that is the honest cost of it working offline.

FALLBACK_HEADLINES: dict[str, list[str]] = {
    "business":  ["Good work, done properly", "Built to last", "People who do the job right"],
    "restaurant": ["Good food, properly made", "Come hungry", "Made fresh, served daily"],
    "store":     ["Made to last", "Find what you need", "Good things, honest prices"],
    "portfolio": ["Work worth looking at", "Selected projects", "Things I have made"],
    "school":    ["Learn it properly", "Taught by people who do it", "Skills that stick"],
    "blog":      ["Worth reading", "Notes and updates", "Writing about the work"],
}

FALLBACK_SECTIONS: dict[str, list[dict[str, str]]] = {
    "hero": [
        {"title": "Welcome to {name}", "subtitle": "Tell people what you do and why it is worth their time.",
         "buttonText": "Get in touch"},
        {"title": "{name}", "subtitle": "A short line that says what this place is, in plain words.",
         "buttonText": "See more"},
        {"title": "Made with care", "subtitle": "Everything here was chosen for a reason. Here is why.",
         "buttonText": "Find out more"},
    ],
    "about": [
        {"title": "About {name}", "subtitle": "Who you are, how long you have been doing this, and what you care about.",
         "buttonText": "Read more"},
        {"title": "The short version", "subtitle": "Enough about us. Here is the part that matters.",
         "buttonText": "Our story"},
        {"title": "Why we do this", "subtitle": "It started as a small idea and turned into something we are proud of.",
         "buttonText": "More"},
    ],
    "features": [
        {"title": "What we do", "subtitle": "The things people come here for, in plain terms.",
         "buttonText": "Ask us"},
        {"title": "What you get", "subtitle": "Three reasons people choose us over the alternative.",
         "buttonText": "Get started"},
        {"title": "How it works", "subtitle": "Simple from the first message to the last.",
         "buttonText": "Talk to us"},
    ],
    "menu": [
        {"title": "The menu", "subtitle": "Our most-ordered dishes. Prices include everything.",
         "buttonText": "Order"},
        {"title": "What we are cooking", "subtitle": "This changes with the season and with the market.",
         "buttonText": "See the menu"},
        {"title": "Signature dishes", "subtitle": "The ones people keep coming back for.",
         "buttonText": "Order now"},
    ],
    "products": [
        {"title": "What we sell", "subtitle": "Everything here is in stock and ready to go.",
         "buttonText": "Shop now"},
        {"title": "The range", "subtitle": "Pick what you need. Prices are what you see.",
         "buttonText": "Browse"},
        {"title": "Current stock", "subtitle": "Small batches, so things sell out. Check back often.",
         "buttonText": "View all"},
    ],
    "gallery": [
        {"title": "Pictures", "subtitle": "A look at the place and the people in it.",
         "buttonText": "See more"},
        {"title": "Recent work", "subtitle": "A few from the last few months.",
         "buttonText": "More photos"},
        {"title": "Inside {name}", "subtitle": "No stock images. This is what it actually looks like.",
         "buttonText": "Take a look"},
    ],
    "images": [
        {"title": "Photos", "subtitle": "Add your own pictures here and arrange them however you like.",
         "buttonText": "Add photos"},
        {"title": "Show, do not tell", "subtitle": "A few pictures say more than a paragraph.",
         "buttonText": "View gallery"},
        {"title": "Around the place", "subtitle": "Drag these into whatever order suits your story.",
         "buttonText": "More"},
    ],
    "testimonials": [
        {"title": "What people say", "subtitle": "The short version, from people who came before you.",
         "buttonText": "Read more"},
        {"title": "In their words", "subtitle": "We would rather let them speak than write it ourselves.",
         "buttonText": "All reviews"},
        {"title": "Kind words", "subtitle": "A few things customers have told us.",
         "buttonText": "More"},
    ],
    "team": [
        {"title": "Who you will meet", "subtitle": "The people who will actually answer you.",
         "buttonText": "Say hello"},
        {"title": "The team", "subtitle": "Small enough that you get the same face each time.",
         "buttonText": "Meet us"},
        {"title": "Who we are", "subtitle": "No stock photos. These are the actual people.",
         "buttonText": "Contact"},
    ],
    "faq": [
        {"title": "Common questions", "subtitle": "The things people ask before they get in touch.",
         "buttonText": "Ask something"},
        {"title": "Before you ask", "subtitle": "Answers to what most people want to know first.",
         "buttonText": "More"},
        {"title": "Questions", "subtitle": "If yours is not here, just message us.",
         "buttonText": "Get in touch"},
    ],
    "hours": [
        {"title": "Where to find us", "subtitle": "Opening hours and the address, all in one place.",
         "buttonText": "Get directions"},
        {"title": "Opening hours", "subtitle": "Come by. We are usually glad to see you.",
         "buttonText": "Find us"},
        {"title": "Come and see us", "subtitle": "Hours, address and how to get here.",
         "buttonText": "Directions"},
    ],
    "cta": [
        {"title": "Ready when you are", "subtitle": "One message is all it takes to start.",
         "buttonText": "Get started"},
        {"title": "Get in touch", "subtitle": "Tell us what you need and we will come back to you.",
         "buttonText": "Send a message"},
        {"title": "Next step", "subtitle": "No forms that go nowhere. This one gets read.",
         "buttonText": "Contact us"},
    ],
    "contact": [
        {"title": "Contact", "subtitle": "Email, phone or a visit. Whichever suits you.",
         "buttonText": "Send a message"},
        {"title": "Get in touch", "subtitle": "We answer everything, usually the same day.",
         "buttonText": "Message us"},
        {"title": "Say hello", "subtitle": "Use whichever way is easiest for you.",
         "buttonText": "Contact"},
    ],
    "blog": [
        {"title": "Latest writing", "subtitle": "Recent posts, newest first.",
         "buttonText": "Read more"},
        {"title": "From the notebook", "subtitle": "Notes on the work, published occasionally.",
         "buttonText": "See all posts"},
        {"title": "Recent posts", "subtitle": "Short pieces, written when there is something worth saying.",
         "buttonText": "Browse"},
    ],
    "newsletter": [
        {"title": "Stay in touch", "subtitle": "Occasional email. No more than that.",
         "buttonText": "Sign up"},
        {"title": "Get the occasional update", "subtitle": "One email now and then, nothing you did not ask for.",
         "buttonText": "Subscribe"},
        {"title": "Keep up to date", "subtitle": "Sign up and we will keep you posted.",
         "buttonText": "Join"},
    ],
}


def fallback_plan(ctx: dict) -> dict:
    """A complete plan with no network involved.

    Used when generate_plan cannot be reached or does not answer in time. The
    result is marked source="fallback" so the UI can say so rather than
    pretending the model wrote it.
    """
    description = str(ctx.get("description") or "")
    name = str(ctx.get("siteName") or "Our Website").strip() or "Our Website"

    kind, _goal = _guess_type(description)
    types = list(ctx.get("sections") or [])
    if not types:
        types = ["hero", "about", "contact"]

    # Seeded from the description, so the same business gets the same page
    # and two different businesses do not get the same one.
    seed = sum(ord(c) for c in description.lower()) or 1
    rng = random.Random(seed)

    def fill(text: str) -> str:
        return text.replace("{name}", name)

    headlines = FALLBACK_HEADLINES.get(kind) or FALLBACK_HEADLINES["business"]

    sections: list[dict[str, str]] = []
    for key in types:
        options = FALLBACK_SECTIONS.get(key)
        if not options:
            # An unknown type still gets something, so a taxonomy addition
            # never produces a blank band on the page.
            options = [{"title": key.replace("-", " ").title(),
                        "subtitle": f"About {name}.", "buttonText": "Get in touch"}]
        row = options[rng.randrange(len(options))]
        sections.append({
            "type": key,
            "title": fill(row["title"])[:120],
            "subtitle": fill(row["subtitle"])[:220],
            "buttonText": row.get("buttonText", "")[:40],
        })

    return {
        "source": "fallback",
        "headline": headlines[rng.randrange(len(headlines))],
        "tagline": f"{name}, described plainly.",
        "sections": sections,
    }