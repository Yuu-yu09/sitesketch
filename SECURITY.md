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
| Refresh token storage | Done — `HttpOnly` cookie, so page scripts cannot read it. Was previously in `localStorage`, which any XSS could exfiltrate. See section 7. |
| Refresh token rotation | Done — the token is single-use. Each refresh issues a new one and invalidates the old, so a stolen cookie is usable at most once and the theft becomes visible as a failed refresh. |
| Rate limit storage | In-process. Single instance only. Move to Redis before scaling past one instance. |
| Client IP for rate limiting | Spoofing-resistant. `X-Forwarded-For` is read **rightmost-untrusted**, not leftmost. The leftmost value is whatever the caller sent and is trivially forged, so trusting it let anyone reset their own limit by inventing a header. |
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
- Removed: `rendercheck.html`, `editorcheck.html` and `shot.html`. These were
  development harnesses that rendered a fixture plan for eyeballing. They
  held no data and no secrets, but they were publicly served and nothing
  needed them in production.

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

   Two exceptions, both deliberate and both scoped to one route:

   - `preview.html` is allowed `frame-ancestors 'self'`, because the builder
     draws the page being edited inside a same-origin iframe. Blocking that
     broke the device preview entirely.
   - A **published** site (`/site/<slug>`) is served with `script-src 'none'`.
     It is not a weaker policy than the rest of the app; it is a stronger
     one, and it is possible only because published pages run zero
     JavaScript. The plan is compiled in the browser at publish time and the
     finished document is what gets stored, so there is nothing left to
     execute.

   `style-src` allows `unsafe-inline` because the editor sets
   `element.style` while dragging, and `img-src` allows Unsplash and
   Supabase because those are where pictures live. Both are deliberate and
   are the only two relaxations.

   **User-authored HTML on a published page is still sanitised**, because
   `script-src 'none'` is a backstop, not the control. `published_html.py`
   strips `<script>`, event handlers, `javascript:` URLs and inline styles
   before storage, and `audit()` reports what it removed.

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

## 7. Cookies and consent

**One cookie exists.** `sitesketch_refresh`, and it does one job: keeping
someone signed in.

| Property | Value | Why |
|---|---|---|
| `HttpOnly` | yes | Page scripts cannot read it. This was the point of the change — the token used to sit in `localStorage`, where any XSS could exfiltrate it. |
| `SameSite` | `Strict` | It is never needed on a cross-site request. |
| `Path` | `/api/auth` | The browser does not attach it to page loads or asset requests at all. |
| `Secure` | production only | Omitting it in development, where the origin is plain HTTP. |
| Lifetime | session, or 30 days | Only 30 days if **Keep me signed in** was ticked. |

**No personal data and no password is in any cookie.** The cookie holds an
opaque random session identifier, not the email, not the username, not
anything that identifies the person. That was the requirement, and an opaque
id is the only way to honour it.

**Rotation on every use.** The refresh token is single-use; using it mints a
replacement and invalidates the original. This is what limits the damage from
a stolen cookie, and it is also how a stolen cookie gets noticed.

**The "keep me signed in" choice rides in the token claims**, not in a
separate preference. A browser will not tell the server whether a cookie is
persistent, so the only honest place to record the decision is inside the
token itself.

### CSRF

A cookie is attached automatically by the browser, which is exactly what
makes it CSRF-able, so this needs an answer. `/api/auth/refresh` checks that
`Origin`/`Referer` is same-origin. No extra round trip and no token to
manage; a forged cross-site request cannot forge those headers.

`JWT_COOKIE_CSRF_PROTECT` is `False` **on purpose** — enabling it would mean
fetching a CSRF token before every refresh, for no additional protection
over the Origin check. A request arriving with neither header (curl, a native
app, a server-side call) is allowed, since those are not browsers and cannot
be the CSRF attack being defended against.

### Consent

The notice appears on the **landing page only**, with **Accept** and
**Decline**. Both are styled to look equally like real answers — if declining
is the shabbier option, the layout is nudging people.

- `Decline` writes a **recorded decision**, not a dismissal. `decision:
  "declined"` is a different state from never having been asked, and
  `Consent.granted()` can tell them apart.
- `Consent.granted(category)` is the single gate any future Analytics or
  Advertising code must pass. Nothing currently uses it because **there is no
  analytics and no advertising** — which is what makes the landing-page copy
  ("we use one cookie, declining changes nothing") true rather than
  misleading. If a tracker is ever added, that copy becomes a lie and
  `browser_check.py` fails.
- Withdrawal is one click, with no confirmation step designed to talk someone
  out of it.

### Legal pages

`privacy.html` (with the preference centre) and `terms.html` are published
and reachable. Sign-in and sign-up carry their own links to both — the cookie
notice used to be the only route there, so moving it to the landing page
would have left those pages with no way to reach the policy at all.

The cookie inventory on `/privacy` is **rendered from `cookies.py`**, and the
retention table from `privacy.py`. It is generated rather than written, so
the policy cannot drift away from what the code actually does. A third-party
script audit lives in `privacy.py` (`THIRD_PARTIES`) and is currently empty,
which is the honest answer.

---

## Outstanding, in priority order

1. **Rotate the secrets pasted into chat** — database password,
   `sb_secret_*`, OAuth secrets, `JWT_SECRET`, and a Vercel token that
   appeared in a screenshot. Anyone reading that transcript has them.
2. **Move the access token out of `localStorage`.** It is the last piece of
   auth state JavaScript can reach: 30 minutes, and readable by any XSS.
   Doing it properly means an async auth bootstrap, which is a real refactor,
   so it was scoped out rather than half-done.
3. Back up the `media` bucket, not just the database.
4. Move rate-limit counters to Redis if more than one instance runs.
5. MFA, if an admin surface is ever exposed.
6. Centralised logging, so incidents are reviewable after the fact.
7. Google/GitHub OAuth — `oauth_accounts` is still commented out in
   `schema.sql`.