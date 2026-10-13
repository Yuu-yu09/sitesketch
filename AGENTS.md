# AGENTS.md

Working rules for this repository. Every rule here exists because something
went wrong here — not because it is good practice in the abstract. The
evidence is in the git history and named where useful.

**Verify before you commit.** Not after. Twice in one session a change was
pushed and only then found broken.

```powershell
.\.venv\Scripts\python.exe tests\run_all.py --quick   # ~1 min, skips slow AI e2e
.\.venv\Scripts\python.exe tests\run_all.py           # everything
```

`run_all.py` runs eight gates and exits non-zero if any fails:

| # | Gate | Catches |
|---|---|---|
| 1 | `node --check` | syntax errors, instantly |
| 2 | ESLint | shadows, undefined names, dead code |
| 3 | JS scope check | out-of-scope `ctx` in `site.js` |
| 4 | test ordering | a `check()` registered above its `def()` |
| 5 | browser suite | the real UI, driven through Playwright |
| 6 | user journey | one new user, nothing to a live site |
| 7 | e2e suite | API level, including the AI endpoints |
| 8 | responsive audit | phone / tablet / desktop, site and builder |

Run the suites **one at a time**. They share a server and an IP address, and
register/login are rate limited, so running them in parallel produces failures
that have nothing to do with the code.

---

## The rules, and why each one is here

### 1. Never rename a binding in the same edit as a logic change

Renaming `items` to `items()` and splitting `write()`/`commit()` in one edit
produced **two bugs**, both from the rename:

- A leftover `items.length` read the *function's arity* — which is `0` — so the
  panel rendered "No pages yet." every time.
- The subsequent fix mismatched a quote and shipped a syntax error.

**After any rename, every remaining use of the old name is suspect.** Grep
for it, then `node --check`, then the suite.

### 2. `node --check` after every single edit

Free, and it takes under a second. It was skipped exactly once, and that
commit contained a syntax error.

### 3. Assert behaviour, never shape

A test counted `.ss-navitem.has-sub` and passed on the count. The bug was
that `has-sub` had been written *outside* the class attribute, so the submenu
could never open. The count was right; the feature was broken.

**If an assertion could pass while the feature is broken, rewrite it.** Hover
the thing. Read the computed style. Check the value the user sees.

**And the corollary, which cost three runs in four: `inner_text()` returns
*rendered* text.** Several layouts set `text-transform: uppercase`, so
comparing it case-sensitively against a string you typed fails while the edit
worked perfectly. It reported *"the edit did not stick"* and sent the hunt
after a race condition in `editor.js` that did not exist — the repro passed
five times out of five.

Which element is first, and so whether it is uppercased, varies with the
layout the AI or the fallback happens to pick. That is what made it look
intermittent rather than consistently broken.

Assert the stored value for "did it save", and compare rendered text
case-insensitively for "is it visible".

### 4. Measure, do not eyeball

Every expensive bug found in this project was found by measuring:

- 790px of toolbar in a 390px viewport — Publish was unreachable on a phone
- 47 full page re-renders for one keystroke, from accumulated listeners
- a caption at 13.76px that was silently ignoring `--type-scale`

None of these looked wrong in the source.

### 5. Prefer a delegated listener installed once

Registering handlers on an element that gets rebuilt accumulates them. The
menu panel rebuilt after every structural edit and re-registered three
delegated handlers each time. The saved data stayed correct, because the
newest closure wrote last — which is precisely why looking at the output
never showed it.

Install once behind a flag, and read state fresh at event time so a stale
closure cannot hold stale data.

### 6. Bulk edits are guarded, not hopeful

When renaming across a file, assert each site matched. An early script
refused to run because `var list = items();` appeared four times — the
handlers were character-identical to the outer declaration. A bulk rename
that silently matches the wrong one turns a lint fix into a behaviour change.

### 7. Prefer editing by line number when text is ambiguous

