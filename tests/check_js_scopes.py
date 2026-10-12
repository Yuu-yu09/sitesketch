"""
Static check for the bug that took the builder down.

site.js builds a `ctx` object inside sectionHTML and passes it to each block
renderer. Any helper defined *outside* those blocks has no ctx in scope, and
reaching for one there fails only when the code path is actually taken.

That is what happened: cardsOf() called ctx.crop() and threw
"ctx is not defined" - but only for list sections that had items, so it looked
intermittent and only appeared on the plans the AI happened to fill in. It
emptied the whole page.

This walks the file and flags any function that uses a bare `ctx` without
either taking it as a parameter or declaring it locally. It is a crude parse,
not a JavaScript engine, so it errs towards reporting and the false positives
are worth reading rather than filtering.

Run:
    .\\.venv\\Scripts\\python.exe tests\\check_js_scopes.py
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = sorted((ROOT / "static" / "js").glob("*.js"))

# "ctx" used as a value: ctx.something, ctx(...), ctx[...], ctx as an argument.
USES_CTX = re.compile(r"(?<![\w.$])ctx\s*[\.\[,)]")
FUNC = re.compile(r"^(\s*)function (\w+)\(([^)]*)\)\s*\{", re.M)


def body_of(src: str, open_brace: int) -> str:
    depth = 0
    i = open_brace
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[open_brace + 1:i]
        i += 1
    return src[open_brace:]


def main() -> int:
    problems: list[str] = []
    checked = 0

    for path in FILES:
        src = path.read_text(encoding="utf-8")
        for match in FUNC.finditer(src):
            name, params = match.group(2), match.group(3)
            body = body_of(src, match.end() - 1)
            checked += 1

            if not USES_CTX.search(body):
                continue

            takes = [p.strip() for p in params.split(",") if p.strip()]
            declares = re.search(r"(?:var|let|const)\s+ctx\b", body)
            if "ctx" in takes or declares:
                continue

            line = src[:match.start()].count("\n") + 1
            problems.append(
                f"{path.relative_to(ROOT)}:{line}  {name}({params}) "
                f"uses ctx but neither takes it nor declares it")

    print(f"checked {checked} function(s) across {len(FILES)} file(s)")
    if not problems:
        print("no out-of-scope ctx references")
        return 0

    print(f"\n{len(problems)} problem(s):")
    for p in problems:
        print("  " + p)
    return 1


if __name__ == "__main__":
    sys.exit(main())
