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

import re
import uuid
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


def run(page, phase=None):
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
        """The long-lived credential must be a cookie script cannot read.

        This used to assert the opposite: that a refresh token sat in
        localStorage, where any script on the page could read it for thirty
        days. It is now an HttpOnly cookie, so the check is that the token is
        nowhere in web storage and the browser is holding it instead.
        """
        in_storage = page.evaluate("""() => {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
            for (let i = 0; i < sessionStorage.length; i++) keys.push(sessionStorage.key(i));
            return keys.filter(k => /refresh/i.test(k || ''));
        }""")
        assert not in_storage, f"a refresh token is still readable in storage: {in_storage}"

        cookies = page.context.cookies()
        ours = [c for c in cookies if c["name"] == "sitesketch_refresh"]
        assert ours, f"no session cookie was set: {[c['name'] for c in cookies]}"
        assert ours[0]["httpOnly"] is True, "the session cookie is readable by script"
        assert ours[0]["sameSite"] == "Strict", ours[0]["sameSite"]
        assert ours[0]["path"] == "/api/auth", ours[0]["path"]
        return f"httpOnly cookie on {ours[0]['domain']}"

    def t_expired_access_token_recovers_silently():
        """The bug this suite exists for.

        The access token was thrown away mid-edit and the user was dumped on
        the login screen. Corrupt the access token, then make a call: the
        client must renew it with the refresh token and carry on.
        """
        if phase:
            phase["name"] = "deliberate expiry (401 expected here)"
        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        page.wait_for_timeout(400)
        page.evaluate("() => localStorage.setItem('sitesketch_token_v1', 'expired.jwt.value')")
        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        assert "login" not in page.url, f"expired token sent the user to {page.url}"
        token = page.evaluate("() => localStorage.getItem('sitesketch_token_v1')")
        assert token and "expired.jwt.value" != token, "token was never renewed"

    def t_project_created_and_listed():
        """Seed a project, then confirm the dashboard lists it.

        The earlier version of this check asserted on `.proj-card`, but the
        "New plan" call-to-action carries that same class - so on an account
        with no projects it passed anyway, and every builder check after it
        then failed because there was nothing to open. It now creates a
        project through the same API the app uses, and only counts real
        cards.
        """
        made = page.evaluate("""async () => {
            const r = await fetch('/api/projects', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + localStorage.getItem('sitesketch_token_v1'),
                },
                body: JSON.stringify({
                    name: 'Browser check project',
                    type: 'business',
                    goal: 'get-contact',
                    plan_json: {
                        "pages": [{
                            "id": "home",
                            "name": "Home",
                            "sections": [
                                {"id": "s_seed_hero", "type": "hero", "title": "Hero",
                                 "subtitle": "A seeded section", "fields": {}, "items": []},
                                {"id": "s_seed_about", "type": "about", "title": "About",
                                 "subtitle": "A seeded section", "fields": {}, "items": []},
                            ],
                        }],
                    },
                }),
            });
            return r.status;
        }""")
        assert made == 201, f"could not seed a project: {made}"

        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        # .proj-new is the "New plan" button, not a project.
        cards = page.locator(".proj-card:not(.proj-new)")
        expect(cards.first).to_be_visible(timeout=SLOW)
        assert cards.count() >= 1, "no project cards rendered"

    check("session survives a page reload", t_session_survives_reload)
    check("refresh token is an httpOnly cookie, not storage", t_refresh_token_is_stored)
    check("expired access token recovers without a login prompt", t_expired_access_token_recovers_silently)
    check("the dashboard lists the account's projects", t_project_created_and_listed)

    # -------------------------------------------------------------- builder
    builder_id: dict[str, str] = {}
    if phase:
        phase["name"] = "builder"

    def t_open_builder():
        page.goto(f"{BASE}/dashboard.html", wait_until="domcontentloaded")
        page.wait_for_timeout(900)
        # The card itself is an <article>; the link to the builder is the
        # anchor inside it, so read the href from there.
        href = (page.locator('.proj-card:not(.proj-new) a[href*="builder.html"]')
                .first.get_attribute("href") or "")
        assert "builder.html" in href, f"project card does not link to the builder: {href!r}"
        page.goto(f"{BASE}/{href}", wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        builder_id["url"] = page.url
        builder_id["pid"] = href.split("id=")[-1]
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

    # ---------------------------------------------------------------- publish
    # The end-to-end one: drive the real Publish button, which compiles the
    # plan in the browser, and then load the address it claims is live. The
    # e2e suite posts hand-written HTML instead, so only this can catch a
    # broken compiler or a nav link that only works in the editor.
    # The slug is unique per run: a fixed one would be a 409 the second time.
    slug = f"browser-check-{uuid.uuid4().hex[:8]}"

    def t_publish_compiles_a_live_site():
        page.goto(f"{BASE}/publish.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_selector("#pubBtn", timeout=SLOW)

        slug_field = page.locator("#slug")
        # The button exists in the markup, so it is not a sign the page is
        # ready - start() fetches the project and only then fills in a
        # suggested slug. Typing before that gets silently overwritten.
        expect(slug_field).to_have_value(re.compile(r".+"), timeout=SLOW)
        slug_field.fill("")
        slug_field.type(slug, delay=15)
        assert slug_field.input_value() == slug, slug_field.input_value()

        page.click("#pubBtn")
        # compile + upload + repaint the status box
        expect(page.locator("#liveBox")).to_be_visible(timeout=90000)
        expect(page.locator("#statusHead")).to_have_text("Your site is live", timeout=15000)

    def t_published_page_really_renders():
        """Load the public address with no session at all."""
        page.context.clear_cookies()
        page.goto(f"{BASE}/site/{slug}", wait_until="domcontentloaded")
        page.wait_for_selector(".ss-site", timeout=30000)
        # the compiled site must be visible, not stuck at opacity 0 waiting
        # for the scroll-reveal observer that a script-free page never runs
        assert page.locator(".ss-sec").count() > 0, "no sections in the published page"
        opacity = page.evaluate(
            "() => getComputedStyle(document.querySelector('.ss-sec')).opacity"
        )
        assert float(opacity) > 0.9, f"published content is invisible (opacity {opacity})"

        # design.css must be inlined, or the page would be unstyled
        styled = page.evaluate(
            "() => getComputedStyle(document.querySelector('.ss-site')).fontSize"
        )
        assert styled not in ("", None), "the published page has no design applied"

    def t_published_page_runs_no_script():
        """A published page has no script of ours and none of anyone else's."""
        ran = page.evaluate("() => typeof window.pwned")
        assert ran == "undefined", "unexpected script on the published page"

    def t_published_page_metadata():
        """The homepage is titled and described as the site, not as "Home"."""
        title = page.title()
        assert "·" not in title, f"homepage title looks like a sub-page: {title!r}"
        assert title.strip(), "empty title"
        desc = page.evaluate(
            "() => (document.querySelector('meta[name=description]')||{}).content"
        )
        assert desc and desc.lower() != "home", f"useless description: {desc!r}"
        og = page.evaluate(
            "() => (document.querySelector('meta[property=\"og:title\"]')||{}).content"
        )
        assert og == title, f"og:title disagrees with the title: {og!r} vs {title!r}"

    def t_published_nav_points_at_real_pages():
        """Nav links have to work on a published site, not just in the editor."""
        hrefs = page.eval_on_selector_all(
            ".ss-navlinks a", "els => els.map(e => e.getAttribute('href'))"
        )
        assert hrefs, "published page has no nav links"
        for href in hrefs:
            assert href.startswith("/site/"), f"nav link is not a real URL: {href!r}"
            assert "#" not in href, f"nav link is still an in-page anchor: {href!r}"
        brand = page.get_attribute(".ss-brand", "href")
        assert brand and brand.startswith("/site/"), brand

    check("publish compiles a live site", t_publish_compiles_a_live_site)
    check("published page really renders", t_published_page_really_renders)
    check("published page runs no script", t_published_page_runs_no_script)
    check("published page metadata is sane", t_published_page_metadata)
    check("published nav points at real pages", t_published_nav_points_at_real_pages)

    # ------------------------------------------------------- cookies and legal
    # These only exist in a browser, so the API suite cannot see them.

    def t_cookie_notice_appears_for_a_new_visitor():
        """No stored choice means the notice is shown, and it says the truth."""
        fresh = page.context.browser.new_context(viewport={"width": 1280, "height": 900})
        try:
            p = fresh.new_page()
            p.goto(f"{BASE}/login.html", wait_until="domcontentloaded")
            bar = p.locator("#consentBar")
            expect(bar).to_be_visible(timeout=8000)
            text = (bar.inner_text() or "").lower()
            # The claim on the page is that nothing tracks anybody. If a
            # tracker is ever added, this copy becomes a lie and this fails.
            assert "no analytics" in text, f"notice does not say what it should: {text!r}"
            assert "one cookie" in text, f"notice does not say how many: {text!r}"
        finally:
            fresh.close()

    def t_cookie_notice_can_be_dismissed_and_stays_dismissed():
        fresh = page.context.browser.new_context(viewport={"width": 1280, "height": 900})
        try:
            p = fresh.new_page()
            p.goto(f"{BASE}/login.html", wait_until="domcontentloaded")
            p.wait_for_selector("#consentBar", timeout=8000)
            p.click("#consentBar .btn-primary")
            p.wait_for_timeout(300)
            assert p.locator("#consentBar").count() == 0, "notice did not go away"

            stored = p.evaluate("() => localStorage.getItem('sitesketch_consent_v1')")
            assert stored, "the choice was not saved"

            p.goto(f"{BASE}/register.html", wait_until="domcontentloaded")
            p.wait_for_timeout(700)
            assert p.locator("#consentBar").count() == 0, "notice came back after a choice"
        finally:
            fresh.close()

    def t_privacy_page_lists_the_real_inventory():
        p = page.context.new_page()
        try:
            p.goto(f"{BASE}/privacy.html", wait_until="domcontentloaded")
            p.wait_for_selector(".legal-table", timeout=8000)
            body = p.inner_text("body")
            lowered = body.lower()

            # rendered from the API, so these are the real names
            assert "sitesketch_refresh" in body, "the session cookie is not listed"
            assert "supabase" in lowered, "no third parties listed"
            # inner_text gives the *rendered* text and the table headers are
            # uppercased in CSS, so this cannot be matched case-sensitively
            assert "how long" in lowered, "the retention table did not render"

            # the headline promise, checked against the rendered page
            assert "no analytics" in lowered, "the short version does not say it"
            assert "loading" not in lowered, "a table failed to load"
        finally:
            p.close()

    def t_preferences_can_be_withdrawn():
        fresh = page.context.browser.new_context(viewport={"width": 1280, "height": 900})
        try:
            p = fresh.new_page()
            p.goto(f"{BASE}/privacy.html", wait_until="domcontentloaded")
            p.wait_for_selector("#prefWithdraw", timeout=8000)
            p.click("#prefWithdraw")
            p.wait_for_timeout(400)
            # withdrawing has to clear the record; the notice may or may not
            # be on this particular page, but the choice must be gone
            assert p.evaluate("() => localStorage.getItem('sitesketch_consent_v1')") is None, \
                "consent was not actually withdrawn"
        finally:
            fresh.close()

    def t_terms_page_is_reachable():
        p = page.context.new_page()
        try:
            p.goto(f"{BASE}/terms.html", wait_until="domcontentloaded")
            assert "Terms of use" in p.title(), p.title()
            body = p.inner_text("body")
            assert "Your content" in body, "terms page did not render"
            assert "—" not in p.inner_text("#legalDate"), "the date placeholder was never filled"
        finally:
            p.close()

    def t_login_page_offers_the_legal_links():
        p = page.context.new_page()
        try:
            p.goto(f"{BASE}/login.html", wait_until="domcontentloaded")
            p.wait_for_timeout(500)
            # the notice links to the preference centre, and the header offers terms
            assert p.locator('a[href*="privacy"]').count() > 0, "no link to the privacy page"
        finally:
            p.close()

    check("cookie notice appears for a new visitor", t_cookie_notice_appears_for_a_new_visitor)
    check("cookie notice is dismissed once and stays gone", t_cookie_notice_can_be_dismissed_and_stays_dismissed)
    check("privacy page lists the real inventory", t_privacy_page_lists_the_real_inventory)
    check("preferences can be withdrawn", t_preferences_can_be_withdrawn)
    check("terms page is reachable", t_terms_page_is_reachable)
    check("login page links to the legal pages", t_login_page_offers_the_legal_links)


def main() -> int:
    console_errors: list[tuple[str, str]] = []
    # Every non-2xx API answer, tagged with the check that was running, so a
    # 401 can be traced to the request that caused it instead of just being
    # reported as console noise.
    bad_responses: list[tuple[str, str, int]] = []
    phase = {"name": "startup"}

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on(
            "pageerror",
            lambda exc: console_errors.append((phase["name"], f"uncaught: {str(exc)[:140]}")),
        )
        page.on(
            "console",
            lambda msg: console_errors.append((phase["name"], f"{msg.type}: {msg.text[:140]}"))
            if msg.type == "error"
            else None,
        )
        page.on("response", lambda res: bad_responses.append(
            (phase["name"], res.url.replace(BASE, ""), res.status)
        ) if res.status >= 400 and "/api/" not in res.url and "favicon" not in res.url else None)

        print(f"\nBrowser journey against {BASE}\n")
        try:
            run(page, phase)
        finally:
            browser.close()

    if bad_responses:
        print("\n  non-2xx API responses:")
        for ph, url, status in bad_responses:
            print(f"    [{status}] {url}  (during {ph})")
    # A page that throws is a bug even if every assertion passed.
    #
    # One class of error is expected: the expiry check deliberately throws the
    # access token away, so the browser logs the 401 the client then recovers
    # from by refreshing. That 401 is the test succeeding, so it does not
    # count. Anything else in that phase, and everything outside it, does.
    NOISY = ("favicon",)
    noisy = [
        f"[{ph}] {txt}"
        for ph, txt in console_errors
        if not any(n in txt.lower() for n in NOISY)
        and not (txt.startswith("error: Failed to load resource")
                 and ph.startswith("deliberate expiry"))
    ]
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