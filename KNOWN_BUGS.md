# Known bugs

Found by real-user testing on 2026-10-14. Every entry says how it was
reproduced, because a bug report that cannot be reproduced cannot be proven
fixed.

**Status: all 8 fixed.** Each is one commit, with its own test.

What real-user testing was worth, in one line: four of these were invisible
to a passing test suite and found only by a person using the thing. The
suite had been 9/9 green throughout.

---

## Lessons worth keeping

**A control that cannot do what its label says is a bug.** Two of these
were the same mistake pointing in opposite directions. Export ZIP looked
working and answered with the word "backend". The publish page claimed
publishing was "simulated in the browser until the Flask backend connects" -
which was false, and made working functionality look unfinished. Half-finished
features deserve labelling. Finished ones do not deserve an apology.

**Ask what the person actually did.** Bug 7 was marked NOT REPRODUCED. "The
dropdown disappears when I click it" was unreproducible; "you have to
long-press and it vanishes when you let go" identified it in one exchange.

**Look at the output.** Every bug here that had a visual symptom was found
by looking at a screenshot rather than by reading code.

---

## 16. Dragging a section works once, then nothing — FIXED (measured)

**Reporter:** the site owner, "sometimes it don't work sometimes it works".

**Measured (2026-10-24):** the first reorder of every session worked, 6 of 6
fresh loads, and every drag *after the first successful reorder did nothing
at all* — ten presses in a row, each verified to land on the grip, against a
re-created instance that was healthy by every outward test
(`options.disabled === false`, `Sortable.active === false`). Healthy face,
dead tap.

**Cause:** Sortable clears its module-level `dragEl` in `_nulling()`, which
only runs at the very end of its own `_onDrop`. Our `onEnd` fired *inside*
that drop handler and synchronously called `render()` → `wireSortable()` →
`sortable.destroy()` — tearing the instance and its list down mid-drop. The
uncleaned state survives into every instance created afterwards, because
they share one module closure; tap-start sees the stale `dragEl` and
silently returns. The first drag always works because state was clean
before it.

**Repro probe:** fresh AI plan, then reorder attempts on the second
section's grip, press verified by `elementFromPoint` against the grip each
time. Before the fix: attempt 0 moves, attempts 1-9 die mid-flight with
chosen/ghost classes never reappearing. After the fix: 8 consecutive
reorders, all landing. Two non-reorders in the post-fix runs were the press
missing the grip after a scroll (`inGripBox: false`), not drag failures.

**Fix:** `builder.js` `onEnd` defers the splice, render and autosave past
the drop (`setTimeout(..., 0)`) so Sortable finishes its own bookkeeping
before the DOM is rebuilt.

---

## Closed

1. Every 404 rendered as raw JSON
2. Colours chosen with the swatch were silently discarded
3. The colour picker opened in the top-left corner
4. There was no way to confirm a colour
5. An opacity slider was offered for a model with no transparency
6. The Menu could not add anything, and had no custom links
7. Dropdowns closed the instant they were clicked
8. Export ZIP was a button that did nothing

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

## 6. The Menu cannot add anything, and has no custom links — FIXED

**Seen as:** "you can't even add, you can't even link it."

**Cause:** the "Add to the menu" control only lists *pages* that are not
already in the menu. When every page is in it, the control disappears
entirely — measured: with 2 pages and both in the menu, `#navAddTop` does not
exist in the DOM. There is also no way to add a link that is not a page,
which is something WordPress menus allow and users expect.

**Fix:** always render the add control. Add a **Custom link** option taking a
label and a URL, stored alongside page-backed entries in `plan.nav`, and
rendered as a real `href`.

**Done.** The page dropdown is always rendered — disabled, with an
explanation, when there is genuinely nothing to add, because a select that
says so is information and an invisible one is not. A Custom link fieldset
sits below it with its own validation.

