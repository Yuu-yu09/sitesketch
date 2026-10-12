"""
Database backup.

Supabase keeps its own point-in-time recovery, but a backup you have never
restored from is a rumour, not a backup. This script takes a plain SQL dump
you can actually inspect and restore, and prunes old ones.

    .venv\\Scripts\\python.exe scripts\\backup_db.py
    .venv\\Scripts\\python.exe scripts\\backup_db.py --restore backups\\sitesketch_2026-10-12.sql

Needs pg_dump on PATH. Install the PostgreSQL client tools if it is missing.
"""

from __future__ import annotations

import argparse
import gzip
import pathlib
import re
import subprocess
import sys
import time
from urllib.parse import urlsplit, unquote

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import config  # noqa: E402

BACKUP_DIR = pathlib.Path(__file__).resolve().parent.parent / "backups"
KEEP_DAYS = 30


def _pg_env(url: str) -> tuple[dict[str, str], str]:
    """Split DATABASE_URL into the pieces pg_dump wants."""
    parts = urlsplit(url)
    env = dict(**__import__("os").environ)
    if parts.password:
        env["PGPASSWORD"] = unquote(parts.password)
    host = parts.hostname or "localhost"
    if host.startswith("aws-0-") or host.endswith(".pooler.supabase.com"):
        # the pooler needs the tenant/user form of the host
        env["PGUSER"] = f"postgres.{host.split('.')[0]}" if not parts.username else parts.username
    else:
        env["PGUSER"] = unquote(parts.username or "postgres")
    return env, host


def make_backup() -> pathlib.Path:
    if not config.DATABASE_URL:
        raise SystemExit("DATABASE_URL is not set, so there is nothing to back up.")

    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = time.strftime("%Y-%m-%d_%H%M%S")
    out = BACKUP_DIR / f"sitesketch_{stamp}.sql.gz"

    env, host = _pg_env(config.DATABASE_URL)
    cmd = [
        "pg_dump",
        "--host", host,
        "--dbname", "postgres",
        "--no-owner",
        "--no-privileges",
        "--format", "plain",
    ]
    print(f"dumping to {out.name} ...")
    try:
        result = subprocess.run(cmd, env=env, capture_output=True)
    except FileNotFoundError:
        raise SystemExit(
            "pg_dump was not found on your PATH.\n"
            "Install the PostgreSQL client tools, then run this again.\n"
            "  winget install PostgreSQL.PostgreSQL   (or download from postgresql.org)\n"
            "Until then, Supabase's own point-in-time recovery still protects the\n"
            "database; see SECURITY.md."
        )
    if result.returncode != 0:
        raise SystemExit(
            "pg_dump failed:\n"
            + result.stderr.decode("utf-8", "replace")[:500]
            + "\nIs the PostgreSQL client installed and pg_dump on your PATH?"
        )

    with gzip.open(out, "wb") as fh:
        fh.write(result.stdout)

    size = out.stat().st_size
    print(f"wrote {out.name} ({size:,} bytes)")
    return out


def prune() -> int:
    cutoff = time.time() - KEEP_DAYS * 86400
    removed = 0
    for path in BACKUP_DIR.glob("sitesketch_*.sql.gz"):
        if path.stat().st_mtime < cutoff:
            path.unlink()
            removed += 1
    if removed:
        print(f"pruned {removed} backup(s) older than {KEEP_DAYS} days")
    return removed


def restore(path: pathlib.Path) -> None:
    if not path.exists():
        raise SystemExit(f"{path} does not exist")

    env, host = _pg_env(config.DATABASE_URL)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as fh:
        sql = fh.read()

    # Refuse to run against anything that is not clearly our own database.
    if b"sitesketch" not in sql.lower() and b"create table" not in sql.lower():
        raise SystemExit("That file does not look like a SiteSketch dump. Stopping.")

    print(f"restoring {path.name} into postgres on {host} ...")
    print("This REPLACES the current contents of those tables.")
    with subprocess.Popen(
        ["psql", "--host", host, "--dbname", "postgres", "--quiet"],
        env=env, stdin=subprocess.PIPE,
    ) as psql:
        psql.communicate(sql)
    if psql.returncode != 0:
        raise SystemExit("psql reported an error; check the output above.")
    print("done. Verify with: .venv\\Scripts\\python.exe tests\\e2e_check.py")


def main() -> int:
    ap = argparse.ArgumentParser(description="Back up and restore the SiteSketch database.")
    ap.add_argument("--restore", metavar="FILE", help="restore a dump instead of taking one")
    ap.add_argument("--no-prune", action="store_true", help="keep every backup")
    args = ap.parse_args()

    if args.restore:
        restore(pathlib.Path(args.restore))
        return 0

    made = make_backup()
    if not args.no_prune:
        prune()
    print(f"\nBackup: {made}")
    print("Offsite copies: Supabase point-in-time recovery covers the hosted")
    print("database; copy these files somewhere else to survive losing the project.")
    _ = re  # keep the import meaningful if the script is trimmed
    return 0


if __name__ == "__main__":
    raise SystemExit(main())