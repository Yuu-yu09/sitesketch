"""Screenshot the builder's Design panel.

The MCP browser screenshot needs a visible desktop window and there is none
in this environment. Playwright runs headless and captures the same pixels
fine, so this is the way to actually see the work.

Writes PNGs to a scratch folder and prints the paths.

Run:
    .venv\\Scripts\\python.exe tests\\capture_design_panel.py
"""

from __future__ import annotations

import pathlib
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
PID = sys.argv[1] if len(sys.argv) > 1 else "9b227c67-48b3-42ab-920f-020e8d732194"
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path(
    r"C:\Users\Pochi\AppData\Local\Temp\opencode\shots")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 950},
                                  device_scale_factor=2)
        page = ctx.new_page()

        page.goto(f"{BASE}/login.html", wait_until="domcontentloaded")
        page.fill("#email", "demo_50a79c@example.com")
        page.fill("#password", "karewa-testing-1")
        page.click("#submitBtn")
        page.wait_for_timeout(2500)

        page.goto(f"{BASE}/builder.html?id={PID}", wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=30000)
        page.wait_for_timeout(1500)

        # dismiss the first-run hint bar so it does not cover the page
        hint = page.locator(".hint-dismiss")
        if hint.count():
            hint.click()
            page.wait_for_timeout(300)

        shots = []

        # 1. the Design panel, as it opens
        page.click("#stylesBtn")
        page.wait_for_timeout(600)
        shots.append(("01-design-panel.png", page))

        # 2. the Menu panel added this session
        page.click("#menuBtn")
        page.wait_for_timeout(600)
        shots.append(("02-menu-panel.png", page))

        # 3. the same page with a brand colour and a larger type scale, to
        #    show the controls actually changing the page
        page.click("#stylesBtn")
        page.wait_for_timeout(400)
        page.evaluate("""() => {
            const s = window.Editor.spec();
            s.tokens.colour = { accent: '#B04A26', bg: '#FFFDF9', text: '#2A1E16' };
            s.tokens.type = { scale: 1.18, lh: 1.15, ls: 0.02 };
            window.Editor.render();
            window.Editor.onChange('capture');
        }""")
        page.wait_for_timeout(1200)
        shots.append(("03-brand-and-type-applied.png", page))

        # 4. the RGB readout beside a colour typed in as rgb()
        page.evaluate("""() => {
            const s = window.Editor.spec();
            s.tokens.colour = { accent: '#B04A26', bg: '#FFFDF9', text: '#2A1E16' };
            s.tokens.type = { scale: 1.1, lh: 1.1, ls: 0 };
            window.Editor.render();
        }""")
        page.wait_for_timeout(500)
        # No stylesBtn click: the panel is already open from step 3, and that
        # button is a toggle, so clicking it here closes it and the colour
        # field stops being visible.
        page.fill('#colour_accent_hex', 'rgb(176, 74, 38)')
        page.dispatch_event('#colour_accent_hex', 'change')
        page.wait_for_timeout(700)
        panel = page.locator('#stylesPanel')
        shots.append(('04-rgb-readout.png', panel))

        # 4. the published site at phone width
        page.evaluate("() => { const s = window.Editor.spec();"
                      " delete s.tokens.colour; delete s.tokens.type;"
                      " window.Editor.render(); window.Editor.onChange('capture'); }")
        page.wait_for_timeout(800)

        for name, p in shots:
            path = OUT / name
            p.screenshot(path=str(path))
            print(str(path))

        ctx.close()
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())