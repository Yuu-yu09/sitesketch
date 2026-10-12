"""
SiteSketch Flask application.

- serves the JSON API under /api
- serves the prototype pages so `flask run` (or Vercel) can host everything
"""

from __future__ import annotations

import pathlib
import re
from datetime import timedelta

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager

import auth
import config
import gemini
import media
import projects
from db import DatabaseUnavailable, query, query_one

ROOT = pathlib.Path(__file__).parent

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["JWT_SECRET_KEY"] = config.SECRET_KEY or "dev-only-insecure"
app.config["JWT_TOKEN_LOCATION"] = ["headers"]
# Short-lived access token, long-lived refresh token. The access token used
# to fall back to flask-jwt-extended's 15 minute default with nothing to
# renew it, so people were logged out mid-edit for no visible reason.
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(minutes=30)
app.config["JWT_REFRESH_TOKEN_EXPIRES"] = timedelta(days=30)
CORS(app)
jwt = JWTManager(app)
app.register_blueprint(auth.bp)
app.register_blueprint(projects.bp)
app.register_blueprint(media.bp)


# Every rejected token answers 401 with the same shape, so the client has one
# code path to handle instead of chasing 401/422 variants.
@jwt.unauthorized_loader
def _no_token(reason):
    return jsonify(error="Please sign in."), 401


@jwt.invalid_token_loader
def _bad_token(reason):
    return jsonify(error="Your session is not valid. Please sign in again."), 401


@jwt.expired_token_loader
def _expired_token(jwt_header, jwt_payload):
    return jsonify(error="Your session expired. Please sign in again."), 401


@jwt.revoked_token_loader
def _revoked_token(jwt_header, jwt_payload):
    return jsonify(error="That session is no longer valid."), 401

PAGES = ("", "index", "login", "register", "dashboard", "plan", "builder", "publish")


# ---------------------------------------------------------------- API: health

@app.get("/api/health")
def health():
    return jsonify(
        ok=True,
        env=config.NODE_ENV,
        port=config.PORT,
        gemini_configured=bool(config.GEMINI_API_KEY),
        supabase_key_configured=bool(config.SUPABASE_KEY),
        missing=config.missing(),
    )


@app.get("/api/db/ping")
def db_ping():
    try:
        row = query_one(
            "select (select count(*) from website_types) as types,"
            "       (select count(*) from goals) as goals,"
            "       (select count(*) from section_templates) as sections"
        )
    except DatabaseUnavailable as exc:
        return jsonify(ok=False, error=str(exc)), 503
    return jsonify(ok=True, **row)


# ------------------------------------------------------- API: taxonomy (plan)

@app.get("/api/types")
def api_types():
    rows = query(
        "select id, name, description, icon from website_types order by sort_order"
    )
    return jsonify([dict(r) for r in rows])


@app.get("/api/goals")
def api_goals():
    type_id = request.args.get("type")
    if type_id:
        rows = query(
            "select id, type_id, name from goals where type_id = %s order by sort_order",
            (type_id,),
        )
    else:
        rows = query("select id, type_id, name from goals order by type_id, sort_order")
    return jsonify([dict(r) for r in rows])


@app.get("/api/sections")
def api_sections():
    type_id = request.args.get("type")
    if type_id:
        rows = query(
            "select id, section_type, name, sort_order, default_json"
            " from section_templates where type_id = %s order by sort_order",
            (type_id,),
        )
    else:
        rows = query(
            "select id, section_type, name, sort_order, default_json"
            " from section_templates order by type_id, sort_order"
        )
    return jsonify([dict(r) for r in rows])


# ------------------------------------------------------------------- API: AI

@app.post("/api/plan")
def api_plan():
    """
    Turn a one-sentence description into a typed, written plan.

    Body: { description, siteName? }
    Returns: { type, goal, siteName, headline, tagline, sections: [{type, title, subtitle}] }

    The type is decided by the model from what the site is FOR. It used to be
    guessed from keywords in the browser, which filed a web programming course
    under "business" and gave it restaurant photography.
    """
    body = request.get_json(silent=True) or {}
    description = (body.get("description") or "").strip()
    if len(description) < 8:
        return jsonify(error="Describe your site in a sentence first"), 400

    try:
        kind, goal = gemini.classify_site(description)
    except gemini.GeminiError as exc:
        return jsonify(error="ai_unavailable", detail=str(exc)), 502

    section_types = _sections_for(kind, goal)
    site_name = (body.get("siteName") or _name_from(description)).strip()[:60]

    try:
        written = gemini.generate_plan({
            "siteName": site_name,
            "type": kind,
            "goal": goal,
            "description": description,
            "sections": section_types,
        })
    except gemini.GeminiError as exc:
        return jsonify(error="ai_unavailable", detail=str(exc)), 502

    return jsonify(
        type=kind,
        goal=goal,
        siteName=site_name,
        headline=written.get("headline", ""),
        tagline=written.get("tagline", ""),
        sections=written.get("sections", []),
    )


