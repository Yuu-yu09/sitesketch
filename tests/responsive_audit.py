"""
Responsive audit: measure what actually breaks at each size.

Guessing produces CSS nobody asked for. This drives a real project through
the builder at phone, tablet and desktop widths and reports concrete
numbers:

  * horizontal overflow - the single most common mobile defect
  * any individual element sticking out past the viewport edge
  * interactive targets smaller than 44px, which are hard to hit with a thumb
  * body text under 14px, which is unreadable on a phone in daylight

Run:
    .venv\\Scripts\\python.exe tests\\responsive_audit.py http://127.0.0.1:3000
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
import uuid

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
PASSWORD = "chicken-karewa1"

# (label, width, height, touch?)
#
# The touch flag matters. A 390px viewport driven by a mouse is not a phone -
# it is a narrow window - so judging phone layouts with pointer:fine produces
# both false alarms and false confidence. The app answers differently to
# (pointer: coarse), so the audit has to ask the same question.
SIZES = [
    ("phone", 390, 844, True),
    ("phone-small", 320, 568, True),      # the narrowest phone still in use
    ("tablet", 820, 1180, True),
    ("laptop", 1280, 800, False),
    ("desktop", 1680, 1050, False),
]

# Every visitor meets these before they have an account. They are measured
# at every size for the same reason the published site is: nothing else
# here produces them, so nothing else would ever notice them breaking.
PUBLIC_PAGES = ["/index.html", "/login.html", "/register.html"]

# 44px is Apple's comfortable touch target. WCAG 2.2 AA asks for 24x24, which
# is the right bar for a mouse-driven desktop and would fail every icon
# button in the builder for no good reason.
MIN_TAP_TOUCH = 44.0
MIN_TAP_MOUSE = 24.0
MIN_BODY_PX = 14.0

# The probe runs inside the page. Returns raw findings; the caller judges them.
PROBE = """
(minTapArg) => {
  const minTap = minTapArg || 44;
  const doc = document.documentElement;
  const out = {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    overflowing: [],
    smallTargets: [],
    tinyText: []
  };

  const vw = doc.clientWidth;
  const label = (el) => {
    const bits = [el.tagName.toLowerCase()];
    if (el.id) bits.push('#' + el.id);
    if (el.className && typeof el.className === 'string') {
      bits.push('.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.'));
    }
    const text = (el.innerText || '').trim().split('\\n')[0];
    if (text) bits.push('"' + text.slice(0, 28) + '"');
    return bits.join(' ');
  };

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const box = el.getBoundingClientRect();
    if (!box.width && !box.height) continue;

    // anything reaching past the right edge, ignoring tiny rounding noise
    if (box.right > vw + 1) {
      out.overflowing.push({
        el: label(el),
        right: Math.round(box.right),
        vw: vw,
        width: Math.round(box.width)
      });
    }

    // interactive things a finger has to hit
    if (el.matches('a, button, input, select, textarea, [role="button"]')) {
      // A checkbox or radio is not measured by its box. WCAG target size
      // is the whole tappable region, and for these that is the label
      // wrapped around them: the "Keep me signed in" row is 44px tall and
      // tapping anywhere on the text toggles the box. Judging the 20px
      // square on its own flags a target nobody actually has difficulty
      // hitting, and the obvious "fix" - a 44px checkbox - would look
      // absurd. The label is only used when it is genuinely larger.
      let h = box.height;
      if (el.matches('input[type="checkbox"], input[type="radio"]')) {
        const lab = el.closest('label');
        if (lab) h = Math.max(h, lab.getBoundingClientRect().height);
      }
      if (h > 0 && h < minTap && box.width > 0) {
        out.smallTargets.push({ el: label(el), h: Math.round(h), w: Math.round(box.width) });
      }
    }

    // body copy that has become unreadable
    //
    // aria-hidden is excluded, and not as a convenience. An element the
    // screen reader will not announce is not body copy: on the landing page
    // the 11.5px "chips" are a picture of a website header, and the
    // browser font minimum does not apply to something decorative. That
    // distinction is the only honest way to exempt them - an exemption
    // keyed on class name would quietly stop measuring the real page.
    if (el.children.length === 0 && (el.textContent || '').trim().length > 12
        && !el.closest('[aria-hidden="true"]')) {
      const size = parseFloat(cs.fontSize);
      if (size && size < 14) {
        out.tinyText.push({ el: label(el), px: Math.round(size * 10) / 10 });
      }
    }
  }

  // keep the report readable: the worst offenders, not every node
  out.overflowing = out.overflowing.sort((a, b) => b.right - a.right).slice(0, 8);
  out.smallTargets = out.smallTargets.slice(0, 8);
  out.tinyText = out.tinyText.slice(0, 8);
  return out;
}
"""


def api(method: str, path: str, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{method} {path} -> {exc.code}: {exc.read()[:200]}") from exc


def reset_limits() -> None:
    """Clear the per-IP register/login limit.

    This audit registers a fresh account on every run and it is run often,
    so it hits the 5-registrations-per-hour ceiling long before anyone is
    actually doing anything wrong. The endpoint 404s in production, so this
    is development-only and silently does nothing if it is absent.
    """
    try:
        req = urllib.request.Request(f"{BASE}/api/dev/reset-limits", method="POST")
        with urllib.request.urlopen(req, timeout=10):
            pass
    except urllib.error.HTTPError:
        pass


def make_project() -> tuple[str, str, dict]:
    """A project with enough content to be worth measuring: every block
    family, several list items, and long text that might not wrap."""
    reset_limits()
    tag = uuid.uuid4().hex[:6]
    reg = api("POST", "/api/auth/register",
              {"username": "resp_" + tag, "email": f"resp_{tag}@example.com",
               "password": PASSWORD})
    token = reg["token"]
    user = reg.get("user") or {"username": "resp_" + tag, "email": f"resp_{tag}@example.com"}

    proj = api("POST", "/api/projects",
               {"name": "Responsive Audit", "type": "business", "goal": "get-contact"},
               token)

    def items(n, label):
        return [{"title": f"{label} {i}",
                 "text": "A reasonably long line of body copy that has to wrap "
                         "properly on a narrow screen without pushing the "
                         "layout sideways."}
                for i in range(n)]

    plan = {
        "meta": {"type": "business", "goal": "get-contact", "theme": "modern",
                 "siteName": "Responsive Audit"},
        "pages": [{"id": "home", "name": "Home", "sections": [
            {"id": "s1", "type": "hero",
             "title": "A headline long enough to need to wrap on a phone",
             "subtitle": "And a subtitle that runs on a little too.",
             "fields": {"buttonText": "Get started"}},
            {"id": "s2", "type": "about", "title": "About us",
             "subtitle": "Who we are.", "fields": {}},
            {"id": "s3", "type": "features", "title": "What we do",
             "subtitle": "Three things.", "fields": {}, "items": items(3, "Feature")},
            {"id": "s4", "type": "images", "title": "Photos", "subtitle": "Our work.",
             "fields": {}, "items": items(6, "Photo")},
            {"id": "s5", "type": "testimonials", "title": "Kind words",
             "subtitle": "From customers.", "fields": {}, "items": items(3, "Quote")},
            {"id": "s6", "type": "gallery", "title": "Gallery", "subtitle": "Pictures.",
             "fields": {}, "items": items(6, "Shot")},
            {"id": "s7", "type": "faq", "title": "Questions",
             "subtitle": "Answers.", "fields": {}},
            {"id": "s8", "type": "contact", "title": "Contact",
             "subtitle": "Say hello.", "fields": {"buttonText": "Send"}},
        ]}],
        "footer": {"note": "A footer note that is long enough to be worth checking."},
    }
    api("PUT", f"/api/projects/{proj['id']}", {"plan_json": plan}, token)
    return proj["id"], token, user


# The builder calls API.requireAuth() and redirects to sign-in without these,
# so the browser context has to be told who it is. Same keys api.js uses.
SEED_AUTH = """
(state) => {
  localStorage.setItem('sitesketch_token_v1', state.token);
  localStorage.setItem('sitesketch_user_v1', JSON.stringify(state.user));
}
"""


def publish(browser, pid: str, token: str, user: dict) -> str:
    """Publish through the real endpoint so the audit measures what a
    visitor actually gets.

    That takes the compiled pages with it, which only a browser can
    produce, so the builder is opened and asked to compile - the same call
    the Publish button makes.

    This function used to send nothing but a slug. The endpoint accepted it,
    stored no pages, and the public route served its "this site isn't
    published" page - so the whole published-site half of this audit was
    measuring a 404 and reporting it clean at every width. Found by
    screenshotting what it had been auditing. The endpoint now refuses a
    publish with no pages, which is what exposed it.
    """
    slug = "resp-" + uuid.uuid4().hex[:8]
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        # The builder redirects to sign-in without a token, and localStorage
        # cannot be written before the origin is loaded - so land somewhere
        # harmless first, seed, then go to the builder.
        page.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
        page.evaluate(SEED_AUTH, {"token": token, "user": user})
        page.goto(f"{BASE}/builder.html?id={pid}", wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=60000)
        page.wait_for_timeout(1200)
        built = page.evaluate("""async () => {
            const css = await (await fetch('static/css/generated.css')).text();
            return window.SS.compileSite(window.Editor.plan, { pageBase: '', css: css });
        }""")
    finally:
        ctx.close()

    if not built.get("pages"):
        raise SystemExit("nothing compiled, cannot audit a page that does not exist")
    res = api("POST", f"/api/projects/{pid}/publish",
              {"slug": slug, "pages": built["pages"], "home": built.get("home")}, token)
    if not res.get("is_published") or not res.get("slug"):
        raise SystemExit(f"publish failed: {str(res)[:300]}")
    return f"/site/{res['slug']}"


def audit(browser, label: str, url: str, width: int, height: int, seed, touch: bool):
    """Measure one page at one size."""
    ctx = browser.new_context(
        viewport={"width": width, "height": height},
        has_touch=touch,
        is_mobile=touch,
    )
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e).splitlines()[0][:100]))

    if seed:
        page.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
        page.evaluate(SEED_AUTH, seed)
    page.goto(BASE + url if url.startswith("/") else url, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    found = page.evaluate(PROBE, MIN_TAP_TOUCH if touch else MIN_TAP_MOUSE)
    ctx.close()

    overflow = found["scrollWidth"] > found["clientWidth"] + 1
    bad = overflow or found["overflowing"] or found["smallTargets"] or found["tinyText"] or errors
    return found, overflow, bad, errors


def report(label: str, width: int, height: int, found, overflow, bad, errors, touch: bool) -> None:
    mark = "FAIL" if bad else "ok  "
    how = "touch" if touch else "mouse"
    print(f"[{mark}] {label:12s} {width}x{height} ({how})")
    if overflow:
        print(f"         scrolls sideways: {found['scrollWidth']}px of content "
              f"in {found['clientWidth']}px")
    for item in found["overflowing"]:
        print(f"         past the edge: {item['el']} (right {item['right']} > {item['vw']})")
    for item in found["smallTargets"]:
        print(f"         small target: {item['el']} ({item['w']}x{item['h']})")
    for item in found["tinyText"]:
        print(f"         tiny text: {item['el']} ({item['px']}px)")
    for err in errors[:3]:
        print(f"         JS error: {err}")


def main() -> int:
    pid, token, user = make_project()
    seed = {"token": token, "user": user}
    with sync_playwright() as pw0:
        browser0 = pw0.chromium.launch()
        slug = publish(browser0, pid, token, user)
        browser0.close()
    print(f"auditing project {pid}, published at {slug}\n")

    problems = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # The generated site first. This is the deliverable: it is what a
        # visitor loads, and it carries none of the editor's furniture.
        print("--- the published site ---")
        for label, width, height, touch in SIZES:
            found, overflow, bad, errors = audit(
                browser, label, slug, width, height, None, touch)
            report(label, width, height, found, overflow, bad, errors, touch)
            problems += 1 if bad else 0

        # The editor, separately. It is a desktop-first tool and its chrome
        # is allowed to be denser, but it still must not scroll sideways on
        # a phone, and its controls still have to be reachable by a thumb.
        print("\n--- the builder ---")
        for label, width, height, touch in SIZES:
            found, overflow, bad, errors = audit(
                browser, label, f"/builder.html?id={pid}", width, height, seed, touch)
            report(label, width, height, found, overflow, bad, errors, touch)
            problems += 1 if bad else 0

        # The pages every visitor meets before they have an account. These
        # are hand-written marketing and sign-in screens rather than
        # generated ones, which is exactly why they were missed: nothing
        # else in this file produces them, so nothing measured them. The
        # landing page is the first thing anyone sees.
        print("\n--- the public pages ---")
        for path, name in [("/index.html", "landing"), ("/login.html", "login"),
                           ("/register.html", "register")]:
            for label, width, height, touch in SIZES:
                found, overflow, bad, errors = audit(
                    browser, f"{name}/{label}", f"{BASE}{path}", width, height, None, touch)
                report(f"{name}/{label}", width, height, found, overflow, bad, errors, touch)
                problems += 1 if bad else 0

        browser.close()

    total = len(SIZES) * (2 + len(PUBLIC_PAGES))
    print()
    print(f"{problems} of {total} measurements have something to fix")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())