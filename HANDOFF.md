# SiteSketch — Handoff notes

Last updated: **Oct 12, 2026**. Read this first when resuming.

---

## 0. Standing rule from the user

**Commit and push to GitHub after every change.** The user was explicit: work must be
safe on the remote even if local tokens, `.env` or the machine are lost.

```powershell
git add -A; git commit -m "..."; git push origin main
```

Remote: `Yuu-yu09/sitesketch`, branch `main`. Check with
`git status -sb` + `git log origin/main..HEAD --oneline` (empty output means clean).

---

## 1. Where the project stands

Working full-stack app. Flask + Supabase (Postgres + Storage) + Gemini, static frontend.

- 9 screens: landing, login, register, dashboard, plan wizard, builder, publish,
  privacy, terms.
- `static/js/api.js` talks to the real Flask API with a JWT. Accounts and projects live
  in Supabase, so anything created on any device is there on the next load.
- The builder is the WordPress model: the page *is* the editor. One renderer
  (`SS.renderPage`) serves the builder canvas, preview and the published page.
- **Live publishing works.** `/site/<slug>` serves a real multi-page site.
  See section 4 for the two bugs that hid behind it.
- Tests, all four suites green as of the last run:

  | Suite | Checks | What it covers |
  |---|---|---|
  | `tests\e2e_check.py` | 63 | API level: auth, projects, media, publishing, headers |
  | `tests\browser_check.py` | 30 | Playwright: the real UI, consent banner, legal pages |
  | `tests\user_journey.py` | 22 | One new user, nothing to a live site, no API calls |
  | `tests\check_js_scopes.py` | — | Static: catches out-of-scope `ctx` (see below) |

  ```powershell
  .venv\Scripts\python.exe tests\e2e_check.py      http://127.0.0.1:3000
  .venv\Scripts\python.exe tests\browser_check.py  http://127.0.0.1:3000
  .venv\Scripts\python.exe tests\user_journey.py  http://127.0.0.1:3000
  .venv\Scripts\python.exe tests\check_js_scopes.py
  ```

---

## 2. What exists

| Area | Detail |
|---|---|
| Backend | `app.py` (routes), `auth.py`, `projects.py`, `media.py`, `db.py` (psycopg 3), `config.py`, `gemini.py` |
| Database | `supabase/schema.sql` + `seed.sql`, already applied. Tables: users, website_types, goals, section_templates, projects, media, ai_logs. Buckets: `media`, `sites` |
| AI | `POST /api/design` (design spec), `POST /api/plan` (type + written copy). Models: `gemini-flash-lite-latest` primary, `gemini-3.8-flash` retry, curated library fallback |
| Editor | `editor.js` (block select, toolbar, inline `contenteditable`, drag, design tokens), `crop.js` (non-destructive crop), `editorui.js` (media picker, Styles panel, block settings, footer panel) |
| Renderer | `site.js` = 15 block types × 29 layout variants, nav, footer; `generated.css` driven entirely by `--sec-*` / design custom properties |
| Media | uploads to Supabase Storage `media` bucket via REST, 6 MB cap, MIME allowlist, recorded in the `media` table |

**Builder features:** inline text editing · block select + floating toolbar (move up/down,
layout, image, crop, AI, settings, duplicate, delete) · drag to reorder (grip + arrow keys
for keyboard) · non-destructive image crop · per-block settings (layout, alignment,
background/text/accent, spacing, corner, hide/show, reset) · site-wide Styles panel ·
fully editable footer · **free-arrange photo wall** (`images` block: add your own pictures,
drag to reorder, size each one — deliberately no layout presets, because templates are what
make generated sites look alike) · Preview mode · closable sidebars · first-run hint bar.

---

## 3. Resume checklist

1. Start the server: `.\.venv\Scripts\python.exe app.py` (port 3000).
2. **Commit and push anything you change.**
3. Verify with the suites above before pushing.
4. Run the suites **one at a time**. They share a server and an IP address, and
   register/login are rate limited, so running two together makes checks fail
   for reasons that have nothing to do with the code.

---

## 4. Open work

- **Google/GitHub OAuth unimplemented.** `oauth_accounts` exists but is commented out in
  `schema.sql`; no callbacks registered at `/api/auth/google|callback`.
- **ZIP export is a stub** ("Phase 2"). The `sites` Storage bucket is reserved for it;
  published pages live in Postgres `published_pages jsonb` instead, so the route can send
  real security headers rather than serving a bucket upload.
- **`DESIGN.md`** not written yet.
- **Secrets pasted in chat need rotating:** DB password, `sb_secret_*`, OAuth secrets,
  `JWT_SECRET`, and a Vercel token from a screenshot. Update `.env` afterwards.
