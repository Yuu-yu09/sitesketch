# Tomorrow

Everything below is written from something already measured. Nothing here is
a guess dressed up as a finding, and nothing was "fixed" without proving it
first.

State at the end of the last session: **24 commits, working tree clean,
`local == origin/main` at `91f809c`.**

## Session update (25 Oct)

- **Gallery control shipped** (the owner asked for it): Photos per row
  (2-5) and Spacing (tight/normal/roomy) live on the gallery's block
  panel, stored as `style.columns`/`style.gap`, emitted as
  `--sec-grid`/`--sec-gap`. Design reversed once mid-build on evidence:
  `variantFor` hashes *every* fresh gallery into masonry or spotlight, so
  the first draft (user yields to variant) would never have applied — an
  explicit count now overrides the preset, phones drop to two-up.
  Commit `8049bc1`.
- **Navbar built; item 1 below is fixed** — labels shortened by the rule
  the item demanded (decided first: known phrases → standard short form,
  word-boundary cut ≤24 chars, typed labels untouched; footer links get
  the same rule), plus a navbar style choice (bar/minimal/outline — the
  variants `generated.css` always had) and an opt-in per-link icon
  following the link's section type. KNOWN_BUGS #13 carries the second
  fix. One commit.
- **New test order bug found and fixed by repositioning, not by code:**
  the nav check was first registered between "menu panel lists every
  page" and the menu chain, but that chain runs on whatever page the
  previous check left open and needs two pages — five menu/publish
  checks failed with `setup failed` style errors until the nav check
  moved next to the gallery check (both seed their own throwaway
  projects). Lesson recorded: a check that navigates is not free to
  insert anywhere.
- **The rotating flake rotated again** during that wrong-order run:
  `published nav reaches the sections` failed once with a custom link
  (`https://example.com/social`) still in a published nav — the
  round-trip test's restore save had not landed, which is item 3's exact
  shape. Green across the run after this entry. Item 3 still open.

---

## Session update (24 Oct)

- **Drag-and-drop fixed.** Root cause: `onEnd` destroyed and re-created
  Sortable *inside* Sortable's own `_onDrop`, leaving the module-level
  `dragEl` guard set for every later instance — first drag works, the rest
  die silently. Fix defers the splice/render one tick. Measured before and
  after in `KNOWN_BUGS.md` #16. One commit.
- **Publishing works; the owner's 404 is still unexplained.** Probed the
  whole flow end to end (fresh account, wizard, publish, Open site): 200,
  real HTML. Nicole's `WebDev` project also serves 200 right now. The
  "This site isn't published" page now logs the requested slug, so if the
  owner hits it again the server log names the exact slug asked for
  (`not-published hit: slug=...`). Ask her to retry and check first.
- **"Open site" trap still possible:** the visible URL text has zero-width
  slashes for wrapping; copying that text yields a dead address. Clicking
  the button is safe. If she copied instead of clicking, that explains one
  symptom; the button path is instrumented either way.
