"""Thin Postgres access layer (psycopg 3). One connection per call - this is a
class project, not a hot path. Every helper commits on success."""

from __future__ import annotations

import contextlib
from typing import Any, Sequence

import psycopg
from psycopg.rows import dict_row

import config

# Every query is bounded. Without this a stalled connection parks the request
# indefinitely: the network to Supabase has been observed stalling for 45s at a
# time, which turned one slow query into a cascade of hung ones.
CONNECT_TIMEOUT = 10
STATEMENT_TIMEOUT_MS = 10_000


class DatabaseUnavailable(RuntimeError):
    """Raised when DATABASE_URL is unset or the database cannot be reached."""


@contextlib.contextmanager
def connection():
    if not config.DATABASE_URL:
        raise DatabaseUnavailable("DATABASE_URL is not set")
    try:
        with psycopg.connect(
            config.DATABASE_URL,
            connect_timeout=CONNECT_TIMEOUT,
            options=f"-c statement_timeout={STATEMENT_TIMEOUT_MS}",
            row_factory=dict_row,
        ) as conn:
            yield conn
    except psycopg.OperationalError as exc:  # unreachable / bad credentials
        raise DatabaseUnavailable(str(exc)) from exc


def query(sql: str, params: Sequence[Any] | None = None) -> list[dict]:
    """Run a read. Returns [] for statements that produce no rows."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params or ())
        if cur.description is None:      # INSERT/UPDATE/DELETE
            return []
        return list(cur.fetchall())


def query_one(sql: str, params: Sequence[Any] | None = None) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Sequence[Any] | None = None) -> int:
    """Run a write statement. Returns the affected row count."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params or ())
        return cur.rowcount