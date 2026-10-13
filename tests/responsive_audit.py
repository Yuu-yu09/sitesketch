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

SIZES = [
    ("phone", 390, 844),
    ("phone-small", 320, 568),      # the narrowest phone still in use
    ("tablet", 820, 1180),
    ("laptop", 1280, 800),
    ("desktop", 1680, 1050),
]

# 44px is the accepted minimum for a comfortable touch target.
MIN_TAP = 44.0
MIN_BODY_PX = 14.0

# The probe runs inside the page. Returns raw findings; the caller judges them.
PROBE = """
() => {
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
      if (box.height > 0 && box.height < 44 && box.width > 0) {
        out.smallTargets.push({ el: label(el), h: Math.round(box.height), w: Math.round(box.width) });
      }
    }

    // body copy that has become unreadable
    if (el.children.length === 0 && (el.textContent || '').trim().length > 12) {
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


def make_project() -> tuple[str, str]:
    """A project with enough content to be worth measuring: every block
    family, several list items, and long text that might not wrap."""
    tag = uuid.uuid4().hex[:6]
    reg = api("POST", "/api/auth/register",
              {"username": "resp_" + tag, "email": f"resp_{tag}@example.com",
               "password": PASSWORD})
    token = reg["token"]

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
    return proj["id"], token


def main() -> int:
    pid, token = make_project()
    print(f"auditing project {pid}\n")

    problems = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for label, width, height in SIZES:
            ctx = browser.new_context(viewport={"width": width, "height": height})
            page = ctx.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e).splitlines()[0][:100]))

            # the generated site itself, not the editor chrome around it
            page.goto(f"{BASE}/builder.html?id={pid}",
                      wait_until="domcontentloaded")
            page.wait_for_selector(".ss-sec", timeout=30000)
            page.wait_for_timeout(900)
            found = page.evaluate(PROBE)

            overflow = found["scrollWidth"] > found["clientWidth"] + 1
            bad = (overflow or found["overflowing"] or found["smallTargets"]
                   or found["tinyText"] or errors)

            mark = "FAIL" if bad else "ok  "
            print(f"[{mark}] {label:12s} {width}x{height}")
            if overflow:
                print(f"         page scrolls sideways: "
                      f"{found['scrollWidth']}px of content in {found['clientWidth']}px")
            for item in found["overflowing"]:
                print(f"         past the edge: {item['el']} "
                      f"(right {item['right']} > {item['vw']})")
            for item in found["smallTargets"]:
                print(f"         small target: {item['el']} ({item['w']}x{item['h']})")
            for item in found["tinyText"]:
                print(f"         tiny text: {item['el']} ({item['px']}px)")
            for err in errors[:3]:
                print(f"         JS error: {err}")

            problems += 1 if bad else 0
            ctx.close()
        browser.close()

    print()
    if problems:
        print(f"{problems} of {len(SIZES)} sizes have something to fix")
    else:
        print(f"all {len(SIZES)} sizes clean")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())