def _sections_for(kind: str, goal: str) -> list[str]:
    """The section list the seeded taxonomy recommends for this type."""
    from db import query
    try:
        rows = query(
            "select section_type from section_templates "
            "where type_id = %s order by sort_order",
            (kind,),
        )
    except Exception:
        rows = []
    if rows:
        return [r["section_type"] for r in rows]
    return _FALLBACK_SECTIONS.get(kind, _FALLBACK_SECTIONS["business"])


# mirrors TYPE_SECTIONS in static/js/api.js, used only if the seed is missing
_FALLBACK_SECTIONS = {
    "business":   ["hero", "about", "features", "testimonials", "cta", "contact"],
    "portfolio":  ["hero", "about", "images", "testimonials", "contact"],
    "restaurant": ["hero", "menu", "about", "hours", "gallery", "contact"],
    "store":      ["hero", "products", "features", "testimonials", "cta", "contact"],
    "school":     ["hero", "about", "gallery", "faq", "contact"],
    "blog":       ["hero", "blog", "about", "newsletter", "contact"],
}


def _name_from(description: str) -> str:
    """A sensible site name: a quoted phrase, else the words before 'for'."""
    quoted = re.search(r'["“‘]([^"”’]{2,40})["”’]', description)
    if quoted:
        return quoted.group(1).strip()

    stop = {
        "website", "site", "page", "landing", "online", "and", "with", "my", "our",
        "the", "for", "that", "this", "an", "a", "want", "need", "create", "make",
        "build", "about", "using",
    }
    base = re.split(r"\s+for\s+", description, maxsplit=1)[0]
    base = re.sub(r"^(i want |i need |a |an |the |create |make |build )", "", base, flags=re.I)
    words = [w for w in re.findall(r"[A-Za-z0-9']+", base) if len(w) > 2 and w.lower() not in stop][:3]
    if not words:
        return "My Website"
    return " ".join(w[:1].upper() + w[1:] for w in words)


@app.post("/api/design")
def api_design():
    """
    Generate a full design spec for a plan.

    Body: { siteName, type, goal, description, sections: [{id, type, title}] }
    Returns the v1 spec consumed by static/js/design.js - same shape the browser
    mock produces, so nothing downstream needs to know Gemini was involved.
    """
    body = request.get_json(silent=True) or {}
    ctx = {
        "siteName": (body.get("siteName") or "My Website")[:60],
        "type": body.get("type") or "business",
        "goal": body.get("goal") or "get-contact",
        "description": (body.get("description") or "")[:400],
        "sections": body.get("sections") or [],
    }
    if not ctx["sections"]:
        return jsonify(error="sections are required", hint="send [{id, type, title}]"), 400
    try:
        spec = gemini.generate_design(ctx)
    except gemini.GeminiError as exc:
        return jsonify(error="ai_unavailable", detail=str(exc)), 502
    return jsonify(spec)


@app.get("/api/design/library")
def api_design_library():
    """The curated library the UI shows in the customizer."""
    return jsonify(
        palettes=gemini.palette_ids(),
        fonts=gemini.font_ids(),
        variants=gemini.variant_names(),
        model=config.GEMINI_MODEL,
    )


# ---------------------------------------------------------------- page serving

@app.get("/")
def page_index():
    return send_from_directory(ROOT, "index.html")


@app.get("/<name>.html")
def page_html(name: str):
    """Serve any committed .html page (Vercel serves these from the CDN first;
    this keeps `flask run` and the function fallback behaving the same)."""
    candidate = (ROOT / f"{name}.html").resolve()
    if candidate.parent == ROOT.resolve() and candidate.exists():
        return send_from_directory(ROOT, candidate.name)
    return jsonify(error="not found", path=name), 404


@app.errorhandler(404)
def not_found(_err):
    return jsonify(error="not found"), 404


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=config.PORT, debug=not config.IS_PROD)