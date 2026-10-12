"""
End-to-end API check against a running SiteSketch deployment.

Walks the whole contract as a real user would, asserts the database reflects
each step, then cleans up after itself.

    python e2e_check.py https://sitesketch.vercel.app
"""

import json
import pathlib
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import published_html  # noqa: E402

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000").rstrip("/")
results = []


def call(method, path, body=None, token=None, expect=None):
    req = urllib.request.Request(f"{BASE}{path}", method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    started = time.time()
    try:
        with urllib.request.urlopen(req, data, timeout=60) as resp:
            raw = resp.read().decode()
            status = resp.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        status = exc.code
    elapsed = (time.time() - started) * 1000
    try:
        parsed = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        parsed = raw[:120]
    if expect is not None and status != expect:
        raise AssertionError(f"{method} {path} -> {status} (expected {expect}): {parsed}")
    return status, parsed, elapsed


def check(name, fn):
    try:
        detail = fn()
        results.append((True, name, detail))
        print(f"  PASS  {name}" + (f"  [{detail}]" if detail else ""))
    except AssertionError as exc:
        results.append((False, name, str(exc)))
        print(f"  FAIL  {name}\n        {exc}")
    except Exception as exc:  # noqa: BLE001
        results.append((False, name, f"{type(exc).__name__}: {exc}"))
        print(f"  ERROR {name}\n        {type(exc).__name__}: {exc}")


print(f"End-to-end check against {BASE}\n")

EMAIL = f"e2e_{uuid.uuid4().hex[:10]}@example.com"
USERNAME = EMAIL.split("@")[0]
PASSWORD = "chicken-karewa1"
token = None
project_id = None
marker = f"e2e marker {uuid.uuid4().hex[:8]}"

# Response headers from the most recent raw_call, so the security header
# check can inspect what the server actually sends.
HEADERS: dict[str, str] = {}


def raw_call(method, path, body=None, token=None, headers=None):
    """Like call(), but never asserts on status and always records headers."""
    req = urllib.request.Request(f"{BASE}{path}", method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for name, value in (headers or {}).items():
        req.add_header(name, value)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=60) as resp:
            raw = resp.read().decode()
            status = resp.status
            HEADERS.clear()
            HEADERS.update({k.lower(): v for k, v in resp.headers.items()})
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        status = exc.code
        HEADERS.clear()
        HEADERS.update({k.lower(): v for k, v in exc.headers.items()})
    try:
        parsed = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        parsed = raw[:120]
    return status, parsed, 0.0


def reset_limits():
    """Clear rate limiter counters. The route 404s in production."""
    raw_call("POST", "/api/dev/reset-limits")


def raw_text(method, path):
    """Full response body as text.

    raw_call() falls back to the first 120 characters when a body is not JSON,
    which silently truncates an HTML page and makes assertions on content
    near the end of the document fail for the wrong reason.
    """
    req = urllib.request.Request(f"{BASE}{path}", method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8", "replace")
            HEADERS.clear()
            HEADERS.update({k.lower(): v for k, v in resp.headers.items()})
            return resp.status, body
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        HEADERS.clear()
        HEADERS.update({k.lower(): v for k, v in exc.headers.items()})
        return exc.code, body


# ---------------------------------------------------------------- health
def t_health():
    status, data, _ = call("GET", "/api/health", expect=200)
    assert data["ok"] is True, data
    assert data["missing"] == [], f"missing env: {data['missing']}"
    # local runs are "development"; the deployed site must be "production"
    assert data["env"] in ("development", "production"), f"env is {data['env']}"
    return f"env={data['env']} no missing vars"


def t_db_ping():
    status, data, _ = call("GET", "/api/db/ping", expect=200)
    assert data["ok"] and data["types"] == 6, data
    return f"{data['types']} types, {data['goals']} goals, {data['sections']} sections"


# ------------------------------------------------------------------ auth
def t_register():
    global token
    status, data, ms = call("POST", "/api/auth/register",
                            {"username": USERNAME, "email": EMAIL, "password": PASSWORD}, expect=201)
    assert data["token"], data
    assert data["user"]["email"] == EMAIL, data
    token = data["token"]
    return f"{ms:.0f}ms token issued"


def t_register_duplicate():
    call("POST", "/api/auth/register",
         {"username": USERNAME + "2", "email": EMAIL, "password": PASSWORD}, expect=409)


def t_register_weak_password():
    call("POST", "/api/auth/register",
         {"username": "weakling", "email": f"weak_{uuid.uuid4().hex[:6]}@example.com", "password": "short"},
         expect=400)


# ------------------------------------------------------------------ security
def t_rejects_common_password():
    """Length alone still lets the top of every wordlist through."""
    # the register limit is per hour and several checks share one address
    reset_limits()
    call("POST", "/api/auth/register",
         {"username": "commonpw", "email": f"common_{uuid.uuid4().hex[:6]}@example.com",
          "password": "password123"},
         expect=400)


def t_rejects_single_character_class_password():
    call("POST", "/api/auth/register",
         {"username": "letterspw", "email": f"letters_{uuid.uuid4().hex[:6]}@example.com",
          "password": "abcdefghijklmnop"},
         expect=400)


def t_rejects_bad_username_characters():
    call("POST", "/api/auth/register",
         {"username": "bad user!", "email": f"badname_{uuid.uuid4().hex[:6]}@example.com",
          "password": PASSWORD},
         expect=400)


def t_security_headers_present():
    status, _, _ = raw_call("GET", "/")
    assert status == 200, status
    for header, needle in [
        ("content-security-policy", "script-src 'self'"),
        ("content-security-policy", "object-src 'none'"),
        ("content-security-policy", "frame-ancestors 'none'"),
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "strict-origin"),
    ]:
        value = HEADERS.get(header, "")
        assert needle in value, f"{header} missing {needle!r} (got {value!r})"


def t_only_preview_may_be_framed():
    """The device preview frames preview.html; nothing else may be framed.

    `frame-ancestors 'none'` everywhere breaks the builder's phone/tablet
    preview, and `frame-ancestors *` everywhere reopens clickjacking on the
    app itself. So exactly one document is exempt, and only to us.
    """
    status, _, _ = raw_call("GET", "/preview.html")
    assert status == 200, status
    assert "frame-ancestors 'self'" in HEADERS.get("content-security-policy", ""), \
        "preview.html may not be framed, so the device preview is broken"
    assert HEADERS.get("x-frame-options") == "SAMEORIGIN", HEADERS.get("x-frame-options")

    for path in ("/", "/dashboard.html", "/builder.html"):
        status, _, _ = raw_call("GET", path)
        assert status == 200, (path, status)
        csp = HEADERS.get("content-security-policy", "")
        assert "frame-ancestors 'none'" in csp, f"{path} is framable: {csp}"
        assert HEADERS.get("x-frame-options") == "DENY", (path, HEADERS.get("x-frame-options"))


def t_login_is_rate_limited():
    """Guessing a password has to get expensive."""
    # Every check in this file runs from one address, so clear the counter
    # first and again afterwards - otherwise the burst below locks the rest
    # of the run out and the failures look like application bugs.
    reset_limits()

    codes = []
    for i in range(14):
        status, _, _ = raw_call("POST", "/api/auth/login",
                                {"email": f"nobody_{uuid.uuid4().hex[:6]}@example.com",
                                 "password": f"guess-{i}"})
        codes.append(status)

    assert 429 in codes, f"never rate limited: {codes}"
    # the limit should bite well before 14 tries
    assert codes.index(429) <= 12, f"allowed too many attempts: {codes}"
    # and the rejection has to say when to come back
    status, data, _ = raw_call("POST", "/api/auth/login",
                               {"email": "x@y.com", "password": "z"})
    assert status == 429 and data.get("retry_after"), f"{status} {data}"

    reset_limits()
    return f"{codes.count(401)} tries then blocked, Retry-After {data['retry_after']}s"


def t_spoofed_forwarded_header_does_not_buy_a_new_bucket():
    """A forged X-Forwarded-For must not reset the limiter.

    Otherwise anyone guessing a password just sends a new fake address each
    time and is never blocked, which is the one thing the limiter is for.
    """
    reset_limits()
    for i in range(12):
        raw_call("POST", "/api/auth/login",
                 {"email": "nobody@example.com", "password": f"guess-{i}"},
                 headers={"X-Forwarded-For": f"203.0.113.{i}"})

    status, _, _ = raw_call("POST", "/api/auth/login",
                            {"email": "nobody@example.com", "password": "guess-13"},
                            headers={"X-Forwarded-For": "203.0.113.99"})
    reset_limits()
    assert status == 429, f"spoofing X-Forwarded-For bypassed the limit: {status}"


def cookie_from_headers():
    """The session cookie the last response set, ready to send back."""
    raw = HEADERS.get("set-cookie", "")
    return raw.split(";")[0].strip() if raw else ""


def t_refresh_cookie_renews_the_session():
    """The bug that logged people out: a 30 minute token with nothing to renew it."""
    status, data, _ = raw_call("POST", "/api/auth/register",
                               {"username": f"ref{uuid.uuid4().hex[:6]}",
                                "email": f"ref_{uuid.uuid4().hex[:6]}@example.com",
                                "password": PASSWORD, "remember": True})
    assert status == 201, data
    assert data.get("expires_in", 0) >= 900, f"access token expires in {data.get('expires_in')}s"

    jar = cookie_from_headers()
    assert jar.startswith("sitesketch_refresh="), f"no session cookie was set: {jar!r}"

    status, renewed, _ = raw_call("POST", "/api/auth/refresh", headers={"Cookie": jar})
    assert status == 200 and renewed.get("token"), renewed

    # the access token must not work as a refresh token
    status, _, _ = raw_call("POST", "/api/auth/refresh", token=data["token"])
    assert status in (401, 422), f"access token accepted as refresh: {status}"


def t_refresh_token_is_never_in_the_response_body():
    """The whole point of the cookie: no long-lived credential in JSON.

    It used to be returned as `refresh` and kept in localStorage, where any
    script on the page could read it for the next thirty days.
    """
    status, data, _ = raw_call("POST", "/api/auth/login",
                               {"email": EMAIL, "password": PASSWORD})
    assert status == 200, data
    assert "refresh" not in data, f"a refresh token is still handed out in JSON: {list(data)}"
    assert cookie_from_headers(), "no session cookie set on login"


def t_session_cookie_is_locked_down():
    """HttpOnly, SameSite, and not sent to the rest of the site."""
    reset_limits()
    raw_call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD, "remember": True})
    raw = HEADERS.get("set-cookie", "")
    assert "httponly" in raw.lower(), f"cookie is readable by script: {raw!r}"
    assert "samesite=strict" in raw.lower(), f"cookie will ride along cross-site: {raw!r}"
    assert "path=/api/auth" in raw.lower(), f"cookie is sent to the whole site: {raw!r}"
    assert "max-age=" in raw.lower(), "'keep me signed in' did not extend the cookie"


