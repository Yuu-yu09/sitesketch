"""
SiteSketch Flask application.

- serves the JSON API under /api
- serves the prototype pages so `flask run` (or Vercel) can host everything
"""

from __future__ import annotations

import pathlib
import re
from datetime import timedelta

from flask import Flask, jsonify, make_response, request, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager

import auth
import config
import cookies
import gemini
import media
import privacy
import projects
from db import DatabaseUnavailable, query, query_one
from ratelimit import limiter

ROOT = pathlib.Path(__file__).parent

# Only these documents may be framed, and only by us. Everything else gets
# `frame-ancestors 'none'`. See _security_headers.
FRAMEABLE_PATHS = frozenset({"/preview.html", "/preview"})

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["JWT_SECRET_KEY"] = config.SECRET_KEY or "dev-only-insecure"
# Short-lived access token, long-lived refresh token. The access token used
# to fall back to flask-jwt-extended's 15 minute default with nothing to
# renew it, so people were logged out mid-edit for no visible reason.
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(minutes=30)
app.config["JWT_REFRESH_TOKEN_EXPIRES"] = timedelta(days=30)
# Access tokens travel in the Authorization header; refresh tokens live in an
# HttpOnly cookie (see cookies.py). flask-jwt-extended reads both locations for
# either kind and separates them by token type, so the header comes first and
# the cookie is the fallback. "headers" staying listed is also what lets a
# non-browser client - the test suite, curl - rotate a token it was handed
# deliberately. The browser never uses that path.
app.config["JWT_TOKEN_LOCATION"] = ["headers", "cookies"]
app.config["JWT_REFRESH_COOKIE_NAME"] = cookies.REFRESH_COOKIE
app.config["JWT_REFRESH_COOKIE_PATH"] = "/api/auth"
app.config["JWT_REFRESH_COOKIE_SECURE"] = config.IS_PROD
app.config["JWT_REFRESH_COOKIE_SAMESITE"] = "Strict"
# flask-jwt-extended's own CSRF double-submit is turned off because it expects
# the client to fetch a token from a csrf endpoint first. auth._same_origin
# does the same job with the Origin header, which needs no extra round trip and
# no extra cookie.
app.config["JWT_COOKIE_CSRF_PROTECT"] = False

# Only meaningful in production; localhost over http would otherwise break.
app.config["HSTS_MAX_AGE"] = 15552000  # 180 days


@app.after_request
def _security_headers(res):
    """Headers that cost nothing and close off whole classes of attack.

    The CSP is the important one: it is the backstop for any XSS we failed
    to prevent in our own escaping. No inline scripts, no inline event
    handlers, and nothing may be pulled from a source we did not choose.
    """
    # The device preview in the builder frames preview.html same-origin so the
    # page's own media queries see the phone/tablet width. `frame-ancestors
    # 'none'` would block that, and the feature is worth more than the last
    # of the clickjacking risk: framing is still limited to our own origin,
    # so a third-party page cannot dress a preview up as one of its own.
    framed = request.path.rstrip("/") in FRAMEABLE_PATHS

    res.headers.setdefault("X-Content-Type-Options", "nosniff")
    res.headers.setdefault("X-Frame-Options", "SAMEORIGIN" if framed else "DENY")
    res.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    res.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    res.headers.setdefault(
        "Content-Security-Policy",
        "; ".join([
            "default-src 'self'",
            # styles: Google Fonts for the typefaces, unsafe-inline for the
            # small amount of element.style the editor applies while dragging
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com data:",
            # scripts are all local files; no inline, no eval
            "script-src 'self'",
            "img-src 'self' data: blob: https://images.unsplash.com https://*.supabase.co",
            "connect-src 'self' https://*.supabase.co",
            "frame-src 'self'",
            "frame-ancestors 'self'" if framed else "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
        ]),
    )
    if config.IS_PROD:
        res.headers.setdefault(
            "Strict-Transport-Security",
            f"max-age={app.config['HSTS_MAX_AGE']}; includeSubDomains",
        )
    return res
CORS(app)
jwt = JWTManager(app)
app.register_blueprint(auth.bp)
app.register_blueprint(projects.bp)
app.register_blueprint(media.bp)
app.register_blueprint(privacy.bp)


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

PAGES = ("", "index", "login", "register", "dashboard", "plan", "builder", "publish",
         "privacy", "terms")


# ---------------------------------------------------------------- API: health

@app.post("/api/dev/reset-limits")
def dev_reset_limits():
    """Clear the rate limiter counters. Development only.

    The test suite runs every check from one address, so without this the
    register limit would lock the run out partway through and failures
    would look like application bugs. Returns 404 in production so the
    route does not exist on a live deployment.
    """
    if config.IS_PROD:
        return jsonify(error="Not found"), 404
    limiter.reset()
    return jsonify(ok=True)


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

    ctx = {
        "siteName": site_name,
        "type": kind,
        "goal": goal,
        "description": description,
        "sections": section_types,
    }

    try:
        written = gemini.generate_plan(ctx)
    except gemini.GeminiError:
        # A slow or unreachable model must not cost someone their first run.
        # Measured: a trivial Gemini call took 161s, so this path is not
        # theoretical. The plan still builds, the sections are the same
        # ones the taxonomy recommended, and source="fallback" tells the
        # browser to say so rather than pass the copy off as AI-written.
        written = gemini.fallback_plan(ctx)

    return jsonify(
        type=kind,
        goal=goal,
        siteName=site_name,
        headline=written.get("headline", ""),
        tagline=written.get("tagline", ""),
        sections=written.get("sections", []),
        source=written.get("source", "ai"),
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


# ---------------------------------------------------------------- published sites

def _published_site(slug: str):
    """The compiled document for one page of a published site, or None.

    Nothing here needs a session: a published site is public by definition.
    The row has to be published *and* to actually carry compiled pages - a
    project that was published before this feature existed has a slug but no
    document, and must read as "not found" rather than serving a blank page.
    """
    if not slug or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,60}", slug):
        return None
    row = query_one(
        "select slug, published_pages, published_home"
        " from projects where slug = %s and is_published = true",
        (slug,),
    )
    if not row or not row["published_pages"]:
        return None
    return row


