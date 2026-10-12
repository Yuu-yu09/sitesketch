"""
End-to-end API check against a running SiteSketch deployment.

Walks the whole contract as a real user would, asserts the database reflects
each step, then cleans up after itself.

    python e2e_check.py https://sitesketch.vercel.app
"""

import json
import sys
import time
import urllib.error
import urllib.request
import uuid

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


def t_refresh_token_renews_the_session():
    """The bug that logged people out: a 30 minute token with nothing to renew it."""
    status, data, _ = raw_call("POST", "/api/auth/register",
                               {"username": f"ref{uuid.uuid4().hex[:6]}",
                                "email": f"ref_{uuid.uuid4().hex[:6]}@example.com",
                                "password": PASSWORD})
    assert status == 201 and data.get("refresh"), data
    assert data.get("expires_in", 0) >= 900, f"access token expires in {data.get('expires_in')}s"

    status, renewed, _ = raw_call("POST", "/api/auth/refresh",
                                  token=data["refresh"])
    assert status == 200 and renewed.get("token"), renewed

    # the access token must not work as a refresh token
    status, _, _ = raw_call("POST", "/api/auth/refresh", token=data["token"])
    assert status in (401, 422), f"access token accepted as refresh: {status}"


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
    ("refresh token renews an expired session", t_refresh_token_renews_the_session),
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