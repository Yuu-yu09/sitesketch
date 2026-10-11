# SiteSketch — Handoff notes

Last session: **Oct 11, 2026**. Read this first when resuming.

---

## 1. Where the project stands

**Working prototype (frontend only), backend not started.**

- 7 screens complete and functional as static HTML/CSS/JS: landing, login, register,
  dashboard, planning wizard, builder, publish.
- Data layer is a **mock API** (`static/js/api.js`) on localStorage (`sitesketch_db_v2`)
  that mirrors the future Flask endpoints. Auth is fake (any email/password works).
- Design system = "graph notebook" direction (impeccable seed `cb4b473c`): warm paper,
  quadrille grid, ink blue-black, pencil-red, highlighter yellow. Bricolage Grotesque /
  Figtree / Spline Sans Mono / Caveat. Applies to SiteSketch's own chrome only.
- Commit `69ed724` = verified 7-screen checkpoint (32 files).
- Remote: GitHub `sitesketch` still holds the **old unrelated React project**. Backup
  + replace plan was approved but **not executed yet** (see §5).

---

## 2. Completed this session

| Work | Detail |
|---|---|
| Finish-review fixes | Hand-drawn SVG arrow on hero demo card; three `➝` glyphs in the flow strip replaced with authored red SVG strokes; publish view count relabelled `Demo · N views` (no fabricated metric); live URL gets zero-width break points after each `/` so the domain never wraps mid-word |
| Content checklist removed **everywhere** | Planner step 3 panel + hint + highlighter marks, landing showcase panel, flow copy rewrite, `renderChecklist()`, `checklist` data in `api.js`, `.marks`/`.bp-check`/`.bp-check h4` CSS. Landing showcase rebalanced as a two-column sitemap. Publish "Before you publish" readiness checks intentionally kept (user declined to remove those) |
| Demo data scrub (redo) | `Alex` / `alex@sitesketch.demo` → `Demo` / `demo@sitesketch.app`; `Sample Portfolio` → `My Portfolio` (slug `my-portfolio`); login hint + autofill updated; **`scrubLegacy()` migration in `api.js`** rewrites already-stored localStorage databases in place, so existing browser data survives (verified live: user's own test projects preserved) |
| Screenshot harness upgrade | `shot.html` gained `walk=plan` (clicks type → goal → step 3 so captures can show the wizard's final step); `shoot.ps1` writes `desktop_plan3.png` / `mobile_plan3.png` |
| New feature direction | User requested Lovable-style complete design generation + WordPress-style editing + non-static designs, "use the skills". Approved: **both entry points** (wizard auto-designs + one-shot describe box) and **curated stock photos**. Plan approved in chat (phases below) |

---

## 3. The approved build (phases) and exact status

### Phase 1 — Design engine (Lovable part)
- [x] **`static/js/design.js` created** (the only new code so far): 12 contrast-checked
      palettes, 10 Google-Font pairings, per-type image pools, section-variant registry,
      seeded RNG (`mulberry32`), `generateSpec()`, `cssVars()`, `variantFor()`,
      `cycleVariant()`, `fontLink()`. Schema v1 = the future Gemini contract.
- [ ] Content packs: real written copy per section type (features, menu items + prices,
      FAQ pairs, testimonials with locale-appropriate names, hours, post titles).
      **Rules: zero em-dashes, no "Acme/SmartFlow" names, no filler verbs
      ("Elevate/Seamless/Unleash"), quotes ≤ 3 lines, organic numbers.**
- [ ] `API.generateDesign(ctx, seed)` mock (≈1.1 s simulated latency) returning
      `{v, seed, name, mode, tokens{palette,font,radius,space,shadow}, motion{reveal}, nav, footer, sections{id:{variant,img}}}`.

### Phase 2 — Non-static renderer
- [ ] New `static/css/generated.css` (keep separate from `app.css`): token vars, 29
      variant styles (14 section types × 2, hero × 3), nav variants (bar/minimal/outline),
      footers, buttons, hover/tactile states, IO scroll-reveal gated by
      `prefers-reduced-motion`, explicit <768 px collapse.
- [ ] Rewrite `static/js/site.js` `sectionHTML()` to render from the spec + `items[]`
      arrays (kill lorem ipsum / "First / Second / Third"). Legacy `THEMES` stays as
      fallback until every project has a design.
- [ ] One-time migration: projects without `plan_json.design` get a deterministic spec
      (`generateSpec({type}, hash(project.id))`) so no project ever renders unstyled.
- [ ] Motion: IntersectionObserver only (never `window.addEventListener("scroll")`).

### Phase 3 — WordPress-style editing
- [ ] Inline editing of **every** text node in the builder canvas (currently titles only,
      via contenteditable) → save on blur into `plan_json`.
- [ ] Section click toolbar: drag, duplicate, delete, AI rewrite, **New layout**
      (`DESIGN.cycleVariant`), image swap picker.
- [ ] Customize panel: palette, font pairing, radius, density, shadow → live CSS vars.
- [ ] Image swap from curated pools (`onerror` fallback to `--soft` block).

### Phase 4 — Flow wiring
- [ ] `plan.html` finish → "designing your site…" state → opens builder fully designed.
- [ ] `dashboard.html` one-shot describe box → plan + design → builder.
- [ ] Builder "Redesign this site" re-roll (new seed; keeps content).
- [ ] `PLAN.md`: add the Gemini structured-output contract (same schema as v1).

---

## 4. Verified-working behaviour (don't regress)

- Demo login: `demo@sitesketch.app` / `demo1234`, or `?demo=1` auto-sign-in.
- Planner: type → goal → step 3; site name auto-derives from type; finish enabled.
- Builder: page tabs (inline rename on dblclick, two-step delete), per-section ⚡ AI fill,
  "AI fill this page", drag reorder (SortableJS).
- Publish: slug → "Publishing…" → Live badge + URL, two-step unpublish, copy fallback.
- Detector (`impeccable detect`) is clean except three contract-level findings that are
  documented and accepted: `cream-palette` ×7, `dark-glow` ×7, `flat-type-hierarchy` ×1.

---

## 5. Resume checklist (in order)

1. Start the local server (it was cancelled at session end):
   `python -m http.server 8017` in the project root.
2. Read `static/js/design.js` end to end before writing more engine code.
3. Build Phase 1 content packs + `API.generateDesign` in `api.js`.
4. Then Phase 2 (`generated.css` + `site.js` rewrite), verify with the wizard walk
   (`shot.html?page=plan.html%3Fdemo%3D1&walk=plan`).
5. Recapture screenshots after visible changes: `powershell -NoProfile -ExecutionPolicy
   Bypass -File "$env:TEMP\opencode\shoot.ps1"`, then copy into `.impeccable/review2/`.
6. Deferred review work: finish-reviewer re-check (`ses_f07be65abffeKNmyKDcus0VorU`),
   `DESIGN.md`, batch presentation of all screens to the user, git push.
7. Git push plan (approved, not done): push remote HEAD to `legacy-react`, then force-push
   local `main`. Git identity is `Nicole <nicolesoriae@gmail.com>`.

## 5b. Backend setup done (Oct 11, after the pause)

**Decisions taken by the user:**
- Backend runtime: **Python Flask** (keeps PLAN.md / proposal accurate; consumes the
  `DATABASE_URL` / `JWT_SECRET` / OAuth vars already in `.env`)
- Auth: **email/password + Google + GitHub OAuth** (social sign-in is now a feature, so
  PLAN.md's auth note and proposal need the amendment added to PLAN.md §12)
- Supabase = database only (direct Postgres), Storage bucket `sites` for published sites

**Created:**
- `supabase/schema.sql` (run first) - users, website_types, goals, section_templates,
  projects, ai_logs, indexes, `updated_at` trigger, public `sites` bucket. **Deviation from
  PLAN.md:** text slug PKs (`'business'`, `'get-contact'`) instead of `uuid`, so DB keys
  match `static/js/api.js` and the design engine with no translation layer. Commented-out
  `oauth_accounts` table for social login.
- `supabase/seed.sql` (run second) - 6 types, 14 goals, 35 section templates, idempotent.
- `.env` wired with the user's real values (gitignored, verified via `git check-ignore`);
  `.env.example` updated to the same variable names with empty values.

**Backend build order (next session, after Phase 1 spec is stable so `/api/design` has a fixed contract):**
1. [x] `requirements.txt`, `config.py`, `db.py`, `app.py`, `api/index.py`, `vercel.json`
2. [x] DB layer (`db.py`: psycopg 3 helpers) + `/api/health`, `/api/db/ping`, `/api/types`,
   `/api/goals`, `/api/sections` + page-serving routes. Verified serving all 7 pages and
   `/static/*` on port 3000 via Flask's test client.
3. [ ] Run `supabase/bootstrap.py` (blocked: the Supabase project ref in `.env` does not
   exist - see §6)
3. Auth: register/login with `werkzeug` password hashes + `flask-jwt-extended`
   (`JWT_SECRET`); drop `?demo=1` to a dev-only flag in production
4. OAuth: `/api/auth/google` + `/api/auth/github` redirect flow (Authlib), upsert into
   `oauth_accounts`; callback URLs to register with both providers
5. AI: `/api/plan`, `/api/design` (Gemini structured output matching the `design.js`
   v1 schema), `/api/section`; log every call into `ai_logs`
6. Publish: compile site in memory -> upload to Storage -> serve `/site/<slug>` and
   `/site/<slug>/about`; real `view_count` increments replace the demo figure
7. Swap `static/js/api.js` from localStorage mock to `fetch` (same public interface)
8. `tests/` (pytest) + README setup; then deploy per §5

## 6. Blocked on the user
- **No working Supabase project yet.** The `DATABASE_URL` project ref
  `dmqkrbbngdxzntihlmev` returns `FATAL: (ENOTFOUND) tenant/user ... not found` from the
  pooler, i.e. that project does not exist. The whole env block looks like a starter
  template (no `GEMINI_API_KEY`, no `SUPABASE_KEY`). Fix: create a real free project at
  supabase.com, then paste (a) Settings -> Database -> Connection string (URI, session
  pooler), (b) Settings -> API -> `service_role` key into `.env` and re-run
  `supabase/bootstrap.py`. Confirm the Google/GitHub OAuth apps are actually theirs too.
- **Rotate exposed secrets** (pasted in chat 2026-10-11): DB password, GitHub OAuth
  secret, Google OAuth secret, `JWT_SECRET`. Update `.env` afterwards.
- `GEMINI_API_KEY` - the AI backbone; features stay mocked without it.
- OAuth app callback URLs (to confirm with the user):
  `http://localhost:3000/api/auth/google/callback` and `.../github/callback`, plus the
  production equivalents once the Vercel domain exists.

## 7. Environment notes
- PowerShell: use `npx.cmd` / `npm.cmd`; `gh` at `$env:ProgramFiles\GitHub CLI\gh.exe`.
- Headless Edge: `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`; top-level
  window width clamps at 500 px, so mobile shots go through `shot.html` (390 × 844 iframe).
- Mobile screenshots at ≤844 px height miss below-fold content (publish live box,
  landing showcase) — check the `-tall` captures for those.
- Reading a PNG that was overwritten can return stale cached content; copy to a fresh
  filename first, or verify with PIL.
- Browser evaluate sandbox has no `setTimeout`; use two sequential evaluates.
- Keep the user's own browser tab untouched; use the dedicated test tab
  (`tab_86042d24-1f8f-4a6f-b295-ec2d9de00659`) for evaluate-driven checks.