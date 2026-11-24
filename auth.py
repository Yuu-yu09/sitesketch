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

import hashlib
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from html import escape as html_escape
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
import mailer
from ratelimit import client_key, limiter

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Columns that make up a user as seen by the API. Never includes
# password_hash. It is a fixed literal, so interpolating it into SQL is
# safe - no caller ever supplies this string.
PUBLIC_USER = "id, username, email, role, created_at"
# The same columns plus the one the tokens are stamped with. Kept apart from
# PUBLIC_USER because token_version is not part of the user as the API
# describes them - it exists so a password reset can expire old sessions.
SESSION_COLUMNS = PUBLIC_USER + ", token_version"

MIN_PASSWORD = 8
# No character-class rule. Requiring an uppercase letter, a digit and a
# symbol was measured against the people it governs: it locked users out of
# their own sign-up form more often than it kept anyone safe, and NIST's
# current guidance drops composition rules for exactly that reason - length
# carries the strength here. The common-password list below still refuses
# the top of every wordlist, so "length alone" cannot let "password123"
# through; what it no longer does is reject a perfectly good passphrase for
# lacking a symbol.
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
FORGOT_LIMIT = (3, 3600)     # 3 "email me a link" requests an hour
RESET_LIMIT = (10, 3600)     # 10 link submissions an hour

RESET_MINUTES = 30
# /forgot answers in at least this long. An address that exists costs one
# insert and one HTTP call to Resend; an address that does not costs neither,
# and the gap is trivially measurable. Without the floor the "we never say
# whether an account exists" answer would be a formality.
ANSWER_FLOOR = 0.35


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


def _answer_after(started: float, floor: float = ANSWER_FLOOR) -> None:
    """Hold a reply until it has taken at least `floor` seconds."""
    left = floor - (time.monotonic() - started)
    if left > 0:
        time.sleep(left)


def _password_problem(password: str) -> str | None:
    if not password or len(password) < MIN_PASSWORD:
        return f"Password needs at least {MIN_PASSWORD} characters."
    lowered = (password or "").lower()
    if lowered in WEAK or "password" in lowered or "qwerty" in lowered:
        return "That password is too common. Pick something harder to guess."
    return None


def _problem(username: str, email: str, password: str) -> str | None:
    """What is wrong with a sign-up, in the order a person would hit it.

    This used to validate `username` as a username - letters, numbers, dot,
    dash and underscore - while the form field was labelled "Your name".
    Typing your actual name got "Usernames may use letters, numbers, dot,
    dash and underscore", which is both wrong and baffling: "Jane O'Brien"
    and "Mary Jane" are not usernames but they are names.

    The field is a display name. It is stored, shown, and put in a token
    claim; it is never a URL, a filename or a selector, so the characters a
    name actually uses are safe here. Letters, spaces, apostrophes, hyphens,
    dots, digits and underscores, starting with a letter.

    Two things were left out of the first version of this and both were
    caught by existing accounts rather than by thought. Digits, and then the
    underscore. The underscore matters beyond tidiness: accounts created
    under the old username rule can contain one, so refusing it here would
    stop somebody re-registering with a name they already hold.
    """
    name = (username or "").strip()
    if len(name) < 2:
        return "Please enter your name."
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9 _'\-.À-ɏ]{1,39}", name):
        return ("Your name may use letters, spaces, apostrophes, dots, "
                "dashes, numbers and underscores, and needs to start with "
                "a letter.")
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
    # tv is the user's token_version. It rides in both tokens so that a
    # password reset can bump the column and leave every older session
    # unable to renew itself - see refresh() and reset_password().
    claims = {"username": user["username"], "tv": int(user.get("token_version") or 0)}
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
    # lower() on the column but not on the parameter, so this compared
    # 'mary jane' against 'Mary Jane' and matched nothing. A duplicate name
    # therefore fell through to the database, which raised a unique
    # violation and answered 500 with a stack trace - to anyone whose name
    # had an upper-case letter in it. Found by registering "Mary Jane"
    # twice.
    if db.query_one("select id from users where lower(username) = lower(%s)",
                    (username,)):
        return jsonify(error="That name is already registered. Try another."), 409

    # The pre-checks above are for a good error message, not for safety:
    # two people can pass them at the same moment and the database is the
    # thing that actually guarantees uniqueness. So the constraint is also
    # caught here. Letting it escape answers 500 with a stack trace, which
    # is a server fault to tell someone who did nothing wrong beyond
    # picking a popular name.
    try:
        user = db.query_one(
            f"insert into users (username, email, password_hash) values (%s, %s, %s) "
            f"returning {SESSION_COLUMNS}",
            (username, email, generate_password_hash(password)),
        )
    except Exception as exc:
        if "users_username_key" in str(exc):
            return jsonify(error="That name is already registered. Try another."), 409
        if "users_email_key" in str(exc):
            return jsonify(error="That email is already registered. Try signing in."), 409
        raise
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
        "select id, username, email, role, password_hash, token_version"
        " from users where lower(email) = %s",
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
    # One row read per refresh - at most every thirty minutes per session -
    # buys the two things a stateless token cannot know on its own: whether
    # the account still exists, and whether its password has been reset since
    # this cookie was issued.
    row = db.query_one(
        "select username, token_version from users where id = %s", (identity,)
    )
    if not row:
        return jsonify(error="Account no longer exists"), 401
    # Tokens minted before token_version existed carry no tv; they read as 0,
    # which is what every account starts at, so this logs nobody out.
    if int(get_jwt().get("tv", 0)) != int(row["token_version"]):
        response = cookies.clear_refresh_cookie(
            jsonify(error="Your password was changed. Please sign in again.")
        )
        response.status_code = 401
        return response

    claims = {"username": row["username"], "tv": int(row["token_version"])}
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


