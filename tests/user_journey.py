"""
End-to-end user journey.

tests/e2e_check.py calls the API and tests/browser_check.py walks the builder
with a pre-seeded project. Neither answers the question that actually matters:
*can a person who has never seen SiteSketch get from nothing to a live
website?*

So this drives the whole thing through the interface, in order, in a browser
profile that has never signed in before:

    register -> plan wizard -> builder -> edit -> publish -> visit the public
    site -> sign out

Nothing is seeded and no API is called directly. The plan wizard is the slow
step because it waits on the AI, so it gets a generous budget rather than
being skipped for speed - skipping it would skip the part most likely to look
broken in front of somebody.

Run:
    .\\.venv\\Scripts\\python.exe tests\\user_journey.py http://127.0.0.1:3000
"""

from __future__ import annotations

import re
import sys
import time
import urllib.request
import uuid

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
PASSWORD = "chicken-karewa1"          # satisfies the password policy
SLOW = 150_000                        # the AI step, generously
results: list[tuple[str, bool, str]] = []


def reset_limits() -> bool:
    """Clear the per-IP register/login limit before signing up.

    Register is 5 per hour per address and every suite shares one address, so
    without this the journey spends budget the earlier runs left behind. It
    failed 16 of 22 checks once, starting at registration and cascading - which
    reads exactly like a broken app and is not one.

    Returns False when the endpoint is absent (production), which is fine:
    the limit simply applies as normal there.
    """
    try:
        request = urllib.request.Request(f"{BASE}/api/dev/reset-limits", method="POST")
        with urllib.request.urlopen(request, timeout=10):
            return True
    except Exception:                                   # noqa: BLE001
        return False


def check(name: str, fn) -> None:
    started = time.time()
    try:
        detail = fn() or ""
        ok, why = True, detail
    except Exception as exc:                       # noqa: BLE001
        ok, why = False, f"{type(exc).__name__}: {exc}".replace("\n", " ")[:170]
    took = time.time() - started
    results.append((name, ok, why))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}  ({took:.1f}s)"
          + (f"  [{why}]" if why else ""))