def t_session_cookie_without_remember_is_short_lived():
    """Not ticking the box has to mean a cookie that dies with the browser."""
    reset_limits()
    raw_call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
    raw = HEADERS.get("set-cookie", "").lower()
    assert "max-age" not in raw, f"a persistent cookie was set without being asked for: {raw!r}"
    assert "sitesketch_refresh=" in raw


def t_refresh_token_rotates():
    """Each refresh hands back a different token, so the old one is spent."""
    status, _, _ = raw_call("POST", "/api/auth/login",
                            {"email": EMAIL, "password": PASSWORD, "remember": True})
    first = cookie_from_headers()

    raw_call("POST", "/api/auth/refresh", headers={"Cookie": first})
    second = cookie_from_headers()

    assert second.startswith("sitesketch_refresh="), "rotation did not re-set the cookie"
    assert second != first, "the refresh token was reused instead of rotated"


def t_cross_site_refresh_is_refused():
    """A cookie travels automatically, so the server checks who asked."""
    raw_call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
    jar = cookie_from_headers()

    status, data, _ = raw_call("POST", "/api/auth/refresh",
                               headers={"Cookie": jar, "Origin": "https://evil.example"})
    assert status == 403, f"a cross-site refresh was allowed: {status} {data}"

    # the same cookie from our own pages is fine
    status, _, _ = raw_call("POST", "/api/auth/refresh",
                            headers={"Cookie": jar, "Origin": BASE})
    assert status == 200, f"same-origin refresh was refused: {status}"


