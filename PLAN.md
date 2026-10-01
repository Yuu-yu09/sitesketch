# SiteSketch — Build Plan (v2)

> **Original title:** SiteSketch: A Web-Based Website Structure and Content Planning Application
> **Suggested updated title:** SiteSketch: An AI-Powered Website Planning, Generation, and Publishing Application
>
> Per professor's revision, the following moved from **Out of Scope → In Scope**:
> 1. Advanced drag-and-drop website building
> 2. AI-generated websites
> 3. Automatic generation of a complete working website
> 4. Website hosting or publishing
>
> Decisions made: **Real LLM API (Google Gemini)**, **self-hosted publishing on the Flask server**, **Supabase (Postgres) as the database**, **GitHub + VS Code for version control**, **plan first → approve → build**.

---

## 1. What the project is now

SiteSketch goes from a *planner* to a *plan → build → publish* pipeline:

```
Describe your site ──► AI generates plan ──► Drag-and-drop builder ──► Compiler generates
     (LLM)                (pages/sections)      (edit/reorder)            a real website
                                                                           │
                                              Publish ◄────────────────────┘
                                          (live URL on your server + ZIP export)
```

The original planning features (type/goal selection, recommendations, checklist, save/load) are **kept** — they become step 1 of the pipeline.

---

## 2. Suggested title update

> **SiteSketch: An AI-Powered Website Planning, Generation, and Publishing Application**

(Keep the old title if your prof prefers — but the scope no longer matches "Structure and Content Planning Application" alone.)

---

## 3. Architecture

Keeps your proposal's stack (HTML/CSS/JS + Flask) and adds three things.

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | HTML, CSS, JavaScript | UI, builder canvas |
| Drag & drop | **SortableJS** (tiny, CDN) | Advanced drag-and-drop builder |
| Backend | Python Flask | App logic, AI proxy, site server |
| Database | **Supabase** (managed Postgres) via `supabase-py` | Users, projects, plan JSON, site registry — keys in `.env`, accessed server-side only |
| AI | **Google Gemini API** (free tier) | Plan + content generation (key in `.env`, calls proxied through Flask — never exposed to browser) |
| Publishing | Flask static routes | Serves published sites at `/site/<slug>` |
| Templates | Jinja2 (ships with Flask) | Compiles plan JSON → working HTML/CSS |
| Design / VCS / IDE | Figma, GitHub, VS Code | Unchanged |

### Project structure

```
sitesketch/
├── app.py                  # app factory + route registration
├── config.py               # env settings incl. GEMINI_API_KEY, SUPABASE_URL, SUPABASE_KEY
├── .env.example            # template; real .env is gitignored
├── db.py                   # Supabase client wrapper + thin query helpers
├── supabase/
│   ├── schema.sql          # run once in Supabase SQL Editor
│   └── seed.sql            # website types, goals, section templates
├── requirements.txt
├── services/
│   ├── ai.py               # Gemini client: plan-gen, copy-gen, validation
│   ├── compiler.py         # plan JSON → static site files
│   └── recommendations.py  # type → suggested sections + checklist
├── blueprints/
│   ├── auth.py             # register / login / logout
│   ├── projects.py         # list/save/load/delete plans
│   ├── builder.py          # builder API (CRUD on plan JSON)
│   ├── ai_routes.py        # AI endpoints (server-side only)
│   └── publish.py          # publish / unpublish / /site/<slug> / ZIP
├── static/
│   ├── js/builder.js       # canvas, drag-and-drop, palette, inline edit
│   ├── js/ai.js            # generate buttons, streaming/error UI
│   └── css/
├── templates/
│   ├── base.html, index.html, auth/, projects/, builder.html
│   └── themes/             # Jinja2 themes for generated sites
│       ├── modern/         #   index.html.j2, page.html.j2, style.css.j2
│       └── classic/
├── published/              # generated live sites (gitignored)
├── exports/                # ZIP builds (gitignored)
└── tests/                  # pytest: auth, plan CRUD, compiler, publish
```

### Core contract: the Plan JSON (single source of truth)

