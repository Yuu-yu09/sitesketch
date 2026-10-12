"""Make a user-authored HTML document safe to serve from our own origin.

A published site is HTML that somebody typed. Serving it back from our domain
means a mistake in their content is a stored XSS against every visitor, so the
document is cleaned here before it is ever stored, and the route that serves
it answers with `script-src 'none'` as the backstop.

This is a blunt instrument on purpose. The renderer escapes everything it
outputs, so in normal use there is nothing here to remove and the document
comes through byte-for-byte. The stripping is the second line of defence for
the cases the renderer cannot know about: a pasted snippet, a hand-edited
plan_json row, or a future block type that interpolates something new.

What it removes:
  - <script>, <iframe>, <object>, <embed>, <applet>, <frame> elements
  - inline event handlers (onclick= and friends)
  - javascript: and data: URLs in href/src/action/formaction
  - <meta http-equiv="refresh"> (silent redirect off-site)
  - <base href> (re-points every relative link on the page)
  - <link rel=stylesheet> and <link rel=import> (arbitrary remote CSS)

What it deliberately leaves alone: inline <style> and style="" attributes, so
the generated design still works. Style cannot execute script in any browser
we support, and the CSP route allows it explicitly.
"""

from __future__ import annotations

import re

# Elements that can run code or frame foreign documents. Removed with their
# content, because `<script>alert(1)</script>` must not leave the text behind.
DROP_WITH_CONTENT = (
    "script", "iframe", "object", "embed", "applet",
    "frame", "frameset", "noscript",
)

_DROP_RE = re.compile(
    r"<\s*(%s)\b[^>]*>.*?<\s*/\s*\1\s*>" % "|".join(DROP_WITH_CONTENT),
    re.IGNORECASE | re.DOTALL,
)
# An unclosed or self-closed form of the same tags, e.g. <script src=x>.
_DROP_SELF_RE = re.compile(
    r"<\s*/?\s*(%s)\b[^>]*/?>" % "|".join(DROP_WITH_CONTENT),
    re.IGNORECASE | re.DOTALL,
)

# Inline event handlers: onclick=, onerror=, onload=, onmouseover= ...
_EVENT_ATTR_RE = re.compile(r"\son[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.IGNORECASE)

# javascript: and data: in any attribute that can carry a URL. data: is
# allowed nowhere here because the images that legitimately need it are
# already resolved to real URLs by the time they reach the document.
_URL_ATTR_RE = re.compile(
    r"(\b(?:href|src|action|formaction|xlink:href|poster|data)\s*=\s*)"
    r"(\"|')\s*(?:javascript|vbscript|data)\s*:[^\"']*\2",
    re.IGNORECASE,
)

_META_REFRESH_RE = re.compile(r"<\s*meta\b[^>]*http-equiv\s*=\s*[\"']?refresh[\"']?[^>]*>", re.IGNORECASE)
_BASE_RE = re.compile(r"<\s*base\b[^>]*>", re.IGNORECASE)
# Only stylesheet/import links. <link rel=preload> for fonts is fine.
_LINK_RE = re.compile(r"<\s*link\b[^>]*>", re.IGNORECASE)
_IMPORT_RE = re.compile(r"@import\b[^;]*;", re.IGNORECASE)

_DOCTYPE_RE = re.compile(r"^\s*<!doctype[^>]*>", re.IGNORECASE)


def sanitise(html: str) -> str:
    """Strip anything executable from a compiled document.

    Returns the document unchanged apart from the removals. Callers still
    serve the result under a `script-src 'none'` CSP; this reduces what an
    attacker can store, the CSP decides what can run.
    """
    if not html:
        return ""

    out = _DROP_RE.sub("", html)
    out = _DROP_SELF_RE.sub("", out)
    out = _EVENT_ATTR_RE.sub("", out)
    out = _URL_ATTR_RE.sub(r'\1""', out)
    out = _META_REFRESH_RE.sub("", out)
    out = _BASE_RE.sub("", out)

    def keep_link(match: re.Match) -> str:
        tag = match.group(0)
        rel = re.search(r"\brel\s*=\s*[\"']?([^\"'\s>]+)", tag, re.IGNORECASE)
        if rel and rel.group(1).strip().lower() in {"stylesheet", "import", "preload", "prefetch"}:
            return ""
        return tag

    out = _LINK_RE.sub(keep_link, out)
    out = _IMPORT_RE.sub("", out)

    # A document that lost its doctype still renders, but in quirks mode the
    # generated layout stops matching the preview, so put it back if needed.
    if _DOCTYPE_RE.match(out):
        out = _DOCTYPE_RE.sub("", out, count=1)
    return "<!doctype html>\n" + out.lstrip()


def audit(html: str) -> list[str]:
    """Names of anything executable still present. Used by the test suite."""
    found = []
    for label, pattern in (
        ("script element", _DROP_SELF_RE),
        ("event handler", _EVENT_ATTR_RE),
        ("javascript: url", _URL_ATTR_RE),
        ("meta refresh", _META_REFRESH_RE),
        ("base element", _BASE_RE),
        ("css import", _IMPORT_RE),
    ):
        if pattern.search(html or ""):
            found.append(label)
    return found
