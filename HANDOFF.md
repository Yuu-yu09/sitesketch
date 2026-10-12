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

- 7 screens: landing, login, register, dashboard, plan wizard, builder, publish.
- `static/js/api.js` talks to the real Flask API with a JWT. Accounts and projects live
  in Supabase, so anything created on any device is there on the next load.
- The builder is the WordPress model: the page *is* the editor. One renderer
  (`SS.renderPage`) serves the builder canvas, preview and the published page.
- Tests: `tests/e2e_check.py` = **30/30**, `tests/media_check.py` = OK.
  Run: `.venv\Scripts\python.exe tests\e2e_check.py http://127.0.0.1:3000`

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
4. `rendercheck.html` renders a fixture plan with **no database** — useful when Supabase is
   unreachable, and the fastest way to eyeball the built page or editor chrome.

---

## 4. Open work

- **`/site/<slug>` is still 404.** Publish sets the flag but nothing serves the compiled
  site. Needs: compile → upload to the `sites` bucket → public route for
  `/site/<slug>` and `/site/<slug>/about`.
- **Google/GitHub OAuth unimplemented.** `oauth_accounts` exists but is commented out in
  `schema.sql`; no callbacks registered at `/api/auth/google|callback`.
- **`DESIGN.md`** not written yet.
- **Secrets pasted in chat need rotating:** DB password, `sb_secret_*`, OAuth secrets,
  `JWT_SECRET`, and a Vercel token from a screenshot. Update `.env` afterwards.
- Throwaway accounts left in the DB from testing.

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