Everything — AI output, builder edits, compiler input — uses one schema:

```json
{
  "meta": { "type": "restaurant", "goal": "take-reservations", "theme": "modern", "siteName": "Lola's Kitchen" },
  "pages": [
    { "id": "home", "name": "Home", "sections": [
      { "id": "s1", "type": "hero", "title": "...", "subtitle": "...", "fields": { "buttonText": "Book a table" } },
      { "id": "s2", "type": "menu-highlights", "title": "...", "fields": { "items": [] } }
    ]}
  ]
}
```

- **AI produces it**, the **builder mutates it**, the **compiler renders it**. No duplicated logic.
- Stored as `jsonb` in `projects.plan_json` (Supabase/Postgres — queryable, not just a blob).

### Database schema (Supabase Postgres — `supabase/schema.sql`)

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  email text unique not null,
  password_hash text not null,
  role text default 'user',               -- 'user' | 'admin'
  created_at timestamptz default now()
);

create table website_types (              -- seed data, admin-editable
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  icon text
);

create table goals (                      -- purpose options per type
  id uuid primary key default gen_random_uuid(),
  type_id uuid references website_types(id) on delete cascade,
  name text not null
);

create table section_templates (
  id uuid primary key default gen_random_uuid(),
  type_id uuid references website_types(id) on delete cascade,
  section_type text not null,             -- hero, gallery, pricing, ...
  name text not null,
  default_json jsonb default '{}'::jsonb,
  checklist_items jsonb default '[]'::jsonb
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  type_id uuid references website_types(id),
  goal_id uuid references goals(id),
  name text not null,
  plan_json jsonb not null default '{}'::jsonb,
  theme text default 'modern',
  slug text unique,
  is_published boolean default false,
  view_count int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table ai_logs (                   -- useful for your defense ("AI usage")
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  project_id uuid references projects(id),
  kind text,                              -- 'plan' | 'section'
  ok boolean default true,
  created_at timestamptz default now()
);
```

> **Auth note:** registration/login stays in Flask (hashed passwords via `werkzeug`) — Supabase is used as the *database*, which is exactly what "Supabase for database storing" means. (Optional later: swap to Supabase Auth.)

---

## 4. Feature design (new four)

### A. Advanced drag-and-drop building
*Definition of "advanced" (say this in your proposal — it keeps scope sane):*
- **Section palette**: drag new sections (Hero, About, Gallery, Features, Pricing, Testimonials, Contact, Footer…) onto the canvas.
- **Reorder** sections by drag within a page and **across pages** (SortableJS `group` option).
- **Add / remove / duplicate** sections; **multi-page** tabs.
- **Inline editing**: click text to edit directly on the canvas (contenteditable → writes back to Plan JSON).
- **NOT included**: absolute/pixel positioning, CSS property inspector (that's a real page builder like Wix — too far).

Auto-saves Plan JSON to the server (debounced) via `PUT /api/projects/<id>/plan`.

### B. AI-generated websites (Gemini)
Two entry points:
1. **"Generate a website from a description"** — user types *"a portfolio for a photography student"*, Gemini returns Plan JSON (`response_mime_type: application/json`), validated against the schema, loaded into the builder.
2. **Per-section copy generation** — "rewrite this hero", "write 3 feature blurbs", tone selector.

Key handling: `.env` → `config.py` → server route → Gemini REST (`generativelanguage.googleapis.com`, `gemini-2.5-flash` or `gemini-2.0-flash`). Never ship the key to the browser. On quota/network failure → clear error toast + optional template fallback so demos never die.

### C. Automatic generation of a complete working website
`services/compiler.py`: Plan JSON + theme → Jinja2 render → real static site:
- One HTML file per page (`index.html`, `about.html`, …), shared `style.css`, images/placeholders.
- Escaping handled by Jinja2 (no XSS from user content).
- Two bundled themes minimum (theme picker in builder).
- Output written to `published/<user_id>/<slug>/`.
- **Live preview iframe** inside the builder (render on demand without publishing).
- Bonus: **Download as .zip** (`zipfile` module).

### D. Website hosting / publishing (self-hosted)
- **Publish** → compiles → `is_published=1`, assigns slug → site live at **`http://<your-host>/site/<slug>`**.
- Route: resolves slug → ownership check → `send_from_directory`.
- **Unpublish / Republish** (recompile), slug editing, view counter.
- Flask serves the folder statically; works on localhost for the demo and on any Python host (PythonAnywhere/Render) for real access. *Domain registration stays Out of Scope.*

### Original features (kept)
Auth, type & goal selection, section recommendations, checklist, save/load — all become the "Planning" module feeding the builder.

---

## 5. API / routes map

| Route | Method | Purpose |
|---|---|---|
| `/register` `/login` `/logout` | GET/POST | Auth |
| `/projects` | GET | Dashboard of saved plans |
| `/projects/new` | POST | Create plan from type+goal |
| `/builder/<id>` | GET | Builder UI |
| `/api/projects/<id>/plan` | GET/PUT | Load/save Plan JSON |
| `/api/ai/generate-plan` | POST | Description → Plan JSON |
| `/api/ai/generate-section` | POST | Section copy |
| `/api/projects/<id>/preview` | GET | Compiled preview (iframe) |
| `/api/projects/<id>/publish` | POST | Publish / unpublish |
| `/site/<slug>` | GET | **The live published site** |
| `/api/projects/<id>/export` | GET | ZIP download |
| `/admin` | GET/POST | Manage types & section templates |

---

## 6. Updated proposal sections (paste-ready)

**In Scope** (add): user registration/login · website type selection · website purpose selection · recommended sections · add/remove/reorder sections via **drag-and-drop builder** · **AI-based generation of site structure and content from a user description** · **automatic compilation of a complete working multi-page website** · **publishing generated sites to a live URL on the server** · ZIP export · visual blueprint preview · content checklist · save/load projects · admin management of website types.

**Out of Scope** (keep): domain registration · online payment systems · advanced collaboration (multi-user real-time editing) · **pixel-level/absolute-positioned visual design editing** · mobile app version.

**New Specific Objectives** (each maps to a feature):
1. To allow users to select the type and purpose of the website they want to create. → *Type/Goal selection*
2. To provide recommended pages and sections based on the selected website type. → *Recommendations*
3. To allow users to build and organize their website through a drag-and-drop interface. → *Builder*
4. To generate a proposed website structure and content from a natural-language description using AI. → *AI plan generation*
5. To automatically generate a complete, working multi-page website from the user's plan. → *Compiler*
6. To publish generated websites to a publicly accessible URL hosted by the system. → *Publishing*
7. To identify basic content the user may still need to prepare. → *Checklist*
8. To allow users to save and reopen their website projects. → *Save/load*

**Tech stack rows to add:** **Supabase (PostgreSQL)** — database/storage · **Gemini API** (AI generation) · **SortableJS** (drag-and-drop) · **Jinja2** (site compilation) · **GitHub** (source code management). *Replace the "SQLite" row with Supabase.*

**Version control:** GitHub repository **`sitesketch`** (private), commits made from VS Code.

---

## 7. Build order (phases)

| Phase | Deliverable | Est. |
|---|---|---|
| **0. Scaffold** | Git repo → GitHub, Flask app factory, **Supabase project + schema**, auth, base templates, smoke test | 1–2 days |
| **1. Planning core** | Type/goal selection, recommendations, checklist, save/load → *original scope done* | 2–3 days |
| **2. Plan JSON + Builder** | Schema, builder UI, SortableJS palette/reorder, inline edit, autosave | 4–6 days |
| **3. Compiler** | Jinja2 themes, live preview iframe, ZIP export → *"complete working website"* done | 3–4 days |
| **4. Publishing** | Publish/unpublish, `/site/<slug>`, view counter → *hosting done* | 1–2 days |
| **5. AI** | Gemini service, plan generation, section copy, validation + fallback → *AI done* | 3–4 days |
| **6. Admin + Polish** | Admin CRUD, Figma catch-up, responsive fixes, error states | 2–3 days |
| **7. Testing + Docs** | pytest on auth/plan/compiler/publish, README, defense prep | 2–3 days |

**8-week mapping** (updated work plan for the proposal):
- W1: Requirements + Figma + scaffold
- W2: Auth + planning core (type/goal/recommendations/checklist/save)
- W3: Plan JSON schema + builder canvas + palette
- W4: Drag-and-drop reorder, multi-page, inline editing, autosave
- W5: Compiler + themes + live preview + ZIP
- W6: Publishing (`/site/<slug>`) + admin module
- W7: Gemini AI integration (plan + section generation)
- W8: Integration, testing, UI polish, documentation, presentation

*(If your prof insists the timeline stay exactly 8 weeks, use this table — W3–W4 are the heaviest; AI can be demoed with one key flow: description → full plan.)*

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Gemini key leaks into GitHub | `.env` + `.gitignore` from commit #1; calls server-side only |
| Supabase **service role** key leaks | Same `.env` rule; key used only in Flask (never in templates/JS); rotate from Supabase dashboard if ever exposed |
| Anyone reads/writes Supabase directly | Tables have RLS enabled; all access goes through Flask with the service key |
| Free-tier quota fails during demo | Graceful error + template fallback; pre-warm one generated site as backup |
| LLM returns malformed JSON | Gemini JSON mode + schema validation + one repair retry |
| Scope creep in "advanced" drag-and-drop | Section-level DnD defined explicitly (§4A) — no pixel positioning |
| XSS via user content in published sites | Jinja2 auto-escaping; sanitize in compiler |
| Windows path issues for published sites | `pathlib` + `send_from_directory` throughout |

---

## 9. Acceptance checklist (what "done" looks like)

- [ ] User can register, log in, create a plan from type + goal
- [ ] System recommends sections + shows content checklist
- [ ] Builder: drag sections in, reorder, across pages, inline-edit text
- [ ] AI: type a description → full editable plan appears
- [ ] Compiler produces a real multi-page site; preview works in iframe
- [ ] Publish → site loads at `/site/<slug>` in a fresh browser tab
- [ ] ZIP export opens locally as a working site
- [ ] Unpublish removes public access; only owner can publish
- [ ] Admin can add a website type and its recommended sections
- [ ] pytest passes; README explains setup incl. `.env` with `GEMINI_API_KEY` + `SUPABASE_URL` + `SUPABASE_KEY`

---

## 10. Appendix A — Supabase setup (do once, ~10 min)

1. Go to **https://supabase.com** → **Sign up with GitHub** (uses the account you're logging into now).
2. **New project**:
   - Name: `sitesketch`
   - Database password: generate a strong one and save it in your password manager
   - Region: **Southeast Asia (Singapore)** — closest to the PH
3. Wait ~2 min for provisioning.
4. Open **SQL Editor** → paste `supabase/schema.sql` (I'll generate this file) → **Run**.
5. Open **Project Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role secret key** (keep secret!) → `SUPABASE_KEY`
6. Paste both into `.env` (gitignored — never committed):

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=eyJhbGciOi...service-role-key...
GEMINI_API_KEY=...   (from https://aistudio.google.com/apikey)
```

*Free tier covers the whole project: 500 MB database, plenty for class use.*

## 11. Appendix B — Git / GitHub / VS Code

- [x] Git installed (2.55) + commit identity set (`Nicole <nicolesoriae@gmail.com>`)
- [x] GitHub CLI installed (2.102)
- [ ] GitHub login (device code `E6EB-7FC9` at **https://github.com/login/device**)
- [ ] Create private repo `sitesketch` + push
- [ ] Open project in VS Code (`code .`)
- [ ] Recommended VS Code extensions: **Python**, **Pylance**, **SQLite Viewer** (reads nothing now — use **SQLTools** if desired), **ESLint** optional

**Workflow once connected:** I commit in logical chunks; you review changes in VS Code's Source Control tab and push — or I run `git push` for you. Never commit `.env`.