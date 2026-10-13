"""
Catch tests registered before they are defined.

This mistake was made three times in a single session, each one a wasted
cycle:

    UnboundLocalError: cannot access local variable 't_undo_reverses_an_edit...'
    where it is not associated with a value

Python resolves names at call time, so a check() registered above the def()
that creates the function raises when the runner reaches it - after all the
slower checks have already run.

It is a purely static mistake, so it deserves a static check rather than
another round of it. Every name passed to check() must have a def() above it
in the same file.

Parsed with ast rather than a regex: the first version of this file matched
its own docstring, because the example inside it looked exactly like a call.
The syntax tree cannot tell code from documentation.

Run:
    .venv\\Scripts\\python.exe tests\\check_test_registrations.py
"""

from __future__ import annotations

import ast
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = sorted((ROOT / "tests").glob("*.py"))


class Visitor(ast.NodeVisitor):
    """Collects every check("title", function_name) call in a module."""

    def __init__(self) -> None:
        self.calls: list[tuple[int, str, str]] = []

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id == "check":
            if len(node.args) >= 2:
                title_node, fn_node = node.args[0], node.args[1]
                if isinstance(title_node, ast.Constant) and isinstance(fn_node, ast.Name):
                    self.calls.append(
                        (node.lineno, str(title_node.value), fn_node.id))
        self.generic_visit(node)


def main() -> int:
    problems: list[str] = []
    checked = 0
    files_with_checks = 0

    for path in TESTS:
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as exc:
            problems.append(f"{path.relative_to(ROOT)}: syntax error - {exc}")
            continue

        # first definition wins, matching how Python actually rebinds
        defs: dict[str, int] = {}
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                defs.setdefault(node.name, node.lineno)

        visitor = Visitor()
        visitor.visit(tree)
        if not visitor.calls:
            continue
        files_with_checks += 1

        for line_number, title, fn in visitor.calls:
            checked += 1
            relative = path.relative_to(ROOT)
            if fn not in defs:
                problems.append(
                    f"{relative}:{line_number}  check({title!r}) refers to "
                    f"{fn!r}, which is never defined in this file")
            elif defs[fn] > line_number:
                problems.append(
                    f"{relative}:{line_number}  check({title!r}) uses {fn!r} "
                    f"but it is not defined until line {defs[fn]} - move the "
                    "registration below the def")

    print(f"checked {checked} check() call(s) across {files_with_checks} file(s)")
    if not problems:
        print("every check() is defined before it is registered")
        return 0

    print(f"\n{len(problems)} problem(s):")
    for problem in problems:
        print("  " + problem)
    return 1


if __name__ == "__main__":
    sys.exit(main())