**The validation is the security-relevant part.** A menu href is the one
place a user types a URL that goes straight into an `href` on a finished
document served from our origin. The publish endpoint strips `<script>` and
event handlers but cannot see inside an attribute, so `javascript:...` would
have survived into a live page. `SS.safeHref` allows only `http`, `https`,
`mailto` and `tel`, and normalises a bare domain to `https` because
`sable.example.com` is what people actually type.

Also added: a **delete** button on menu rows. There was none — a top-level
item could be reordered and hidden but never removed.

Three bugs of my own, all caught here: `items()` rebuilt each entry without
its `href`, so every custom link deleted itself on the panel's next read;
the duplicate-suppression map was marked *before* the duplicate test, so
every page-backed entry rejected itself and the home page dropped out; and
that map was shared with children, so a submenu pointing at a page also in
the menu rendered empty — caught by an existing test my change broke.

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

## 8. Export ZIP is a button that does nothing — FIXED

**Seen as:** clicking it says only "Prototype: ZIP export runs through the
Flask backend (Phase 2)".

**Cause:** `#zipBtn` is wired to a toast. It is a real button in the
publish page that cannot do the thing its label promises.

**Fix (immediate):** disable it and label it honestly, so nobody waits for a
download that will never arrive. Implementing export properly is separate
work and should be scoped as such.

**Done.** Disabled, labelled "Export ZIP — not built yet", with a note that
publishing already puts the site online. Left visible rather than removed,
so the feature is acknowledged and building it later is turning something on
rather than inventing it.

**And the opposite mistake, found by the test written for this one.** The
same page carried a visible line claiming publishing was *"simulated in the
browser until the Flask backend connects"*. That is false — publishing
writes the compiled document to the database and serves it from
`/site/<slug>` with no session, no JavaScript and real cache headers, and
the suite compiles, publishes and fetches it as an anonymous visitor on
every run. Removed.

The test asserts no part of the page still claims "prototype", "phase 2" or
"flask backend". That assertion is what found the second one; I was only
looking for the ZIP wording.

## 10. Every "Pages" link in the footer is dead — FIXED

**Seen as:** clicking **Home** in the footer of a published site does nothing.

**Reproduced:** publish any site, fetch `/site/<slug>`, collect every
`href="#…"` and every `id` in the document.

    Dead fragment targets:
      href="#home"  -> id present: False
      href="#"      -> id present: False

**Cause:** `footerHTML` emitted `href="#' + p.id + '"`, but nothing ever
emitted that id. Sections carry `data-sect="s_…"` — never `id` — so there
was no target anywhere on the page. The brand link was `href="#"`, which
merely jumps to the top.

This is also why my earlier claim that "sections already carry a stable id"
was wrong: that is true of the plan data, not of the compiled document. The
id is not emitted, so nothing on a published page can be linked to at all.

**Fix:** the footer resolves page links through the same `pageKey`/`pageBase`
logic the navbar already used — a published page is its own document, so a
link to another page has to be a real URL. `href="#"` is kept only for the
in-builder case, where the links are never followed. The footer brand now
points at the site's own base URL when published.

Verified on a live publish: footer reads
`Foot Co -> /site/ft-…`, `Home -> /site/ft-…`, and clicking it lands on a
page with its sections. No fragment targets are left dangling.

The test clicks the link rather than counting it — the old markup was
present and looked correct, so counting would have passed.

## 9. The pre-publish checklist passes placeholder text — FIXED

**Seen as:** a published page ending in a section reading

    Hero
    Big headline + one button at the top
    [ Get started ]

— and all four pre-publish checks showing a green tick.

**Reproduced:** register, wizard (type-card path), add one section from the
rail, publish. Fetch `/site/<slug>` and read it. Measured before the fix:

    CHECKLIST: all four ticked
      At least one page exists ✓  At least 3 sections ✓
      Homepage headline is written ✓  Every section has a title ✓

**Cause:** `publish.js` counted a section as written when
`s.title.length >= 2`. The text above is 35 characters long, so the scaffold
passed. A new section is seeded in `api.js` with the library's own
`SECTIONS[type].name` as its title and `SECTIONS[type].blurb` as its subtitle
— so the untouched state is *exactly* recognisable, and the check never looked
for it.

