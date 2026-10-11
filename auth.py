"""
Auth: email + password with hashed credentials, issued as JWTs.

Passwords are hashed with werkzeug (scrypt). The plaintext password is never
stored, logged, or returned. OAuth sign-in lives in oauth.py.
"""

from __future__ import annotations

import re
import secrets

from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt, get_jwt_identity, jwt_required
from werkzeug.security import check_password_hash, generate_password_hash

import config
import db

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8

PUBLIC_USER = "id, username, email, role, created_at"


def _problem(username: str, email: str, password: str) -> str | None:
    if not username or len(username) < 3:
        return "Username needs at least 3 characters."
    if not EMAIL_RE.match(email or ""):
        return "That email address does not look right."
    if not password or len(password) < MIN_PASSWORD:
        return f"Password needs at least {MIN_PASSWORD} characters."
    return None


def _public(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        # the screens render user.name; username stays for clarity in the API
        "name": row["username"],
        "username": row["username"],
        "email": row["email"],
        "role": row["role"],
    }


@bp.post("/register")
def register():
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    problem = _problem(username, email, password)
    if problem:
        return jsonify(error=problem), 400

    if db.query_one("select id from users where lower(email) = %s", (email,)):
        return jsonify(error="That email is already registered. Try signing in."), 409
    if db.query_one("select id from users where lower(username) = %s", (username,)):
        return jsonify(error="That username is taken. Try another."), 409

    user = db.query_one(
        f"insert into users (username, email, password_hash) values (%s, %s, %s) "
        f"returning {PUBLIC_USER}",
        (username, email, generate_password_hash(password)),
    )
    token = create_access_token(
        identity=str(user["id"]),
        additional_claims={"username": user["username"]},
    )
    return jsonify(token=token, user=_public(user)), 201


@bp.post("/login")
def login():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    row = db.query_one(
        "select id, username, email, role, password_hash from users where lower(email) = %s",
        (email,),
    )
    # Same message either way so the endpoint cannot be used to find accounts.
    if not row or not check_password_hash(row["password_hash"], password):
        return jsonify(error="Email or password is incorrect."), 401

    token = create_access_token(
        identity=str(row["id"]),
        additional_claims={"username": row["username"]},
    )
    return jsonify(token=token, user=_public(row))


@bp.post("/demo")
def demo():
    """
    One-click sign-in for ?demo=1, for local screenshots and walkthroughs only.

    Disabled unless DEMO_MODE=1, so the public deployment has no demo door.
    Creates the demo account on first use and returns a real token.
    """
    if not config.DEMO_MODE:
        return jsonify(error="Not found"), 404

    demo_email = config.DEMO_EMAIL
    row = db.query_one(
        f"select {PUBLIC_USER} from users where lower(email) = %s",
        (demo_email,),
    )
    if not row:
        row = db.query_one(
            f"insert into users (username, email, password_hash) values (%s, %s, %s) "
            f"returning {PUBLIC_USER}",
            ("demo", demo_email, generate_password_hash(secrets.token_urlsafe(24))),
        )

    token = create_access_token(
        identity=str(row["id"]),
        additional_claims={"username": row["username"], "provider": "demo"},
    )
    return jsonify(token=token, user=_public(row))


@bp.get("/me")
@jwt_required()
def me():
    row = db.query_one(
        f"select {PUBLIC_USER} from users where id = %s",
        (get_jwt_identity(),),
    )
    if not row:
        return jsonify(error="Account no longer exists"), 401
    user = _public(row)
    user["provider"] = get_jwt().get("provider", "password")
    return jsonify(user=user)