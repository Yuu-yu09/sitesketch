# Security

What is actually enforced in this repository, and what has to be done
outside it. Written so a reader can tell the difference rather than assume
everything on a checklist is covered.

---

## 1. Data in transit (HTTPS / TLS)

**Done by Vercel.** Certificates are issued and renewed automatically and
HTTPS is forced; there is no plain-HTTP listener to misconfigure.

**Done here:** HSTS is sent in production, which tells browsers to refuse
plain HTTP for this domain and for a further 180 days, so a downgrade
attack fails silently:

```
Strict-Transport-Security: max-age=15552000; includeSubDomains
```

It is deliberately omitted in development, because `max-age` on
`http://localhost` locks you out of your own machine.

**Not done, needs your decision:** `preload` (submitting the domain to the
browser preload list) is irreversible for a year. Do it at launch, not now.

---

## 2. Access control and authentication

| Measure | State |
|---|---|
| Passwords hashed | Done — werkzeug **scrypt** with a per-password salt. Plaintext is never stored, logged or returned. |
| Strong passwords enforced | Done — 10+ characters and three of {lower, upper, digit, symbol}; common passwords like `password123` rejected outright. |
| Brute force limited | Done — 10 login attempts per IP per 5 minutes, 5 registrations per IP per hour. Over the limit returns **429** with `Retry-After`. |
| Account enumeration blocked | Done — login answers the same message for an unknown email, and burns comparable hashing time, so timing does not leak either. |
| Access tokens | Done — 30 minutes. |
| Silent renewal | Done — a 30 day refresh token renews the access token and replays the request, so nobody is bounced mid-edit. See `auth.py`, `static/js/api.js`. |
| Rate limit storage | In-process. Single instance only. Move to Redis before scaling past one instance. |
| MFA / 2FA | **Not done.** Needs a TOTP library, a recovery-code flow and an enrolment UI. The practical version for this project: require MFA before exposing any admin surface. |
| Custom admin URL | Not applicable. There is no `/wp-admin`; admin actions are JWT-scoped per user. `projects.py` re-checks ownership on every read and write, so one user's token cannot touch another's project. |

**On hashing the username:** it is not possible, and pretending otherwise
would be wrong. A username has to be *looked up* and *displayed*, so it
cannot be a one-way hash. It is instead validated to a safe character set
(`[A-Za-z0-9_.-]{3,40}`), length limited, and unique. Passwords are the
only secret worth hashing here, and they are.

---

## 3. Keeping software current

- Flask, psycopg, Werkzeug and Flask-JWT-Extended are pinned in
  `requirements.txt`.
- Regenerate and redeploy with:

  ```powershell
  .venv\Scripts\python.exe -m pip install -U pip
  .venv\Scripts\python.exe -m pip install -r requirements.txt --upgrade
  ```

- Removed: 142 lines of dead CSS from the retired three-column builder.
  Unreachable code is not a vulnerability on its own, but it is a place
  nobody reviews.
- **Known leftovers that should go before a real launch:** `rendercheck.html`
  and `editorcheck.html` are development harnesses that render a fixture
  plan. They hold no data and no secrets, so they are harmless, but they
  are not needed in production and are best deleted or moved behind a flag.

---

## 4. Input validation and code protection

**SQL injection — not possible by construction.** Every value reaches the
database through a `%s` parameter (`db.py`, `auth.py`, `projects.py`). The
only strings interpolated into SQL are fixed literals we wrote ourselves
(`PUBLIC_USER`, a hardcoded `UPDATE` column list). No user input is ever
concatenated into a statement.

**XSS — defence in depth, three layers:**

1. `esc()` in `static/js/site.js` escapes every piece of user text before
   it is written into the page. All 15 block builders route through it.
2. Section style overrides are written as CSS custom properties, and values
   are clamped (`clampNum`) before they reach an inline style.
3. **Content-Security-Policy** — the backstop if 1 and 2 ever miss:

   ```
   default-src 'self'; script-src 'self'; object-src 'none';
   frame-ancestors 'none'; base-uri 'self'; form-action 'self'
   ```

   No inline script, no `eval`, no third-party script. An injected `<script>`
   tag simply will not run.

   `style-src` allows `unsafe-inline` because the editor sets
   `element.style` while dragging, and `img-src` allows Unsplash and
   Supabase because those are where pictures live. Both are deliberate and
   are the only two relaxations.

**File uploads** (`media.py`) allow an explicit MIME list, are capped at
6 MB, and the extension is taken from the validated MIME type rather than
from anything the client sent. Storage keys are generated server-side
(`<user_id>/<uuid>.<ext>`), so a caller cannot choose a path or overwrite
someone else's file.

**File uploads are not virus-scanned.** Fine for a student project; add a
scan before accepting files from strangers.

---

## 5. Firewalls and traffic protection

**Done here:** per-IP rate limiting (section 2). It returns a proper 429
with `Retry-After` rather than queueing work forever, so a flood costs
little.

**Provided by the platform, free tier:**

- Vercel's edge absorbs volumetric traffic and terminates TLS.
- Postgres is not reachable from the internet: the only endpoint is the
  Supabase pooler, and the connection string lives in environment
  variables that were never committed (`.env` is gitignored and verified
  with `git check-ignore`).

**Not done, needs your decision:**

- A real WAF (Cloudflare free tier is the usual answer) — gives IP and
  country blocking, managed rules, and a challenge page for bots.
- Automated dependency scanning in CI (`pip-audit`, Dependabot).
- Centralised logging. Failures currently return messages and nothing is
  recorded anywhere you can audit afterwards.

---

## 6. Backups and disaster recovery

**Done:** `scripts/backup_db.py` takes a gzipped `pg_dump`, prunes anything
older than 30 days, and can restore:

```powershell
.venv\Scripts\python.exe scripts\backup_db.py
.venv\Scripts\python.exe scripts\backup_db.py --restore backups\sitesketch_....sql.gz
```

It refuses to restore a file that does not look like one of our dumps.
`backups/` is gitignored: a dump contains every account row.

**Requires `pg_dump`** (PostgreSQL client tools, not currently installed on
this machine — the script says so clearly rather than crashing).

**Backups are only backups once you have restored one.** A restore onto a
scratch database is the only way to know. Schedule it, and run it.

**Offsite:** copy `backups/` somewhere separate from the machine that made
them. Supabase's own point-in-time recovery protects the hosted database,
but not against losing the project itself.

**Not covered:** uploaded images live in Supabase Storage and are **not**
in the SQL dump. Back up the `media` bucket separately or those pictures
are one bucket deletion away from gone.

---

## Outstanding, in priority order

1. **Rotate the secrets pasted into chat** — database password,
   `sb_secret_*`, OAuth secrets, `JWT_SECRET`, and a Vercel token that
   appeared in a screenshot. Anyone reading that transcript has them.
2. Delete `rendercheck.html` and `editorcheck.html` from production.
3. Back up the `media` bucket, not just the database.
4. Move rate-limit counters to Redis if more than one instance runs.
5. MFA, if an admin surface is ever exposed.
6. Centralised logging, so incidents are reviewable after the fact.