"""
Projects: the plans a student builds, stored in Postgres.

Every row belongs to the signed-in user (JWT identity). plan_json holds the whole
Plan plus, once generated, the design spec - the single source of truth for the
builder, the compiled site and the publish flow.
"""

from __future__ import annotations

import json
import re

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

import db
import published_html

bp = Blueprint("projects", __name__, url_prefix="/api/projects")

NOT_SLUG = re.compile(r"[^a-z0-9]+")

# A published site is compiled HTML that we store and serve. The cap keeps one
# project from filling the table: roughly a dozen pages of generated markup.
MAX_PUBLISHED_BYTES = 4 * 1024 * 1024
MAX_PUBLISHED_PAGES = 40
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$")


def slugify(text: str) -> str:
    out = NOT_SLUG.sub("-", (text or "").lower()).strip("-")[:60]
    return out or "my-site"


def page_key(page_id: str) -> str:
    """The key a compiled page is stored and served under.

    Must agree with SS.pageKey in static/js/site.js, because the client builds
    the nav links and the server stores the pages from the same compile step.
    When they disagreed, a page id of "About Us" was stored as "about-us"
    while the link still pointed at "/About%20Us", so every sub-page 404'd.
    """
    return NOT_SLUG.sub("-", (page_id or "").lower()).strip("-")[:60]


def clean_published_pages(raw, home_hint: str = "") -> tuple[dict, str, str | None]:
    """Validate and sanitise the compiled pages sent with a publish request.

    Returns (pages, home, error). Anything executable is stripped before it
    reaches the database, so a stored published site is inert even before the
    route that serves it adds `script-src 'none'`.

    `home` is returned explicitly rather than worked out from the dict later,
    because published_pages is jsonb and jsonb does not preserve key order.
    """
    if raw is None:
        # Not "no error": a request with no compiled pages at all would
        # otherwise set is_published = true and serve a site that 404s.
        # An empty object is already refused below; a missing key means the
        # same thing and has to be refused the same way.
        return {}, "", "There were no pages to publish"
    if not isinstance(raw, dict):
        return {}, "", "Compiled pages must be an object of page id to HTML"

    pages: dict[str, str] = {}
    total = 0
    for page_id, html in list(raw.items())[:MAX_PUBLISHED_PAGES + 1]:
        if not isinstance(page_id, str) or not isinstance(html, str):
            return {}, "", "Compiled pages must be strings"
        key = page_key(page_id)
        if not key:
            return {}, "", f"“{page_id}” cannot be used as a page address"
        if key in pages:
            # "About Us" and "about-us" both normalise to about-us. One of
            # them would silently vanish, which is worse than a refusal.
            return {}, "", f"Two pages both want the address “{key}”"
        total += len(html)
        if total > MAX_PUBLISHED_BYTES:
            return {}, "", "That site is too large to publish"
        pages[key] = published_html.sanitise(html)

    if not pages:
        return {}, "", "There were no pages to publish"
    if len(pages) > MAX_PUBLISHED_PAGES:
        return {}, "", "That site has too many pages"

    # Fall back to the conventional name, then to whatever exists, rather than
    # trusting the order the keys happen to come back in.
    home = page_key(home_hint or "")
    if home not in pages:
        home = "home" if "home" in pages else next(iter(pages))
    return pages, home, None


def serialize(row: dict) -> dict:
    """Shape matches the old localStorage objects so the screens need no changes."""
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "type": row["type_id"],
        "goal": row["goal_id"],
        "theme": row["theme"],
        "slug": row["slug"],
        "is_published": row["is_published"],
        "view_count": row["view_count"],
        "created_at": int(row["created_at"].timestamp() * 1000),
        "updated_at": int(row["updated_at"].timestamp() * 1000),
        "plan_json": row["plan_json"] or {},
        "published_at": (int(row["published_at"].timestamp() * 1000)
                         if row.get("published_at") else None),
    }


def _owned(project_id: str) -> dict | None:
    return db.query_one(
        "select * from projects where id = %s::uuid and user_id = %s::uuid",
        (project_id, get_jwt_identity()),
    )


@bp.get("")
@jwt_required()
def index():
    rows = db.query(
        "select * from projects where user_id = %s::uuid order by updated_at desc",
        (get_jwt_identity(),),
    )
    return jsonify([serialize(r) for r in rows])


@bp.post("")
@jwt_required()
def create():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "My Website").strip()[:60] or "My Website"
    row = db.query_one(
        "insert into projects (user_id, type_id, goal_id, name, plan_json, theme, slug)"
        " values (%s::uuid, %s, %s, %s, %s::jsonb, %s, %s)"
        " returning *",
        (
            get_jwt_identity(),
            body.get("type") or "business",
            body.get("goal") or "get-contact",
            name,
            json.dumps(body.get("plan_json") or {}),
            body.get("theme") or "modern",
            body.get("slug"),
        ),
    )
    return jsonify(serialize(row)), 201


@bp.get("/<pid>")
@jwt_required()
def show(pid: str):
    row = _owned(pid)
    if not row:
        return jsonify(error="Project not found"), 404
    return jsonify(serialize(row))


@bp.put("/<pid>")
@jwt_required()
def update(pid: str):
    if not _owned(pid):
        return jsonify(error="Project not found"), 404

    body = request.get_json(silent=True) or {}
    sets: list[str] = []
    params: list = []

    if "name" in body:
        sets.append("name = %s")
        params.append((body["name"] or "My Website").strip()[:60])
    if "slug" in body:
        raw = body["slug"]
        sets.append("slug = %s")
        params.append(slugify(raw) if raw else None)
    if "theme" in body:
        sets.append("theme = %s")
        params.append(body["theme"] or "modern")
    if "plan_json" in body:
        sets.append("plan_json = %s::jsonb")
        params.append(json.dumps(body["plan_json"] or {}))

    if not sets:
        row = _owned(pid)
        return jsonify(serialize(row))

    params.extend([pid, get_jwt_identity()])
    row = db.query_one(
        f"update projects set {', '.join(sets)} where id = %s::uuid and user_id = %s::uuid returning *",
        params,
    )
    return jsonify(serialize(row))


