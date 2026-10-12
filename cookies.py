"""Cookie handling and the cookie inventory.

Two jobs.

1. The refresh token lives in an HttpOnly cookie rather than in web storage.
   That is the whole reason this module exists. A token in localStorage can
   be read by any script that manages to run on the page, and ours used to
   live for thirty days, so one XSS was thirty days of account access. An
   HttpOnly cookie cannot be read by script at all. The trade is that the
   browser now attaches it to requests automatically, so the cookie-authed
   endpoints check the Origin header - see auth.py.

2. The inventory below. Every cookie the site can set is declared here with
   its category, purpose and lifespan, and /privacy renders straight from it,
   so the published list cannot drift away from what the code actually does.
   tests/e2e_check.py asserts the same thing from the other direction.

Categories follow the usual GDPR vocabulary:

  Essential    needed for a feature to work at all; cannot be declined
  Functional   remembers a choice; no tracking, no third party
  Analytics    measuring how the site is used
  Advertising  targeted advertising and cross-site tracking

Only Essential cookies are set today. Nothing in this codebase writes an
Analytics or Advertising cookie, and the consent banner says so rather than
pretending otherwise - see the note in consent.js.
"""

from __future__ import annotations

from flask import Response

import config

# ---------------------------------------------------------------- the inventory

REFRESH_COOKIE = "sitesketch_refresh"

COOKIE_INVENTORY: list[dict] = [
    {
        "name": REFRESH_COOKIE,
        "category": "Essential",
        "purpose": (
            "Keeps you signed in. Holds a signed session token that lets the "
            "server recognise you without asking for your password again."
        ),
        "lifespan": "Until you close the browser, or 30 days if you chose “Keep me signed in”",
        "essential": True,
        "script_readable": False,
        "third_party": False,
        "details": (
            "HttpOnly, so no script can read it. SameSite=Strict, so it is never "
            "attached to a request from another site. Scoped to /api/auth, so it "
            "is not sent when your published site is being viewed. It holds no "
            "personal data: not your name, not your email, not your password."
        ),
    },
    {
        "name": "sitesketch_consent",
        "category": "Functional",
        "purpose": "Remembers that you have seen the cookie notice, so it is not shown on every visit.",
        "lifespan": "12 months",
        "essential": False,
        "script_readable": True,
        "third_party": False,
        "details": "Contains only the categories you agreed to. No identifier, no fingerprint.",
    },
]

# What is actually set today. Kept separate from the inventory above because
# the inventory also lists things that are only set if a feature that needs
# them is ever switched on, and /privacy must not imply they are in use.
COOKIES_IN_USE = {REFRESH_COOKIE}


def inventory_for_api() -> dict:
    """Machine-readable inventory, so a test can check the code against it."""
    return {
        "in_use": sorted(COOKIES_IN_USE),
        "declared": COOKIE_INVENTORY,
        "categories": sorted({c["category"] for c in COOKIE_INVENTORY}),
    }


# ---------------------------------------------------------------- the mechanics

def set_refresh_cookie(response: Response, token: str, remember: bool) -> Response:
    """Attach the session cookie to a login or refresh response.

    `remember` decides the lifespan: a session cookie when False, which is
    exactly "expires when the browser closes", or thirty days when True. Both
    are short compared with the token itself, and it rotates on every refresh
    (see auth.refresh), so a stolen cookie is useful for minutes rather than
    for the length of the token.
    """
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        # Seven days is the floor browsers accept for Max-Age; anything
        # shorter and they treat the cookie as a session cookie anyway.
        max_age=30 * 24 * 60 * 60 if remember else None,
        # Scoped to the auth endpoints. The cookie is never needed to view a
        # page, a static file or somebody else's published site, so it should
        # not travel with those requests.
        path="/api/auth",
        httponly=True,
        secure=config.IS_PROD,
        # Strict, not Lax: the browser should not attach this cookie to any
        # request initiated by another site, which is what makes the Origin
        # check in auth.py a second layer rather than the only one.
        samesite="Strict",
    )
    return response


def clear_refresh_cookie(response: Response) -> Response:
    """Remove the session cookie. Attributes must match or the browser keeps it."""
    response.delete_cookie(
        key=REFRESH_COOKIE,
        path="/api/auth",
        httponly=True,
        secure=config.IS_PROD,
        samesite="Strict",
    )
    return response