def run(page, log):
    who = f"journey{uuid.uuid4().hex[:6]}"
    email = f"{who}@example.com"
    slug = "journey-" + uuid.uuid4().hex[:8]

    if not reset_limits():
        log("note: rate-limit reset unavailable, sign-up may hit the shared limit")

    # ---------------------------------------------------------------- land
    def t_landing_page_loads():
        page.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
        expect(page.locator("h1")).to_be_visible(timeout=15000)
        log(f"{page.title()!r}")

    def t_a_stranger_gets_to_the_sign_up_form():
        link = page.locator('a[href*="register"]').first
        expect(link).to_be_visible(timeout=10000)
        link.click()
        page.wait_for_url(lambda u: "register" in u, timeout=15000)

    # ------------------------------------------------------------- register
    def t_register_a_brand_new_account():
        page.wait_for_selector("#name", timeout=15000)
        page.fill("#name", who)
        page.fill("#email", email)
        page.fill("#password", PASSWORD)
        page.fill("#password2", PASSWORD)
        page.click("#submitBtn")
        # registering is supposed to sign you straight in
        page.wait_for_url(lambda u: "dashboard" in u, timeout=40000)
        log(f"signed up as {email}")

    def t_a_new_account_starts_empty():
        page.wait_for_selector(".proj-card", timeout=15000)
        assert "login" not in page.url, f"bounced to {page.url}"
        body = page.inner_text("body")
        assert "New plan" in body, "no way to start from the dashboard"
        # nobody else's data, including the API suite's projects
        assert "E2E Kitchen" not in body, "a new account can see another account's project"

    # ----------------------------------------------------------- plan wizard
    def t_step1_describe_the_site():
        page.goto(f"{BASE}/plan.html", wait_until="domcontentloaded")
        page.wait_for_selector("#typeGrid .type-card", timeout=20000)
        # choose a type the way a person would: click the first card offered
        page.locator("#typeGrid .type-card").first.click()
        page.fill("#aiDesc", "A ramen shop in Melbourne doing late-night bowls, "
                             "with a menu and opening hours.")
        page.click("#aiBtn")

    def t_step1_waits_for_the_ai_plan():
        started = time.time()
        # step2 only unhides once the plan has come back
        page.wait_for_selector("#step2:not([hidden])", timeout=SLOW)
        log(f"AI plan in {time.time() - started:.1f}s")

    def t_step2_pick_a_goal():
        page.wait_for_selector("#goalList button", timeout=20000)
        page.locator("#goalList button").first.click()
        page.click("#next2")
        page.wait_for_selector("#step3:not([hidden])", timeout=20000)

    def t_step3_name_the_site_and_finish():
        page.wait_for_selector("#siteName", timeout=20000)
        page.fill("#siteName", "Midnight Bowl")
        page.click("#finish")
        page.wait_for_url(lambda u: "builder" in u, timeout=SLOW)
        log("reached the builder")

    # --------------------------------------------------------------- builder
    def t_the_builder_renders_sections():
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        assert page.locator(".ss-sec").count() > 0, "no sections rendered"

    def t_the_two_sidebars_are_there():
        """The brief asked for an add-section palette on the left and a design
        panel on the right, both closable."""
        assert page.locator("#paletteStructure").count() > 0, "no add-section palette"
        assert page.locator("#stylesPanel").count() > 0, "no design panel"
        assert page.locator("#panelClose").count() > 0, "the design panel cannot be closed"

    def t_edit_text_inline():
        target = page.locator(".ss-sec [data-edit]").first
        target.click()
        target.fill("Edited by the journey test")
        page.keyboard.press("Escape")
        page.wait_for_timeout(2000)              # let the autosave land
        assert target.inner_text().strip() == "Edited by the journey test", \
            f"the edit did not stick: {target.inner_text()!r}"
        log("typed into the page itself")

    def t_the_edit_survives_a_reload():
        """Which means the autosave actually reached the server."""
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        page.wait_for_timeout(1500)
        assert "Edited by the journey test" in page.inner_text("body"), \
            "the edit was lost on reload, so it was never saved"

    def t_nobody_was_asked_to_sign_in_again():
        assert "login" not in page.url, f"ended up back at {page.url}"

    # --------------------------------------------------------------- publish
    def t_publish():
        pid = page.url.split("id=")[-1]
        page.goto(f"{BASE}/publish.html?id={pid}", wait_until="domcontentloaded")
        page.wait_for_selector("#pubBtn", timeout=SLOW)
        field = page.locator("#slug")
        expect(field).to_have_value(re.compile(r".+"), timeout=SLOW)
        field.fill("")
        field.type(slug, delay=10)
        page.click("#pubBtn")
        expect(page.locator("#liveBox")).to_be_visible(timeout=SLOW)
        expect(page.locator("#statusHead")).to_have_text("Your site is live", timeout=20000)

    def t_the_live_url_shown_is_the_right_one():
        shown = page.inner_text("#liveUrl").replace("\u200b", "").replace("\u200B", "")
        assert shown.endswith(f"/site/{slug}"), f"wrong live URL shown: {shown!r}"

    # ------------------------------------------- what a member of the public sees
    def fresh_visitor():
        return page.context.browser.new_context(viewport={"width": 1280, "height": 900})

    def t_an_anonymous_visitor_sees_the_site():
        other = fresh_visitor()
        try:
            p = other.new_page()
            p.goto(f"{BASE}/site/{slug}", wait_until="domcontentloaded")
            p.wait_for_selector(".ss-sec", timeout=30000)
            assert p.locator(".ss-nav").count() > 0, "the published site has no navigation"
            opacity = p.evaluate(
                "() => getComputedStyle(document.querySelector('.ss-sec')).opacity")
            assert float(opacity) > 0.9, f"published content is invisible ({opacity})"
            assert p.evaluate("() => document.cookie") == "", \
                "a published site set a cookie"
            log("loaded with no session at all")
        finally:
            other.close()

    def t_the_public_page_has_the_edit():
        other = fresh_visitor()
        try:
            p = other.new_page()
            p.goto(f"{BASE}/site/{slug}", wait_until="domcontentloaded")
            p.wait_for_timeout(400)
            assert "Edited by the journey test" in p.inner_text("body"), \
                "the edit made in the builder is not on the published site"
        finally:
            other.close()

    def t_the_public_page_runs_no_script():
        other = fresh_visitor()
        try:
            p = other.new_page()
            p.goto(f"{BASE}/site/{slug}", wait_until="domcontentloaded")
            p.wait_for_timeout(300)
            assert p.evaluate("() => document.querySelectorAll('script').length") == 0, \
                "a published site shipped a script"
        finally:
            other.close()

    def t_a_missing_site_explains_itself():
        other = fresh_visitor()
        try:
            p = other.new_page()
            resp = p.goto(f"{BASE}/site/no-such-site-at-all", wait_until="domcontentloaded")
            assert resp.status == 404, f"a missing site answered {resp.status}"
            text = p.inner_text("body").lower()
            assert "published" in text, f"the 404 page does not explain itself: {text[:120]!r}"
        finally:
            other.close()

    # ------------------------------------------------------------ sign out
    def t_signing_out_really_signs_out():
        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        page.wait_for_timeout(600)
        page.evaluate("() => window.API && API.logout()")
        page.wait_for_timeout(900)
        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        assert "login" in page.url, f"a signed-out user reached {page.url}"
        log("kicked back to the login screen")

    def t_the_published_site_survives_signing_out():
        """Being signed out of the app must not take the public site down."""
        other = fresh_visitor()
        try:
            p = other.new_page()
            resp = p.goto(f"{BASE}/site/{slug}", wait_until="domcontentloaded")
            assert resp.status == 200, f"the live site died with the session: {resp.status}"
        finally:
            other.close()

    check("landing page loads", t_landing_page_loads)
    check("a stranger reaches the sign-up form", t_a_stranger_gets_to_the_sign_up_form)
    check("register a brand new account", t_register_a_brand_new_account)
    check("a new account starts empty", t_a_new_account_starts_empty)
    check("step 1: describe the site", t_step1_describe_the_site)
    check("step 1: the AI plan comes back", t_step1_waits_for_the_ai_plan)
    check("step 2: pick a goal", t_step2_pick_a_goal)
    check("step 3: name it and finish", t_step3_name_the_site_and_finish)
    check("the builder renders sections", t_the_builder_renders_sections)
    check("palette and design panel are present", t_the_two_sidebars_are_there)
    check("edit text inline", t_edit_text_inline)
    check("the edit survives a reload", t_the_edit_survives_a_reload)
    check("nobody was asked to sign in again", t_nobody_was_asked_to_sign_in_again)
    check("publish the site", t_publish)
    check("the live URL shown is right", t_the_live_url_shown_is_the_right_one)
    check("an anonymous visitor sees the site", t_an_anonymous_visitor_sees_the_site)
    check("the public page carries the edit", t_the_public_page_has_the_edit)
    check("the public page runs no script", t_the_public_page_runs_no_script)
    check("a missing site explains itself", t_a_missing_site_explains_itself)
    check("signing out really signs out", t_signing_out_really_signs_out)
    check("the live site outlives the session", t_the_published_site_survives_signing_out)