This is AGENTS.md rule 3 and rule 12 in one page: the assertion could pass
while the feature was broken, and the gate measured the shape of the data
rather than whether a person had written it.

**Fix:** a section is counted as placeholder when its title still equals
`SECTIONS[type].name` **and** its subtitle still equals
`SECTIONS[type].blurb`. New check: "No section is still showing placeholder
text", naming how many.

Verified both directions, because a check that fires on everything is as
useless as one that fires on nothing:

- rail-added section, untouched → "7 section(s) still show placeholder text",
  1 failing check
- AI-drafted site, untouched by hand → "No section is still showing
  placeholder text", 0 failing

**Advisory, not a gate.** The check reports but does not block publishing —
you may legitimately want a scaffold section live while you write it.

## 11. Two hero sections stack on one page — FIXED

**Seen as:** on a live publish, `g-hero` appeared twice in the section list,
both rendering full-width.

    g-hero s_mgo3dti
    g-hero s_ittov4r

**Cause:** `EditorUI.addSection` had no duplicate guard. The rail will add
any section type any number of times.

**Fix:** refuse a second hero on a page, with a toast saying why — a rail
card that does nothing on click reads as broken rather than deliberate.
Only the opener is a singleton: features, testimonials and menus stay
repeatable, which is correct and was verified not to have been caught by the
same rule.

Measured after the fix: clicking the hero card leaves the label list
unchanged and toasts "This page already has a hero at the top", while
clicking testimonials still goes 4 → 5.

**Scope note.** This does not prevent a hero being *moved* rather than added
— that is deliberate reordering, not a mistake, and blocking it would break
drag-to-position.

## 12. Every card in a section shows the same photo — FIXED

**Seen as:** a ramen site publishing three menu cards — "House special",
"Seasonal plate", "House classic" — all three loading one identical file.

    House special  ─┐
    Seasonal plate  ├─ photo-1552566626-52f8b828add9
    House classic  ─┘

**Reproduced:** publish, fetch `/site/<slug>`, count image srcs. Three
occurrences of one URL. Looked obvious in a screenshot; measured anyway,
because two near-identical URLs would have looked the same and needed a
different fix.

**Cause:** `cardsOf` took a single `fallbackImage` — `ctx.poolImage` — and
handed it to every card in the section. `poolImage` is derived from the
*section* index (`site.js`), so it is one image per section by
construction. Any card without its own photo therefore got the same one.

**Fix:** build a per-card spread from the same pool, offset by the section's
index so two sections do not start on the same photo either. An item that
*does* have its own picture still wins — only the fallback changed.

Measured after the fix, on a features section in the card-grid variant:

    Fast and reliable  2f8b828add9
    Made with care     e0d58224f24
    Here to help       7-4c7edcad34c4
    DISTINCT: 3 of 3

**A false measurement worth recording.** The first attempt to verify this
found **zero** `.ss-card` elements and I nearly read that as "already
fixed". It was not: the fixture's sections had all landed on list/row
variants, which render no cards at all. A check that measures nothing
passes silently — this one would have reported green while proving nothing.
The test therefore asserts on a variant that is known to render cards, and
first asserts that cards exist at all.

## 13. The navbar reaches none of the sections — FIXED

**Seen as:** a six-section site publishing a navbar reading

    Midnight Bowl -> /site/nav-628acc47
    Home          -> /site/nav-628acc47

Two entries, both pointing at the same address. Five of six sections
unreachable.

**Cause, two layers.** `plan.nav` entries could only target a **page**, and
SiteSketch generates a one-page site — so the menu collapsed to a single
link to the page you were already on. Underneath that, nothing on a
published page was linkable at all: sections carried `data-sect` but no
`id` (this is the same measurement recorded under bug 10, where it showed up
as dead footer links).

**Fix.**

