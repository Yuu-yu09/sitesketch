"""
Auth: email + password with hashed credentials, issued as JWTs.

Passwords are hashed with werkzeug (scrypt). The plaintext password is never
stored, logged, or returned.

The refresh token is handed out as an HttpOnly cookie rather than in the
response body, so no script on the page can read it. That moves the threat
from "XSS steals a 30-day token" to "another site tries to make the browser
send the cookie", which is what _same_origin_exists_for_cookie_auth below
and the cookie's SameSite=Strict setting between them close off.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

from flask import Blueprint, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)
from werkzeug.security import check_password_hash, generate_password_hash

import config
import cookies
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


def _session(user: dict, status: int = 200, remember: bool = False):
    """A login response: a short access token plus a refresh cookie.

    The access token expires in minutes on purpose. Without a refresh token
    that meant people were silently signed out every fifteen minutes while
    they were working, which read as "it logged me out for no reason".

    The refresh token is no longer handed back in the body for the client to
    store. It goes into an HttpOnly cookie, so a script that manages to run on
    the page cannot read it - it used to sit in localStorage for thirty days,
    which meant one XSS was thirty days of access to the account.
    """
    identity = str(user["id"])
    claims = {"username": user["username"]}
    # The lifespan the person chose rides along inside the refresh token. The
    # browser will not tell the server whether a cookie is persistent or a
    # session cookie, so the only way to honour "Keep me signed in" across a
    # rotation is to have recorded it somewhere the server can read.
    refresh = create_refresh_token(
        identity=identity,
        additional_claims=dict(claims, remember=bool(remember)),
    )
    response = jsonify(
        token=create_access_token(identity=identity, additional_claims=claims),
        expires_in=_access_seconds(),
        user=_public(user),
    )
    response.status_code = status
    return cookies.set_refresh_cookie(response, refresh, remember)


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
    return _session(user, 201, remember=_remember(body))


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
    del token  # replaced by _session, which also issues the refresh cookie
    return _session(row, remember=_remember(body))


def _remember(body: dict) -> bool:
    """Did the person ask to stay signed in?

    Default is False: staying signed in for thirty days has to be something
    you choose, not something you get by ignoring a checkbox.
    """
    return bool((body or {}).get("remember"))


def _same_origin(req) -> bool:
    """True when the browser says this request came from our own pages.

    Needed because the refresh token is a cookie: the browser attaches it to
    any request, including one another site tried to make it send. Two
    independent things stop that, and this is the half that works even if the
    browser is old enough to ignore SameSite:

      - the cookie is SameSite=Strict, so a cross-site request never carries
        it in the first place;
      - this check refuses anything whose Origin or Referer is not us.

    Origin is the header to look at. It cannot be forged by a page in a
    browser (only by a non-browser client, which could just skip the cookie
    anyway). Referer is the fallback for the rare browser that omits Origin on
    a same-origin POST.

    Requests with neither header are allowed. A non-browser client is not
    carrying a cookie it did not receive deliberately, and rejecting them
    would break the test suite and curl for no security gain.
    """
    for header in ("Origin", "Referer"):
        raw = req.headers.get(header)
        if not raw:
            continue
        if raw == "null":
            # some privacy tools strip Origin down to the literal "null"
            return False
        host = urlparse(raw).netloc or raw.split("//")[-1].split("/")[0]
        if host and host == req.host:
            return True
        return False
    return True


@bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    """Trade a still-valid refresh token for a fresh access token.

    The client calls this silently whenever an access token has run out, so
    someone halfway through editing their site is never bounced to the login
    screen for it.

    The refresh token is replaced every time. That is the rotation the
    checklist asks for: the value that was just used stops being useful, so
    a cookie captured at any one moment is worth much less than the full
    thirty days. A stolen cookie still works until its own expiry, so this is
    defence in depth rather than complete replay protection - see SECURITY.md
    for what detecting reuse would need.
    """
    if not _same_origin(request):
        return jsonify(error="Cross-site request refused"), 403

    identity = get_jwt_identity()
    claims = {"username": get_jwt().get("username")}
    if not claims.get("username"):
        row = db.query_one("select username from users where id = %s", (identity,))
        if not row:
            return jsonify(error="Account no longer exists"), 401
        claims["username"] = row["username"]

    remember = bool(get_jwt().get("remember"))
    response = jsonify(
        token=create_access_token(identity=identity, additional_claims=claims),
        expires_in=_access_seconds(),
    )
    # issue the successor and overwrite the cookie in the same response
    return cookies.set_refresh_cookie(
        response,
        create_refresh_token(
            identity=identity,
            additional_claims=dict(claims, remember=remember),
        ),
        remember,
    )


@bp.post("/logout")
def logout():
    """Drop the session cookie.

    Stateless tokens cannot be revoked server-side, so this clears the
    browser's copy of the refresh token. The access token in memory stays
    valid until it expires on its own, which is why it is short lived.
    """
    return cookies.clear_refresh_cookie(jsonify(ok=True))


@bp.get("/cookie-inventory")
def cookie_inventory():
    """The declared cookie list, for /privacy and for the audit test."""
    return jsonify(cookies.inventory_for_api())


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