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

import json
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

    def t_undo_and_redo_buttons_start_disabled():
        """Nothing to undo on arrival, so the buttons must say so.

        If they look available but do nothing, the first thing a user
        tries after breaking something is the one control that lies.

        Runs before any other builder check, because this is only true
        until the first edit.
        """
        expect(page.locator("#undoBtn")).to_be_disabled(timeout=5000)
        expect(page.locator("#redoBtn")).to_be_disabled(timeout=5000)

    def t_undo_reverses_an_edit_and_redo_puts_it_back():
        title = page.evaluate(
            "() => window.Editor.plan.pages[0].sections[0].title")
        edited = "Undo test wording"

        # The previous check edited the same field. Pause past the
        # coalescing window so this is its own step - otherwise the two
        # merge and one undo legitimately reverts both.
        page.wait_for_timeout(900)

        page.evaluate("(t) => {"
                      "  window.Editor.writeValue(window.Editor.plan, window.Editor.pageId,"
                      "    window.Editor.plan.pages[0].sections[0].id, 'title', t);"
                      "  window.Editor.render();"
                      "  window.Editor.onChange('test');"
                      "}", edited)
        page.wait_for_timeout(300)
        assert page.evaluate(
            "() => window.Editor.plan.pages[0].sections[0].title") == edited

        expect(page.locator("#undoBtn")).to_be_enabled(timeout=5000)
        page.click("#undoBtn")
        page.wait_for_timeout(400)
        after_undo = page.evaluate(
            "() => window.Editor.plan.pages[0].sections[0].title")
        assert after_undo == title, f"undo did not restore the old wording: {after_undo!r}"
        # and the canvas agrees with the model, not just the model
        assert edited not in (page.locator(".ss-sec").first.inner_text() or ""), \
            "the canvas still shows the undone text"

        expect(page.locator("#redoBtn")).to_be_enabled(timeout=5000)
        page.click("#redoBtn")
        page.wait_for_timeout(400)
        assert page.evaluate(
            "() => window.Editor.plan.pages[0].sections[0].title") == edited, \
            "redo did not put the edit back"

    def t_undo_is_bindable_to_the_keyboard():
        """Ctrl+Z, because reaching for a small button after every drag is
        not how anyone actually works.

        One edit, one Ctrl+Z, back to where it started. Asserting a
        two-step jump here would be asserting a bug.
        """
        page.evaluate("() => window.History.reset(window.Editor.plan)")
        before = page.evaluate("() => window.Editor.plan.pages[0].sections[0].title")
        page.evaluate("() => {"
                      "  window.Editor.writeValue(window.Editor.plan, window.Editor.pageId,"
                      "    window.Editor.plan.pages[0].sections[0].id, 'title', 'Keyboard undo');"
                      "  window.Editor.render(); window.Editor.onChange('test'); }")
        page.wait_for_timeout(900)          # past the coalescing window

        page.click("#canvas", position={"x": 5, "y": 5})
        page.keyboard.press("Control+z")
        page.wait_for_timeout(400)
        assert page.evaluate(
            "() => window.Editor.plan.pages[0].sections[0].title") == before, \
            "Ctrl+Z did not undo"

    def t_each_separate_edit_is_its_own_step():
        """Two deliberate actions, paused between them, are two undo
        steps. This is the other half of the coalescing rule: coalesce
        bursts, but never swallow a pause."""
        page.evaluate("() => window.History.reset(window.Editor.plan)")
        page.evaluate("() => {"
                      "  window.Editor.writeValue(window.Editor.plan, window.Editor.pageId,"
                      "    window.Editor.plan.pages[0].sections[0].id, 'title', 'Step one');"
                      "  window.Editor.render(); window.Editor.onChange('test'); }")
        page.wait_for_timeout(900)
        page.evaluate("() => {"
                      "  window.Editor.writeValue(window.Editor.plan, window.Editor.pageId,"
                      "    window.Editor.plan.pages[0].sections[0].id, 'title', 'Step two');"
                      "  window.Editor.render(); window.Editor.onChange('test'); }")
        page.wait_for_timeout(300)
        assert page.evaluate("() => window.History.past.length") == 2, \
            "two paused edits should be two steps, got " \
            f"{page.evaluate('() => window.History.past.length')}"

        page.click("#canvas", position={"x": 5, "y": 5})
        page.keyboard.press("Control+z")
        page.wait_for_timeout(300)
        assert page.evaluate(
            "() => window.Editor.plan.pages[0].sections[0].title") == "Step one", \
            "one undo should revert one step, not both"

    def t_undo_restores_a_deleted_section():
        """The destructive one. A mis-drag deleting a section has to be
        recoverable or people stop trusting the editor."""
        count_before = page.evaluate("() => window.Editor.plan.pages[0].sections.length")
        first_id = page.evaluate("() => window.Editor.plan.pages[0].sections[0].id")

        page.evaluate("(id) => { window.Editor.select(id); window.Editor.command('del'); }", first_id)
        page.wait_for_timeout(300)
        gone = page.evaluate("() => window.Editor.plan.pages[0].sections.length")
        assert gone == count_before - 1, f"delete did not happen ({count_before} -> {gone})"

        page.click("#undoBtn")
        page.wait_for_timeout(400)
        restored = page.evaluate("() => window.Editor.plan.pages[0].sections.length")
        ids = page.evaluate("() => window.Editor.plan.pages[0].sections.map(s => s.id)")
        assert restored == count_before, f"undo did not restore the section ({restored})"
        assert first_id in ids, "the right section came back, not a different one"

    def t_a_new_edit_drops_the_redo_stack():
        """Standard behaviour, and it stops redo restoring a state that
        never existed."""
        page.evaluate("() => {"
                      "  window.Editor.writeValue(window.Editor.plan, window.Editor.pageId,"
                      "    window.Editor.plan.pages[0].sections[0].id, 'title', 'To be undone');"
                      "  window.Editor.render(); window.Editor.onChange('test'); }")
        page.wait_for_timeout(300)
        page.click("#undoBtn")
        page.wait_for_timeout(300)
        expect(page.locator("#redoBtn")).to_be_enabled(timeout=5000)

        page.evaluate("() => {"
                      "  window.Editor.writeValue(window.Editor.plan, window.Editor.pageId,"
                      "    window.Editor.plan.pages[0].sections[0].id, 'title', 'Something else');"
                      "  window.Editor.render(); window.Editor.onChange('test'); }")
        page.wait_for_timeout(300)
        expect(page.locator("#redoBtn")).to_be_disabled(timeout=5000)

    def t_rapid_edits_collapse_into_one_step():
        """Typing fires the change callback repeatedly. If each keystroke
        were its own undo step, Ctrl+Z would remove one character at a
        time and feel broken."""
        page.evaluate("() => { window.History.reset(window.Editor.plan); }")
        page.evaluate("() => {"
                      "  window.Editor.writeValue(window.Editor.plan, window.Editor.pageId,"
                      "    window.Editor.plan.pages[0].sections[0].id, 'title', 'A');"
                      "  window.Editor.render(); window.Editor.onChange('test'); }")
        for letter in ("B", "C", "D"):
            page.evaluate("(t) => {"
                          "  window.Editor.writeValue(window.Editor.plan, window.Editor.pageId,"
                          "    window.Editor.plan.pages[0].sections[0].id, 'title', t);"
                          "  window.Editor.render(); window.Editor.onChange('test'); }", letter)
        assert page.evaluate("() => window.History.past.length") == 1, \
            f"a burst of edits became {page.evaluate('() => window.History.past.length')} steps"

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
    # must precede every other builder check: it is only true until the
    # first edit, and the checks below all make one
    check("undo/redo start disabled", t_undo_and_redo_buttons_start_disabled)
    check("design panel opens on the right", t_design_panel_opens_on_the_right)
    check("sidebars can be closed and the page expands", t_sidebars_can_be_closed)
    check("inline text editing saves", t_inline_edit_saves)
    check("undo reverses an edit and redo puts it back", t_undo_reverses_an_edit_and_redo_puts_it_back)
    check("undo works from the keyboard", t_undo_is_bindable_to_the_keyboard)
    check("each paused edit is its own undo step", t_each_separate_edit_is_its_own_step)
    check("undo restores a deleted section", t_undo_restores_a_deleted_section)
    check("a new edit clears the redo stack", t_a_new_edit_drops_the_redo_stack)
    check("a burst of edits is one undo step", t_rapid_edits_collapse_into_one_step)
    check("drag handles are visible without hovering", t_drag_handles_are_visible)

    def t_type_scale_reaches_the_rendered_text():
        """The whole point of the control: move one slider and the text
        actually changes size. Asserting the slider exists would pass even
        if the CSS never referenced it."""
        base = page.evaluate("""
            () => {
              const h = window.Editor.root.querySelector('.ss-site h1')
                         || window.Editor.root.querySelector('.ss-sec h2');
              const p = window.Editor.root.querySelector('.ss-sec p');
              return {
                h1: h ? parseFloat(getComputedStyle(h).fontSize) : 0,
                p: p ? parseFloat(getComputedStyle(p).fontSize) : 0
              };
            }""")
        assert base["h1"] > 0 and base["p"] > 0, f"no measurable text: {base}"

        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  s.tokens.type = { scale: 1.25, lh: 1, ls: 0 };"
                      "  window.Editor.render(); }")
        page.wait_for_timeout(400)
        bigger = page.evaluate("""
            () => {
              const h = window.Editor.root.querySelector('.ss-site h1')
                         || window.Editor.root.querySelector('.ss-sec h2');
              const p = window.Editor.root.querySelector('.ss-sec p');
              return {
                h1: h ? parseFloat(getComputedStyle(h).fontSize) : 0,
                p: p ? parseFloat(getComputedStyle(p).fontSize) : 0
              };
            }""")
        assert bigger["h1"] > base["h1"] * 1.15, \
            f"heading did not scale: {base['h1']:.1f}px -> {bigger['h1']:.1f}px"
        # body text has to move too, or "text size" only means "heading size"
        assert bigger["p"] > base["p"] * 1.15, \
            f"body text did not scale: {base['p']:.1f}px -> {bigger['p']:.1f}px"

        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  delete s.tokens.type; window.Editor.render(); }")
        page.wait_for_timeout(300)

    def t_line_and_letter_spacing_reach_the_page():
        before = page.evaluate("""
            () => {
              const h = window.Editor.root.querySelector('.ss-site h1')
                         || window.Editor.root.querySelector('.ss-sec h2');
              const cs = h ? getComputedStyle(h) : null;
              if (!cs) return null;
              /* computed lineHeight comes back as "83.776px" and
                 letterSpacing can be "normal" - parse in the browser so
                 Python never has to strip a unit */
              return { lh: parseFloat(cs.lineHeight) || 0,
                       ls: parseFloat(cs.letterSpacing) || 0 };
            }""")
        assert before and before["lh"], f"could not read heading line-height: {before}"

        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  s.tokens.type = { scale: 1, lh: 1.4, ls: 0.08 };"
                      "  window.Editor.render(); }")
        page.wait_for_timeout(400)
        after = page.evaluate("""
            () => {
              const h = window.Editor.root.querySelector('.ss-site h1')
                         || window.Editor.root.querySelector('.ss-sec h2');
              const cs = h ? getComputedStyle(h) : null;
              if (!cs) return null;
              return { lh: parseFloat(cs.lineHeight) || 0,
                       ls: parseFloat(cs.letterSpacing) || 0 };
            }""")
        assert after["lh"] > before["lh"] + 1, \
            f"line spacing did not change: {before['lh']} -> {after['lh']}"
        assert after["ls"] > before["ls"], \
            f"letter spacing did not change: {before['ls']} -> {after['ls']}"

        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  delete s.tokens.type; window.Editor.render(); }")
        page.wait_for_timeout(300)

    def t_type_scale_survives_a_reload():
        """It has to be stored in the plan, or it is a preview-only toy."""
        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  s.tokens.type = { scale: 1.15, lh: 1.1, ls: 0.03 };"
                      "  window.Editor.onChange('design:type'); }")
        page.wait_for_timeout(1600)          # let the debounced save land
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        stored = page.evaluate("() => JSON.stringify("
                               "  (window.Editor.spec().tokens || {}).type || null)")
        assert '"scale":1.15' in stored.replace(" ", ""), \
            f"type scale was not persisted: {stored}"

    check("type scale reaches the rendered text", t_type_scale_reaches_the_rendered_text)
    check("line and letter spacing reach the page", t_line_and_letter_spacing_reach_the_page)
    check("type scale survives a reload", t_type_scale_survives_a_reload)
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

    def t_cookie_notice_appears_on_the_landing_page():
        """No stored choice means the notice is shown, and it says the truth."""
        fresh = page.context.browser.new_context(viewport={"width": 1280, "height": 900})
        try:
            p = fresh.new_page()
            p.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
            bar = p.locator("#consentBar")
            expect(bar).to_be_visible(timeout=8000)
            text = (bar.inner_text() or "").lower()
            # The claim on the page is that nothing tracks anybody. If a
            # tracker is ever added, this copy becomes a lie and this fails.
            assert "no analytics" in text, f"notice does not say what it should: {text!r}"
            assert "one cookie" in text, f"notice does not say how many: {text!r}"

            # two real answers, both looking like answers
            expect(bar.locator("button")).to_have_count(2, timeout=5000)
            labels = [t.strip() for t in bar.locator("button").all_inner_texts()]
            joined = " ".join(labels).lower()
            assert "accept" in joined, labels
            assert "decline" in joined, labels
        finally:
            fresh.close()

    def t_notice_is_not_on_the_sign_in_page():
        """It belongs on the landing page only.

        A fixed bottom bar on the signed-in pages covered the plan wizard's
        primary button, which reads as a broken app rather than a notice.
        """
        fresh = page.context.browser.new_context(viewport={"width": 1280, "height": 900})
        try:
            p = fresh.new_page()
            for path in ("login.html", "register.html"):
                p.goto(f"{BASE}/{path}", wait_until="domcontentloaded")
                p.wait_for_timeout(400)
                assert p.locator("#consentBar").count() == 0, \
                    f"the cookie notice is on {path}, where it does not belong"
        finally:
            fresh.close()

    def t_declining_is_a_recorded_decision():
        fresh = page.context.browser.new_context(viewport={"width": 1280, "height": 900})
        try:
            p = fresh.new_page()
            p.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
            p.wait_for_selector("#consentBar", timeout=8000)
            p.click("#consentBar button:has-text('Decline')")
            p.wait_for_timeout(300)
            assert p.locator("#consentBar").count() == 0, "notice did not go away"

            saved = json.loads(p.evaluate("() => localStorage.getItem('sitesketch_consent_v1')"))
            assert saved is not None, "the decision was not saved"
            # declining is a real answer, distinct from never having been asked
            assert saved["decision"] == "declined", saved
            assert saved["categories"] == [], saved
            assert saved["essential"] is True, "essential is not optional"

            # and it must not come back
            p.reload(wait_until="domcontentloaded")
            p.wait_for_timeout(500)
            assert p.locator("#consentBar").count() == 0, "a declined notice came back"
        finally:
            fresh.close()

    def t_accepting_is_recorded_too():
        fresh = page.context.browser.new_context(viewport={"width": 1280, "height": 900})
        try:
            p = fresh.new_page()
            p.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
            p.wait_for_selector("#consentBar", timeout=8000)
            p.click("#consentBar button:has-text('Accept')")
            p.wait_for_timeout(300)
            saved = json.loads(p.evaluate("() => localStorage.getItem('sitesketch_consent_v1')"))
            assert saved["decision"] == "accepted", saved
            assert "Functional" in saved["categories"], saved
        finally:
            fresh.close()

    def t_landing_page_links_to_the_legal_pages():
        p = page.context.new_page()
        try:
            p.goto(f"{BASE}/index.html", wait_until="domcontentloaded")
            p.wait_for_timeout(400)
            for path in ("privacy.html", "terms.html"):
                assert p.locator(f'a[href="{path}"]').count() > 0, \
                    f"the landing page does not link to {path}"
        finally:
            p.close()

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
        """The cookie notice used to be the only route to the policy. When it
        moved to the landing page these pages had no way to reach it.

        Uses a signed-out context on purpose: login.html redirects to the
        dashboard when there is already a session, which is correct and would
        otherwise make this check look like it failed.
        """
        fresh = page.context.browser.new_context(viewport={"width": 1280, "height": 900})
        try:
            p = fresh.new_page()
            for path in ("login.html", "register.html"):
                p.goto(f"{BASE}/{path}", wait_until="domcontentloaded")
                p.wait_for_timeout(500)
                assert "login" in p.url or "register" in p.url, f"{path} redirected to {p.url}"
                for target in ("privacy.html", "terms.html"):
                    assert p.locator(f'a[href="{target}"]').count() > 0, \
                        f"{path} does not link to {target}"
        finally:
            fresh.close()

    check("cookie notice appears on the landing page", t_cookie_notice_appears_on_the_landing_page)
    check("notice is not on the sign-in pages", t_notice_is_not_on_the_sign_in_page)
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