"""Inspect the Design panel, including the brand colour controls.

The browser MCP evaluate tool does not appear to execute against the page -
its side effects (localStorage, document.title) never landed. Playwright
does, and it is what every suite here already uses, so this is the honest
tool for the job rather than fighting one.

Run:
    .venv\\Scripts\\python.exe tests\\inspect_design_panel.py
"""

from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
PID = sys.argv[1] if len(sys.argv) > 1 else "9b227c67-48b3-42ab-920f-020e8d732194"

PROBE = """
() => {
  const panel = document.getElementById('stylesPanel');
  const q = (s) => panel ? panel.querySelectorAll(s).length : -1;
  const one = (s) => panel ? panel.querySelector(s) : null;
  return {
    panelPresent: !!panel,
    panelSections: Array.from(panel ? panel.querySelectorAll('.panel-section h3') : [])
      .map(h => h.textContent.trim()),
    paletteName: one('#paletteName') ? one('#paletteName').textContent : null,
    swatches: q('.swatch'),
    brandFieldset: q('.brand-colours'),
    brandRows: q('.brand-row'),
    colorInputs: q('input[type="color"]'),
    hexFields: q('.hex-field'),
    hexIds: Array.from(panel ? panel.querySelectorAll('.hex-field') : [])
      .map(e => e.id + '=' + JSON.stringify(e.value)),
    rangeIds: Array.from(panel ? panel.querySelectorAll('input[type="range"]') : [])
      .map(e => e.id + '=' + e.value),
    selects: Array.from(panel ? panel.querySelectorAll('select') : [])
      .map(e => e.id + '=' + e.options[e.selectedIndex].text),
    buttons: Array.from(panel ? panel.querySelectorAll('button') : [])
      .map(b => (b.id || '') + ':' + b.textContent.trim().slice(0, 22)),
    // the sliders must actually reach the rendered page
    cssVars: (() => {
      const site = document.querySelector('.ss-site');
      const cs = site ? getComputedStyle(site) : null;
      return cs ? {
        typeScale: cs.getPropertyValue('--type-scale').trim(),
        lh: cs.getPropertyValue('--lh').trim(),
        ls: cs.getPropertyValue('--ls').trim(),
        accent: cs.getPropertyValue('--accent').trim(),
        fontBody: cs.getPropertyValue('--font-body').trim().slice(0, 28)
      } : null;
    })(),
    heroText: (document.querySelector('.ss-sec h1') || {}).textContent
  };
}
"""


def main() -> int:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 950})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e).splitlines()[0][:120]))

        page.goto(f"{BASE}/login.html", wait_until="domcontentloaded")
        page.fill("#email", "demo_50a79c@example.com")
        page.fill("#password", "karewa-testing-1")
        page.click("#submitBtn")
        page.wait_for_timeout(2500)

        page.goto(f"{BASE}/builder.html?id={PID}", wait_until="domcontentloaded")
        page.wait_for_selector(".ss-sec", timeout=30000)
        page.wait_for_timeout(1200)

        page.click("#stylesBtn")
        page.wait_for_timeout(600)

        result = page.evaluate(PROBE)
        print(json.dumps(result, indent=2))
        if errors:
            print("\nJS errors:")
            for e in errors[:5]:
                print("  " + e)
        ctx.close()
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())