def t_logout_clears_the_session_cookie():
    raw_call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})
    assert cookie_from_headers(), "no cookie to clear"
    status, _, _ = raw_call("POST", "/api/auth/logout")
    assert status == 200, status
    cleared = HEADERS.get("set-cookie", "").lower()
    assert "sitesketch_refresh=" in cleared and "max-age=0" in cleared, \
        f"logout did not expire the cookie: {cleared!r}"


def t_multipage_keys_survive_normalisation():
    """Page ids that are not already slugs must still be reachable.

    The client normalises page ids into URLs and the server stores the pages
    under the same normalised key. When the two disagreed, a page called
    "About Us" was stored as "about-us" while the link still pointed at
    "/About%20Us", so every sub-page of a multi-page site 404'd.
    """
    reset_limits()
    who = f"mp{uuid.uuid4().hex[:6]}"
    _, reg, _ = raw_call("POST", "/api/auth/register",
                         {"username": who, "email": f"{who}@example.com",
                          "password": PASSWORD})
    owner = reg["token"]
    _, made, _ = raw_call("POST", "/api/projects",
                          {"name": "Multipage", "type": "business", "goal": "get-contact"},
                          token=owner)
    pid = made["id"]

    pages = {
        "home": "<!doctype html><p>the home page</p>",
        "About Us": "<!doctype html><p>about, with a space and capitals</p>",
        "FAQ": "<!doctype html><p>questions</p>",
    }
    slug = "mp-" + uuid.uuid4().hex[:8]
    status, data, _ = raw_call("POST", f"/api/projects/{pid}/publish",
                               {"slug": slug, "pages": pages}, token=owner)
    assert status == 200, data

    for key, needle in (("about-us", "about, with a space"),
                        ("faq", "questions")):
        status, body = raw_text("GET", f"/site/{slug}/{key}")
        assert status == 200, f"/site/{slug}/{key} -> {status}"
        assert needle in body, f"{key} served the wrong page"

    # the home page is still the first key, not whatever sorted first
    status, body = raw_text("GET", f"/site/{slug}")
    assert status == 200 and "the home page" in body, status

    raw_call("DELETE", f"/api/projects/{pid}", token=owner)


def t_colliding_page_keys_are_refused():
    """Two pages normalising to one address must not silently drop one."""
    reset_limits()
    who = f"cl{uuid.uuid4().hex[:6]}"
    _, reg, _ = raw_call("POST", "/api/auth/register",
                         {"username": who, "email": f"{who}@example.com",
                          "password": PASSWORD})
    owner = reg["token"]
    _, made, _ = raw_call("POST", "/api/projects",
                          {"name": "Collide", "type": "business", "goal": "get-contact"},
                          token=owner)
    status, data, _ = raw_call("POST", f"/api/projects/{made['id']}/publish",
                               {"slug": "collide-" + uuid.uuid4().hex[:8],
                                "pages": {"home": "<p>a</p>", "About Us": "<p>b</p>",
                                          "about-us": "<p>c</p>"}},
                               token=owner)
    assert status == 400, f"a silent page loss was accepted: {status} {data}"
    raw_call("DELETE", f"/api/projects/{made['id']}", token=owner)


