"""Thin Postgres access layer (psycopg 3). One connection per call - this is a
class project, not a hot path. Every helper commits on success."""

from __future__ import annotations

import contextlib
import socket
import time
from typing import Any, Sequence
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg.rows import dict_row

import config

# Every query is bounded. Without this a stalled connection parks the request
# indefinitely: the network to Supabase has been observed stalling for 45s at a
# time, which turned one slow query into a cascade of hung ones.
CONNECT_TIMEOUT = 10
STATEMENT_TIMEOUT_MS = 10_000

# The Supabase pooler host resolves to NAT64 IPv6 addresses first. On a normal
# network those answer instantly, but where IPv6 is unusable each attempt
# burns its full timeout before libpq falls back to IPv4 - which is where the
# consistent ~30s per query came from. Pin the host to an IPv4 literal and the
# stall disappears. Cached briefly so we are not resolving on every call.
_IPV4_CACHE: dict[str, tuple[float, str]] = {}
_IPV4_TTL = 600


def _ipv4_host(url: str) -> str:
    """Return the host as an IPv4 literal when one is available."""
    parts = urlsplit(url)
    host = parts.hostname
    if not host:
        return url
    # already a literal?
    try:
        socket.inet_aton(host)
        return url
    except OSError:
        pass

    cached = _IPV4_CACHE.get(host)
    if cached and time.time() - cached[0] < _IPV4_TTL:
        ip = cached[1]
    else:
        try:
            infos = socket.getaddrinfo(host, parts.port or 5432, family=socket.AF_INET)
            ip = infos[0][4][0]
            _IPV4_CACHE[host] = (time.time(), ip)
        except OSError:
            return url  # let libpq try whatever it likes

    netloc = f"{ip}"
    if parts.username:
        netloc = f"{parts.username}:{parts.password or ''}@{ip}"
    if parts.port:
        netloc += f":{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


class DatabaseUnavailable(RuntimeError):
    """Raised when DATABASE_URL is unset or the database cannot be reached."""


@contextlib.contextmanager
def connection():
    if not config.DATABASE_URL:
        raise DatabaseUnavailable("DATABASE_URL is not set")
    try:
        with psycopg.connect(
            _ipv4_host(config.DATABASE_URL),
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