1. Sections render with a real `id`, so a fragment has a target.
2. A nav entry may carry a `sectionId` as well as a `pageId`. It survives
   `navItems`, the Menu panel and a save/load round trip — the panel
   rebuilds each entry, and dropping the field there would silently turn
   every section link back into a page link the moment you renamed
   something else.
3. A one-page site with no saved menu now defaults to its own sections
   rather than to "Home". Their titles are already written, and this is what
   a brochure one-pager is. Sites with several pages are untouched.

`aria-current="page"` stays on the page link only. A section anchor is on
the same page, so marking every entry current would have been meaningless.

Measured on a live publish:

    Home                       /site/nav-7e99c1c8                aria-current=page
    Our signature bowls        /site/nav-7e99c1c8#s_gne0yzk
    Cooked slow and served...  /site/nav-7e99c1c8#s_1ch82rx
    Open late for hungry souls /site/nav-7e99c1c8#s_qowzrqi

    dangling fragments: []
    clicking the 3rd link scrolls to y=641

**A bug caught by measuring the builder, not the published site.** The first
version emitted `#home#s_gne0yzk` in the builder — two fragments, which
resolves to nothing. The published site was fine, so a test that only looked
at `/site/<slug>` would have passed. The builder is the in-place preview
and has to be checked separately.

## 14. The footer colour swatch lies about what is on screen — FIXED

**Seen as:** the Footer's Background swatch showing an empty white square
while the footer is dark. Reported twice, as "the footer colour does not
work" and "the selected colour does not appear in the box", and **not
reproducible for a long time** — driving the picker end to end showed the
chip, the painted colour and the page background all updating correctly.

**What finally made it reproducible:** a screenshot of the panel. The
measurement that had been missing was simply *what the swatch shows when
the value is inherited*, because the earlier probes had always clicked a
colour first.

    bgInput     = #ffffff        <- what the swatch claimed
    footPainted = rgba(0, 0, 0, 0) <- actually transparent, inheriting dark
    footColor   = rgb(241, 238, 232) <- cream text on that dark ground

**Cause:** with "Use theme" there is no stored value, and the footer panel
fell back to hardcoded `#ffffff` and `#1d4ed8`. `paletteColor(spec, key)` —
which resolves the real palette entry — existed already and was used by the
section panel two panels further down. The footer panel was simply never
updated when that helper was introduced. So the swatch promised white on a
dark footer: picking a colour then produced something that looked nothing
like the square that was clicked, which is the whole of the complaint.

**Fix:** use `paletteColor(spec, …)` in the footer panel, as the section
panel already does. Measured after:

    bgInput    = #f4f5f6
    resolvedBg = #F4F5F6     -> matches: True

**And a regression I caused while committing this, recorded because it is
the exact failure this project keeps hitting.** To keep one bug per commit I
temporarily reverted the footer fix with a PowerShell `String.Replace` and
restored it afterwards. The replace was unguarded, so it also rewrote
`#blockBg` and `#blockAccent` — the *section* panel, which had been correct
all along — and the navbar commit shipped that regression. A guarded edit
would have caught it; the same guard is used for the `cardsOf` call sites
precisely because this has happened before. Repaired in the commit that
follows.

## 15. Uploading an image hangs on "Uploading…" forever — FIXED

**Seen as:** "I uploaded an image yet I click it many times it don't do
anything." The dialog sits on **Uploading…** and never resolves.

**Reproduced:** POST /api/media directly. It does not return.

**Measured:**

    bucket GET -> 200 in 42.7s
    first upload  -> 201 in 83.5s
    second upload -> 201 in 43.0s
    list uploads  -> 200 in  0.5s

**Cause, two halves.**

1. `ensure_bucket()` ran on **every** upload. It is a network round trip to
   Supabase Storage that takes ~43s here, so every upload paid that before a
   byte was stored. The bucket is not un-created between requests, so it only
   ever needs checking once per process. Caching it took the first upload
   from 83.5s to 43.0s.
2. `uploadFile` used a bare `fetch` with no timeout and no visible failure,
   so however long the store took, the UI waited indefinitely. Now bounded
   at 90s and it says what happened instead of hanging.