- **The access token is still in `localStorage`.** 30 minutes, but readable by any XSS.
  The refresh token moved to an `HttpOnly` cookie; this is the remaining half and it
  needs an async auth bootstrap, so it was scoped out rather than half-done.
- No MFA, no real WAF.
- **No visual verification.** The screenshot tool needs a visible desktop window, which
  is unavailable in this environment. Everything is checked by DOM assertions instead.
- Throwaway accounts left in the DB from testing.

### Publishing bugs worth remembering

Both were invisible until `user_journey.py` exercised a real end-to-end flow, and both
are the kind that look fine in a unit test:

- **`jsonb` reorders object keys.** The homepage was whichever page happened to sort
  first, so `/site/<slug>` served the wrong page as the index. Fixed with an explicit
  `published_home` column rather than by picking a key at read time.
- **Page ids that were not lowercase slugs produced dead links.** The client built
  `href`s from the raw id while the server stored a slugified key. Fixed with
  `SS.pageKey` / `projects.page_key`, and colliding keys are refused rather than silently
  overwriting each other.

Also fixed in the same area: the ETag included `view_count`, so it changed on every
request; and `_site_response` was left with a stale `views` argument that raised a
`KeyError` and 500'd the page.

### The `ctx` bug, and why it looked intermittent

`cardsOf()` in `site.js` is defined outside every block renderer, so there is no `ctx` in
scope — but it called `ctx.crop()`. It returned early for empty lists, so it only threw
for sections that had items, meaning whether it fired depended on what the AI happened to
generate. Two runs passed 22/22; then it emptied the builder entirely.

`tests\check_js_scopes.py` now fails the build on that class of mistake. It is a crude
parse and errs towards reporting, so expect to read a false positive (`sectionHTML`
declares its own `ctx`) rather than filter it out.

---

## 5. Gotchas that cost time — do not repeat

- **Editor chrome leaked into built pages.** `app.css` styles bare `h1/a/button`, so any
  element the generated site did not restate inherited the *editor's* colours. Generated
  CSS must restate what it needs.
- **Cache-bust when testing.** Flask sends `Cache-Control: no-cache` but the browser still
  served a stale `site.js` for a long time. Append `?v=<timestamp>` to script srcs when a
  change does not appear.
- **`display:none` on a grid child removes it from the grid flow.** Collapsing a sidebar
  that way pulled the canvas into the `0` column and collapsed the page to ~62 px. Collapse
  with `width: 0; overflow: hidden` instead.
- **Dead CSS outranks live CSS by source order.** 142 lines from the old three-column
  builder silently overrode the current `.builder-shell`. Deleted.
- **Section settings keys are unique per section.** Buffering edits by path alone
  (`"title"`) restored one section's wording onto another. Keys are `sectionId|path`.
- **Crop maths must account for the image's own aspect ratio**, otherwise a "landscape"
  preset produces a portrait crop.
- **Every `getElementById` needs a matching `id`** — a missing one silently broke wiring.
- PowerShell 5.1 has no `Invoke-RestMethod -Form`; test uploads from Python (`requests`).
- Use Python for edits on files with non-ASCII (PowerShell `Set-Content` adds a BOM).

---

## 6. Environment facts

- Supabase project `xvlkjcazhxqaahdalhon`, region Tokyo (`aws-0-ap-northeast-1`).
- Pooler host must be **`aws-0-`**, not `aws-1-`. Database is `postgres`.
- DB password starts with `@`, so it stays percent-encoded as `%40` in `DATABASE_URL`.
- Direct host `db.<ref>.supabase.co` is IPv6-only — use the pooler.
- Keys are `sb_secret_*` (server) and `sb_publishable_*` (browser).
- Vercel env (7): `NODE_ENV`, `APP_URL`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY`,
  `GEMINI_API_KEY`, `JWT_SECRET`. **Redeploy required after env changes.**
- Schema uses text slug PKs (`'business'`, `'get-contact'`) to match `api.js`/`design.js`
  — a deliberate deviation from `PLAN.md`.
- **The network to Supabase Tokyo is intermittent on this machine.** Symptoms: DNS fast,
  raw-IP TCP fast, but hostname TCP ~45 s, so every DB query took 45 s and the builder
  looked hung. It recovers on its own; check with a raw-IP connect before assuming a code
  fault.
- Gemini latency is variable: seconds normally, but a `classify_site` call was measured at
  **96 s**. Two model attempts × two API calls is a 130 s worst case.
- Screenshots: `powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\opencode\shoot.ps1"`,
  then `$env:TEMP\opencode\crop.py`. Headless Edge at
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. `shot.html?walk=plan|block|footer`
  drives the page into a state worth capturing. Top-level windows clamp to 500 px wide, so
  mobile shots go through the `shot.html` iframe harness.