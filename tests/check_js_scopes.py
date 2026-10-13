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

# "ctx" as a standalone identifier: ctx.something, ctx(...), ctx[...], ctx as an
# argument, and just "= ctx".
#
# The trailing lookahead matters more than it looks. An earlier version
# required a . [ , or ) after the name, so `fakeCtx = ctx;` passed clean -
# the simplest possible way to reach an out-of-scope ctx, in the very file
# this gate exists to guard. Not followed by a word character, so fakeCtx
# and ctxMap do not match; not preceded by one, or a dot, so this.ctx does
# not either.
USES_CTX = re.compile(r"(?<![\w.$])ctx(?![\w$])")
FUNC = re.compile(r"^(\s*)function (\w+)\(([^)]*)\)\s*\{", re.M)

BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
LINE_COMMENT = re.compile(r"//[^\n]*")


def strip_comments(src: str) -> str:
    """Remove comments before looking for identifiers, keeping line numbers.

    A prose sentence explaining that a function deliberately does *not* take
    a ctx is not a use of one, and matching it means a comment can raise a
    false alarm and, by habituation, train people to ignore the gate. This
    was not theoretical: the note added to cardsOf while fixing exactly this
    bug tripped the check that guards it.

    Each comment is replaced by as many newlines as it contained, so a line
    number reported against the cleaned source still points at the right
    line of the file. Only text is removed, so this cannot hide a real
    reference - a use has to be outside a comment to be code at all.
    """
    def blank(match: re.Match) -> str:
        return "\n" * match.group(0).count("\n")

    return LINE_COMMENT.sub(blank, BLOCK_COMMENT.sub(blank, src))


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
        raw = path.read_text(encoding="utf-8")
        src = strip_comments(raw)
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

            line = raw[:match.start()].count("\n") + 1
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