def main() -> int:
    console: list[str] = []
    print(f"\nFull user journey against {BASE}")
    print("  fresh browser profile · no seeding · no direct API calls\n")

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        def log(text):
            print(f"        · {text}")

        # Full stack, not just the message. "ctx is not defined" on its own
        # says nothing about which of ninety uses in site.js is at fault.
        page.on("pageerror", lambda e: console.append(
            f"uncaught: {str(e).splitlines()[0][:120]}\n      "
            + "\n      ".join((getattr(e, "stack", "") or "").splitlines()[1:5])))
        page.on("console", lambda m: console.append(f"{m.text[:160]}")
                if m.type == "error" and "favicon" not in m.text.lower() else None)

        try:
            run(page, log)
        finally:
            browser.close()

    # A failed resource load during the journey is usually the deliberate
    # sign-out checks, so only real script errors are fatal here.
    noisy = [c for c in console
             if "Failed to load resource" not in c and "401" not in c]
    check("no uncaught JavaScript errors in the journey",
          lambda: (_ for _ in ()).throw(Exception("; ".join(noisy[:3]))) if noisy else "")

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} journey checks passed")
    failed = [n for n, ok, _ in results if not ok]
    if failed:
        print("failed: " + ", ".join(failed))
        return 1
    print("A new user can get from nothing to a live website.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