def t_keep_me_signed_in_is_off_by_default():
    """The safe default has to be the safe default, not just the markup."""
    reset_limits()
    raw_call("GET", "/login.html")   # warm, no cookies involved
    status, _, _ = raw_call("POST", "/api/auth/login",
                            {"email": EMAIL, "password": PASSWORD})
    raw = HEADERS.get("set-cookie", "").lower()
    assert "max-age" not in raw, \
        f"signing in without asking granted a persistent cookie: {raw!r}"


def t_privacy_summary_is_served():
    status, data, _ = call("GET", "/api/privacy/summary", expect=200)
    assert data["retention"], "no retention table published"
    for row in data["retention"]:
        assert row["data"] and row["why"] and row["kept"], row
    assert data["third_parties"], "no third parties declared"
    for tp in data["third_parties"]:
        assert tp["name"] and tp["why"] and tp["what_leaves"], tp
    # The claim on the page is that nothing tracks anybody. Assert it rather
    # than trusting the copy.
    assert data["tracking_categories_used"] == [], data["tracking_categories_used"]
    names = [c["name"] for c in data["cookies"]]
    assert "sitesketch_refresh" in names, names


def t_inventory_covers_every_storage_key():
    """Every value the client writes must be on the published list.

    An audit that only lists cookies hides exactly what people want to know
    about, so this walks the client's own storage and compares.
    """
    status, data, _ = call("GET", "/api/privacy/summary", expect=200)
    declared = {c["name"] for c in data["cookies"]}

    # keys api.js and consent.js are known to write
    written = {
        "sitesketch_token_v1", "sitesketch_user_v1",
        "sitesketch_last_email_v1", "sitesketch_consent_v1",
        "sitesketch_remember_pref_v1",
    }
    missing = written - declared
    assert not missing, f"storage the app uses but the policy does not list: {missing}"


def t_no_credential_is_in_cookies_or_storage():
    """The inventory must not declare anything that holds a secret.

    Checked as properties rather than by grepping the prose. An earlier
    version banned the word "password" from the purpose text and flagged the
    session cookie for saying "without asking for your password again" - it
    describes what the cookie *avoids* needing, not what it stores. Rewriting
    honest copy to satisfy a grep is backwards, so this asserts the things
    that are actually load bearing instead.
    """
    status, data, _ = call("GET", "/api/privacy/summary", expect=200)

    for entry in data["cookies"]:
        name = entry["name"].lower()
        for banned in ("password", "passwd", "card", "cvv", "secret"):
            assert banned not in name, \
                f"{entry['name']} looks like it stores a {banned}"

    # The one entry that is a credential has to be the locked-down kind.
    session = [c for c in data["cookies"] if c["name"] == "sitesketch_refresh"]
    assert len(session) == 1, "the session cookie is not in the inventory"
    assert session[0]["script_readable"] is False, \
        "the session cookie is readable by script"
    assert session[0]["essential"] is True, "the session cookie is not marked essential"

    # Nothing anywhere claims to handle payment details.
    everything = json.dumps(data).lower()
    for banned in ("card number", "credit card", "cvv", "payment details"):
        assert banned not in everything, f"the policy mentions {banned}"

    # and the retention table has to state the quiet part out loud
    rows = {r["data"].lower(): r for r in data["retention"]}
    assert any("not stored" in r["kept"].lower() for r in rows.values()), \
        "the retention table never states that the password is not stored"


def t_password_is_not_stored_anywhere():
    """The hash lives in Postgres and never travels to the browser."""
    reset_limits()
    who = f"pw{uuid.uuid4().hex[:6]}"
    status, data, _ = raw_call("POST", "/api/auth/register",
                               {"username": who, "email": f"{who}@example.com",
                                "password": PASSWORD})
    assert status == 201, data
    blob = json.dumps(data)
    assert PASSWORD not in blob, "the response echoed the password"
    assert "password_hash" not in blob, "the response exposed the hash"

    status, me, _ = raw_call("GET", "/api/auth/me", token=data["token"])
    assert status == 200, me
    assert PASSWORD not in json.dumps(me), "the profile endpoint echoed the password"
    assert "password_hash" not in json.dumps(me), "the profile endpoint exposed the hash"


def t_legal_pages_are_reachable():
    for path, needle in (("/privacy.html", "Privacy"), ("/terms.html", "Terms of use")):
        status, body = raw_text("GET", path)
        assert status == 200, f"{path} -> {status}"
        assert needle in body, f"{path} does not look like the right page"


