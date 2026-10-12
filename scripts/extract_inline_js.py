"""Move inline <script> blocks out of the HTML pages.

The Content-Security-Policy we ship is `script-src 'self'`, which allows no
inline script at all. Every page used to carry a page-specific script inline,
so the browser refused to run it and the app came up blank.

Rather than weaken the policy with 'unsafe-inline' - which would give an
injected <script> tag the same rights as our own code - the page scripts move
into static/js/pages/. Classic scripts run in document order, so putting the
file where the inline block was keeps load order identical.

Run once from the project root; it rewrites the .html files in place.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "static" / "js" / "pages"

# <script> with no attributes at all. Anything with src= is already external.
INLINE = re.compile(r"^[ \t]*<script>(.*?)^[ \t]*</script>[ \t]*$",
                    re.DOTALL | re.MULTILINE)


def page_name(html: pathlib.Path) -> str:
    return html.stem


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    moved = []

    for html in sorted(ROOT.glob("*.html")):
        source = html.read_text(encoding="utf-8")
        blocks = [m.group(1).strip("\n") for m in INLINE.finditer(source)]
        if not blocks:
            continue

        stem = page_name(html)
        target = OUT_DIR / f"{stem}.js"
        if target.exists():
            print(f"  skip {html.name}: {target.name} already exists")
            continue

        # One file per page, in document order, separated by a banner so the
        # split point stays readable later.
        parts = []
        for i, block in enumerate(blocks, start=1):
            if len(blocks) > 1:
                parts.append(f"/* ---- inline block {i} of {len(blocks)} ---- */")
            parts.append(block.rstrip())
        target.write_text("\n\n".join(parts) + "\n", encoding="utf-8")

        counter = iter(range(1, 10_000))

        def replace(_match):
            n = next(counter)
            src = f"static/js/pages/{stem}.js"
            if n > 1:
                src = f"static/js/pages/{stem}.{n}.js"
            return f'<script src="{src}"></script>'

        rewritten = INLINE.sub(replace, source)
        html.write_text(rewritten, encoding="utf-8")
        moved.append((html.name, target.name, len(blocks)))

    if not moved:
        print("no inline scripts found")
        return 0

    for name, out, count in moved:
        print(f"  {name}: {count} inline block(s) -> static/js/pages/{out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
