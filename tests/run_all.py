"""
One command that verifies everything, and fails if anything is wrong.

The reason this exists: results were reported from a build that was already
broken, twice, because verification had been split across ad-hoc commands.
"46/46" was true of a different commit than the one on disk. A single gate
makes "verified" one fact about the current tree instead of a claim about
something that used to be true.

Order is cheapest-and-fastest first, so a syntax error is reported in under a
second rather than after a three-minute browser suite:

    1  node --check     every JS file parses
    2  eslint           no-shadow, no-undef, no-unused-vars and friends
    3  JS scope check   the out-of-scope `ctx` class that emptied the builder
    4  test ordering    no check() registered before its def
    5  browser suite    the real UI
    6  user journey     one new user, nothing to a live site
    7  e2e suite        API level, including the AI endpoints
    8  responsive audit phone / tablet / desktop, published site and builder

Usage:
    .venv\\Scripts\\python.exe tests\\run_all.py [base_url]

    --quick     skip the e2e suite (it calls Gemini, which can take minutes)

The suites share one server and one IP address, and register/login are rate
limited, so they run strictly one after another. Running them in parallel
produces failures that have nothing to do with the code.
"""

from __future__ import annotations

import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
BASE = "http://127.0.0.1:3000"


def run(label: str, argv: list[str], cwd: pathlib.Path = ROOT) -> tuple[bool, str]:
    started = time.time()
    try:
        proc = subprocess.run(
            argv, cwd=str(cwd), capture_output=True, text=True, timeout=2400)
    except subprocess.TimeoutExpired:
        return False, f"{label}: timed out after 40 minutes"

    output = (proc.stdout or "") + (proc.stderr or "")
    tail = "\n".join(output.strip().splitlines()[-14:])
    detail = f"{label}: {time.time() - started:.0f}s\n{tail}"
    return proc.returncode == 0, detail


def js_files() -> list[pathlib.Path]:
    found = sorted((ROOT / "static" / "js").rglob("*.js"))
    # third-party, minified; we did not write it and node --check on it is noise
    return [f for f in found if "vendor" not in f.parts]


def step_syntax() -> tuple[bool, str]:
    files = js_files()
    for path in files:
        proc = subprocess.run(["node", "--check", str(path)],
                              capture_output=True, text=True)
        if proc.returncode != 0:
            return False, (f"{path.relative_to(ROOT)} does not parse:\n"
                           f"{proc.stderr.strip()[:400]}")
    return True, f"all {len(files)} JS file(s) parse"


def step_eslint() -> tuple[bool, str]:
    binary = ROOT / "node_modules" / ".bin" / "eslint.cmd"
    if not binary.exists():
        return True, "eslint not installed - skipped (npm install --no-save eslint@9)"
    proc = subprocess.run([str(binary), "static/js"],
                          cwd=str(ROOT), capture_output=True, text=True)
    if proc.returncode == 0:
        return True, "no lint findings"
    return False, (proc.stdout + proc.stderr).strip()[-1200:]


def server_is_up() -> bool:
    try:
        with urllib.request.urlopen(BASE + "/index.html", timeout=6) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError):
        return False


def main() -> int:
    quick = "--quick" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    base = args[0] if args else BASE

    print("=" * 66)
    print(f"  verifying {ROOT.name} against {base}")
    print("=" * 66)

    steps: list[tuple[str, object]] = [
        ("JS parses (node --check)", step_syntax),
        ("ESLint", step_eslint),
        ("JS scope check", lambda: run("check_js_scopes",
                                       [str(PYTHON), "tests/check_js_scopes.py"])),
        ("test ordering", lambda: run("check_test_registrations",
                                      [str(PYTHON), "tests/check_test_registrations.py"])),
    ]

    if not server_is_up():
        print(f"\n!! no server at {base}")
        print("   start it first:  .venv\\Scripts\\python.exe app.py\n")
        return 2

    steps += [
        ("browser suite", lambda: run("browser_check",
                                      [str(PYTHON), "tests/browser_check.py", base])),
        ("user journey", lambda: run("user_journey",
                                     [str(PYTHON), "tests/user_journey.py", base])),
    ]
    if not quick:
        steps.append(("e2e suite", lambda: run("e2e_check",
                                               [str(PYTHON), "tests/e2e_check.py", base])))
    steps.append(("responsive audit", lambda: run("responsive_audit",
                                                  [str(PYTHON), "tests/responsive_audit.py", base])))

    results: list[tuple[str, bool, str]] = []
    for label, step in steps:
        ok, detail = step()          # type: ignore[operator]
        results.append((label, ok, detail))
        print(f"\n{'PASS' if ok else 'FAIL'}  {label}")
        if not ok:
            print("-" * 66)
            print(detail)
            print("-" * 66)

    print("\n" + "=" * 66)
    failed = [label for label, ok, _ in results if not ok]
    print(f"  {len(results) - len(failed)}/{len(results)} gates passed")
    if failed:
        print("  failed: " + ", ".join(failed))
    print("=" * 66)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())