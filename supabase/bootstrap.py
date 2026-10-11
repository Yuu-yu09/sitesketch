"""
SiteSketch - database bootstrap.

Applies supabase/schema.sql then supabase/seed.sql to $DATABASE_URL
and reports what landed. Idempotent: safe to re-run.

    .venv\\Scripts\\python.exe supabase\\bootstrap.py

Reads .env from the repo root (never commits it).
"""

import os
import pathlib
import sys

import psycopg

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load_env(path: pathlib.Path) -> None:
    """Minimal .env loader so this runs without extra deps."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def apply(conn, path: pathlib.Path) -> None:
    sql = path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    print(f"applied {path.name}")


def main() -> int:
    load_env(ROOT / ".env")

    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        print("DATABASE_URL is missing from .env", file=sys.stderr)
        return 1
    if not os.environ.get("SUPABASE_KEY", "").strip():
        print("note: SUPABASE_KEY (sb_secret_*) is still empty - publishing needs it")

    try:
        with psycopg.connect(dsn, autocommit=True, connect_timeout=15) as conn:
            apply(conn, ROOT / "supabase" / "schema.sql")
            apply(conn, ROOT / "supabase" / "seed.sql")

            with conn.cursor() as cur:
                cur.execute(
                    "select table_name from information_schema.tables "
                    "where table_schema = 'public' order by table_name"
                )
                tables = [row[0] for row in cur.fetchall()]

                counts = {}
                for table in ("website_types", "goals", "section_templates", "projects", "users"):
                    if table in tables:
                        cur.execute(f"select count(*) from {table}")
                        counts[table] = cur.fetchone()[0]

                cur.execute("select id from storage.buckets where id = 'sites'")
                bucket = cur.fetchone() is not None
    except psycopg.OperationalError as exc:
        print(f"cannot reach the database: {exc}", file=sys.stderr)
        print("if you rotated the password, update DATABASE_URL in .env", file=sys.stderr)
        return 1

    print("tables:  " + ", ".join(tables))
    print("rows:   " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    print(f"bucket: sites {'present' if bucket else 'MISSING'}")
    print("database is ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())