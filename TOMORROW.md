# Tomorrow

Everything below is written from something already measured. Nothing here is
a guess dressed up as a finding, and nothing was "fixed" without proving it
first.

State at the end of the last session: **24 commits, working tree clean,
`local == origin/main` at `91f809c`.**

---

## 1. Nav and footer links are full sentences — BUG, found in a screenshot

**Mine. Introduced by the navbar-section-anchor change on 14 Oct.**

    Home · Our Signature Bowls · Born in Tokyo and raised in Melbourne.
    · Late Night Opening Hours

`labelFor()` in `site.js` uses the section **title**, but AI titles are
complete headlines. "Born in Tokyo and raised in Melbourne." is not a nav
label. Shows on any site with an `about` or quote section.

Reproduced on a live publish — screenshot at
`%TEMP%/opencode/shots/wiz-live.png`.

**Not diagnosed yet, so measure first.** Likely fix: trim to a short label,
and let the Menu panel's label field (which already exists) carry it. Do not
guess the trimming rule — decide what a nav label should be before coding it.

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