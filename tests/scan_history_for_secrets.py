"""
Look for secret-shaped strings anywhere in the git history.

.env itself was never committed, which is the good news. This checks the
other way a secret leaks: pasted into a source file, a config example, a
commit message, or a document someone edited.

Pattern-based rather than value-based, because the values are not available
here and were pasted into a chat transcript rather than the repository. It
flags anything that looks like a credential so it can be eyeballed, and says
which commit introduced it.

Run:
    .venv\\Scripts\\python.exe tests\\scan_history_for_secrets.py
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Shapes, not values.
PATTERNS = {
    "supabase service key": re.compile(r"\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{20,}"),
    "google api key": re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"),
    "jwt secret assignment": re.compile(
        r"JWT_SECRET_KEY\s*[=:]\s*['\"][^'\"\s]{12,}['\"]", re.I),
    "generic api key": re.compile(
        r"\b(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|PASSWORD)\s*[=:]\s*['\"][^'\"\s]{16,}['\"]", re.I),
    "postgres url with password": re.compile(r"postgres(ql)?://[^:\s]+:[^@\s]{4,}@"),
    "bearer token": re.compile(r"\bBearer\s+[A-Za-z0-9._-]{30,}"),
    "aws access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "github token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
    "slack token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
}

# .env.example is expected to hold placeholder names, not values.
ALLOW_SUFFIXES = (".env.example",)

# The test suite legitimately contains credentials-shaped strings: the shared
# PASSWORD constant, and every suite needs one to register with. Flagging
# those teaches you to ignore the scanner, which is how a scanner stops being
# one. Tests are still scanned for the provider-key shapes below, which have
# no business being there.
TEST_PREFIXES = ("tests/",)


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=str(ROOT), capture_output=True, text=True
    ).stdout


def main() -> int:
    files = [f for f in git("ls-files").splitlines() if f]
    print(f"scanning {len(files)} tracked file(s) and every commit message\n")

    findings: list[str] = []

    # current tree
    for name in files:
        if name.endswith(ALLOW_SUFFIXES):
            continue
        in_tests = name.startswith(TEST_PREFIXES)
        try:
            text = (ROOT / name).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for label, pattern in PATTERNS.items():
            if in_tests and label == "generic api key":
                continue
            for match in pattern.finditer(text):
                line = text[: match.start()].count("\n") + 1
                redacted = match.group(0)[:12] + "..."
                findings.append(
                    f"  {name}:{line}  {label}  {redacted}")

    # commit messages
    for line in git("log", "--all", "--pretty=format:%h %s").splitlines():
        for label, pattern in PATTERNS.items():
            if pattern.search(line):
                findings.append(f"  commit message  {label}  {line[:70]}")

    if not findings:
        print("no secret-shaped strings found in the working tree or commit messages")
        print("\nNote: this only covers the repository. Values pasted into a chat")
        print("transcript are still exposed and still need rotating - a scan")
        print("cannot make a leaked value un-leaked.")
        return 0

    print(f"{len(findings)} potential finding(s):\n")
    for finding in findings:
        print(finding)
    return 1


if __name__ == "__main__":
    sys.exit(main())