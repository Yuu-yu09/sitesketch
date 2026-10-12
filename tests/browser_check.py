"""
Browser end-to-end tests.

These drive a real browser through a real user journey, rather than calling
the API directly like tests/e2e_check.py. They exist because the API tests
all passed while the site still logged people out mid-edit: nothing was
checking what happened in the browser after the token expired, nothing
clicked a button, and nothing looked at a rendered page.

Run:
    .venv\\Scripts\\python.exe tests\\browser_check.py http://127.0.0.1:3000
"""

from __future__ import annotations

import sys
import time

from playwright.sync_api import expect, sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000").rstrip("/")
EMAIL = f"browser{int(time.time())}@example.com"
USERNAME = f"browser{int(time.time())}"
PASSWORD = "karewa-testing-1"

results: list[tuple[str, bool, str]] = []

# The database connection to Supabase has been observed stalling for 45s at a
# time from this machine. Waits are generous so a slow network reads as a
# passing check rather than a phantom bug.
SLOW = 90_000


def check(name: str, fn) -> None:
    """Run one check and record the outcome, never letting it stop the run."""
    started = time.time()
    try:
        detail = fn() or ""
        results.append((name, True, detail))
        print(f"  PASS  {name}" + (f"  [{detail}]" if detail else ""))
    except Exception as exc:  # noqa: BLE001 - a failing check must not abort
        message = str(exc).split("\n")[0][:150]
        results.append((name, False, message))
        print(f"  FAIL  {name}\n        {message}")
    _ = round(time.time() - started, 2)


