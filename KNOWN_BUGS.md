# Known bugs

Found by real-user testing on 2026-10-14. Every entry says how it was
reproduced, because a bug report that cannot be reproduced cannot be proven
fixed.

**Status:** 6 of 8 fixed. Remaining: **6** (Menu cannot add / no custom
links) and **8** (Export ZIP is a stub). Both have a stated fix below.

Fix one at a time, commit each separately, update this file in the same
commit.

---

## 1. Every 404 renders as raw JSON — FIXED

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

**Done.** `_wants_json()` checks the path first, then the `Accept` header, so
a `curl` to `/api/...` gets JSON whatever it sends and a browser navigation
gets a page with a message and a link back. `/site/...` is untouched and keeps
its own "This site isn't published" wording. Covered by
`t_a_browser_gets_a_page_and_an_api_caller_gets_json`.

---

## 2. Colours picked with the swatch are silently thrown away — FIXED

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

**Done.** `parseColour` now takes 3, 4, 6 and 8 digits. Four- and eight-digit
forms keep the colour and drop the alpha. Five and seven digits are still
refused, as is everything that is not a colour at all — a looser pattern here
would turn a typo into a black swatch. Covered by
`t_an_eight_digit_colour_is_not_thrown_away`, which asserts through the real
field and on to the rendered page rather than only calling the parser.

*Note for whoever does bug 3:* this removes the *silent failure*, not the
confusion. The opacity slider is still offered by the browser and still means
nothing here, and there is still no Apply button.

---

## 3. The colour picker opens in the top-left corner — FIXED

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

**Done.** `static/js/picker.js`. The swatch is now a `<button>` that opens a
picker positioned from the swatch's own box in JS — it flips above when there
is no room below and is clamped so it can never leave the window. Measured:
it opens 36px below the swatch. The native input stays in the DOM, hidden,
only so the picker can offer **More colours** for the eyedropper.

---

## 4. No way to confirm a colour — FIXED

**Seen as:** "you can't even see a button for enter."

**Cause:** the native picker has no confirm step. There is nothing to click
to say "this is the colour I want", and nothing that tells you the value has
been accepted.

**Fix:** the in-panel picker from bug 3 ends in an explicit **Apply**, with
Cancel alongside it. This is why 3 and 4 are one piece of work.

**Done.** Apply commits; Cancel discards; Enter applies and Esc closes. Both
halves are tested, because a picker that can only commit is worse than no
picker — there is no way back from a colour chosen by mistake.

---

## 5. An opacity slider is offered for a model that has no transparency — FIXED

**Seen as:** "why is the transparency on picking a colour like that."

**Cause:** the native picker shows an opacity slider. The app has no
transparency concept anywhere — brand colours, section colours and the
footer colours are all opaque — so the control can only produce a value the
app then rejects (bug 2).

**Fix:** solved by bug 3's in-panel picker, which has no alpha control, plus
bug 2 so a pasted 8-digit value is not thrown away.

**Done.** There is no alpha anywhere in `picker.js` — deliberately. The test
asserts the picker contains no range input at all, so an opacity control
cannot quietly reappear.

---

## 3b. Colour controls are 34x30 — FIXED

Not reported, found by the responsive audit on the day the picker landed: the
new chip inherited the size of the input it replaced, which is under the 44px
touch bar. Fixed by growing the chip itself on coarse pointers rather than
padding it, since padding a button enlarges its box but not its hit area.

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

## 7. Dropdowns close the instant they are clicked — FIXED

**Seen as:** "when I click it, it disappears right away." Later detail, which
turned this from unreproducible into obvious: **you have to long-press to open
it, and it vanishes the moment you lift your finger.** Nothing could ever be
selected.

**Cause.** Chrome closes a native `<select>` popup the instant the element it
is anchored to is replaced in the DOM. A document-level handler in
`editor.js` was replacing it:

```
editorui.js:824  EditorUI.footerPanel   rebuilds the panel's innerHTML
builder.js:387   renderPanel
builder.js:559   onSelectionChange
editor.js:188    Editor.select(null)
editor.js:670    document click handler   <-- the cause
```

That handler exists to clear the toolbar when you click away from a section.
It bailed out only for `.ss-sec` and `.block-toolbar`, so **clicking any
side-panel control counted as clicking away.** That ran `Editor.select(null)`,
which fired `onSelectionChange`, which re-rendered the panel, which replaced
the very `<select>` being opened.

Why it needed a long press: on a touchscreen that is simply how a `<select>`
opens. The `click` that fires on release then destroyed it. On a mouse it
looked intermittent, which is why it survived the first round of testing.

**Fix.** Anything the user can operate is not "away". The handler now also
bails for `.builder-panel`, `.builder-rail`, `.builder-top`, `.modal` and
`.toast-host`.

**Verified** by node identity, not by appearance: the same `<select>` element
is still in the document after a long press (node swaps went 1 -> 0), and the
dropdown still commits its value. That is
`t_panel_controls_survive_being_clicked`.

*Lesson worth keeping:* this was on the list as NOT REPRODUCED because a
normal click produced zero mutations. It was not unreproducible — it was
reproducible only through a path nobody had tried. Asking the person who saw
it for the gesture was worth more than another hour of guessing.

---

## 8. Export ZIP is a button that does nothing — OPEN

**Seen as:** clicking it says only "Prototype: ZIP export runs through the
Flask backend (Phase 2)".

**Cause:** `#zipBtn` is wired to a toast. It is a real button in the
publish page that cannot do the thing its label promises.

**Fix (immediate):** disable it and label it honestly, so nobody waits for a
download that will never arrive. Implementing export properly is separate
work and should be scoped as such.