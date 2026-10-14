# Rotate the credentials that were pasted into chat

**Status: NOT DONE. This is a checklist, not a record.**

Several secrets were pasted into a chat transcript during development. Anyone
who can read that transcript has them. Rotating them requires dashboard access
that is not available from this repository, so nothing here can be automated.

`.env` itself was never committed — verified across all 68 commits — and
`tests/scan_history_for_secrets.py` passes. That covers the *repository*. It
does not cover the transcript, and no scan can un-leak a value.

## Order matters

Rotate the **database password first**, because it is the credential most
likely to be reused elsewhere and it gates everything else.

| # | Credential | Where to rotate | Then |
|---|---|---|---|
| 1 | `DATABASE_URL` password | Supabase → Project Settings → Database | update `.env` and Vercel env vars, then `scripts/apply_migrations.py` still connects |
| 2 | `SUPABASE_KEY` | Supabase → Project Settings → API | update `.env` and Vercel env vars |
| 3 | `GEMINI_API_KEY` | Google AI Studio → Get API key | update `.env` and Vercel env vars |
| 4 | `JWT_SECRET` | generate your own — it never needed to exist elsewhere | update `.env` and Vercel env vars; **this signs everyone out** |
| 5 | `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials | update `.env` and Vercel env vars |
| 6 | `GITHUB_CLIENT_SECRET` | GitHub → Settings → Developer settings → Apps | update `.env` and Vercel env vars |
| 7 | Vercel token | Vercel → Account Settings → Tokens → revoke | mint a new one; needed for CLI deploys |

### Two things checked against the code, so the list above is the whole list

`config.py` reads exactly nine credential-shaped settings: `DATABASE_URL`,
`SUPABASE_URL`, `SUPABASE_KEY`, `GEMINI_API_KEY`, `JWT_SECRET`, `SECRET_KEY`,
and the Google and GitHub client id/secret pairs. Client **IDs** are public
by design and are not rotated.

- **`SECRET_KEY` is not set in `.env`**, and `config.py` line 52 reads
  `SECRET_KEY = _get("SECRET_KEY") or JWT_SECRET`. So it silently falls back
  to `JWT_SECRET` — rotating `JWT_SECRET` (#4) rotates both. There is no
  separate step, and adding a new `SECRET_KEY` would *not* rotate anything
  that matters today.
- **`.env` also holds `SUPABASE_PUBLISHABLE_KEY`**, which no code reads. It
  is the publishable (anon) key and is designed to be public, so it does not
  need rotating. The one that matters is `SUPABASE_KEY`, which `media.py`
  sends as `Authorization: Bearer` — that is the **service_role** key, and it
  bypasses row-level security. Confirm you are rotating the service_role key
  and not the publishable one.

`.env` is confirmed gitignored (`.gitignore:2`) and
`tests/scan_history_for_secrets.py` passes. The repository is clean. The
exposure is the transcript, and only rotation fixes that.

## After rotating

```powershell
.\.venv\Scripts\python.exe -m pip install -q -r requirements.txt
.\.venv\Scripts\python.exe tests\run_all.py
```

The suites register real accounts against the real database, so they will
fail loudly if a rotated value was not updated in `.env`.

## Then check the app still works

- Sign up and sign in (exercises `JWT_SECRET`, the refresh cookie, the DB)
- Generate a plan (exercises `GEMINI_API_KEY`; a slow response means the
  fallback ran, which is expected while Gemini is degraded)
- Publish a site (exercises `DATABASE_URL`, `SUPABASE_KEY` for storage)

## If a secret is exposed somewhere you did not expect

Do not just rotate it. Find out where it went first — check the hosting
provider's access logs, because a leaked credential is only a problem if
someone used it.

## What is already verified

- `.env` is gitignored (`.gitignore:2`) and appears in no commit
- `tests/scan_history_for_secrets.py` finds nothing across 91 tracked files
  and 68 commits
- No hardcoded credentials in any source file

So the repository is clean. The exposure is the transcript, and the only fix
for that is rotation.