@bp.post("/<pid>/publish")
@jwt_required()
def publish(pid: str):
    if not _owned(pid):
        return jsonify(error="Project not found"), 404
    body = request.get_json(silent=True) or {}

    slug = slugify(body.get("slug") or body.get("name") or "")
    if not SLUG_RE.match(slug):
        return jsonify(error="That address can only use letters, numbers and dashes"), 400

    pages, home, problem = clean_published_pages(body.get("pages"), body.get("home") or "")
    if problem:
        return jsonify(error=problem), 400

    # Slugs are the public address, so a clash has to be a clear refusal
    # rather than a unique-constraint error surfacing as a 500.
    taken = db.query_one(
        "select id from projects where slug = %s and id <> %s::uuid",
        (slug, pid),
    )
    if taken:
        return jsonify(error=f"“{slug}” is already taken. Try another address."), 409

    row = db.query_one(
        "update projects"
        " set is_published = true, slug = %s, published_pages = %s::jsonb,"
        "     published_home = %s, published_at = now()"
        " where id = %s::uuid and user_id = %s::uuid returning *",
        (slug, json.dumps(pages), home, pid, get_jwt_identity()),
    )
    return jsonify(serialize(row))


@bp.post("/<pid>/unpublish")
@jwt_required()
def unpublish(pid: str):
    """Take the site offline.

    The compiled pages are left in place so republishing is instant, but the
    public route only ever serves a row whose is_published is true, so
    nothing is reachable while this is false.
    """
    if not _owned(pid):
        return jsonify(error="Project not found"), 404
    row = db.query_one(
        "update projects set is_published = false"
        " where id = %s::uuid and user_id = %s::uuid returning *",
        (pid, get_jwt_identity()),
    )
    return jsonify(serialize(row))


@bp.get("/<pid>/export.zip")
@jwt_required()
def export_zip(pid: str):
    """Download the published site as a ZIP that opens locally.

    The compiled pages already live in `published_pages`. Inside the stored
    documents every internal link points at the live address -
    /site/<slug>/about-us - because that is what the published copy needs.
    Those links die the moment the copy leaves the server: file:// cannot
    resolve them. So the ZIP rewrites exactly the two link shapes the
    renderer emits (the home page and /site/<slug>/<key>) to their relative
    file names, which makes the archive open as a working site offline.
    Anything else in the document is left untouched.

    Refused loudly if there is nothing published - the button is on the
    publish page and says what it is doing, so a silent zip-of-nothing
    would be the old "button that pretends" mistake again.
    """
    import io
    import zipfile

    from flask import send_file

    row = _owned(pid)
    if not row:
        return jsonify(error="Project not found"), 404
    pages = row.get("published_pages") or {}
    if not row["is_published"] or not row.get("published_home") or not pages:
        return jsonify(error="Publish the site first - a download needs a " +
                             "finished copy to zip"), 400

    slug = row["slug"] or "site"
    home = row["published_home"] if row["published_home"] in pages \
        else next(iter(pages))
    live = "/site/" + slug

    # The renderer emits exactly two internal href shapes - the home page as
    # <live> and any other page as <live>/<key> - each optionally carrying a
    # #section anchor. Order matters: sub-pages are rewritten first so the
    # home rule cannot swallow their path as a fragment. Rewriting both to
    # file names turns every stored document into a working relative site.
    # The quote guards names that merely contain the live path from a
    # half-rewritten fate. §-fragments travel because file:// links to
    # named sections stay valid relative.
    def to_local(html: str) -> str:
        esc = re.escape(live)
        html = re.sub(
            r'(["\'])' + esc + r"/(?P<k>[a-z0-9][a-z0-9-]*)(?P<f>[^\"']*)[\"']",
            lambda m: m.group(1) + m.group("k") + ".html" +
                      (m.group("f") if m.group("f").startswith("#") else "") +
                      m.group(1),
            html,
        )
        html = re.sub(
            r'(["\'])' + esc + r'(?P<f>[^"\']*)["\']',
            lambda m: m.group(1) + "index.html" +
                      (m.group("f") if m.group("f").startswith("#") else "") +
                      m.group(1),
            html,
        )
        return html

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for key, html in pages.items():
            name = "index.html" if key == home else key + ".html"
            zf.writestr(name, to_local(html))
        zf.writestr(
            "README.txt",
            "%s - downloaded from SiteSketch on %s\n\n"
            "This is the exact copy visitors see at:\n"
            "    https://<your-host>/site/%s\n\n"
            "index.html is the home page. Every other page is a file of its\n"
            "own, and the links between them are relative, so opening\n"
            "index.html in a browser works with no server - double-click it.\n\n"
            "Editing these files will not change the live site; republish\n"
            "from SiteSketch instead.\n"
            % (row["name"],
               row["published_at"].strftime("%Y-%m-%d") if
               row.get("published_at") else "(date missing)",
               slug),
        )
    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True,
                     download_name=slug + ".zip")


@bp.delete("/<pid>")
@jwt_required()
def destroy(pid: str):
    removed = db.query_one(
        "delete from projects where id = %s::uuid and user_id = %s::uuid returning id",
        (pid, get_jwt_identity()),
    )
    if not removed:
        return jsonify(error="Project not found"), 404
    return jsonify(ok=True, id=str(removed["id"]))