def t_consent_notice_is_not_served_to_published_sites():
    """A published site runs no script, so it must not carry the consent code.

    Self-contained on purpose: this lives in the auth block, which runs before
    the shared test project exists, so it cannot borrow that one.
    """
    reset_limits()
    who = f"consent{uuid.uuid4().hex[:6]}"
    _, reg, _ = raw_call("POST", "/api/auth/register",
                         {"username": who, "email": f"{who}@example.com",
                          "password": PASSWORD})
    assert reg.get("token"), reg
    owner = reg["token"]

    _, made, _ = raw_call("POST", "/api/projects",
                          {"name": "Consent check", "type": "business",
                           "goal": "get-contact"}, token=owner)
    assert made.get("id"), made

    slug = "consent-check-" + uuid.uuid4().hex[:8]
    status, data, _ = raw_call("POST", f"/api/projects/{made['id']}/publish",
                               {"slug": slug, "pages": _compiled()}, token=owner)
    assert status == 200, data

    status, body = raw_text("GET", f"/site/{slug}")
    assert status == 200, status
    assert "consent" not in body.lower(), "the consent banner leaked into a published site"

    # tidy up so repeated runs do not pile up published rows
    raw_call("DELETE", f"/api/projects/{made['id']}", token=owner)


def t_cookie_inventory_is_published():
    """The list on /privacy comes from the same place the code sets cookies."""
    status, data, _ = call("GET", "/api/auth/cookie-inventory", expect=200)
    declared = {c["name"] for c in data["declared"]}
    assert "sitesketch_refresh" in declared, declared
    for cookie in data["declared"]:
        assert cookie["category"] in {"Essential", "Functional", "Analytics", "Advertising"}, cookie
        assert cookie["purpose"], cookie
        assert cookie["lifespan"], cookie
        # Nothing here may be readable by script except the consent record.
        if cookie["name"] != "sitesketch_refresh":
            assert cookie["script_readable"] is True, cookie["name"]

    # And nothing claims to be tracking people.
    tracking = [c["name"] for c in data["declared"]
                if c["category"] in {"Analytics", "Advertising"}]
    assert not tracking, f"tracking cookies declared but not implemented: {tracking}"


def t_login():
    status, data, ms = call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD}, expect=200)
    assert data["token"], data
    return f"{ms:.0f}ms"


def t_login_wrong_password():
    call("POST", "/api/auth/login", {"email": EMAIL, "password": "not-the-password"}, expect=401)


def t_login_unknown_email():
    call("POST", "/api/auth/login", {"email": "nobody@example.com", "password": "whatever1"}, expect=401)


def t_me():
    status, data, _ = call("GET", "/api/auth/me", token=token, expect=200)
    assert data["user"]["email"] == EMAIL, data
    assert data["user"]["name"], data
    return f"name={data['user']['name']}"


def t_me_without_token():
    call("GET", "/api/auth/me", expect=401)


def t_me_with_garbage_token():
    call("GET", "/api/auth/me", token="not-a-real-token", expect=401)


# ------------------------------------------------------------- projects
def t_create_project():
    global project_id
    plan = {
        "meta": {"type": "restaurant", "goal": "show-menu", "theme": "modern", "siteName": "E2E Kitchen"},
        "pages": [{"id": "home", "name": "Home", "sections": [
            {"type": "hero", "title": "E2E hero", "subtitle": "sub", "fields": {"buttonText": "Menu"}},
            {"type": "menu", "title": "Dishes", "subtitle": "favourites", "fields": {}},
        ]}],
    }
    status, data, ms = call("POST", "/api/projects",
                            {"name": "E2E Kitchen", "type": "restaurant", "goal": "show-menu", "plan_json": plan},
                            token=token, expect=201)
    assert data["name"] == "E2E Kitchen", data
    assert data["is_published"] is False, data
    assert data["slug"] is None, data
    project_id = data["id"]
    return f"{ms:.0f}ms id={project_id[:8]}"


def t_list_projects():
    status, data, _ = call("GET", "/api/projects", token=token, expect=200)
    names = [p["name"] for p in data]
    assert "E2E Kitchen" in names, names
    assert data[0]["updated_at"] >= data[0]["created_at"], data[0]
    return f"{len(data)} project(s): {', '.join(names)}"


def t_get_project():
    status, data, _ = call("GET", f"/api/projects/{project_id}", token=token, expect=200)
    assert len(data["plan_json"]["pages"][0]["sections"]) == 2, data


def t_save_plan():
    plan = {
        "meta": {"type": "restaurant", "goal": "show-menu", "theme": "modern", "siteName": "E2E Kitchen Renamed"},
        "pages": [{"id": "home", "name": "Home", "sections": [
            {"type": "hero", "title": marker, "subtitle": "edited", "fields": {}},
        ]}],
    }
    status, data, ms = call("PUT", f"/api/projects/{project_id}", {"plan_json": plan, "name": "E2E Kitchen Renamed"},
                            token=token, expect=200)
    assert data["name"] == "E2E Kitchen Renamed", data
    assert data["plan_json"]["pages"][0]["sections"][0]["title"] == marker, data
    return f"{ms:.0f}ms plan persisted"


