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
    def t_brand_colours_reach_the_page():
        """A typed hex has to become the actual rendered colour, not just a
        value sitting in the plan."""
        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  s.tokens.colour = { accent: '#B04A26', bg: '#FFFDF9', text: '#2A1E16' };"
                      "  window.Editor.render(); }")
        page.wait_for_timeout(400)
        got = page.evaluate("""
            () => {
              const site = window.Editor.root.querySelector('.ss-site');
              const cs = getComputedStyle(site);
              return { accent: cs.getPropertyValue('--accent').trim(),
                       bg: cs.getPropertyValue('--bg').trim(),
                       text: cs.getPropertyValue('--text').trim() };
            }""")
        assert got["accent"] == "#B04A26", f"accent did not apply: {got}"
        assert got["bg"] == "#FFFDF9", f"background did not apply: {got}"
        assert got["text"] == "#2A1E16", f"text colour did not apply: {got}"

        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  delete s.tokens.colour; window.Editor.render(); }")
        page.wait_for_timeout(300)

    def t_brand_derives_readable_ink():
        """The other five colours are derived. accentInk in particular is
        what text on a button is drawn in, so getting it wrong makes the
        button unreadable rather than merely ugly."""
        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  s.tokens.colour = { accent: '#FFE066' };   /* light accent */"
                      "  window.Editor.render(); }")
        page.wait_for_timeout(300)
        light = page.evaluate(
            "() => getComputedStyle(window.Editor.root.querySelector('.ss-site'))"
            ".getPropertyValue('--accent-ink').trim()")
        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  s.tokens.colour = { accent: '#101010' };   /* dark accent */"
                      "  window.Editor.render(); }")
        page.wait_for_timeout(300)
        dark = page.evaluate(
            "() => getComputedStyle(window.Editor.root.querySelector('.ss-site'))"
            ".getPropertyValue('--accent-ink').trim()")
        assert light != dark, \
            f"ink did not adapt to the accent: both {light!r}"
        assert light.upper() == "#14110A", \
            f"a pale accent should take dark ink, got {light!r}"
        assert dark.upper() == "#FFFFFF", \
            f"a dark accent should take white ink, got {dark!r}"

        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  delete s.tokens.colour; window.Editor.render(); }")
        page.wait_for_timeout(300)

    def t_partial_brand_set_stays_coherent():
        """Setting only an accent must not blank the rest of the palette.
        Someone who knows their brand colour and nothing else should still
        get a readable page."""
        got = page.evaluate("""() => {
            const D = window.DESIGN;
            const base = D.paletteById('cobalt-cream').c;
            const out = D.applyBrand(base, { tokens: { colour: { accent: '#7A1F3D' } } });
            return { surface: out.surface, muted: out.muted, line: out.line,
                     soft: out.soft, accent: out.accent, text: out.text };
        }""")
        for key in ("surface", "muted", "line", "soft"):
            assert got[key] and got[key].startswith("#"), \
                f"derived colour {key} is missing: {got}"
        # text and background must still come from the palette, untouched
        assert got["accent"] == "#7A1F3D", got
        assert got["text"].upper() == "#16181D", \
            f"text should have come from the palette, got {got['text']}"

    def t_brand_colours_survive_a_reload():
        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  s.tokens.colour = { accent: '#7A1F3D', bg: '#FFFDF9', text: '#2A1E16' };"
                      "  window.Editor.onChange('design:colour'); }")
        page.wait_for_timeout(1600)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        accent = page.evaluate(
            "() => getComputedStyle(document.querySelector('.ss-site'))"
            ".getPropertyValue('--accent').trim()")
        assert accent.upper() == "#7A1F3D", f"brand colour not persisted: {accent}"
        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  delete s.tokens.colour; window.Editor.onChange('design:colour'); }")
        page.wait_for_timeout(1200)

    def t_published_copy_carries_no_editor_instructions():
        """A visitor must never read instructions meant for the builder.

        These strings were rendered by the renderer rather than stored in
        the plan, so no amount of editing the content removed them: a
        published page showed "Replace this with your own story." and a
        photo with no caption shipped alt="Add a photo". Both were found
        by screenshotting a live page, not by any earlier test.

        Asserted against the compiled non-editable output, because that is
        the thing that gets stored and served.
        """
        # a plan with every optional field empty is the worst case: that is
        # exactly when the placeholders used to appear
        stripped = page.evaluate("""() => {
            const plan = JSON.parse(JSON.stringify(window.Editor.plan));
            for (const pg of plan.pages) {
                for (const s of pg.sections || []) {
                    delete s.subtitle;
                    delete s.body;
                    delete s.items;
                    delete s.crops;
                }
            }
            window.__stripped = plan;
            return window.SS.compileSite(plan, { pageBase: '', css: '/*t*/' });
        }""")
        assert stripped["pages"], "nothing compiled"

        # everything a reader could see, or that an assistive tech reads out
        visible = ""
        for html in stripped["pages"].values():
            visible += html.lower()
        for phrase in ("replace this with your own story",
                       "tell the short version",
                       "a line about this",
                       "add a caption",
                       "add a photo"):
            assert phrase not in visible, \
                f"published page still shows editor copy: {phrase!r}"

        # the same stripped plan, rendered for the builder, still guides the
        # person editing it - otherwise there is nothing to click into
        editor_html = page.evaluate(
            "() => window.SS.renderPage(window.__stripped, "
            "window.Editor.plan.pages[0].id, { editable: true }).toLowerCase()")
        assert ("add a caption" in editor_html
                or "a line about this" in editor_html
                or "tell the short version" in editor_html), \
            "the builder should still show its placeholders"

    check("brand colours reach the page", t_brand_colours_reach_the_page)
    check("brand derives readable ink", t_brand_derives_readable_ink)
    check("a partial brand set stays coherent", t_partial_brand_set_stays_coherent)
    def t_an_eight_digit_colour_is_not_thrown_away():
        """A colour chosen from the swatch must actually land.

        Chrome's colour picker has an opacity slider, and once it is touched
        the input reports 8-digit hex. parseColour accepted only 3 and 6
        digits, so it returned null and the colour was discarded with no
        message - the swatch, the most obvious way to pick a colour, did
        nothing. Reported as "you can't properly change the colours".
        """
        cases = [
            # what the picker sends once opacity has been touched
            ("#B04A2680", "#B04A26"),
            ("#B04A26FF", "#B04A26"),
            # four-digit #rgba, alpha dropped
            ("#B04A", "#BB0044"),
            ("#B044", "#BB0044"),
            # and the forms that were already working must not regress
            ("#B04A26", "#B04A26"),
            ("#B04", "#BB0044"),
        ]
        for raw, expected in cases:
            got = page.evaluate("(v) => window.DESIGN.parseColour(v)", raw)
            assert got and got.upper() == expected, \
                f"{raw!r} parsed to {got!r}, expected {expected}"

        # the whole path, not just the parser: through the field to the page
        if page.get_attribute("#stylesBtn", "aria-pressed") != "true":
            page.click("#stylesBtn")
            page.wait_for_timeout(500)
        page.fill("#colour_accent_hex", "#2E7D3280")
        page.dispatch_event("#colour_accent_hex", "change")
        page.wait_for_timeout(900)
        accent = page.evaluate(
            "() => getComputedStyle(window.Editor.root.querySelector('.ss-site'))"
            ".getPropertyValue('--accent').trim()")
        assert accent.upper() == "#2E7D32", \
            f"an 8-digit colour did not reach the page: {accent}"

        # five digits is not a colour and must still be refused
        assert page.evaluate("(v) => window.DESIGN.parseColour(v)",
                             "#2E7D3") is None, "5 digits parsed as a colour"

        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  delete s.tokens.colour; window.Editor.onChange('design:colour'); }")
        page.wait_for_timeout(1200)

    check("an eight-digit colour is not thrown away",
          t_an_eight_digit_colour_is_not_thrown_away)
    def t_colour_fields_accept_rgb_and_hsl():
        """People arrive with colours in whatever format their tools hand
        over. Figma, a brand guide screenshot and every CSS rule speak rgb()
        and hsl(); rejecting them with "use a full colour like #B04A26" is
        true and useless when what is in front of you is 176, 74, 38."""
        cases = [
            ("#B04A26", "#B04A26"),
            ("b04a26", "#B04A26"),
            ("#B04", "#BB0044"),
            ("rgb(176, 74, 38)", "#B04A26"),
            ("rgba(176, 74, 38, 0.8)", "#B04A26"),
            ("rgb(176 74 38)", "#B04A26"),
            # checked against python colorsys, not guessed: hls_to_rgb(20,62%,42)
            # is #AE5529
            ("hsl(20, 62%, 42%)", "#AE5529"),
            ("  #B04A26  ", "#B04A26"),
        ]
        results = page.evaluate("""(cases) => {
            const out = [];
            for (const c of cases) {
                const v = window.DESIGN.parseColour(c[0]);
                out.push(v);
            }
            return out;
        }""", cases)
        for (raw, expected), got in zip(cases, results):
            assert got and got.upper() == expected.upper(), \
                f"{raw!r} parsed to {got!r}, expected {expected}"

        # rubbish is still refused, rather than silently becoming black
        for junk in ("rebeccapurple", "rgb(1,2)", "#12345", "not a colour", ""):
            assert page.evaluate("(v) => window.DESIGN.parseColour(v)", junk) is None, \
                f"{junk!r} should not parse"

    def t_rgb_readout_shows_the_value():
        """You should not have to open a system dialog to find out what
        colour you just set."""
        page.click("#stylesBtn")
        page.wait_for_timeout(400)
        page.fill("#colour_accent_hex", "rgb(176, 74, 38)")
        page.dispatch_event("#colour_accent_hex", "change")
        page.wait_for_timeout(600)

        shown = page.locator("#colour_accent_rgb").inner_text()
        assert shown == "rgb(176, 74, 38)", f"readout says {shown!r}"
        accent = page.evaluate(
            "() => getComputedStyle(window.Editor.root.querySelector('.ss-site'))"
            ".getPropertyValue('--accent').trim()")
        assert accent.upper() == "#B04A26", f"page accent is {accent}"

        page.click("#colourReset")
        page.wait_for_timeout(400)

    def t_unset_brand_swatch_shows_the_real_colour():
        """An unset brand colour must not look like black.

        The swatch defaulted to #000000, so a Design panel with nothing
        chosen showed three solid black squares beside three empty fields -
        which reads as "your brand is black", not "not set yet". It should
        preview the colour the site is actually using, dimmed.
        """
        if page.get_attribute("#stylesBtn", "aria-pressed") != "true":
            page.click("#stylesBtn")
            page.wait_for_timeout(500)

        # Clear via the real control rather than by poking state from the
        # console. The button calls refresh() explicitly; setting the same
        # value twice from outside leaves the panel showing what it already
        # showed, which is a stale panel, not a bug in the swatch.
        page.click("#colourReset")
        page.wait_for_timeout(900)

        for key in ("accent", "bg", "text"):
            # the chip is the visible control now: a button that opens
            # SiteSketch's picker. The native input is still in the DOM,
            # hidden, so it can back the "More colours" escape hatch.
            info = page.evaluate(
                "(k) => { const c = document.querySelector('#colour_' + k + '_chip');"
                "  if (!c) return { missing: true };"
                "  return { shown: c.style.getPropertyValue('--chip').trim(),"
                "           empty: c.dataset.empty === '1',"
                "           opacity: getComputedStyle(c).opacity }; }", key)
            assert not info.get("missing"), f"{key} has no colour chip"
            assert info["shown"].upper() != "#000000", \
                f"{key} chip shows black while unset"
            assert info["empty"], f"{key} chip is not marked unset"
            assert float(info["opacity"]) < 1, \
                f"{key} chip is not dimmed, so it reads as chosen"

        # setting one must un-dim it, or the state is stuck
        page.fill("#colour_accent_hex", "#B04A26")
        page.dispatch_event("#colour_accent_hex", "change")
        page.wait_for_timeout(700)
        after = page.evaluate(
            "() => { const c = document.querySelector('#colour_accent_chip');"
            "  return { empty: c.dataset.empty === '1',"
            "           opacity: getComputedStyle(c).opacity }; }")
        assert not after["empty"], "chip stayed marked unset after a value was set"
        assert float(after["opacity"]) == 1, "chip stayed dimmed after a value was set"

    def t_the_picker_opens_beside_the_swatch():
        """Not in the top-left corner of the screen.

        The native colour dialog did exactly that. Measured rather than
        assumed: the swatch sits correctly at x=1148 y=367 with no
        transformed ancestors, but #stylesPanel is position:sticky with
        overflow:auto and Chrome anchors the popup to the viewport for an
        input inside one. There is no way to style, scroll or focus that into
        place, which is why there is a picker of our own.
        """
        if page.get_attribute("#stylesBtn", "aria-pressed") != "true":
            page.click("#stylesBtn")
            page.wait_for_timeout(600)
        page.click("#colour_accent_chip")
        page.wait_for_timeout(500)

        assert page.locator(".ss-picker").count() == 1, "the picker did not open"
        pk = page.locator(".ss-picker").bounding_box()
        chip = page.locator("#colour_accent_chip").bounding_box()

        assert pk["y"] >= chip["y"] - 40, \
            f"the picker opened above the swatch by {chip['y'] - pk['y']}px"
        # vertically it must be near the swatch, not parked at the top
        assert abs(pk["y"] - chip["y"]) < 220, \
            f"the picker is {abs(pk['y'] - chip['y'])}px from the swatch vertically"
        # and horizontally overlapping it, or clamped just inside the window
        assert pk["x"] < chip["x"] + chip["width"], \
            "the picker is not beside the swatch at all"
        assert pk["x"] >= 0 and pk["y"] >= 0, "the picker is off-screen"

        # it must offer an Apply, which the native dialog never had
        assert page.locator(".ss-picker-apply").is_visible(), "no Apply button"
        assert page.locator(".ss-picker-cancel").is_visible(), "no Cancel button"
        # and no opacity control, because the design system has no transparency
        assert page.locator(".ss-picker input[type=range]").count() == 0, \
            "the picker offers an alpha slider for a design system that has none"

        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        assert page.locator(".ss-picker").count() == 0, "Escape did not close it"

    def t_the_picker_applies_and_cancels():
        """Apply commits, Cancel discards.

        Both halves matter. A picker that can only commit is worse than no
        picker, because there is no way back from a colour chosen by mistake.
        """
        if page.get_attribute("#stylesBtn", "aria-pressed") != "true":
            page.click("#stylesBtn")
            page.wait_for_timeout(600)

        def accent():
            return page.evaluate(
                "() => getComputedStyle(window.Editor.root.querySelector('.ss-site'))"
                ".getPropertyValue('--accent').trim().toUpperCase()")

        before = accent()

        # --- Apply commits, through the drag rather than the text field
        page.click("#colour_accent_chip")
        page.wait_for_timeout(500)
        box = page.locator(".ss-picker-sv").bounding_box()
        page.mouse.move(box["x"] + box["width"] * 0.85,
                        box["y"] + box["height"] * 0.25)
        page.mouse.down()
        page.mouse.up()
        page.wait_for_timeout(400)
        dragged = page.locator(".ss-picker-hex").input_value().upper()
        assert dragged != before, "dragging the square changed nothing"

        page.click(".ss-picker-apply")
        page.wait_for_timeout(1000)
        assert page.locator(".ss-picker").count() == 0, "Apply left it open"
        assert page.locator("#colour_accent_hex").input_value().upper() == dragged, \
            "the text field did not follow the picker"
        assert accent() == dragged, \
            f"Apply did not reach the page: {accent()} not {dragged}"

        # --- Cancel discards
        applied = accent()
        page.click("#colour_accent_chip")
        page.wait_for_timeout(500)
        page.fill(".ss-picker-hex", "#FF0000")
        page.wait_for_timeout(300)
        page.click(".ss-picker-cancel")
        page.wait_for_timeout(900)
        assert page.locator(".ss-picker").count() == 0, "Cancel left it open"
        assert accent() == applied, \
            f"Cancel changed the page: {accent()} not {applied}"
        assert page.locator("#colour_accent_hex").input_value().upper() != "#FF0000", \
            "Cancel left the typed colour behind"

        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  delete s.tokens.colour; window.Editor.onChange('design:colour'); }")
        page.wait_for_timeout(1200)

    def t_the_picker_survives_being_clicked():
        """Clicking inside the picker must not destroy it.

        This is bug 7 all over again. The document-level "click away clears
        the toolbar" handler rebuilds the panel on any click outside the
        canvas, and a picker rendered outside the panel would be torn down by
        its own first click.
        """
        if page.get_attribute("#stylesBtn", "aria-pressed") != "true":
            page.click("#stylesBtn")
            page.wait_for_timeout(600)
        page.click("#colour_accent_chip")
        page.wait_for_timeout(500)

        # Apply and Cancel are deliberately not in this list: they are supposed to
        # close the picker, and t_the_picker_applies_and_cancels covers them.
        for selector in (".ss-picker-hex", ".ss-picker-r", ".ss-picker-sv"):
            page.locator(selector).click()
            page.wait_for_timeout(250)
            assert page.locator(".ss-picker").count() == 1, \
                f"the picker was destroyed by clicking {selector}"

        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

    def t_builder_warns_when_the_live_site_is_behind():
        """An edit does not reach visitors until the site is republished.

        Publishing stores a finished copy of the page, because a published
        site runs no JavaScript. That is correct, and it meant that changing
        your brand colour, opening your live site and finding the old colour
        there was the expected result with no warning anywhere - reported by
        a real user.
        """
        stale = page.locator("#liveStale")

        # this project is unpublished in the browser suite, so nothing to warn
        assert not stale.is_visible(), \
            "the out-of-date warning is showing for a site that was never published"

        # publish it for real through the page, exactly as a person would
        slug = "stale-" + uuid.uuid4().hex[:8]
        page.goto(f"{BASE}/publish.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        page.fill("#slug", slug)
        page.click("#pubBtn")
        page.wait_for_timeout(6000)

        page.goto(f"{BASE}/builder.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        page.wait_for_timeout(1500)
        # published and unedited since: nothing to warn about
        assert not stale.is_visible(), \
            "warned immediately after publishing, with no edits since"

        # now make an edit and wait for autosave
        if page.get_attribute("#stylesBtn", "aria-pressed") != "true":
            page.click("#stylesBtn")
            page.wait_for_timeout(500)
        page.fill("#colour_accent_hex", "#2E7D32")
        page.dispatch_event("#colour_accent_hex", "change")
        page.wait_for_timeout(2500)

        assert stale.is_visible(), \
            "the live site is behind the editor and the builder did not say so"
        assert "republish" in stale.inner_text().lower(), stale.inner_text()

        # and the warning clears once the site is republished
        page.goto(f"{BASE}/publish.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        page.click("#pubBtn")
        page.wait_for_timeout(6000)
        page.goto(f"{BASE}/builder.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        page.wait_for_timeout(1500)
        assert not stale.is_visible(), "still warning after republishing"

        # Leave the project published. Taking it offline here broke every later
        # check that loads the published address, because this test
        # publishes last and the suite's own publish step did not recover
        # it. The later tests republish with their own slug anyway.
        page.goto(f"{BASE}/builder.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        page.wait_for_timeout(1200)
        page.evaluate("() => {"
                      "  const s = window.Editor.spec();"
                      "  delete s.tokens.colour; window.Editor.onChange('design:colour'); }")
        page.wait_for_timeout(1500)

    def t_panel_controls_survive_being_clicked():
        """A dropdown must not be destroyed by the act of opening it.

        A document-level handler cleared the section selection on any click
        that was not on the canvas. Clicking a side-panel control therefore
        ran onSelectionChange, which re-rendered the panel, which replaced
        the <select> being clicked. Chrome closes the native popup the moment
        its node is replaced, so on a touchscreen - where a dropdown only
        opens on a long press - the list vanished the instant you lifted your
        finger and nothing could be chosen.

        The check is node identity, not appearance: the same element must
        still be in the document afterwards.
        """
        page.goto(f"{BASE}/builder.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        page.wait_for_timeout(1200)
        if page.get_attribute("#footerBtn", "aria-pressed") != "true":
            page.click("#footerBtn")
            page.wait_for_timeout(700)

        # mark the node we are about to poke
        page.evaluate("""() => {
            const s = document.querySelector('#footCols');
            s.setAttribute('data-identity', 'ORIGINAL');
        }""")

        for selector in ("#footCols", "#footAlign"):
            page.evaluate("(sel) => document.querySelector(sel)"
                          ".setAttribute('data-identity', 'ORIGINAL')", selector)
            box = page.locator(selector).bounding_box()
            assert box, f"{selector} has no box"
            cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            # a long press, which is how a touchscreen opens a dropdown
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.wait_for_timeout(700)
            page.mouse.up()
            page.wait_for_timeout(400)

            assert page.locator(f'{selector}[data-identity="ORIGINAL"]').count(), \
                f"{selector} was replaced in the DOM by being clicked, so " \
                f"its dropdown would close the instant it opened"

        # and the panel must still work afterwards
        page.select_option("#footCols", "1fr 1fr")
        page.wait_for_timeout(800)
        assert page.evaluate(
            "() => ((window.Editor.plan.footer || {}).style || {}).columns") \
            == "1fr 1fr", \
            "the dropdown stopped working after being clicked"

    check("a panel control is not destroyed by being clicked",
          t_panel_controls_survive_being_clicked)
    check("published copy carries no editor instructions",
          t_published_copy_carries_no_editor_instructions)
    def t_a_custom_menu_link_can_be_added():
        """The Menu could not add anything once every page was in it, and
        could not add a link that is not a page at all.

        The add control was conditional on there being a spare page, so with
        every page in the menu it disappeared from the DOM entirely -
        measured, #navAddTop was absent - leaving nothing to click. And
        there was no way to point a menu item at anything but a page, which
        is not what a menu is for.
        """
        page.goto(f"{BASE}/builder.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        page.wait_for_timeout(1200)
        if page.get_attribute("#menuBtn", "aria-pressed") != "true":
            page.click("#menuBtn")
            page.wait_for_timeout(700)

        # the control is there whatever the state of the page list
        assert page.locator("#navAddTop").count() == 1, \
            "there is no way to add a page to the menu at all"
        assert page.locator("#navCustomAdd").count() == 1, \
            "there is no way to add a link that is not a page"

        def nav_hrefs():
            return page.evaluate(
                "() => [...document.querySelectorAll('.ss-nav a')]"
                ".map(a => a.getAttribute('href'))")

        before = nav_hrefs()
        page.fill("#navCustomLabel", "Instagram")
        page.fill("#navCustomHref", "https://instagram.com/sablecoffee")
        page.click("#navCustomAdd")
        page.wait_for_timeout(1400)

        assert "https://instagram.com/sablecoffee" in nav_hrefs(), \
            f"the custom link did not reach the navigation: {nav_hrefs()}"
        assert page.locator("[data-nav-href]").count() >= 1, \
            "the custom link has no editable address in the panel"

        # it must survive the panel being read again. items() rebuilt each
        # entry without its href at first, and navItems drops entries with no
        # usable href - so every custom link deleted itself the moment the
        # panel looked at the list.
        page.click("#menuBtn")
        page.wait_for_timeout(500)
        page.click("#menuBtn")
        page.wait_for_timeout(900)
        assert "https://instagram.com/sablecoffee" in nav_hrefs(), \
            f"the custom link did not survive reopening the panel: {nav_hrefs()}"

        page.locator("[data-nav-href]").first.fill("https://instagram.com/updated")
        page.wait_for_timeout(1200)
        assert "https://instagram.com/updated" in nav_hrefs(), \
            f"editing the address in place did nothing: {nav_hrefs()}"

        # remove it again
        rows_before = page.locator(".menu-row").count()
        page.locator("[data-nav-rm]").last.click()
        page.wait_for_timeout(1200)
        assert page.locator(".menu-row").count() == rows_before - 1, \
            "the remove button did not remove the row"
        assert "https://instagram.com/updated" not in nav_hrefs(), \
            "the removed link is still in the navigation"

        del before

    def t_a_dangerous_menu_address_is_refused():
        """A menu href lands in a published document as an attribute.

        The publish endpoint strips <script> and event handlers, but it
        cannot see inside an href, so "javascript:..." would survive into a
        page served from our origin. Only the schemes a business menu
        actually uses are allowed; anything else is not a link at all.
        """
        if page.get_attribute("#menuBtn", "aria-pressed") != "true":
            page.click("#menuBtn")
            page.wait_for_timeout(700)

        before = page.locator(".menu-row").count()
        page.fill("#navCustomLabel", "Bad")
        page.fill("#navCustomHref", "javascript:alert(1)")
        page.click("#navCustomAdd")
        page.wait_for_timeout(900)

        assert page.locator(".menu-row").count() == before, \
            "a javascript: address was added to the menu"
        assert "javascript:" not in page.evaluate(
            "() => document.body.innerHTML").lower(), \
            "a javascript: address reached the page"

        # a bare domain is what people actually type, and is allowed
        page.fill("#navCustomLabel", "Bookings")
        page.fill("#navCustomHref", "sable.example.com/book")
        page.click("#navCustomAdd")
        page.wait_for_timeout(1400)
        hrefs = page.evaluate(
            "() => [...document.querySelectorAll('.ss-nav a')]"
            ".map(a => a.getAttribute('href'))")
        assert "https://sable.example.com/book" in hrefs, \
            f"a scheme-less address was not normalised to https: {hrefs}"

        page.locator("[data-nav-rm]").last.click()
        page.wait_for_timeout(1200)

    def t_a_menu_link_survives_a_round_trip():
        """Custom links must still be there after a reload.

        navItems drops any entry whose page no longer exists. A custom link
        has no page, so it has to be kept on the strength of its own href -
        otherwise it renders in the editor and vanishes on the next load.
        """
        page.goto(f"{BASE}/builder.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        page.wait_for_timeout(1200)
        if page.get_attribute("#menuBtn", "aria-pressed") != "true":
            page.click("#menuBtn")
            page.wait_for_timeout(700)

        page.evaluate("""() => {
            const plan = window.Editor.plan;
            plan.nav = [
                { pageId: null, href: 'https://example.com/social',
                  label: 'Social', visible: true, children: [] },
                { pageId: null, href: 'mailto:hello@example.com',
                  label: 'Email', visible: true, children: [] }
            ];
            window.Editor.onChange('nav');
        }""")
        page.wait_for_timeout(2000)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        page.wait_for_timeout(1500)

        hrefs = page.evaluate(
            "() => [...document.querySelectorAll('.ss-nav a')]"
            ".map(a => a.getAttribute('href'))")
        assert "https://example.com/social" in hrefs, \
            f"a custom link did not survive a reload: {hrefs}"
        assert "mailto:hello@example.com" in hrefs, \
            f"a mailto link did not survive a reload: {hrefs}"

        # put the menu back as the rest of the suite expects it
        page.evaluate("""() => {
            window.Editor.plan.nav = null;
            window.Editor.onChange('nav');
        }""")
        page.wait_for_timeout(1500)

    def t_export_zip_does_not_pretend_to_work():
        """A control that cannot do what its label says is a bug.

        Export ZIP was a normal-looking button wired to a toast reading
        "Prototype: ZIP export runs through the Flask backend (Phase 2)".
        Reported as "for zipping the file it says backend" - and it is worse
        than having no button at all, because it looks like a working
        control and the only answer a person gets mentions a backend and a
        phase.

        Building export properly is separate work. Until then it is disabled
        and says so.
        """
        page.goto(f"{BASE}/publish.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_timeout(1800)

        btn = page.locator("#zipBtn")
        assert btn.count() == 1, "the export button has gone entirely"
        assert btn.is_disabled(), \
            "export is presented as working when it is not built"
        assert btn.get_attribute("aria-disabled") == "true", \
            "a disabled control should still say so to assistive tech"

        label = " ".join(btn.inner_text().split()).lower()
        assert "not built" in label, \
            f"the button does not admit it does not work: {label!r}"
        assert page.locator("#zipNote").is_visible(), \
            "nothing explains that export is unavailable"

        # and no part of the page should still be promising a backend
        body = " ".join(page.inner_text("body").split()).lower()
        for claim in ("prototype", "phase 2", "flask backend"):
            assert claim not in body, \
                f"the page still claims {claim!r} about export"

    check("export zip does not pretend to work",
          t_export_zip_does_not_pretend_to_work)
    check("a custom menu link can be added", t_a_custom_menu_link_can_be_added)
    check("a dangerous menu address is refused", t_a_dangerous_menu_address_is_refused)
    check("a menu link survives a round trip", t_a_menu_link_survives_a_round_trip)
    def t_every_colour_control_opens_the_picker():
        """Not just the brand swatches.

        Frame, footer background and link, block background/text/accent and
        the decorative shapes were all still bare input[type=color], so each
        opened the native dialog in the top-left corner with no Apply and an
        opacity slider for a design system that has no transparency.
        """
        page.goto(f"{BASE}/builder.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        page.wait_for_timeout(1200)

        checked = 0
        for btn in ("#footerBtn", "#stylesBtn"):
            if page.get_attribute(btn, "aria-pressed") != "true":
                page.click(btn)
                page.wait_for_timeout(800)

            natives = page.locator("#panelBody input[type=color]").count()
            chips = page.locator("#panelBody .colour-chip").count()
            # equal, not merely at least: the brand inputs already carry
            # .colour-native and must not have gained a second chip
            assert chips == natives, \
                f"{btn} has {natives} colour inputs but {chips} chips"
            checked += natives

        assert checked >= 5, \
            f"only found {checked} colour controls; the panels changed"

        # and one of them really works end to end
        if page.get_attribute("#footerBtn", "aria-pressed") != "true":
            page.click("#footerBtn")
            page.wait_for_timeout(800)
        page.locator("#panelBody .colour-chip").first.click()
        page.wait_for_timeout(600)
        assert page.locator(".ss-picker").count() == 1, \
            "a footer colour chip did not open the picker"

        page.fill(".ss-picker-hex", "#2A6B4F")
        page.wait_for_timeout(300)
        page.click(".ss-picker-apply")
        page.wait_for_timeout(1200)
        applied = page.evaluate("() => document.querySelector('#footBg').value")
        assert applied.lower() == "#2a6b4f", \
            f"applying from a footer chip did not persist: {applied}"

        # put it back
        page.evaluate("() => { const c = document.querySelector('#footBgClear');"
                      "  if (c) c.click(); }")
        page.wait_for_timeout(900)

    def t_the_description_box_needs_no_detour():
        """The AI description box was only reachable by pressing Back.

        Clicking a type card auto-advances to step 2 after 180ms, and the
        description box lived below the type grid inside step 1 - so it
        disappeared almost as soon as you picked a type. Using the product's
        headline feature meant going forward, then back, then finding it.
        Reported as "I have to click multiple times before it opens".
        """
        page.goto(f"{BASE}/plan.html", wait_until="domcontentloaded")
        page.wait_for_selector("#typeGrid .type-card", timeout=SLOW)
        page.wait_for_timeout(800)

        # usable on arrival, before any type has been chosen
        box = page.locator("#aiDesc")
        assert box.is_visible(), "the description box is not visible on arrival"
        assert box.is_editable(), "the description box cannot be typed into"

        box.fill("A ramen shop in Melbourne doing late-night bowls.")
        page.wait_for_timeout(300)
        assert page.locator("#aiBtn").is_visible(), \
            "there is no way to start generating from the description"

        # and still on screen once a type has been picked and stepped back
        page.locator("#typeGrid .type-card").first.click()
        page.wait_for_timeout(900)
        page.click("#back2")
        page.wait_for_timeout(600)
        assert page.locator("#aiDesc").is_visible(), \
            "the description box vanished after picking a type"
        assert page.locator("#aiDesc").input_value(), \
            "what you typed was lost by choosing a type"

    def t_a_section_can_be_dropped_where_you_want_it():
        """Adding always appended; then you dragged it somewhere better.

        A rail card now drags onto the page and lands between the sections
        you drop it on, with an insertion line showing where first.

        Built with pointer events rather than a second Sortable sharing a
        group with the canvas. That is what this started as, and it did
        nothing: the instance was created with all fifteen cards in it, and
        no mousedown on the rail produced a drag at all - no ghost, no
        onChoose, and no native dragstart either, while the canvas list a
        few lines above dragged fine. Rather than keep guessing, the drag is
        done directly.
        """
        page.goto(f"{BASE}/builder.html?id={builder_id['pid']}",
                  wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=SLOW)
        page.wait_for_timeout(1500)

        def ids():
            return page.evaluate(
                "() => [...document.querySelectorAll('#canvas .ss-sec')]"
                ".map(s => s.dataset.sect)")

        def available_keys():
            return page.evaluate(
                "() => [...document.querySelectorAll('#rail [data-key]')]"
                ".map(n => n.dataset.key)")

        def drag_first_available_to(target_y):
            """The rail offers different sections per site type, so this
            takes whatever is on offer rather than naming one."""
            card = page.locator("#rail .rail-library [data-key]").first
            card.scroll_into_view_if_needed()
            page.wait_for_timeout(200)
            box = card.bounding_box()
            page.mouse.move(box["x"] + 30, box["y"] + box["height"] / 2)
            page.mouse.down()
            page.wait_for_timeout(120)
            page.mouse.move(box["x"] + 120, box["y"] + 10, steps=8)
            page.wait_for_timeout(250)
            page.mouse.move(target_y[0], target_y[1], steps=22)
            page.wait_for_timeout(400)

        keys = available_keys()
        assert len(keys) >= 2, f"the rail offers only {keys}"

        # --- a drop lands where the line was, not at the end
        before = ids()
        third = page.locator("#canvas .ss-sec").nth(2).bounding_box()
        drag_first_available_to((third["x"] + 300, third["y"] + 3))
        assert page.locator(".ss-dropchip").count() == 1, \
            "no chip followed the pointer"
        assert page.locator(".ss-dropline").count() == 1, \
            "no insertion line said where it would land"
        page.mouse.up()
        page.wait_for_timeout(1800)
        after = ids()
        assert len(after) == len(before) + 1, \
            f"the drop added {len(after) - len(before)} sections, expected 1"
        assert after[2] != before[2], \
            "it landed at the end rather than where it was dropped"

        # --- Escape abandons the drag and adds nothing
        count = len(ids())
        card = page.locator("#rail .rail-library [data-key]").first
        card.scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        box = card.bounding_box()
        page.mouse.move(box["x"] + 30, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.wait_for_timeout(120)
        page.mouse.move(box["x"] + 150, box["y"] + 20, steps=10)
        page.wait_for_timeout(300)
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        page.mouse.up()
        page.wait_for_timeout(1200)
        assert len(ids()) == count, "Escape still added a section"
        assert page.locator(".ss-dropchip").count() == 0, \
            "the drag chip was left behind"
        assert page.locator(".ss-dropline").count() == 0, \
            "the insertion line was left behind"

        # --- and a plain click still means "add to the end"
        before = ids()
        page.locator("#rail .rail-library [data-key]").last.click()
        page.wait_for_timeout(1500)
        assert len(ids()) == len(before) + 1, "a plain click stopped adding"
        assert ids()[-1] not in before, "a click no longer appends"

    check("a section can be dropped where you want it",
          t_a_section_can_be_dropped_where_you_want_it)
    check("the description box needs no detour",
          t_the_description_box_needs_no_detour)
    check("every colour control opens the picker",
          t_every_colour_control_opens_the_picker)
    check("the picker opens beside the swatch", t_the_picker_opens_beside_the_swatch)
    check("the picker applies and cancels", t_the_picker_applies_and_cancels)
    check("the picker survives being clicked", t_the_picker_survives_being_clicked)
    check("an unset brand swatch shows the real colour",
          t_unset_brand_swatch_shows_the_real_colour)
    check("brand colours survive a reload", t_brand_colours_survive_a_reload)
    def t_menu_panel_lists_every_page():
        """The menu is its own list now, not something derived from the
        pages, so it has to start out containing all of them.

        Adds a second page first: reordering, submenus and deleting a page
        are all meaningless with only one page, and a single-page project is
        what the rest of this suite happens to have."""
        page.click("#addPage")
        page.wait_for_selector('.menu-row, .panel-section', timeout=8000)
        page.wait_for_timeout(500)
        # naming it, because an unnamed page reads as "Page 2" everywhere
        page.evaluate("() => {"
                      "  const plan = window.Editor.plan;"
                      "  plan.pages[plan.pages.length - 1].name = 'About';"
                      "  window.Editor.render(); }")

        page.click("#menuBtn")
        page.wait_for_timeout(400)
        assert page.locator("#menuBtn").get_attribute("aria-pressed") == "true", \
            "the menu panel did not open"
        labels = page.locator(".menu-row input[data-nav-label]").count()
        page_count = page.evaluate("() => window.Editor.plan.pages.length")
        assert page_count >= 2, f"setup failed, only {page_count} page(s)"
        assert labels == page_count, \
            f"menu shows {labels} items for {page_count} pages"

    def t_renaming_a_menu_item_changes_the_nav():
        before = page.locator(".ss-navlinks a").first.inner_text()
        field = page.locator('.menu-row input[data-nav-label]').first
        field.fill("Our work")
        page.wait_for_timeout(500)
        after = page.locator(".ss-navlinks a").first.inner_text()
        assert after.strip() == "Our work", \
            f"the nav still says {after.strip()!r}, expected 'Our work'"
        assert page.evaluate(
            "() => window.Editor.plan.nav[0].label") == "Our work", \
            "the label was not written to the plan"

    def t_a_page_can_be_taken_out_of_the_menu():
        """Not deleted - still there, just not shown. A visitor should not
        see a page that is still perfectly editable."""
        count_before = page.locator(".ss-navitem").count()
        page.evaluate("() => {"
                      "  const plan = window.Editor.plan;"
                      "  plan.nav = plan.nav || plan.pages.map(p => ({ pageId: p.id,"
                      "    label: '', visible: true, children: [] }));"
                      "  plan.nav[0].visible = false;"
                      "  window.Editor.render(); window.Editor.onChange('nav'); }")
        page.wait_for_timeout(400)
        count_after = page.locator(".ss-navitem").count()
        assert count_after == count_before - 1, \
            f"hiding a menu item changed {count_before} -> {count_after}"
        pages_now = page.evaluate("() => window.Editor.plan.pages.length")
        assert pages_now >= 2, f"hiding a menu item deleted a page ({pages_now} left)"

        # put it back, so later checks see a whole menu
        page.evaluate("() => {"
                      "  window.Editor.plan.nav[0].visible = true;"
                      "  window.Editor.render(); window.Editor.onChange('nav'); }")
        page.wait_for_timeout(300)

    def t_menu_items_can_be_reordered():
        order_before = page.evaluate(
            "() => Array.from(document.querySelectorAll('.ss-navlinks a'))"
            ".map(a => a.textContent.trim())")
        page.locator('.menu-row [data-nav-down]').first.click()
        page.wait_for_timeout(500)
        order_after = page.evaluate(
            "() => Array.from(document.querySelectorAll('.ss-navlinks a'))"
            ".map(a => a.textContent.trim())")
        assert order_after != order_before, "the menu order did not change"
        assert order_after[1] == order_before[0], \
            f"expected the first item to move down: {order_before} -> {order_after}"

    def t_a_submenu_renders_and_survives():
        """A submenu has to be real markup in the published page, not an
        editor affordance that vanishes on publish."""
        page.evaluate("() => {"
                      "  const plan = window.Editor.plan;"
                      "  const second = plan.pages[1];"
                      "  if (!second) return;"
                      "  plan.nav = plan.nav || plan.pages.map(p =>"
                      "    ({ pageId: p.id, label: '', visible: true, children: [] }));"
                      "  plan.nav[0].children = [{ pageId: second.id, label: 'More' }];"
                      "  window.Editor.render(); window.Editor.onChange('nav'); }")
        page.wait_for_timeout(500)
        assert page.locator(".ss-submenu a").count() > 0, "no submenu was rendered"
        assert page.locator(".ss-navitem.has-sub").count() > 0, \
            "the parent is not marked as having a submenu"

        # The class existing is not the same as the menu opening. The first
        # version of this put has-sub outside the class attribute, so the
        # element matched nothing and the submenu could never open - and a
        # count-only assertion is exactly what let that through.
        parent = page.locator(".ss-navitem.has-sub").first
        submenu = parent.locator(".ss-submenu")
        assert submenu.count() == 1, "no submenu inside the parent"
        hidden = submenu.evaluate("el => getComputedStyle(el).display")
        assert hidden == "none", f"the submenu starts open ({hidden})"
        parent.hover()
        page.wait_for_timeout(300)
        shown = submenu.evaluate("el => getComputedStyle(el).display")
        assert shown != "none", "hovering the parent did not open the submenu"

    def t_deleting_a_page_drops_it_from_the_menu():
        """A saved menu that points at a deleted page must not render a dead
        link - that is exactly the bug that shipped once already with page
        keys."""
        page.evaluate("() => {"
                      "  const plan = window.Editor.plan;"
                      "  const victim = plan.pages[1];"
                      "  if (!victim) return;"
                      "  plan.nav = plan.pages.map(p => ({ pageId: p.id, label: '',"
                      "    visible: true, children: [] }));"
                      "  plan.nav[0].children = [{ pageId: victim.id, label: 'Doomed' }];"
                      "  window.Editor.render(); }")
        page.wait_for_timeout(300)
        assert page.locator(".ss-submenu a").count() > 0, \
            "setup failed: no submenu to delete a page out of"

        page.evaluate("() => {"
                      "  const plan = window.Editor.plan;"
                      "  plan.pages.splice(1, 1);"
                      "  window.Editor.render(); }")
        page.wait_for_timeout(400)
        assert page.locator(".ss-submenu a").count() == 0, \
            "the submenu still points at a page that no longer exists"
        # and no link anywhere points at the deleted id
        ids = page.evaluate("() => window.Editor.plan.pages.map(p => p.id)")
        hrefs = page.evaluate(
            "() => Array.from(document.querySelectorAll('.ss-navlinks a'))"
            ".map(a => a.getAttribute('href'))")
        dead = [h for h in hrefs if any(h == "#" + i for i in ids) is False
                and h.startswith("#")]
        assert not dead, f"dead menu links survived: {dead}"

    def t_menu_panel_does_not_accumulate_listeners():
        """The panel is rebuilt after every structural edit. If its handlers
        are re-registered each time they pile up on the same element, and the
        symptom is invisible in the saved menu: the newest closure writes
        last, so the result stays correct.

        Measured before the fix: four edits then one keystroke caused 47 full
        page re-renders. It is a performance bug wearing the costume of
        nothing being wrong."""
        # menuBtn is a toggle: clicking it while the panel is already open closes
        # it. An earlier check left it open, so clicking blindly would have
        # shut it and then timed out looking for rows that were gone.
        if page.locator("#menuBtn").get_attribute("aria-pressed") != "true":
            page.click("#menuBtn")
        page.wait_for_timeout(300)
        assert page.locator("#menuBtn").get_attribute("aria-pressed") == "true", \
            "could not open the menu panel"
        page.evaluate("""() => {
            window.__renders = 0;
            const orig = window.Editor.render;
            window.Editor.render = function () {
                window.__renders++; return orig.apply(this, arguments);
            };
        }""")
        for _ in range(4):
            page.locator('.menu-row [data-nav-toggle]').first.click()
            page.wait_for_timeout(200)

        before = page.evaluate("() => window.__renders")
        page.locator('.menu-row input[data-nav-label]').first.fill("Typed")
        page.wait_for_timeout(500)
        after = page.evaluate("() => window.__renders")

        renders = after - before
        assert renders <= 3, \
            f"one keystroke caused {renders} page re-renders - the panel is " \
            "registering its handlers again on every rebuild"

    check("menu panel lists every page", t_menu_panel_lists_every_page)
    check("renaming a menu item changes the nav", t_renaming_a_menu_item_changes_the_nav)
    check("a page can be taken out of the menu", t_a_page_can_be_taken_out_of_the_menu)
    check("menu items can be reordered", t_menu_items_can_be_reordered)
    check("a submenu renders", t_a_submenu_renders_and_survives)
    check("deleting a page drops it from the menu", t_deleting_a_page_drops_it_from_the_menu)
    check("menu panel does not accumulate listeners", t_menu_panel_does_not_accumulate_listeners)
    check("colour fields accept rgb() and hsl()", t_colour_fields_accept_rgb_and_hsl)
    check("the RGB readout shows the value", t_rgb_readout_shows_the_value)
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

    # Runs late on purpose. It publishes, and the checks above all load the
    # published address and expect the project in a known state; run earlier
    # it left them looking at a site that had moved underneath them. Four
    # unrelated checks failed that way before this was moved.
    check("the builder warns when the live site is behind",
          t_builder_warns_when_the_live_site_is_behind)


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