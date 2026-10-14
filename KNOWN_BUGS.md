# Known bugs

Found by real-user testing on 2026-10-14. Every entry says how it was
reproduced, because a bug report that cannot be reproduced cannot be proven
fixed.

**Status:** all OPEN unless a line says otherwise. Fix one at a time, commit
each fix separately, and update this file in the same commit.

---

## 1. Every 404 renders as raw JSON — OPEN

**Seen as:** `{"error":"not found"}` with Chrome's JSON viewer, on an ordinary
page load.

**Cause:** `@app.errorhandler(404)` in `app.py` returns `jsonify(...)` for
*every* 404, not just API ones. Any mistyped or stale URL — a `/site/...`
link from an old publish, a project that was deleted, a typo — dumps JSON at
the visitor instead of a page.

This is also the root of the earlier "publishing not found" report, which was
twice logged as unreproducible. It was never about publishing.

**Fix:** content-negotiate on `request.path`. JSON only when the path starts
`/api/`; otherwise return an HTML 404 page. Same for `page_html()`, which has
the same problem for a missing `.html`.

---

## 2. Colours picked with the swatch are silently thrown away — OPEN

**Seen as:** "you can't properly change the colours."

**Cause:** Chrome's colour picker includes an **opacity slider**, and once it
is touched the input reports **8-digit hex**. `DESIGN.parseColour` accepts
only 3- or 6-digit hex, so it returns `null` and the colour is discarded
with no message.

Reproduced directly:

```
parseColour("#B04A26")   -> #b04a26
parseColour("#B04A2680") -> null      <- what Chrome actually sends
parseColour("#B04A26FF") -> null
```

**Fix:** accept 4- and 8-digit hex in `parseColour`, apply the RGB part and
ignore alpha, because the app has no transparency model and silently
discarding a chosen colour is worse than ignoring its opacity. Add a test
covering every digit count, including the ones that must still be refused.

---

## 3. The colour picker opens in the top-left corner — OPEN

**Seen as:** the picker appears far from the swatch, over the left sidebar.

**Cause (measured):** the swatch is correctly placed at `x=1148, y=367` with
no transformed ancestors. But `#stylesPanel` is `position: sticky` with
`overflow: auto`, and Chrome anchors the native colour popup to the viewport
when the input sits inside a sticky scroll container.

**Not fixable with `<input type="color">`** — the placement is the browser's,
not ours. Trying to scroll or focus the input does not move it.

**Fix:** stop depending on the native dialog as the only route. Render an
in-panel colour picker anchored to the swatch, and keep the native one as a
secondary "more colours" option.

---

## 4. No way to confirm a colour — OPEN

**Seen as:** "you can't even see a button for enter."

**Cause:** the native picker has no confirm step. There is nothing to click
to say "this is the colour I want", and nothing that tells you the value has
been accepted.

**Fix:** the in-panel picker from bug 3 ends in an explicit **Apply**, with
Cancel alongside it. This is why 3 and 4 are one piece of work.

---

## 5. An opacity slider is offered for a model that has no transparency — OPEN

**Seen as:** "why is the transparency on picking a colour like that."

**Cause:** the native picker shows an opacity slider. The app has no
transparency concept anywhere — brand colours, section colours and the
footer colours are all opaque — so the control can only produce a value the
app then rejects (bug 2).

**Fix:** solved by bug 3's in-panel picker, which has no alpha control, plus
bug 2 so a pasted 8-digit value is not thrown away.

---

## 6. The Menu cannot add anything, and has no custom links — OPEN

**Seen as:** "you can't even add, you can't even link it."

**Cause:** the "Add to the menu" control only lists *pages* that are not
already in the menu. When every page is in it, the control disappears
entirely — measured: with 2 pages and both in the menu, `#navAddTop` does not
exist in the DOM. There is also no way to add a link that is not a page,
which is something WordPress menus allow and users expect.

**Fix:** always render the add control. Add a **Custom link** option taking a
label and a URL, stored alongside page-backed entries in `plan.nav`, and
rendered as a real `href`.

---

## 7. Dropdowns close the instant they are clicked — NOT REPRODUCED

**Seen as:** "when I click it, it disappears right away."

**Measured:** zero DOM mutations occur when `#footCols` is clicked, so the
panel is *not* being re-rendered underneath the dropdown. The markup,
handlers and ordering look correct.

**Why not confirmed:** Chrome's native `<select>` popup is drawn by the OS
and does not exist in the DOM, so headless Playwright cannot observe it
closing. This one needs the exact steps from the person who saw it.

**Do not "fix" this until it can be reproduced.** Two other things in this
file looked like bugs and were not; guessing here risks breaking selects
that work.

---

## 8. Export ZIP is a button that does nothing — OPEN

**Seen as:** clicking it says only "Prototype: ZIP export runs through the
Flask backend (Phase 2)".

**Cause:** `#zipBtn` is wired to a toast. It is a real button in the
publish page that cannot do the thing its label promises.

**Fix (immediate):** disable it and label it honestly, so nobody waits for a
download that will never arrive. Implementing export properly is separate
work and should be scoped as such.