- **ZIP export is built** (she asked outright; bug #8 second fix). Server
  route `GET /api/projects/<id>/export.zip` zips the stored published copy,
  rewriting `/site/<slug>...` hrefs to `index.html`/`<key>.html` so the
  archive opens offline as a working site; the button downloads through the
  authenticated fetch; unpublished projects get a client-side refusal (the
  console would log a 400 network error otherwise, which the suite counts as
  an uncaught error). Two suite checks cover refusal and a real download
  read back through `zipfile`.
- **Gallery control** she asked for: columns/spacing controls for the
  gallery grid.
- **Browser suite has become flaky, and the failures predate today's
  change:** across four runs, varying subsets of `delete gives visible
  feedback`, `type scale survives a reload`, `brand colours survive a
  reload`, `a menu link survives a round trip` fail, and `the builder warns
  when the live site is behind` fails every run (stashes and runs with and
  without the drag fix both show it). Baseline stashes prove they are not
  caused by the drag commit. `the builder warns...` needs a reproduction
  outside the suite's long fixture lives; project GET once returned an
  in-session 500 that did not reproduce on plain API calls. Do not ship a
  green claim while both runs disagree; bisect this before trusting "PASS".

---

## 1. Nav and footer links are full sentences — FIXED (25 Oct)

**Mine. Introduced by the navbar-section-anchor change on 14 Oct.**

    Home · Our Signature Bowls · Born in Tokyo and raised in Melbourne.
    · Late Night Opening Hours

`labelFor()` in `site.js` used the section **title**, but AI titles are
complete headlines. "Born in Tokyo and raised in Melbourne." is not a
nav label. Shows on any site with an `about` or quote section.

Was reproduced on a live publish — screenshot at
`%TEMP%/opencode/shots/wiz-live.png`. Fixed the same day by the rule the
item demanded (decided before coding — see the session note above); see
KNOWN_BUGS #13's second fix.

## 2. Menu cards render as blobs — BUG, undiagnosed

Seen in the same screenshot. `g-menu v-cards` produced three organic rounded
card shapes. Menu cards are not the shape feature's business.

Two candidates, neither confirmed:
- the shape feature leaking from the gallery change (gallery cards now carry
  `data-tile` and `tileStyle(item)`)
- the crop change (`transform: scale(1/w)` plus `transform-origin`) in
  `cropStyle` interacting with the card border-radius

**Measure first.** Read the computed `clip-path`, `--tile-shape` and
`border-radius` on a menu card and find out which it actually is.

## 3. Three browser tests are flaky — TEST BUG, not product

Intermittently fail in the full suite, pass alone:

- `type scale survives a reload`
- `a menu link survives a round trip`
- `brand colours survive a reload`

All assert "does this survive a reload" **without first confirming the save
landed**. `the builder warns when the live site is behind` was the same
shape and has been fixed by waiting for the indicator it asserts.

**The honest fix is to poll the save signal across all of them**, not to
lengthen sleeps. `#saveState` reads "SAVED" before an edit too, so it is not
a usable signal on its own — `#saveState` plus a dirty flag, or wait for the
change to round-trip.

Do not "fix" this by bumping timeouts. That hides the order dependence.

## 4. ROTATE_SECRETS.md — NEEDS A HUMAN

Still not done. The credentials pasted into the 14 Oct transcript are live:
database password, `SUPABASE_KEY` (service_role), OAuth client secrets,
`JWT_SECRET`, Vercel token.

`ROTATE_SECRETS.md` is accurate as of `09830db` — the `SECRET_KEY` step was
removed because it silently fell back to `JWT_SECRET`, and the checklist now
says to rotate **service_role**, not the publishable key.

This one does not need me. It needs your dashboards.

---

## Not bugs — verified working, do not re-investigate

- Gallery photo picking — changes, matches what was clicked, `items` stays an array
- Gallery shape controls — 7 options, `clip-path` applied
- Type presets — `h1 54.4px → 64.192px`, survives reload
- One-page navbar — real section anchors, no dangling fragments
- Footer — real navigation, accent colours the links at rest
- Mobile builder — canvas visible at 390px, rail is a drawer
- List sections — seeded, no longer publish as empty headings

## Optional, from the WordPress comparison

Ranked by felt absence for a first-time user:

1. **Reusable patterns** — biggest single win, biggest build. Rebuilding a
   testimonial block by hand each time is the clearest gap.
2. **Palette as a sitewide constraint** — the footer does this; everywhere
   else you can still pick an off-brand colour by hand.
3. **Layout width control** (`contentSize` / `wideSize`) and **previewing a
   section variant before applying it**.

Type presets — the one idea worth stealing from WordPress — are done.

---

## Carried over from earlier, still open

- **Footer redesign** — the navigation half is fixed. Whether the columns,
  the headings or the duplicated copyright bar are the remaining "messy" was
  asked and never answered.
- **Supabase uploads take ~43s** even after the bucket check is cached. That
  remainder is the storage round trip, not our code.