Three `set()`-like helpers exist in `editorui.js`. Removing the wrong one
would have broken section editing. Check the enclosing function's own range,
not the file.

### 8. Name a limit you chose, and say so

The responsive audit uses a 14px body-text floor. When a 13.8px caption kept
failing it, chasing it found a real bug — a hardcoded inline
`font-size:.86rem` bypassing `--type-scale`. A threshold you invented is not
a reason to stop looking.

### 9. A gate that fails open is not a gate

ESLint was installed with `--no-save`, so on a fresh clone `run_all.py`
skipped the lint gate and reported it as passing. The gate added to stop
exactly this class of bug was an instance of it. `package.json` now pins the
dependency, and the skip branch prints a loud warning.

### 10. Say what is not verified

If a suite has not been re-run since a change, say so. Reporting numbers
from a stale build is worse than reporting nothing — it happened twice here.

### 11. An unrecorded dependency is a step that silently does not happen

Three times, one root cause:

- ESLint installed with `--no-save`, no `package.json`. The lint gate skipped
  itself and reported as passing.
- `playwright` missing from `requirements.txt`. `pip install` succeeded and
  then three of the four suites could not run at all.
- `.python-version` (3.13) disagrees with the header in `requirements.txt`
  (3.11+) and with the local interpreter (3.14.7), so production and local
  can differ for reasons nobody can see.

**After touching any dependency, prove a fresh environment builds:**

```powershell
Remove-Item -Recurse -Force .venv
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
.\.venv\Scripts\python.exe tests\run_all.py --quick
```

None of these three were visible from inside a working environment. All three
surfaced only when something forced a rebuild from scratch.

---

## Architecture worth knowing before you change it

**One renderer.** `static/js/site.js` draws the builder canvas, the device
preview and the published page. A change there affects all three, and the
browser suite exercises all three.

**The plan is one JSON object.** `plan_json` holds pages, sections, crops,
design tokens, the nav and the brand colours. Undo/redo snapshots it whole.

**Everything funnels through one callback.** `Editor.onChange` fires after
every mutation, which is why history, autosave and the device preview all work
without extra plumbing. Adding a mutation path that bypasses it will silently
skip undo and autosave.

**Published pages run zero JavaScript.** The plan is compiled in the browser
at publish time and the finished document is stored. That is why the route
can send `script-src 'none'` — do not add a script to a published page.

**Type scale.** Every `font-size`, `line-height` and `letter-spacing` in
`static/css/generated.css` is a `calc()` against `--type-scale`, `--lh` or
`--ls`. A hardcoded size breaks the text-size control. This already happened
once, as an inline style in `site.js`.

**`builder.html` loads `app.css` then `generated.css`.** A rule in `app.css`
loses to a same-specificity rule in `generated.css`. Overriding a generated
site element from `app.css` needs a more specific selector, or it silently
does nothing. This cost two silent no-ops.

## Where things are

| Path | What |
|---|---|
| `app.py` | routes, security headers, JWT config |
| `auth.py` | register/login, refresh-token rotation, cookie |
| `projects.py` | plan CRUD, publish, page keys |
| `gemini.py` | AI calls, deadline, offline copy fallback |
| `static/js/` | `site.js` renderer, `editor.js`, `history.js`, `design.js` |
| `static/js/pages/` | one file per screen |
| `tests/` | `run_all.py` is the gate; the rest are its parts |
| `supabase/` | `schema.sql`, migrations |

## Still known-broken, do not "fix" by accident

- **Gemini is degraded** (503 high demand). AI tests pass via the fallback and
  say `fallback` in the output. A slow `/api/plan` is expected, not a
  regression.
- **The access token is in `localStorage`** (30 min, JS-readable). The refresh
  token is an `HttpOnly` cookie. Moving the access token needs an async auth
  bootstrap — do not half-do it.
- **`.python-version` says 3.13, the local venv is 3.14.7.** Unresolved.