# ------------------------------------------------------------ password reset

def _hash_token(raw: str) -> str:
    """SHA-256 of the link token.

    Not a password hash: the token is 32 random bytes, so there is no wordlist
    to slow a guesser down for, and a deliberately slow hash would only make
    every reset attempt slow for us. What matters is that the database holds
    no value that can be turned back into a working link.
    """
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _reset_link(raw: str) -> str:
    return f"{config.APP_URL.rstrip('/')}/reset.html?token={raw}"


def _reset_text(name: str, link: str) -> str:
    return (
        f"Hello {name},\n\n"
        "Someone asked to reset the password for your SiteSketch account.\n"
        f"Open this link to choose a new one. It works once, for {RESET_MINUTES} minutes:\n\n"
        f"{link}\n\n"
        "If this was not you, nothing has changed and you can ignore this "
        "message. Your current password still works.\n"
    )


def _reset_html(name: str, link: str) -> str:
    # Inline styles only: mail clients throw away most stylesheets, so anything
    # cleverer than this arrives as an unstyled block of text.
    return (
        '<div style="font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#16283C">'
        f"<p>Hello {html_escape(name)},</p>"
        "<p>Someone asked to reset the password for your SiteSketch account.</p>"
        f'<p><a href="{html_escape(link)}" style="display:inline-block;background:#16283C;'
        'color:#fff;padding:.7rem 1.1rem;border-radius:6px;text-decoration:none">'
        "Choose a new password</a></p>"
        f'<p style="color:#5a5f6b">The link works once, for {RESET_MINUTES} minutes. '
        "If this was not you, nothing has changed - your current password still "
        "works.</p></div>"
    )


@bp.post("/forgot")
def forgot():
    """Email a reset link. Answers the same way whatever it found.

    The reply cannot say "no such account", or the form becomes a way to ask
    which addresses are registered. So the same sentence goes out either way
    and the work is padded to ANSWER_FLOOR, because the account-dependent
    branch costs an insert and a call to Resend and the other costs neither.
    """
    started = time.monotonic()
    blocked = _too_many(request, "forgot", FORGOT_LIMIT)
    if blocked:
        return blocked

    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    generic = ("If that address has an account, a reset link is on its way. "
               f"It expires in {RESET_MINUTES} minutes.")

    if EMAIL_RE.match(email) and len(email) <= 254:
        row = db.query_one(
            "select id, username, email from users where lower(email) = %s",
            (email,),
        )
        if row:
            raw = secrets.token_urlsafe(32)
            # Drop this account's dead rows first: an expired or already-used
            # link can never work again, so keeping it is just a copy of a
            # credential sitting in the table.
            db.execute(
                "delete from password_resets where user_id = %s"
                " and (used_at is not null or expires_at < now())",
                (row["id"],),
            )
            db.execute(
                "insert into password_resets (user_id, token_hash, expires_at)"
                " values (%s, %s, %s)",
                (row["id"], _hash_token(raw),
                 datetime.now(timezone.utc) + timedelta(minutes=RESET_MINUTES)),
            )
            link = _reset_link(raw)
            mailer.send(
                row["email"],
                "Reset your SiteSketch password",
                _reset_text(row["username"], link),
                _reset_html(row["username"], link),
            )

    _answer_after(started)
    return jsonify(ok=True, message=generic)


@bp.post("/reset")
def reset_password():
    """Trade a valid link for a new password.

    Order matters: the link is checked before the password is judged, so an
    expired link says so rather than complaining about a password the person
    is about to have to retype anyway.
    """
    blocked = _too_many(request, "reset", RESET_LIMIT)
    if blocked:
        return blocked

    body = request.get_json(silent=True) or {}
    raw = (body.get("token") or "").strip()
    password = body.get("password") or ""
    if not raw or len(raw) > 200:
        return jsonify(error="That reset link is incomplete. Request a new one."), 400

    # The expiry is compared in SQL rather than in Python: the database clock
    # is the one that stamped the row.
    row = db.query_one(
        "select id, user_id,"
        "       (expires_at < now()) as expired,"
        "       (used_at is not null) as used"
        " from password_resets where token_hash = %s",
        (_hash_token(raw),),
    )
    if not row or row["used"] or row["expired"]:
        return jsonify(error="That reset link has expired or has already been "
                             "used. Request a new one."), 400

    problem = _password_problem(password)
    if problem:
        return jsonify(error=problem), 400

    db.execute(
        "update users set password_hash = %s,"
        " token_version = token_version + 1 where id = %s",
        (generate_password_hash(password), row["user_id"]),
    )
    # Close every outstanding link for the account, this one included. Two
    # links can be live at once (a retry, two devices), and the older one must
    # not be able to undo the reset that already happened.
    db.execute(
        "update password_resets set used_at = now()"
        " where user_id = %s and used_at is null",
        (row["user_id"],),
    )
    return jsonify(ok=True, message="Your password has been changed. "
                                    "Sign in with the new one.")