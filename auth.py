"""
Auth: email + password with hashed credentials, issued as JWTs.

Passwords are hashed with werkzeug (scrypt). The plaintext password is never
stored, logged, or returned. OAuth sign-in lives in oauth.py.
"""

from __future__ import annotations

import re

from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)
from werkzeug.security import check_password_hash, generate_password_hash

import db
from ratelimit import client_key, limiter

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Columns that make up a user as seen by the API. Never includes
# password_hash. It is a fixed literal, so interpolating it into SQL is
# safe - no caller ever supplies this string.
PUBLIC_USER = "id, username, email, role, created_at"

MIN_PASSWORD = 10
PASSWORD_CLASSES = 3
# Very common passwords and their keyboard shapes. A length rule on its own
# still lets "password123" through, which is in every wordlist ever published.
WEAK = {
    "password", "password1", "password123", "passw0rd", "12345678", "123456789",
    "1234567890", "qwertyuiop", "qwerty123", "iloveyou", "letmein1", "welcome1",
    "admin123", "administrator", "abc12345", "football", "baseball", "sunshine",
    "princess", "dragon123", "monkey12", "shadow12", "trustno1", "superman",
    "starwars", "whatever", "sitesketch", "changeme", "secret123", "test1234",
}

# Attempts allowed per window, per IP address.
LOGIN_LIMIT = (10, 300)      # 10 tries every 5 minutes
REGISTER_LIMIT = (5, 3600)   # 5 sign-ups an hour from one address


def _too_many(req, scope: str, limit: tuple[int, int]):
    """Return a 429 response when this caller is over budget, else None."""
    count, window = limit
    key = client_key(req, scope)
    if not limiter.allow(key, count, window):
        retry = limiter.retry_after(key, window)
        return (
            jsonify(
                error="Too many attempts. Please wait a moment and try again.",
                retry_after=retry,
            ),
            429,
            {"Retry-After": str(retry)},
        )
    return None


def _password_problem(password: str) -> str | None:
    if not password or len(password) < MIN_PASSWORD:
        return f"Password needs at least {MIN_PASSWORD} characters."
    classes = sum([
        bool(re.search(r"[a-z]", password)),
        bool(re.search(r"[A-Z]", password)),
        bool(re.search(r"\d", password)),
        bool(re.search(r"[^A-Za-z0-9]", password)),
    ])
    if classes < PASSWORD_CLASSES:
        return ("Use a mix of letters, numbers and symbols, or a long passphrase "
                "made of several words.")
    lowered = (password or "").lower()
    if lowered in WEAK or "password" in lowered or "qwerty" in lowered:
        return "That password is too common. Pick something harder to guess."
    return None


def _problem(username: str, email: str, password: str) -> str | None:
    if not username or len(username) < 3:
        return "Username needs at least 3 characters."
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,40}", username or ""):
        return "Usernames may use letters, numbers, dot, dash and underscore."
    if not EMAIL_RE.match(email or "") or len(email) > 254:
        return "That email address does not look right."
    return _password_problem(password)


def _session(user: dict, status: int = 200):
    """A login response: a short access token plus a long refresh token.

    The access token expires in minutes on purpose. Without a refresh token
    that meant people were silently signed out every fifteen minutes while
    they were working, which read as "it logged me out for no reason".
    """
    identity = str(user["id"])
    claims = {"username": user["username"]}
    return jsonify(
        token=create_access_token(identity=identity, additional_claims=claims),
        refresh=create_refresh_token(identity=identity, additional_claims=claims),
        expires_in=_access_seconds(),
        user=_public(user),
    ), status


def _access_seconds() -> int:
    from flask import current_app

    raw = current_app.config.get("JWT_ACCESS_TOKEN_EXPIRES")
    try:
        return int(raw.total_seconds())
    except AttributeError:
        return 900


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
    blocked = _too_many(request, "register", REGISTER_LIMIT)
    if blocked:
        return blocked

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
    del token  # replaced by _session, which also issues a refresh token
    return _session(user, 201)


@bp.post("/login")
def login():
    blocked = _too_many(request, "login", LOGIN_LIMIT)
    if blocked:
        return blocked

    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    row = db.query_one(
        "select id, username, email, role, password_hash from users where lower(email) = %s",
        (email,),
    )
    # Same message and roughly the same work either way, so the endpoint
    # cannot be used to work out which accounts exist.
    if not row or not check_password_hash(row["password_hash"], password):
        if not row:
            # burn comparable time against a real hash
            check_password_hash(
                "scrypt:32768:8:1$placeholder$" + "0" * 128, password or "x"
            )
        return jsonify(error="Email or password is incorrect."), 401

    token = create_access_token(
        identity=str(row["id"]),
        additional_claims={"username": row["username"]},
    )
    del token  # replaced by _session, which also issues a refresh token
    return _session(row)


@bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    """Trade a still-valid refresh token for a fresh access token.

    The client calls this silently whenever an access token has run out, so
    someone halfway through editing their site is never bounced to the login
    screen for it.
    """
    identity = get_jwt_identity()
    claims = {"username": get_jwt().get("username")}
    if not claims.get("username"):
        row = db.query_one("select username from users where id = %s", (identity,))
        if not row:
            return jsonify(error="Account no longer exists"), 401
        claims["username"] = row["username"]

    return jsonify(
        token=create_access_token(identity=identity, additional_claims=claims),
        expires_in=_access_seconds(),
    )


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