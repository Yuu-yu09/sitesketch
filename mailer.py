"""Outbound email.

One provider, one function. Resend was the service chosen for this project;
the call is plain `requests` rather than an SDK, so there is no package to
keep in step with an API change.

Two behaviours are worth knowing before reading the reset code:

* With no RESEND_API_KEY set, nothing is sent. The reset endpoint still
  answers exactly as it would otherwise - it must not reveal which addresses
  have accounts - so a missing key is reported by /api/health
  (`email_configured`) and logged as an error instead of being swallowed.

* Outside production every message is *also* appended to
  instance/mail_outbox.jsonl. That is what lets the reset flow be tested end
  to end with no mail account: the suite reads the token from the same file
  the server would have sent, instead of inventing a back door into the API.
  In production no copy is written, because the inbox is the only place a
  reset link should exist.
"""

from __future__ import annotations

import json
import logging
import pathlib

import requests

import config

log = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"
# Resend's own test sender. It only delivers to the address that owns the
# Resend account, so a real deployment sets MAIL_FROM to an address on a
# domain verified in Resend; see .env.example.
DEFAULT_FROM = "SiteSketch <onboarding@resend.dev>"

ROOT = pathlib.Path(__file__).resolve().parent


def outbox_path() -> pathlib.Path:
    return ROOT / "instance" / "mail_outbox.jsonl"


def configured() -> bool:
    return bool(config.RESEND_API_KEY)


def can_deliver() -> bool:
    """Would a message sent right now reach somebody?

    In production that means a configured key. In development the outbox is a
    real delivery channel - it is how the reset flow is exercised without an
    inbox - so the answer is yes. The distinction matters: an endpoint that
    answers "a link is on its way" while this returns False is lying to the
    person, which is exactly how "sending email is not working" gets reported
    as a mystery.
    """
    return configured() or not config.IS_PROD


def send(to: str, subject: str, text: str, html: str = "") -> bool:
    """Deliver one message. Returns True only when it was actually sent.

    Never raises: a mail outage must not turn "I forgot my password" into a
    500 the person cannot act on. The caller answers the same way either way,
    and the failure is logged here with enough detail to debug it.
    """
    delivered = False
    if configured():
        try:
            resp = requests.post(
                RESEND_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {config.RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": config.MAIL_FROM or DEFAULT_FROM,
                    "to": [to],
                    "subject": subject,
                    "text": text,
                    **({"html": html} if html else {}),
                },
                timeout=10,
            )
            delivered = resp.status_code < 300
            if not delivered:
                log.error("resend refused (%s): %s", resp.status_code, resp.text[:400])
        except Exception as exc:  # noqa: BLE001 - a mail failure is not a request failure
            log.error("resend unreachable: %s", exc)
    else:
        log.error("RESEND_API_KEY is not set - no email was sent to %s", to)

    if not config.IS_PROD:
        _keep_copy(to, subject, text)
    return delivered


def _keep_copy(to: str, subject: str, text: str) -> None:
    """Development only: a copy on disk, which is how the suite reads a token."""
    try:
        path = outbox_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"to": to, "subject": subject, "text": text}) + "\n")
    except OSError as exc:  # read-only filesystem (Vercel), or no permission
        log.warning("could not write the dev mail outbox: %s", exc)