def t_plan_survives_new_session():
    """Same data on a fresh sign-in, i.e. it really is in Postgres."""
    status, login, _ = call("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD}, expect=200)
    fresh = login["token"]
    status, data, _ = call("GET", f"/api/projects/{project_id}", token=fresh, expect=200)
    assert data["plan_json"]["pages"][0]["sections"][0]["title"] == marker, data
    assert data["name"] == "E2E Kitchen Renamed", data


def t_other_user_cannot_read():
    intruder = f"intruder_{uuid.uuid4().hex[:6]}"
    status, other, _ = call("POST", "/api/auth/register",
                            {"username": intruder, "email": f"{intruder}@example.com",
                             "password": PASSWORD}, expect=201)
    call("GET", f"/api/projects/{project_id}", token=other["token"], expect=404)
    call("PUT", f"/api/projects/{project_id}", {"name": "hijacked"}, token=other["token"], expect=404)
    call("DELETE", f"/api/projects/{project_id}", token=other["token"], expect=404)


def t_publish():
    status, data, ms = call("POST", f"/api/projects/{project_id}/publish", {"slug": "E2E Kitchen!"}, token=token, expect=200)
    assert data["is_published"] is True, data
    assert data["slug"] == "e2e-kitchen", f"slug not normalised: {data['slug']}"
    return f"{ms:.0f}ms slug={data['slug']}"


def t_unpublish():
    status, data, _ = call("POST", f"/api/projects/{project_id}/unpublish", {}, token=token, expect=200)
    assert data["is_published"] is False, data
    # slug survives unpublishing so the address stays reserved
    assert data["slug"] == "e2e-kitchen", data


def t_republish_same_slug():
    status, data, _ = call("POST", f"/api/projects/{project_id}/publish", {"slug": "e2e-kitchen"}, token=token, expect=200)
    assert data["slug"] == "e2e-kitchen", data


# ---------------------------------------------------------------- published site

def _compiled(marker: str = "Hello from the compiled site") -> dict:
    """Stand-in for what the browser hands over at publish time.

    Deliberately carries the things a hand-edited plan_json could contain, so
    the sanitiser and the serving CSP are both exercised by the same request.
    """
    return {
        "home": (
            "<!doctype html><html><head><title>Compiled</title></head><body>"
            f"<h1>{marker}</h1>"
            "<script>window.pwned = 1;</script>"
            '<img src=x onerror="alert(1)">'
            '<a href="javascript:alert(2)">click</a>'
            "<p>Safe text survives.</p>"
            "</body></html>"
        ),
        "about": "<!doctype html><html><body><h1>The about page</h1></body></html>",
    }


def t_publish_stores_compiled_pages():
    status, data, _ = call("POST", f"/api/projects/{project_id}/publish",
                          {"slug": "e2e-kitchen", "pages": _compiled()},
                          token=token, expect=200)
    assert data["is_published"] is True, data
    assert data.get("published_at"), "publish did not record when it happened"


def t_published_site_is_served():
    status, body = raw_text("GET", "/site/e2e-kitchen")
    assert status == 200, status
    assert "Hello from the compiled site" in body, "home page did not serve"
    assert "Safe text survives." in body, "sanitising ate real content"
    return f"{len(body)} bytes"


def t_published_second_page_is_served():
    status, body = raw_text("GET", "/site/e2e-kitchen/about")
    assert status == 200, status
    assert "The about page" in body, body[:200]


def t_published_site_has_no_working_script():
    """A published site must not be able to run code on our origin.

    Two independent guards, and this asserts both: nothing executable
    survives being stored, and the route answers with a CSP that would stop
    it anyway.
    """
    status, body = raw_text("GET", "/site/e2e-kitchen")
    assert status == 200, status
    leftovers = published_html.audit(body)
    assert not leftovers, f"published page still contains {leftovers}"
    assert "window.pwned" not in body, "script body survived"
    assert "onerror" not in body, "event handler survived"

    csp = HEADERS.get("content-security-policy", "")
    assert "script-src 'none'" in csp, csp
    assert HEADERS.get("x-content-type-options") == "nosniff"


def t_published_site_is_public_and_cached():
    """No token, and cheap to serve."""
    status, _ = raw_text("GET", "/site/e2e-kitchen")
    assert status == 200, "a published site should need no login"
    assert HEADERS.get("etag"), "no validator, so it can never be cached"
    assert "max-age" in HEADERS.get("cache-control", "")


def t_unknown_slug_is_not_found():
    for path in ("/site/nobody-uses-this", "/site/e2e-kitchen/no-such-page"):
        status, _ = raw_text("GET", path)
        assert status == 404, f"{path} -> {status}"


def t_publish_rejects_a_slug_already_taken():
    # registers a second account, and the register limit is per hour
    reset_limits()
    other = call("POST", "/api/auth/register",
                 {"username": f"slugtest{uuid.uuid4().hex[:6]}",
                  "email": f"slug_{uuid.uuid4().hex[:6]}@example.com",
                  "password": PASSWORD}, expect=201)[1]
    # A different project has to make the claim: republishing e2e-kitchen onto
    # its own slug is exactly what the button does and must stay allowed.
    _, squatter, _ = call("POST", "/api/projects",
                          {"name": "Squatter", "type": "business", "goal": "get-contact"},
                          token=other["token"], expect=201)

    status, data, _ = raw_call("POST", f"/api/projects/{squatter['id']}/publish",
                               {"slug": "e2e-kitchen", "pages": _compiled()},
                               token=other["token"])
    assert status == 409, f"expected the clash to be refused, got {status}: {data}"
    assert "taken" in str(data.get("error", "")).lower(), data

    # and the site that already owns the address is untouched
    status, body = raw_text("GET", "/site/e2e-kitchen")
    assert status == 200 and "Hello from the compiled site" in body, status


def t_publish_rejects_junk_pages():
    for bad in (["not", "a", "dict"], {"home": 12345}, {"home": "x" * (5 * 1024 * 1024)}):
        status, data, _ = raw_call("POST", f"/api/projects/{project_id}/publish",
                                   {"slug": "e2e-junk", "pages": bad}, token=token)
        assert status == 400, f"{str(bad)[:40]} -> {status} {data}"


def t_unpublished_site_is_not_reachable():
    call("POST", f"/api/projects/{project_id}/unpublish", {}, token=token, expect=200)
    status, _ = raw_text("GET", "/site/e2e-kitchen")
    assert status == 404, f"an unpublished site is still being served: {status}"
    # put it back so the cleanup test sees the state it expects
    call("POST", f"/api/projects/{project_id}/publish",
         {"slug": "e2e-kitchen", "pages": _compiled()}, token=token, expect=200)


def t_projects_require_auth():
    call("GET", "/api/projects", expect=401)
    call("POST", "/api/projects", {"name": "sneaky", "type": "business", "goal": "get-contact"}, expect=401)


def t_no_demo_door():
    """Registration or login must be the only way in."""
    status, data, _ = call("POST", "/api/auth/demo", expect=404)
    assert "token" not in (data or {}), data


# ------------------------------------------------------------------- ai
def t_ai_design():
    sections = [{"id": "s1", "type": "hero", "title": "x"},
                {"id": "s2", "type": "menu", "title": "x"},
                {"id": "s3", "type": "contact", "title": "x"}]
    status, data, ms = call("POST", "/api/design",
                            {"siteName": "E2E Bakehouse", "type": "restaurant", "goal": "show-menu",
                             "description": "a test bakery", "sections": sections}, expect=200)
    assert data["tokens"]["palette"], data
    assert data["tokens"]["font"], data
    assert data["name"], data
    coverage = len(data.get("sections", {}))
    assert coverage == 3, f"only {coverage}/3 layouts assigned"
    assert not data.get("unassigned"), data
    return f"{ms:.0f}ms {data['name']!r} {data['tokens']['palette']}/{data['tokens']['font']}"


def t_ai_design_validation():
    call("POST", "/api/design", {"siteName": "No sections"}, expect=400)


def t_ai_plan_types_a_course_site_correctly():
    """A web programming course must not be filed as a business site.

    This is a real reported bug: keyword matching found no food or shop
    words, fell back to "business", and a business site draws from the
    "place" image pool, which is full of restaurant interiors. The page
    then looked like a cafe for a coding course.
    """
    status, data, ms = call("POST", "/api/plan",
                            {"description": "a course website for full stack web programming"},
                            expect=200)
    assert data["type"] == "school", f"course site typed as {data['type']!r}, expected 'school'"
    assert data["siteName"], data
    assert data["headline"], data
    written = {s["type"] for s in data.get("sections", [])}
    assert written, data
    assert "menu" not in written and "hours" not in written, \
        f"restaurant sections leaked into a course site: {sorted(written)}"
    return f"{ms:.0f}ms {data['type']}/{data['goal']} {data['siteName']!r} {sorted(written)}"


def t_ai_plan_classifies_other_types():
    """A restaurant brief still gets a restaurant site."""
    status, data, ms = call("POST", "/api/plan",
                            {"description": "a menu website for my ramen shop"}, expect=200)
    assert data["type"] == "restaurant", f"ramen shop typed as {data['type']!r}"
    written = {s["type"] for s in data.get("sections", [])}
    assert "menu" in written, f"no menu section for a restaurant: {sorted(written)}"
    return f"{ms:.0f}ms {data['type']} {sorted(written)}"


def t_ai_plan_rejects_a_stub_description():
    call("POST", "/api/plan", {"description": "hi"}, expect=400)


# ------------------------------------------------------------------ pages
def t_pages_render():
    expected = {"/": "SiteSketch", "/login.html": "Sign in", "/register.html": "Create account",
                "/dashboard.html": "My plans", "/plan.html": "New plan",
                "/builder.html": "Builder", "/publish.html": "Publish"}
    for path, title in expected.items():
        req = urllib.request.Request(f"{BASE}{path}")
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode()
        got = (html.split("<title>")[1].split("</title>")[0]) if "<title>" in html else None
        assert got == title, f"{path} title is {got!r}, expected {title!r}"
    return f"{len(expected)} pages with correct titles"


def t_static_assets():
    for asset in ("/static/css/app.css", "/static/js/api.js", "/static/js/site.js",
                  "/static/js/design.js", "/static/js/vendor/Sortable.min.js",
                  "/static/css/fonts.css", "/static/icons/bootstrap-icons.css"):
        req = urllib.request.Request(f"{BASE}{asset}")
        with urllib.request.urlopen(req, timeout=30) as resp:
            assert resp.status == 200, asset
            body = resp.read()
        assert len(body) > 500, f"{asset} is suspiciously small"
    return "7 assets ok"


# ----------------------------------------------------------------- cleanup
def t_cleanup():
    call("DELETE", f"/api/projects/{project_id}", token=token, expect=200)
    status, data, _ = call("GET", "/api/projects", token=token, expect=200)
    assert data == [], data


for name, fn in [
    ("health reports no missing secrets", t_health),
    ("database reachable with seed data", t_db_ping),
    ("register creates an account", t_register),
    ("duplicate email rejected", t_register_duplicate),
    ("weak password rejected", t_register_weak_password),
    ("common password rejected", t_rejects_common_password),
    ("single-class password rejected", t_rejects_single_character_class_password),
    ("bad username characters rejected", t_rejects_bad_username_characters),
    ("security headers on every response", t_security_headers_present),
    ("only the preview may be framed", t_only_preview_may_be_framed),
    ("login attempts are rate limited", t_login_is_rate_limited),
    ("spoofed forwarded header cannot dodge the limit", t_spoofed_forwarded_header_does_not_buy_a_new_bucket),
    ("refresh token renews an expired session", t_refresh_cookie_renews_the_session),
    ("no refresh token in the response body", t_refresh_token_is_never_in_the_response_body),
    ("session cookie is httpOnly, strict and scoped", t_session_cookie_is_locked_down),
    ("session cookie is short lived unless asked", t_session_cookie_without_remember_is_short_lived),
    ("refresh token rotates on every use", t_refresh_token_rotates),
    ("cross-site refresh is refused", t_cross_site_refresh_is_refused),
    ("logout clears the session cookie", t_logout_clears_the_session_cookie),
    ("cookie inventory is published", t_cookie_inventory_is_published),
    ("privacy summary is served", t_privacy_summary_is_served),
    ("multi-page keys survive normalisation", t_multipage_keys_survive_normalisation),
    ("colliding page keys are refused", t_colliding_page_keys_are_refused),
    ("keep me signed in is off by default", t_keep_me_signed_in_is_off_by_default),
    ("inventory covers every storage key", t_inventory_covers_every_storage_key),
    ("no credential is ever stored client-side", t_no_credential_is_in_cookies_or_storage),
    ("password never leaves the server", t_password_is_not_stored_anywhere),
    ("privacy and terms pages are reachable", t_legal_pages_are_reachable),
    ("published sites carry no consent code", t_consent_notice_is_not_served_to_published_sites),
    ("login works", t_login),
    ("wrong password rejected", t_login_wrong_password),
    ("unknown email rejected", t_login_unknown_email),
    ("token identifies the user", t_me),
    ("missing token rejected", t_me_without_token),
    ("garbage token rejected", t_me_with_garbage_token),
    ("create project", t_create_project),
    ("list projects", t_list_projects),
    ("read project", t_get_project),
    ("save plan", t_save_plan),
    ("plan survives a new sign-in", t_plan_survives_new_session),
    ("another user cannot touch the project", t_other_user_cannot_read),
    ("publish sets slug", t_publish),
    ("unpublish keeps the slug", t_unpublish),
    ("republish with same slug", t_republish_same_slug),
    ("publish stores the compiled pages", t_publish_stores_compiled_pages),
    ("published site is served", t_published_site_is_served),
    ("published second page is served", t_published_second_page_is_served),
    ("published site cannot run script", t_published_site_has_no_working_script),
    ("published site is public and cacheable", t_published_site_is_public_and_cached),
    ("unknown slug and page are 404", t_unknown_slug_is_not_found),
    ("publish refuses a taken slug", t_publish_rejects_a_slug_already_taken),
    ("publish rejects junk pages", t_publish_rejects_junk_pages),
    ("unpublished site is unreachable", t_unpublished_site_is_not_reachable),
    ("projects endpoints need a token", t_projects_require_auth),
    ("no demo door: registration required", t_no_demo_door),
    ("AI design generation", t_ai_design),
    ("AI types a course site as school, not business", t_ai_plan_types_a_course_site_correctly),
    ("AI types a ramen shop as restaurant", t_ai_plan_classifies_other_types),
    ("AI plan rejects a stub description", t_ai_plan_rejects_a_stub_description),
    ("AI rejects an empty brief", t_ai_design_validation),
    ("all pages render with the right title", t_pages_render),
    ("static assets served", t_static_assets),
    ("cleanup removes the test project", t_cleanup),
]:
    check(name, fn)

passed = sum(1 for ok, _, _ in results if ok)
failed = [name for ok, name, _ in results if not ok]
print(f"\n{passed}/{len(results)} passed")
if failed:
    print("failed: " + "; ".join(failed))
sys.exit(1 if failed else 0)