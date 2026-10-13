"""Capture every screen, so the design can actually be looked at.

Until now no screenshot existed: the MCP screenshot tool needs a visible
desktop window and there is none here. Playwright runs headless and captures
the same pixels, which makes a visual pass possible for the first time in
this project - every design decision so far was made from DOM measurements
without anyone seeing the result.

Run:
    .venv\\Scripts\\python.exe tests\\capture_all_screens.py
"""

from __future__ import annotations

import json
import pathlib
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
OUT = pathlib.Path(r"C:\Users\Pochi\AppData\Local\Temp\opencode\shots")
EMAIL = sys.argv[1] if len(sys.argv) > 1 else "demo_50a79c@example.com"
PASSWORD = sys.argv[2] if len(sys.argv) > 2 else "karewa-testing-1"


def api(method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode())


def latest_project(token: str) -> str:
    """GET /api/projects answers with a bare list, not an envelope."""
    data = api("GET", "/api/projects", None, token)
    projects = data if isinstance(data, list) else (data.get("projects") or [])
    return projects[0]["id"] if projects else ""


def ensure_published(page, token: str, pid: str) -> str:
    """Publish the way a browser does.

    Not a convenience: the endpoint compiles nothing itself. It takes the
    finished HTML from the request body and stores it, because a published
    site runs zero JavaScript. Calling it with only a slug sets is_published
    and stores nothing, and the public route then 404s.

    That is now a 400 rather than a silent success (see
    t_publish_refuses_a_request_with_no_compiled_pages), and this had to
    change because the first version of this script did exactly that and
    screenshotted "This site isn't published" three times.
    """
    import uuid
    project = api("GET", f"/api/projects/{pid}", None, token)
    # Reuse the existing address, but republish either way. The project may
    # already carry a slug from an earlier API-only publish that stored no
    # pages, and then every screenshot would be of a 404.
    slug = project.get("slug") or ("shots-" + uuid.uuid4().hex[:8])
    page.goto(f"{BASE}/builder.html?id={pid}", wait_until="domcontentloaded")
    page.wait_for_selector(".ss-sec", timeout=30000)
    page.wait_for_timeout(1200)

    compiled = page.evaluate("""async () => {
        // The stylesheet has to be fetched and inlined exactly as
        // publish.js does it. Without this the page compiles to bare HTML -
        // Times New Roman, blue underlines, raw bullets - and
        // compileSite now refuses to do it at all.
        const css = await (await fetch('static/css/generated.css')).text();
        return window.SS.compileSite(window.Editor.plan, {
            pageBase: '', css: css
        });
    }""")
    api("POST", f"/api/projects/{pid}/publish",
        {"slug": slug, "pages": compiled["pages"], "home": compiled["home"]}, token)
    return slug


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    token = api("POST", "/api/auth/login", {"email": EMAIL, "password": PASSWORD})["token"]
    pid = latest_project(token)
    print(f"project {pid}")

    slug = ""
    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # --- marketing and auth, desktop
        ctx = browser.new_context(viewport={"width": 1440, "height": 900},
                                  device_scale_factor=2)
        page = ctx.new_page()
        for name, path, full in [
            ("10-landing.png", "/index.html", True),
            ("11-login.png", "/login.html", False),
        ]:
            page.goto(BASE + path, wait_until="domcontentloaded")
            page.wait_for_timeout(1200)
            page.screenshot(path=str(OUT / name), full_page=full)
            print(OUT / name)

        # --- signed in
        page.goto(f"{BASE}/login.html", wait_until="domcontentloaded")
        page.fill("#email", EMAIL)
        page.fill("#password", PASSWORD)
        page.click("#submitBtn")
        page.wait_for_timeout(2500)

        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        page.wait_for_timeout(1200)
        page.screenshot(path=str(OUT / "12-dashboard.png"))
        print(OUT / "12-dashboard.png")

        page.goto(f"{BASE}/builder.html?id={pid}", wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=30000)
        page.wait_for_timeout(1500)

        # Publish here, while a signed-in builder is on screen, because
        # compiling is what publishing needs and only the browser can do it.
        slug = ensure_published(page, token, pid)
        print(f"published at /site/{slug}")
        page.wait_for_timeout(500)
        hint = page.locator(".hint-dismiss")
        if hint.count():
            hint.click()
            page.wait_for_timeout(300)

        # These toolbar buttons are toggles: clicking one that is already open
        # closes it, which is how the first run of this script photographed
        # the builder with the Design panel shut. Each button maintains
        # aria-pressed, so ask that rather than guessing from the layout.
        for btn, name in [
            ("#stylesBtn", "13-builder-design.png"),
            ("#menuBtn", "14-builder-menu.png"),
            ("#footerBtn", "15-builder-footer.png"),
        ]:
            if page.get_attribute(btn, "aria-pressed") != "true":
                page.click(btn)
                page.wait_for_timeout(600)
            if page.get_attribute(btn, "aria-pressed") != "true":
                raise SystemExit(f"{btn} did not open its panel")
            page.screenshot(path=str(OUT / name))
            print(OUT / name)
        ctx.close()

        # --- the published site, which is what a visitor actually gets
        if slug:
            for name, w, h in [("20-published-desktop.png", 1440, 900),
                                ("21-published-tablet.png", 820, 1180),
                                ("22-published-phone.png", 390, 844)]:
                c = browser.new_context(viewport={"width": w, "height": h},
                                        device_scale_factor=2)
                p = c.new_page()
                p.goto(f"{BASE}/site/{slug}", wait_until="domcontentloaded")
                p.wait_for_timeout(1500)
                p.screenshot(path=str(OUT / name), full_page=(w < 500))
                print(OUT / name)
                c.close()

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())