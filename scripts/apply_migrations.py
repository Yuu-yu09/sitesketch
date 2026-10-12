"""Apply supabase/migrate_published.sql.

The project talks to Postgres directly rather than through a migration tool,
so this runs the same idempotent SQL the schema uses. Safe to run repeatedly:
every statement in the migration is `if not exists`.

    .\\.venv\\Scripts\\python.exe scripts\\apply_migrations.py
"""

from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import db  # noqa: E402


def apply(path: pathlib.Path) -> None:
    sql = path.read_text(encoding="utf-8")
    # Split on `;` first, then strip comment lines from each chunk. Filtering
    # comment-led chunks out beforehand silently drops the statement that
    # happens to follow a comment, which is most of them.
    statements = [s for s in sql.split(";") if s.strip()]
    print(f"{path.name}: {len(statements)} statement(s)")
    done = 0
    for statement in statements:
        cleaned = "\n".join(
            line for line in statement.splitlines()
            if not line.strip().startswith("--")
        ).strip()
        if not cleaned:
            continue
        db.query(cleaned)
        done += 1
        print(f"  ok  {cleaned.splitlines()[0][:66]}")
    print(f"  applied {done}")


def main() -> int:
    folder = ROOT / "supabase"
    targets = sorted(p for p in folder.glob("migrate_*.sql"))
    if not targets:
        print("no migrations found")
        return 0
    for path in targets:
        apply(path)
    print("\nall migrations applied")
    return 0


if __name__ == "__main__":
    sys.exit(main())
