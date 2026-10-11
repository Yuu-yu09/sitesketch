"""
SiteSketch Flask application.

- serves the JSON API under /api
- serves the prototype pages so `flask run` (or Vercel) can host everything
"""

from __future__ import annotations

import pathlib

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

import config
from db import DatabaseUnavailable, query, query_one

ROOT = pathlib.Path(__file__).parent

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.config["JWT_SECRET_KEY"] = config.SECRET_KEY or "dev-only-insecure"
CORS(app)

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
        demo_mode=config.DEMO_MODE,
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


# ---------------------------------------------------------------- page serving

@app.get("/")
def page_index():
    return send_from_directory(ROOT, "index.html")


@app.get("/<name>.html")
def page_html(name: str):
    if name in PAGES:
        return send_from_directory(ROOT, f"{name}.html")
    return jsonify(error="not found", path=name), 404


@app.errorhandler(404)
def not_found(_err):
    return jsonify(error="not found"), 404


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=config.PORT, debug=not config.IS_PROD)