def run(page):
    # ---------------------------------------------------------- registration
    def t_register_form_loads():
        page.goto(f"{BASE}/register.html", wait_until="domcontentloaded")
        expect(page.locator("#email")).to_be_visible(timeout=8000)
        expect(page.locator("#password")).to_be_visible(timeout=4000)

    def t_register_creates_account():
        page.fill("#name", USERNAME)
        page.fill("#email", EMAIL)
        page.fill("#password", PASSWORD)
        page.fill("#password2", PASSWORD)   # the form asks for it twice
        page.click("button[type=submit]")
        page.wait_for_url("**/dashboard.html", timeout=SLOW)
        assert "dashboard" in page.url, f"landed on {page.url}"

    check("registration form is usable", t_register_form_loads)
    check("registering signs you straight in", t_register_creates_account)

    # -------------------------------------------------------------- session
    def t_session_survives_reload():
        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        page.wait_for_timeout(600)
        assert "login" not in page.url, f"bounced to {page.url} on reload"

    def t_refresh_token_is_stored():
        stored = page.evaluate("() => localStorage.getItem('sitesketch_refresh_v1')")
        assert stored, "no refresh token stored, so the session cannot be renewed"

    def t_expired_access_token_recovers_silently():
        """The bug this suite exists for.

        The access token was thrown away mid-edit and the user was dumped on
        the login screen. Corrupt the access token, then make a call: the
        client must renew it with the refresh token and carry on.
        """
        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        page.wait_for_timeout(400)
        page.evaluate("() => localStorage.setItem('sitesketch_token_v1', 'expired.jwt.value')")
        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        assert "login" not in page.url, f"expired token sent the user to {page.url}"
        token = page.evaluate("() => localStorage.getItem('sitesketch_token_v1')")
        assert token and "expired.jwt.value" != token, "token was never renewed"

    def t_project_created_and_listed():
        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        page.wait_for_timeout(800)
        expect(page.locator(".proj-card").first).to_be_visible(timeout=SLOW)

    check("session survives a page reload", t_session_survives_reload)
    check("a refresh token is stored", t_refresh_token_is_stored)
    check("expired access token recovers without a login prompt", t_expired_access_token_recovers_silently)
    check("the dashboard lists the account's projects", t_project_created_and_listed)

    # -------------------------------------------------------------- builder
    builder_id: dict[str, str] = {}

    def t_open_builder():
        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        page.wait_for_timeout(900)
        href = page.locator(".proj-card").first.get_attribute("href") or ""
        assert "builder.html" in href, f"project card does not link to the builder: {href!r}"
        page.goto(f"{BASE}/{href}", wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        builder_id["url"] = page.url
        assert page.locator(".ss-sec").count() > 0, "builder rendered no sections"

    def t_design_panel_opens_on_the_right():
        panel = page.locator("#stylesPanel")
        expect(panel).to_be_visible(timeout=5000)
        box = panel.bounding_box()
        assert box and box["x"] > page.viewport_size["width"] / 2, \
            f"design panel is not on the right (x={box['x'] if box else None})"

    def t_sidebars_can_be_closed():
        page.click("#panelClose")
        page.wait_for_timeout(300)
        assert page.locator("#stylesPanel").is_hidden(), "design panel did not close"
        page.click("#railToggle")
        page.wait_for_timeout(300)
        canvas_w = page.locator("#canvas").bounding_box()["width"]
        assert canvas_w > 700, f"canvas did not expand when closed (width={canvas_w})"
        page.click("#railToggle")
        page.click("#stylesBtn")
        page.wait_for_timeout(300)

    def t_inline_edit_saves():
        page.wait_for_selector(".ss-sec h1, .ss-sec h2", timeout=8000)
        heading = page.locator(".ss-sec").first.locator("h1, h2").first
        heading.click()
        page.wait_for_timeout(200)
        heading.fill("Edited in the browser test")
        page.locator("body").click(position={"x": 5, "y": 5})
        page.wait_for_timeout(400)
        stored = page.evaluate(
            "() => JSON.stringify(window.Editor.plan.pages[0].sections[0].title)"
        )
        assert "Edited in the browser test" in stored, f"edit was not saved: {stored}"

    def t_drag_handles_are_visible():
        grips = page.locator(".ss-sec > .sec-grip")
        assert grips.count() > 0, "no drag handles rendered"
        opacity = grips.first.evaluate("el => getComputedStyle(el).opacity")
        assert float(opacity) > 0, "drag handles are invisible until hovered"

    def t_footer_is_editable():
        footer = page.locator("[data-foot]")
        expect(footer).to_be_visible(timeout=6000)
        target = footer.locator("[data-edit]").first
        target.click()
        page.wait_for_timeout(200)
        target.fill("Footer edited")
        page.locator("body").click(position={"x": 5, "y": 5})
        page.wait_for_timeout(400)
        assert "Footer edited" in page.content(), "footer edit did not reach the page"

    def t_device_preview_switches():
        for device in ["mobile", "tablet"]:
            page.click(f'[data-device="{device}"]')
            page.wait_for_timeout(700)
            frame = page.locator("#deviceFrame")
            expect(frame).to_be_visible(timeout=5000)
            width = frame.bounding_box()["width"]
            assert 200 < width < 900, f"{device} preview width looks wrong ({width})"
        page.click('[data-device="desktop"]')
        page.wait_for_timeout(400)
        assert page.locator("#deviceFrame").is_hidden(), "desktop did not restore the canvas"

    check("builder opens from the dashboard", t_open_builder)
    check("design panel opens on the right", t_design_panel_opens_on_the_right)
    check("sidebars can be closed and the page expands", t_sidebars_can_be_closed)
    check("inline text editing saves", t_inline_edit_saves)
    check("drag handles are visible without hovering", t_drag_handles_are_visible)
    check("footer text is editable", t_footer_is_editable)
    check("device preview switches between phone, tablet and desktop", t_device_preview_switches)


def main() -> int:
    console_errors: list[str] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on(
            "pageerror",
            lambda exc: console_errors.append(f"uncaught: {str(exc)[:140]}"),
        )
        page.on(
            "console",
            lambda msg: console_errors.append(f"{msg.type}: {msg.text[:140]}")
            if msg.type == "error"
            else None,
        )

        print(f"\nBrowser journey against {BASE}\n")
        try:
            run(page)
        finally:
            browser.close()

    # a page that throws is a bug even if every assertion passed
    noisy = [e for e in console_errors if "favicon" not in e.lower()]
    check("no uncaught JavaScript errors", lambda: (_ for _ in ()).throw(
        Exception("; ".join(noisy[:3]))
    ) if noisy else "")

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{passed}/{total} browser checks passed")
    failed = [name for name, ok, _ in results if not ok]
    if failed:
        print("failed: " + ", ".join(failed))
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())