@app.get("/site/<slug>")
@app.get("/site/<slug>/")
def site_home(slug: str):
    row = _published_site(slug)
    if not row:
        return _no_site()
    pages = row["published_pages"]
    # published_home, never the first key: published_pages is jsonb and jsonb
    # reorders keys by length and bytewise, so the first key after a round
    # trip is whichever key happened to sort first, not the home page.
    home = row["published_home"] or "home"
    if home not in pages:
        home = "home" if "home" in pages else next(iter(pages), "")
    if not home:
        return _no_site()
    return _site_response(slug, home, pages[home])


@app.get("/site/<slug>/<page_id>")
def site_page(slug: str, page_id: str):
    row = _published_site(slug)
    if not row:
        return _no_site()
    pages = row["published_pages"]
    html = pages.get(page_id)
    if html is None:
        return _no_site()
    return _site_response(slug, page_id, html)


def _site_response(slug: str, page_id: str, html: str):
    res = app.response_class(html, mimetype="text/html; charset=utf-8")
    # The document only changes when the owner republishes, so the validator
    # is built from the slug, the page and its length - deliberately not from
    # view_count, which changes on every hit and would make this never match.
    res.headers["Cache-Control"] = "public, max-age=60, must-revalidate"
    res.headers["ETag"] = f'W/"{slug}-{page_id}-{len(html)}"'
    # A published site is user-authored HTML on our origin. The document has
    # already been stripped on the way in; this is what stops anything that
    # slipped through. No scripts at all - a published page does not use any.
    res.headers["Content-Security-Policy"] = "; ".join([
        "default-src 'none'",
        "style-src 'unsafe-inline' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src https: data:",
        "script-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ])
    res.headers["X-Content-Type-Options"] = "nosniff"
    res.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    _count_view(slug)
    return res


def _count_view(slug: str) -> None:
    """Best effort: a failed counter must never fail the page."""
    try:
        query("update projects set view_count = view_count + 1 where slug = %s", (slug,))
    except Exception:
        pass


def _no_site():
    res = app.response_class(
        "<!doctype html><meta charset=utf-8><title>Not published</title>"
        "<div style=\"font:16px/1.6 system-ui;max-width:34rem;margin:18vh auto;"
        "padding:0 1.5rem;text-align:center\">"
        "<h1 style=\"font-size:1.6rem;margin:0 0 .5rem\">This site isn't published</h1>"
        "<p style=\"color:#5a5f6b;margin:0\">The address may be wrong, or the "
        "owner may have taken it offline.</p></div>",
        mimetype="text/html; charset=utf-8",
    )
    res.status_code = 404
    res.headers["Cache-Control"] = "no-store"
    res.headers["X-Content-Type-Options"] = "nosniff"
    return res


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
    # same reasoning as the 404 handler: a person asking for a page that is
    # not there should get a page, not a JSON object
    if _wants_json():
        return jsonify(error="not found", path=name), 404
    return make_response(_APP_404_HTML, 404)


def _wants_json() -> bool:
    """True when this request is a fetch/XHR against the API.

    The 404 handler used to answer with JSON for everything, so any stale or
    mistyped URL - a /site/... link from an old publish, a deleted project, a
    typo - dumped {"error": "not found"} at a person in their browser
    instead of a page. That is also what the "publishing not found" report
    turned out to be twice over: it was never about publishing.
    """
    if request.path.startswith("/api/"):
        return True
    # an XHR or fetch sends Accept: application/json; a browser navigation
    # asks for text/html. Test the path first so a curl to /api still gets
    # JSON regardless of its Accept header.
    accept = request.headers.get("Accept", "")
    return "application/json" in accept and "text/html" not in accept


_APP_404_HTML = (
    "<!doctype html><meta charset=utf-8><title>Page not found &middot; SiteSketch</title>"
    "<meta name=viewport content='width=device-width,initial-scale=1'>"
    "<div style=\"font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif;"
    "max-width:34rem;margin:18vh auto;padding:0 1.5rem;text-align:center\">"
    "<div style=\"font-size:2rem;margin-bottom:1rem\">&#9888;</div>"
    "<h1 style=\"font-size:1.5rem;margin:0 0 .6rem\">We couldn't find that page</h1>"
    "<p style=\"color:#5a5f6b;margin:0 0 1.6rem\">"
    "The address may have a typo in it, or the page may have moved.</p>"
    "<a href=\"/index.html\" style=\"display:inline-block;padding:.7rem 1.2rem;"
    "border-radius:8px;background:#16283c;color:#fff;text-decoration:none;"
    "font-weight:600\">Back to SiteSketch</a></div>"
)


def _not_found_response():
    """A 404 that matches who is asking.

    A person who mistypes an address gets a page. A script calling the API
    gets JSON. The old handler always answered with JSON, so a stale
    /site/... link or a deleted project dumped {"error": "not found"} into
    the browser - which is what the "publishing not found" report turned out
    to be, twice, and was never about publishing.
    """
    if _wants_json():
        return jsonify(error="not found"), 404
    return make_response(_APP_404_HTML, 404)


@app.errorhandler(404)
def not_found(_err):
    return _not_found_response()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=config.PORT, debug=not config.IS_PROD)