**Not a full fix, stated plainly.** 43s is still far too slow for a user
clicking a button, and that remainder is the Supabase Storage round trip
itself, not our code. What is fixed here is the part we own: paying for a
bucket check on every upload, and failing silently.

**The other half of the report — "I click it many times it doesn't do
anything" — is the same bug, not a second one.** Picking an existing upload
works:

    tiles: 1  "Bloomfield Poster.png"
    img BEFORE: images.unsplash.com/photo-1544025162...
    img AFTER : ...supabase.co/storage/v1/object/public/...
    IMAGE CHANGED: True   modal closed   js errors: []

The repeated clicking was happening *during* the 83-second hang, before the
file had finished uploading, so there was nothing to pick yet. Worth
recording because "clicking an upload does nothing" and "the upload hangs"
look like two bugs and are one, and fixing only the second would have left
the report feeling unanswered.## 16. Deleting a plan needs several clicks and gives no feedback — FIXED

**Seen as:** "the deleting of plans is so buggy you have to click multiple
times for it to function well."

**Cause, two parts.**

1. The two-step confirm armed a state with **no CSS at all** — `.is-armed`
   appeared nowhere in the stylesheets. The first click set a `title`
   tooltip, which takes a second to appear and is easy to miss, so the
   click registered and nothing on screen changed. It looked like a dead
   button.
2. The armed state expired after **3 seconds**, silently. A two-step confirm
   asks you to read and then click, and 3s is shorter than that, so anyone
   who behaved as intended had their arm reset and had to start again —
   which is precisely the "click multiple times" report.

**Fix:** style `.is-armed` (filled error background, trash icon swapped for
a tick), lengthen the window to 8s, and update the `aria-label` while armed.

Measured: after one click the button computes
`background-color: rgb(163, 46, 27)`, trash `display: none`, tick visible,
and it is still armed at 5.4s. The second click deletes and toasts.

## 17. Picking a card image destroys the section — FIXED

**Seen as:** "the img you can select it but you cant change it, you cant even
use your own uploads."

**Reproduced:** build a site, add a features section, switch it to the card
grid, click a card's picture. The picker opens with 30 library tiles; choose
one and the picture does not change.

    card img BEFORE: photo-1552566626-52f8b828a
    modal open: True     LIBRARY tiles: 30
    card img AFTER : photo-1552566626-52f8b828a
    CARD IMAGE CHANGED: False

**It was much worse than "does not change".** Driving the same write
directly threw:

    TypeError: items(...).map is not a function
        at BLOCKS.menu (site.js:309)
        at SS.renderPage -> Editor.render

**Cause.** Every card and list row stores its picture under the path
`items:<n>:img` — `cardsOf` emits `path + ":" + i + ":img"`. `resolve()` did
not understand that shape:

    var index = parseInt(parts[0], 10);            // parseInt("items") -> NaN
    if (isNaN(index)) return { section: section, key: "items" };

so it returned a bare key, and `writeValue` fell through to its final
`else` and ran `section["items"] = url` — **replacing the whole items array
with a URL string**. The next render called `.map` on a string and threw,
which is what the user saw as "selecting does nothing": the page died before
it could repaint.

Worse, `setImage` ends in `Editor.onChange`, so autosave persisted the
corrupted section. Selecting a card image was silently destructive.

Section images were unaffected, which is why the feature looked like it
worked whenever it was driven from a section rather than a card.

**Fix:** `resolve()` handles `items:<n>:<field>`, and coerces a non-array
`items` back to an array rather than trusting it.

    card img AFTER : photo-1524758631624-e2822e
    CARD IMAGE CHANGED: True     js errors: []

**How it was found, because the first two attempts were bad tests.** One
clicked the *uploads* tab on an account with no uploads and read "0 tiles"
as a fault. Another asserted the card image changed after picking tile zero
— which may legitimately already be that photograph, so it could never fail
correctly. Only driving the write directly and reading the thrown error
found it. "Cannot reproduce" is sometimes "has not reproduced yet".
