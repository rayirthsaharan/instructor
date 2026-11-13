# Instructor - User Flows and Screen Specs

Status: **v1.** Owner: `ui-ux-designer`. Tokens and components are defined in `docs/DESIGN_SYSTEM.md` (referred to as DS). Data names (`step.checkpoint`, `unreadablePages`) refer to the Guide contract in `docs/ARCHITECTURE.md` section 4 as amended by its section 10. Aligned with D-007, D-009, D-010, D-015 (sections 3, 4 and 10.3) and D-016 (10.1). M2 review rulings (2026-11-12) are in sections 1, 5, 6.2, 6.3, 8 and 9.

Layout references: **375** (`sm`), **768** (`md`), **1280** (`lg`). Page numbers shown to users are `pageIndex + 1`.

## 1. Primary journey

```
Library --(Add a manual)--> Capture --(Analyse)--> Processing --(done)--> Guide overview + prep
   ^                                                                            |
   |                                                                     (Start / Continue)
   |                                                                            v
   +---- Completion <--(last step done)-- Step player <--> Assistant sheet
                                              |  ^              |
                                              v  |              v (citation)
                                          Original viewer <-----+
```

1. **Library**: first visit shows the empty state with one action, "Add a manual".
2. **Capture**: PDF or page photos; reorder/remove photos; "Analyse".
3. **Processing**: honest stages at its own URL; the user may leave, refresh or come back later.
4. **Overview + prep**: what you are making, time, people, phases; tick off tools and parts; "Start".
5. **Step player**: one step per screen until the last step.
6. **Assistant** and **Original viewer**: overlays over the player; closing either returns to the same step, same zoom.
7. **Completion**: finished; anything skipped is listed.

Routes: `/` Library, `/new` Capture, `/d/[documentId]` Processing (resumable, D-009), `/g/[id]` Overview, `/g/[id]/play` Player. Player state lives in the URL so back/refresh/share-to-self work: `?step=<stepId>`, overlays as `&panel=ask | steps | original` and `&page=<n>`. The browser Back button closes the top overlay first, then leaves the player.

History rule (confirmed at the M2 review): **step changes replace the history entry; opening an overlay pushes one.** Browser Back therefore never walks back through steps - a 24-step job must not leave 24 entries between the user and the Overview, and "previous step" already has a 56px button, a swipe and a key. Closing an overlay with its own close button goes back one entry (it does not push another).

Global chrome: there is no persistent navigation bar. Library is home; every other screen has a single back affordance in its header. The player has its own chrome (section 6).

---

## 2. Library (home) `/`

Purpose: resume fast, or start a new manual.

**Content hierarchy**
1. Wordmark "Instructor" (`display-md`) and Primary button "Add a manual".
2. "Continue" hero: the most recently used unfinished guide (only if one exists): first-page thumbnail, title, segmented progress, "Step 7 of 24 - <step title>", Primary "Continue".
3. "Your guides" list: Guide cards (DS 7.2) sorted by last used. Each: thumbnail (first page, 3:4), title, meta (`body-sm`: "24 steps - about 90 min"), progress ring or state, overflow menu ("Open overview", "Delete").
4. Footer note (`body-sm`, `ink-muted`): "Guides are saved on this device."

**Layout**

| Width | Layout |
|---|---|
| 375 | Single column, 16 gutter. Header row: wordmark left, 44 icon button "+" right. Continue hero is a full-width card with a 56px Primary. List = stacked horizontal cards (thumbnail 64x85 left). "Add a manual" also appears as a full-width Secondary under the list. |
| 768 | 24 gutter. Header shows the labelled Primary. Hero: thumbnail left (160 wide), text right. List = 2-column grid. |
| 1280 | Content max 1200, centred. Hero spans 8 columns with the "Add" dropzone-style tile in the remaining 4 (accepts file drops and goes straight to Capture with the files). List = 3-column grid of vertical cards (thumbnail on top). |

**Interactions**
- Card tap: unfinished guide -> player at the saved step; not started -> Overview; finished -> Overview. "Continue" -> player.
- Delete: confirm dialog "Delete this guide? The guide and the uploaded manual will be removed from this device's library." Cancel / Delete. After delete: toast "Guide deleted" (no undo - files are removed).
- Processing card: tap -> `/d/[documentId]`. Failed card: tap -> the same URL, which shows its error state.

**States**
- Empty (first run): centred block: bracket-corner page icon, `display-lg` "Turn any manual into clear steps", `body-lg` "Add the PDF, or take photos of the paper booklet. We'll mark up the manual's own pictures, one step at a time.", Primary "Add a manual". Three one-line points below ("Check your parts first", "One step per screen", "Ask when you're stuck"). No sample data.
- Loading: 1 hero skeleton + 3 card skeletons.
- Error (list failed to load): Error banner "We couldn't load your guides." + "Try again". "Add a manual" remains available.
- Free-limit reached (configuration): "Add a manual" stays enabled; Capture explains the limit (section 3).

---

## 3. Capture `/new`

Purpose: get the pages in, in the right order, with specific errors.

**Content hierarchy**
1. Header: back to Library, title "Add your manual".
2. Dropzone (DS 7.9).
3. After files are added: for a PDF - one file row (name, pages, size, remove); for photos - the page-thumbnail grid with page numbers, plus an "Add more pages" tile.
4. Tip line (`body-sm`): "Photograph each page flat, in good light, one page per photo."
5. Sticky footer: Primary "Analyse manual" (`lg`), with helper "12 pages" beside it.

**Layout**

| Width | Layout |
|---|---|
| 375 | Single column. Dropzone min-height 220 with "Take photos" (Primary) above "Choose files" (Secondary), both full width 56. Thumbnails 3 columns. Footer bar fixed above the safe area. |
| 768 | Dropzone 280 high; thumbnails 5 columns; footer bar fixed. |
| 1280 | Two columns: dropzone/thumbnails (8 cols), right column (4 cols) holds "What works best" tips and the Analyse button (not fixed). Whole page accepts drops. |

**Interactions**
- "Take photos" opens the camera through the file input (`capture="environment"`); each shot is appended. "Choose files" opens the picker (PDF, JPEG, PNG, HEIC, WebP; multiple).
- One PDF **or** photos, not both. Adding a PDF when photos exist (or the reverse) asks: "Replace the photos with this PDF?" Cancel / Replace.
- Reorder by drag, or tile menu "Move earlier / Move later"; remove with the tile's remove button (toast "Page removed" + Undo).
- "Analyse manual" is disabled until at least one valid file is present; helper explains: "Add a PDF or at least one page photo."
- On Analyse: upload begins; rows show determinate progress; when the upload is accepted, navigate to `/d/[documentId]` (replace the history entry, so Back goes to the Library, not to a spent form).

**States and exact error copy** (Error banner above the dropzone, the rest of the screen stays usable; rejected files are not added)

| Problem | Message |
|---|---|
| Unsupported type | "That file type isn't supported. Use a PDF, or JPEG, PNG, HEIC or WebP photos." |
| Too large | "That's over the 40 MB limit. Try a smaller PDF, or photos of the pages instead." |
| Too many pages | "This manual has 84 pages. The limit is 60. If your product is one section of it, upload just those pages." |
| Password-protected PDF | "This PDF is locked with a password. Remove the password, or take photos of the pages." |
| Corrupt / unreadable file | "We couldn't open that file. It may be damaged. Try downloading it again or use photos." |
| Upload failed (network) | "The upload stopped. Check your connection." + "Try again" (keeps the selected files) |
| Too many uploads (`rate_limited`, HTTP 429 or 503) | "Too many uploads in a short time. Wait a little, then try again." + "Try again" (keeps the selected files) |
| Monthly quota used (`quota_exceeded`, config, off by default) | Info banner: "You've used this month's free guides." |
| Anything else | "The upload didn't go through. Try again." + "Try again" (keeps the selected files) |

`rate_limited` and `quota_exceeded` are different situations and never share copy (D-015):
- **`rate_limited`** is temporary. Error banner; the selected files stay; "Analyse manual" stays enabled, so the user can simply try again. The copy names no duration: the server's wait varies from seconds to minutes and a stated time would be a guess.
- **`quota_exceeded`** will not clear by retrying. Info banner (not an error: nothing went wrong), no "Try again"; the selected files stay visible; "Analyse manual" is disabled and its helper repeats the banner sentence. No payment UI in MVP.

Error banner labels (`label`, DS 7.12 "label names the problem"), in table order: "FILE TYPE NOT SUPPORTED", "FILE TOO LARGE", "TOO MANY PAGES", "PDF IS LOCKED", "COULDN'T OPEN FILE", "UPLOAD STOPPED", "TOO MANY UPLOADS", and "UPLOAD FAILED" for anything else. The Info banner has no label.

The tip line ("Photograph each page flat...") is about photos: hide it once a PDF is selected.

Loading: thumbnails show skeleton tiles while the browser decodes/converts (HEIC). Empty: the dropzone itself.

---

## 4. Processing `/d/[documentId]`

Purpose: honest progress for about a minute; safe to leave.

The URL is the job's identity. Opening it at any time (refresh, Back, Library card, another tab) renders the job's **current** state from the server: running -> the stage list at the real stage; finished -> redirect (replace) to `/g/[id]`; failed or rejected -> the matching state in section 10. No state is held only in the page.

**Content hierarchy**
1. First-page thumbnail (120 wide, 3:4) with bracket corners.
2. `display-lg` "Reading your manual" (failed state: "We couldn't finish your guide" - the title must not claim work is still going on).
3. Stage list (DS 7.14), driven only by the job's real stage and progress. It has exactly one row per stage the API reports (D-015), so a row never turns "done" for work the server did not report:

   | Row | API stage(s) | Detail line (`body-sm`), only while the row is active |
   |---|---|---|
   | "Reading pages" | `ingest`, `render` | "Page 8 of 20" once the rendered-page count is known; otherwise none |
   | "Finding parts and building steps" | `analyse` | none |
   | "Double-checking" | `verify` | "Comparing numbers and part labels with the original" |
   | "Finishing" | `publish` | none |

   Finding parts and building steps is one row because it is one stage; it is not split to look busier. Queued (not started): all four rows pending, and "Reading pages" carries the detail "Waiting to start" - no row is shown active until the server reports a stage.
4. `body` note: "This usually takes about a minute. You can leave this page - we'll keep going."
5. Quiet button "Back to library".

No percentage bar and no invented time countdown: the stage list is the progress. No tips carousel.

**Layout**: one centred column at every width (max-width 480). The screen has no header bar; "Back to library" (item 5, or the action inside the error banner when failed) is its single back affordance. 375: thumbnail above title, content top-aligned at 48 from the top of the viewport. 768 / 1280: vertically centred block; thumbnail left of the title at 1280.

**Interactions**: none required. When the job finishes, navigate (replace history entry) to the Overview. If the user left, the Library card flips to "Ready" and a toast appears if the app is open: "Your guide is ready" + "Open".

**States**
- Known manual (content-hash match): no stage list is shown; go straight to Overview with toast "We already know this manual - your guide is ready."
- Loading the job state: stage-list skeleton (4 rows). Document not found / not owned by this session: "This manual isn't on this device." + "Back to library".
- Rejected, failed, partially unreadable: see section 10.
- Connection lost while polling: info banner "Reconnecting... your manual is still being read." Polling resumes silently.
- Slow (stage unchanged > 60s): detail line under the active stage "Still working - long manuals take longer." If the row already has a detail, the two are joined: "Page 8 of 20. Still working - long manuals take longer." Nothing else changes.

---

## 5. Guide overview and prep `/g/[id]`

Purpose: "Can I start, and what am I in for?"

**Content hierarchy**
1. Header: back to Library; overflow (Original manual, Delete guide).
2. Eyebrow (`label`): "HERE'S THE PLAN". Title (`display-xl`): `guide.title`. Summary (`body-lg`): `guide.summary`.
3. Facts row - three tiles with icon, value (`display-md`), caption (`body-sm`): time ("About 90 min" from `estimatedMinutes`), people ("2 people" from `peopleNeeded`), difficulty (3 dots filled 1-3 plus the word: "Easy" / "Moderate" / "Demanding").
4. Notices, in this order when present: **safety-critical** notice (`guide.safetyCritical`: Warning banner "This job involves safety-critical work. Follow the original manual's warnings exactly. If you're unsure, stop and get a qualified person." with a checkbox "I understand" - rules under Interactions); **unreadable pages** banner (section 10.2); authority note (DS 7.12 Info), which here carries the one-time provenance key as a second sentence (DS 7.16).
5. **Before you start** - readiness line ("7 of 12 checked" / "Everything checked" / "1 part marked missing"), then two groups:
   - "Tools" - Checklist rows (DS 7.4) from `tools[]`; `included: false` shows "Not in the box - you need your own" in `body-sm` `ink-muted` (a sentence, not a stamped label: never the mono `tag` face).
   - "Parts" - Checklist rows from `parts[]`: thumbnail = crop of `part.source`, name, `manualLabel`, "x`quantity`". Tapping the thumbnail opens the Part sheet with a larger crop and "Show in manual".
6. **The steps** - phase outline: each phase as a row (title, "6 steps", done count, trailing chevron: right when closed, down when open; `aria-expanded`); expands to its step titles (rows as in the Step rail). Tapping a step opens the player there. Without the chevron the row reads as a static card.
7. Sticky footer: Primary (`lg`) "Start" - or "Continue at step 7" when progress exists, or "Review steps" when finished.

**Layout**

| Width | Layout |
|---|---|
| 375 | Single scrolling column. Facts row = 3 equal tiles. Checklist rows full-bleed with 16 inset. Footer bar fixed with the Primary full width; readiness line repeated above the button in `body-sm`. |
| 768 | Column max 640 centred. Facts tiles larger. Footer bar fixed, button max 400 centred. |
| 1280 | Two columns: left (7 cols) title, summary, facts, notices, phase outline; right (5 cols) sticky "Before you start" card containing the checklist (own scroll, max-height viewport minus 160) and the Start button at its bottom. No fixed footer. |

**Interactions**
- Tick a row: toggles "got it"; saved immediately (optimistic); survives reload.
- Row overflow -> "I'm missing this" (section 10.4) / "Show in manual" (Original viewer at `part.source`).
- "Check all" Quiet button per group (desktop and tablet only; on mobile it sits in the group's overflow) - for people who counted from the paper list.
- **Start is never blocked by an incomplete checklist.** If items are unchecked, Start opens a small confirm sheet: "You haven't checked 5 items. Start anyway?" Secondary "Back to checklist" / Primary "Start anyway". With everything checked (or on Continue) it goes straight to the player.
- **Safety acknowledgement** (`guide.safetyCritical` only). It is a one-time notice before the first step, not a lock:
  - Shown and required only while the guide has **no progress** (no step opened or completed). Until it is ticked, "Start" is disabled with the helper line (`body-sm`, above the button) "Tick "I understand" above to start."; tapping a step in the phase outline does not open the player - it scrolls to the checkbox, focuses it and shows the same helper.
  - Once progress exists ("Continue at step N", "Review steps") the banner stays but the checkbox is **not rendered** and nothing is gated: the user already acknowledged it, and the warnings themselves are on every affected step.
  - The tick is page state only; it is not persisted. Reloading before starting asks again, which is harmless. A direct `/g/[id]/play` URL is not gated.

**States**
- Loading: skeleton for title (2 lines), facts row, 6 checklist rows.
- No tools or no parts listed in the manual: the group shows "The manual doesn't list any tools." (or parts). Nothing is invented.
- Part without `quantity`: no quantity tag. Part without `manualLabel`: no label tag. Part without a source region: no thumbnail; row keeps a "p. 3" tag.
- Error loading guide: full-screen Error banner "We couldn't open this guide." + "Try again" + "Back to library". Guide not found / not owned: "This guide isn't on this device." + "Back to library".
- Save failed (checklist): the tick stays, a toast says "Couldn't save - we'll retry", retry silently; after 3 failures an inline Error banner with "Try again".

---

## 6. Step player `/g/[id]/play` - the heart of the product

### 6.1 Design conditions
The phone is propped against a box, 50-70 cm away, portrait or landscape. One hand, sometimes one knuckle, sometimes dirty. The user glances, works for a minute, glances again. Therefore:
- The **picture and the instruction** are readable without touching anything.
- The only thing that must be tapped per step is one large button at the bottom.
- Nothing required sits in the top third; top-bar items are conveniences.
- A stray touch must never lose the user's place: no destructive gestures, every navigation is reversible with one tap.
- The screen stays awake (Wake Lock on by default while the player is open).

### 6.2 Anatomy (portrait, 375 x 667 reference)

```
+-------------------------------------+
| [x]  STEP 7 OF 24 - FRAME   [>)][:] |  Top bar 48
| ====== ====----- -------- -----     |  Segmented progress 6 (+8 padding)
+-------------------------------------+
|                                     |
|   SOURCE VISUAL (DS 7.10)           |  Visual stage: 42% of viewport height
|   brackets, callouts      [Marks]   |  (min 240, max 360), edge to edge,
|   [p. 12]            [-] [+] [Fit]  |  sticky under the top bar
+-------------------------------------+
| (irreversible / warning banners)    |
| Attach the side panel               |  Step title  display-md
| Push the 4 dowels into the holes    |  Instruction  glance (22/30)
| on the long edge of panel A.        |
| [x4 o Dowel 101350] [x1 o Panel A]  |  Part and tool chips (wrap)
| +- YOU'LL KNOW IT'S RIGHT WHEN ---+ |  Checkpoint block
| | Each dowel stands about 1 cm... | |
| +---------------------------------+ |
| > Why this matters                  |  Disclosures (collapsed)
| > Common mistake                    |
| > Explain it more simply            |
+-------------------------------------+
| [ < ]  [   Done - next step   ] [=] [?] |  Action bar 56 + 12 padding + safe area
+-------------------------------------+
```

**Top bar** (48, `surface`, bottom hairline): Close (icon, to Overview; `aria-label="Leave guide"`), counter `label` "STEP 7 OF 24" with the phase title after a dot (truncates; phase drops first), Read-aloud icon button (speaker; `aria-pressed`), overflow menu: "Original manual", "Keep screen on" (switch), "Read each step aloud automatically" (switch), "Guide overview". Segmented progress (DS 7.5) directly below.

**Visual stage**: Source visual. Sticky so the picture never scrolls away while reading. If the text panel is scrolled, the stage shrinks to 30% height (transition `dur-base`; reduced motion: instant) and restores on scroll to top.

**Text panel** (scrolls; bottom padding = action bar height + 24). Fixed order - the order is safety-driven and must not be rearranged:
1. Irreversible banner (if `step.irreversible`).
2. Warning banners: severity `warning` before `caution`, manual order within each (all of `step.warnings`, never collapsed; the manual's wording is shown verbatim per DS 7.12).
3. Missing-part banner (if the step uses a part marked missing; section 10.4).
4. Low-confidence banner (if `confidence: low`).
5. Step title (`display-md`, `h1`).
6. Instruction (`glance`). This is Instructor's wording of the step.
7. Provenance slot, directly under the instruction (DS 7.16); omitted when empty: the **Source quote** "FROM YOUR MANUAL" (if `step.sourceQuote`; when the quote equals the instruction it collapses to the one-line source line, DS 7.16 "Never the same words twice"), then the "Read from the picture" tag (if `interpretedFromDiagram`).
8. Parts and tools for this step (Part chips; label `label` "FOR THIS STEP"). Quantity = `partsUsed[].quantity`; omitted if absent. A chip whose part is marked on the picture carries the same number as its callout (DS 7.3); chips have no thumbnail.
9. Checkpoint block (if `checkpoint`). The checkpoint text appears exactly once; when it is the manual's own sentence the block says so with a source line instead of repeating it (DS 7.15).
10. Disclosures: "Why this matters" (`why`), "Common mistake" (`commonMistake`), "Explain it more simply". Each is shown only if it has data, except "Explain it more simply", which is always present. The first two carry the caption from DS 7.16 inside their content.
11. Quiet link "Show original page".

`confidence: medium` shows no marker (noise would train users to ignore the low marker). Low only.

**Action bar** (`surface`, `elev-1`, top hairline, 12 padding, 8 gaps, all controls 56 high):
- **Back** (icon button 56, Secondary style): previous step. Disabled on step 1.
- **Primary** (flex, min 150): "Done - next step". Marks the step complete and advances. On the last step: "Done - finish". If the step is already complete: "Next step" (and a small check + "Done" tag sits beside the step title; the overflow offers "Mark as not done").
- **Steps** (icon button 56): opens the Step rail sheet.
- **Ask** (icon button 56, `accent` icon on `accent-soft`): opens the Assistant.

At 320 width the Steps button moves into the top bar counter (the counter itself becomes the button) so the Primary keeps >= 150.

**The Primary label never wraps to two lines.** Where the full label does not fit on one line the short form is used; `aria-label` always carries the full label:

| Full label | Short form | Short form is used |
|---|---|---|
| "Done - next step" | "Done" + trailing arrow-right icon | `landscape-compact` |
| "Next step" | "Next" + trailing arrow-right icon | `landscape-compact` |
| "Done - finish" | "Finish" | `landscape-compact` |
| "I checked - done" | padlock + "I checked" | all of `sm`, and `landscape-compact` |

The Ask button is `accent` icon on an `accent-soft` fill at every width (no border); it is the only tinted control in the bar. On `lg`, while the dock is open, it is a toggle in its selected state: `accent` fill, `on-accent` icon and label, `aria-expanded="true"`, `aria-controls` = the dock; pressing it again closes the dock. The button does not move when the dock opens - it stays in the action bar under the step content, even though the dock is the left column (section 7); the dock's own close button is the nearby way out. Wherever the sheet is used instead (below `lg`, or a window under 560 tall) the sheet covers it, so it has no selected state there.

### 6.3 Layout by width

| Width | Layout |
|---|---|
| **375 portrait** | As 6.2. Visual edge to edge (radius 0). |
| **Phone landscape** (`landscape-compact`, e.g. 667x375) | Common when propped. Top bar collapses to a 6px progress bar across the full width plus a 44 "x" overlaid top-left of the visual. Two columns: visual left 56% full height; right 44% holds a 44 compact header (the counter, which is the Steps button as at 320; read-aloud; overflow - right-aligned), then the text panel (scrolls) with the action bar pinned at its bottom (Back 56, Primary flex with short labels per 6.2, Ask 56; no Steps button). Instruction stays `glance`. |
| **768** | Top bar 56. Visual stage 48% of viewport height, inset 24 with radius `md`. Text panel max-width 640 centred. Action bar: content max-width 640 centred; Back and Steps get text labels ("Back", "Steps"), Ask labelled "Ask". Step rail and Assistant open as sheets (max-width 560). |
| **1280** | Three regions under a 56 top bar (Close and counter left; read-aloud and overflow right-aligned at the 32 margin, as at 768 - never floating after the counter). **Left**: Step rail permanently visible, 280 wide, own scroll, 12 top padding before the first phase header. **Centre**: visual stage, fills remaining width and full height minus bars, radius `md`, 24 padding. The stage here is taller than most step regions, so the view shows the bracketed region with the rest of the page around it - this is intended (DS 7.10 layer 2: fit is always "contain", never a hard crop); the dim wash does the focusing. **Right**: text panel 420 wide, own scroll, with the action bar pinned at its bottom (Back / Primary / Ask - no Steps button). Between 1024 and 1199 the rail collapses to a 64 icon strip (status markers and numbers; expands on hover/focus). **When the Assistant is open the dock takes the rail's place in the left column** (section 7 "Desktop dock": 320 / 360 / 400 wide); the right column - text panel and action bar - is not touched in any way, and the centre gives up the difference in width. While the dock is open the top-bar counter is the Steps button. |

### 6.4 Interactions

| Action | Touch | Keyboard / pointer |
|---|---|---|
| Complete and advance | Tap Primary | `Enter` or `Space` on Primary; `Ctrl/Cmd+Enter` anywhere |
| Next / previous without completing | Swipe left / right on the text panel, or on the visual at 1x. Threshold: 64px horizontal travel and under 30 degrees from horizontal, or a fling over 0.5 px/ms | `ArrowRight` / `ArrowLeft` (when focus is not in an input or the zoomed visual); `PageDown` / `PageUp` |
| Jump | Steps button -> rail -> tap row | Rail is a list; `Home` / `End` first / last. On `lg` with the dock open: the top-bar counter button opens the rail as a panel (section 7) |
| Zoom / pan | Per DS 7.10 | Per DS 7.10 |
| Link picture and part | Tap callout or part chip | Tab to either, `Enter` |
| Read aloud | Tap speaker | `R` |
| Ask | Tap Ask | `/` or `A` (dock already open: moves focus to the composer) |
| Original page | "Show original page", or the visual's "Original page" button | `O` |
| Leave | Close | `Esc` closes the top overlay; if none, focuses Close (does not leave) |

- **Completing vs navigating**: swipes and arrows only move. Only the Primary marks a step done. This lets users peek ahead without corrupting progress.
- **Step change**: DS "Step change" motion. Focus moves to the step title; the text panel scrolls to top; the visual resets to the new step's region with a Snap; zoom resets. Screen readers hear "Step 8 of 24: <title>".
- **Undo**: after "Done - next step", a toast "Step 7 done" with "Undo" (8s) returns to step 7 and unmarks it.
- **Haptics** (where supported): 10ms on Primary; double pulse when arriving on an irreversible step.
- **Read-aloud** (speech synthesis): speaks, in order, "Careful: this step can't be undone" (if irreversible), each warning, the title, the instruction, then "You'll know it's right when" + checkpoint. Speaker icon shows a playing state; tap to stop; changing step stops speech (and restarts on the new step only if automatic mode is on). If speech synthesis is unavailable the control is hidden.
- **Keep screen on**: requested on entering the player and again when the tab becomes visible. If unsupported or refused, the switch is shown off with the helper "Your browser can't keep the screen on. Set your phone's auto-lock to a longer time."
- **Explain it more simply**: opening the disclosure requests a simpler wording (cached per step). Loading: 3 skeleton text lines (90%, 80%, 60% wide) - not one solid block, which reads as a missing picture. If no safe simpler wording exists: "This step is already as simple as we can safely make it." (no label, no note). Result appears under the label "SIMPLER WORDING" with the note "Same step, simpler words. Numbers and part names are unchanged." Error: "Couldn't get a simpler version." + "Try again". The original instruction always stays visible above. Only the instruction is reworded: warning banners, the irreversible banner and the Source quote are never simplified and stay exactly as shown.
- **Progress is saved** on every step change and completion (optimistic). If a save fails: silent retry; after 3 failures a toast "Progress isn't saving - check your connection". Local state is kept and re-sent.
- **First run** (first player open on this device): one dismissible coach line above the action bar for step 1 only: "Swipe or use the arrows to look around. Tap Done when you've finished a step." No multi-screen tutorial.

### 6.5 Irreversible steps ("check before you continue")
The irreversible thing is the physical act, so the treatment arrives **before** the instruction is acted on and does not hide it:
1. On the step before: the Primary reads "Done - next step" as usual, but a one-line notice sits above the action bar: padlock + "Next step can't be undone".
2. On arrival: double haptic; Irreversible banner first in the text panel; the top bar's progress hairline and the action bar's top border turn `danger-fg` (2px); the step rail shows the padlock. Read-aloud leads with the notice.
3. The Primary becomes **"I checked - done"** (Danger-outlined Secondary style with padlock icon until tapped; a normal tap, no hold - a hold gesture is unreliable on a propped phone).
4. No modal, and no invented checklist: the banner text is fixed generic copy plus the manual's own warnings and the step's checkpoint.

### 6.6 States

| State | Treatment |
|---|---|
| Loading guide | Skeleton: progress bar track, visual stage skeleton with bracket corners, 1 title line, 3 instruction lines, action bar with disabled controls |
| Step image loading | Visual skeleton only; text and action bar are live immediately (step data loads once per guide) |
| Step image failed | Visual error state (DS 7.10) with "Try again"; a note under the instruction: "The picture didn't load. You can still open the original manual." |
| No region / invalid region | Full page shown, tag "Whole page shown" |
| Step with several sources | Pager on the visual "1 / 2", opening on `sources[0]`. Pages = the step's `sources` in order, then any page referenced only by a highlight. Each highlight is drawn on the page of its own `highlight.source` (never assumed to be `sources[0]`). Selecting a part chip whose highlight is on another page switches the pager to that page |
| Approximate region (`regionFallback: true` on the step source or a highlight's source) | Dashed brackets and the "Approximate area" tag (DS 7.10, 7.16); the crop gets extra padding. No banner |
| Step has no parts / tools | The "FOR THIS STEP" group is omitted |
| Low confidence | DS low-confidence visual state + banner; rail flag |
| Offline | Info banner under the top bar: "You're offline. Steps you've opened still work; asking questions needs a connection." The Ask button is unchanged (no offline dot - cut in the M3 review: the banner and the disabled composer already say it) |
| Guide load error | Full-screen: "We couldn't open this guide." + "Try again" + "Back to library" |
| Unknown `?step` | Open at the saved step and toast "That step isn't in this guide - showing where you left off." |
| All steps done, user re-enters | Opens at step 1 in review mode: Primary reads "Next step"; top bar tag "Finished" |

---

## 7. Assistant sheet (`&panel=ask`)

Purpose: answer from the manual, about this step, without losing the step.

Revised after the M3 review of the built UI (2026-11-12); aligned with D-019 and D-020. Desktop dock moved to the left column on 2026-11-13 (M4 ruling; replaces D-021 item 1, D-022 item 7 and D-027 item 1).

**Content hierarchy**
1. Header: title "Ask about this step", close button.
2. Context strip (sheet only - the dock has none; non-scrolling, 64 high): 48x48 thumbnail of the current step's visual + "STEP 7" (`label`; not "ABOUT STEP 7" - that wording belongs to the conversation divider directly below, and the two must not read as a repeat) + step title (1 line, truncates). Trailing **safety tag** when the step has one (`tag`, radius `xs`, padding 2 8, icon 16): irreversible -> padlock + "Can't be undone" (`danger-fg` on `danger-soft`); otherwise, with warnings -> triangle + "1 warning" / "2 warnings" (`warn-fg` on `warn-soft`). Irreversible wins when both apply. The sheet is modal and covers the step's banners, so the strip says they exist. Tapping the strip closes the sheet (back to the step); `aria-label="Step 7: <title>. 1 warning. Close and go back to the step"`.
3. Conversation (per guide, scrolls, newest at bottom). Quiet "Clear conversation", right-aligned, is the first item of the scroll area when there is history (confirm dialog: "Clear this conversation?" / "Your questions and the answers for this guide will be removed." / Danger "Clear" + "Cancel"). A divider with the Context tag "ABOUT STEP 7" is inserted whenever the user asks from a different step than the previous message.
4. Suggested-question chips (shown when no question has been asked on this step yet): "What does this mean?", "Which piece is this?", "Why am I doing this?".
5. Composer (DS 7.13), pinned to the bottom above the keyboard.
6. Footnote under the composer (`body-sm`, `ink-muted`): "Answers come only from your manual."

**Layout**

| Width | Layout |
|---|---|
| `sm`, `md`, `landscape-compact` (everything below 1024 wide), **and any window under 560 tall** | Modal bottom sheet (DS 7.7), opens at the `full` detent (the keyboard needs the room; a `half` detent would leave about two lines of conversation above the keyboard). Full width on `sm`; centred, max-width 560 on `md`. The context strip keeps the step and its safety tag in view. One presentation below `lg` (M3 ruling): the earlier right-hand panel for 768 and for landscape is dropped - 6.3 already specified sheets at 768, and in landscape a 44% column plus the keyboard leaves no usable conversation area. |
| `lg` (>= 1024 wide) and >= 560 tall | **Desktop dock**, below. Not modal, no scrim. |

**Sheet or dock - the whole rule.** `window width >= 1024 and window height >= 560` -> dock; anything else -> sheet. It is decided from the window size alone, on open and on resize. It never depends on the step, on its banners or on any measured content: the same window always gets the same presentation on every step. If a resize crosses the line while the assistant is open, the presentation switches in place - conversation, scroll position and composer draft are kept, and focus goes to the composer if it was inside the assistant. The 560 floor is about chat room only (top bar and progress 70 + dock header 56 + chips, composer and footnote up to about 250 leave under 180 for the conversation below that height); it is no longer a safety rule, because the dock cannot cover a banner.

**Desktop dock** - the assistant takes the place of the **step rail** (the left column). The step content is not part of the dock and the dock never touches it: the text panel (banners, title, instruction, provenance, parts, checkpoint, disclosures) and the action bar under it stay in the right column at 420, at full size, with the same scroll position, exactly as when the assistant is closed. Nothing is repeated in the dock, so there is nothing to keep in step and nothing to fit.

```
+-- top bar 56: [x] [STEP 5 OF 10 - BUILD THE FRAME v]            [>)] [:] --+
+-- segmented progress -------------------------------------------------------+
| Ask about this step [x] |                        | (irreversible banner)    |
+-------------------------+                        | (warning banners)        |
| conversation (scrolls)  |   SOURCE VISUAL        | Step title               |
|                         |   (unchanged, live:    | Instruction              |
|                         |    zoom, marks,        | FOR THIS STEP chips      |
|                         |    callouts)           | Checkpoint               |
| [chip] [chip]           |                        | Disclosures              |
| [chip]                  |                        +--------------------------+
| [ composer      ] [send]|                        | [Back] [ Done - next ]   |
| Answers come only ...   |                        |                  [Ask *] |
+-------------------------+------------------------+--------------------------+
   DOCK (replaces rail)        CENTRE (fills)          TEXT PANEL 420 (untouched)
```

Column widths (the centre takes what is left; the text panel is 420 in every case):

| Window width | Rail (dock closed) | Dock (open) | Centre, closed -> open | Centre padding, open |
|---|---|---|---|---|
| 1024-1199 | 64 icon strip | **320** | 540 -> 284 (at 1024); 715 -> 459 (at 1199) | 12 |
| 1200-1439 | 280 | **360** | 580 -> 500 (at 1280) | 24 |
| >= 1440 | 280 | **400** | 740 -> 620 (at 1440) | 24 |

The widths are fixed steps, not fluid. 280 (the rail's own width) is too narrow for the chat - about 28 characters of `body-lg` per line - so the dock is wider than the rail and the centre pays for it. At 1024 the picture is narrow (260 of image after padding) but still whole, live and zoomable, and closing the dock is one key away.

**Dock anatomy**, top to bottom. `surface`, 1px `line` right border (the rail's border), from under the progress bar to the bottom edge of the window - there is no action bar under the dock:
1. Header, 56 high, bottom hairline, padding 0 8 0 16: title "Ask about this step" (`display-md`, `h2`), close icon button 44 (`aria-label="Close the assistant"`).
2. Conversation: fills the rest, min-height 120, the dock's only scroller, padding 16, `overscroll-behavior: contain`. Content as "Content hierarchy" item 3.
3. Suggested-question chips (when shown): padding 12 16 0, wrap, gap 8.
4. Composer row: padding 12 16 0, input + Send 48, gap 8.
5. Footnote: padding 4 16 16.

There is **no context strip, no step summary, no banners, no toggle row and no safety tag** in the dock: the step is on screen beside it. The "ABOUT STEP n" divider in the conversation stays.

**Safety rule, and why it now holds without a check.** A step's warning and irreversible banners are in the text panel, and the dock neither covers, resizes, scrolls nor re-renders the text panel. So with the dock open the banners are exactly as visible as with the assistant closed - on every step, at every window size that gets the dock. Engineering must keep that property literal: opening, closing or using the dock must not change the right column's width, height, scroll position or content. The Primary keeps its label rules ("I checked - done" on irreversible steps, 6.5) and the irreversible border colours on the bars stay.

**Steps while the rail is hidden**
- While the dock is open the rail (and the 64 strip) is not rendered. The **top-bar counter becomes the Steps button**, as it already is at 320 and in `landscape-compact`: same text, plus a trailing chevron-down 16; height 44; hover `surface-sunken`; focus ring; `aria-haspopup="dialog"`, `aria-label="Steps. Step 5 of 10, Build the frame"`. With the dock closed it is plain text again (the rail is on screen).
- It opens the Step rail (DS 7.6) as a **modal left panel over the dock**: same width as the dock (320 / 360 / 400), from under the top bar to the bottom of the window, `surface-raised`, `elev-2`, scrim over the rest, header "Steps" + close 44, current row scrolled to centre and focused. Choosing a row goes to that step and closes the panel; `Esc`, the close button or the scrim close it without moving. On close, focus returns to the counter button (after choosing a row: to the step title, as any step change). The dock, its conversation and its draft are untouched underneath.
- Back, the Primary, `ArrowLeft` / `ArrowRight`, `PageUp` / `PageDown` and swipes work as always (arrows not while focus is in the composer, 6.4).
- **Step change with the dock open** (any route): the text panel and the visual change as in 6.4 - the text panel scrolls to its top, which puts the new step's banners first in view. The conversation and any draft in the composer stay; the next question is about the new step. Focus stays in the composer if it was there, otherwise moves to the step title. The step is announced as in 6.4.
- **"Step n" citation chip**: goes to that step with the dock open. Because the rail is not there to show the move, the confirmation is the counter, the text panel and the picture changing together. The chip that was pressed disappears (a chip citing the current step is omitted, DS 7.11), so focus moves to the step title like any other step change; `/` or `A` returns to the composer.

**DOM, landmarks and focus**
- DOM order equals visual order, left to right: top bar, **dock**, visual, text panel, action bar. The dock sits in the rail's position in the DOM - the rail is unmounted (or `hidden`) while the dock is open, never merely moved off screen. Not after the action bar: the tab order would then jump from bottom-right to top-left (DS section 8 rule 4).
- The dock is `<aside aria-labelledby="its h2">` (a complementary landmark), not a dialog: no `aria-modal`, no focus trap, no scrim, the rest of the page is not `inert`. The step title stays the page's only `h1`, so screen-reader users reach the step by heading or by the main landmark, and the chat by the complementary landmark.
- Tab order: top bar (Close, Steps counter, read-aloud, overflow) -> dock (close, conversation's chips and links in order, suggestion chips, composer, Send) -> visual controls -> text panel -> Back, Primary, Ask. Tabbing forward from Send therefore leads through the picture and the step to the Primary.
- **Focus on open: the composer** (the dock is for keyboard-and-pointer devices; `/` then typing must work without another key). The composer's accessible name is "Ask a question about step 5". The sheet keeps focusing its title (DS 7.7).
- Close (dock close button, `Esc` while focus is inside the dock, or the Ask toggle): the rail returns; focus goes to Ask. `Esc` with focus outside the dock keeps its 6.4 meaning and does not close the dock.
- Answers are announced as in DS 7.13 (once, polite); nothing else in the dock is live.

**Opening and closing - no animation.** Rail out and dock in happen in one frame, both ways: no slide, no fade, no width transition. The centre column changes width in the same frame; the picture is re-fitted to the step's region at the new width (if the user had zoomed or panned, the zoom level and the centre point are kept). The Steps panel appears and leaves with a `dur-fast` opacity fade together with its scrim (no slide - it does not travel from anywhere meaningful). Reduced motion: no change needed for the dock; the Steps panel follows the 80ms rule.

**Toast** while the dock is open: bottom-left of the **centre** column (inset 24, 80 above the column's bottom so it clears the picture's page tag and zoom controls; max-width = column width - 48), not the window's bottom-left, where it would cover the composer.

**Removed by this ruling** (delete, do not hide): the pinned step summary in the dock (banner copies, toggle row, collapsed instruction and checkpoint, the 44% cap, the summary scroller); the split right column; the chat minimums of 200 / 240; and the fits-or-sheet fallback of D-027 item 1 - the dock no longer measures itself or reports to the player, and no step is ever sent to the sheet because of its banners.

Rejected: a modal side panel (blocks changing step and zooming while asking); the dock in the right column over the step text with a pinned summary (M3: duplicated banners needed a height fallback that sent most banner steps to the sheet at 1280x600, 1024x768 and 1280x720); narrowing the text panel at 1024-1199 to give the picture more room (it would reflow the banners at the moment the dock opens and break "the dock never touches the step column"); a 280 dock that leaves the picture unmoved (chat lines too short to read).

**Interactions**
- Tapping a suggestion chip sends it.
- **Send**: on a keyboard-and-pointer device (`not (pointer: coarse)`) `Enter` sends and `Shift+Enter` is a new line. On touch (`pointer: coarse`) `Enter` is a new line and only the Send button sends - a propped phone must not send a half-typed question. The on-screen keyboard's key must match: `enterkeyhint="enter"` on touch, `"send"` otherwise.
- After Send on touch the composer is disabled and the keyboard closes, so the answer has the whole sheet.
- **Stop** replaces Send while an answer is being prepared. Stop discards the partial answer (unverified text is never kept, D-019) and keeps the question: under the user's bubble, `body-lg` `ink-muted` "You stopped this answer." + Quiet "Ask again". Nothing is saved for a stopped turn.
- **Citations are two chips** (DS 7.11): "Step 4" goes to that step (sheet: closes the sheet first; dock: the dock stays open, see "Steps while the rail is hidden"); "p. 4" opens the Original viewer at the cited page and region **over** the sheet or dock. Closing the viewer returns to the conversation with its scroll position kept. The viewer has no "Go to step" footer (removed: the Step chip does it).
- No per-message rating in the MVP ("Helpful" / "Not helpful" is cut: no endpoint and nobody to read the data).
- Composer limit: 1000 characters. A counter ("1000 / 1000", `tag`, `ink-muted`, right-aligned under the input) appears within the last 100; input stops at the limit.

**States**
- Empty: context strip (sheet only), one line "Stuck on this step? Ask in your own words.", chips.
- Loading history: 2 message skeletons. History failed: `body` `ink-muted` "Couldn't load your earlier questions." + Quiet "Try again"; the composer still works.
- **Preparing an answer** (DS 7.13 "Answer in progress"): provisional text plus a visible status line - "Looking in your manual..." until the first words arrive, then "Checking this against your manual..." until the answer is verified (text after the first number is held back until then, D-019), and "Still checking. This can take up to a minute." after 20 s. The screen must never show a half sentence with no sign of work.
- Complete: per DS 7.13.
- **Not in manual** (D-020): whenever an answer is not grounded or has no valid citation it is replaced by the fixed message - there is no separate "couldn't point to the manual" caution line and no uncited answer state. Block per DS 7.13: label "NOT IN YOUR MANUAL", fixed text "I couldn't find this in your manual, so I won't guess. Check the original manual or ask the manufacturer.", Quiet "Open the original manual" (Original viewer at the first source page of the step the question was asked about, no brackets). No citations.
- Error: inline `danger-fg` "That didn't go through." + Quiet "Try again". Assistant unavailable: "The assistant isn't available right now. Try again in a little while." + "Try again".
- Rate-limited: info banner "You're asking quickly. Wait a little, then try again." + Quiet "Try again". Another answer still running in this session (D-020 item 5): info banner "Still answering your last question. Wait for it to finish, then try again." + "Try again".
- Offline: composer and chips disabled with helper "You're offline. Questions need a connection."; history is readable.
- No message-limit state (cut: the server keeps the last 200 messages per guide, D-020 item 8, and never refuses a question for count).

---

## 8. Original viewer (`&panel=original&page=n`)

Purpose: the unaltered manual, always reachable, returning to the same place.

**Content hierarchy**
1. Header: close ("Back to step 7" as text on `md`+, icon on `sm`), "Page 12 of 20" (`tag`), "Marks" toggle (shown only when opened with a region).
2. Page stage: the full page, zoom and pan as DS 7.10 (same component, full-page mode). When opened from a step or a citation, the region is bracketed and the view starts fitted to the whole page (context first), with the brackets emphasised (4px) for 2s - no pulse animation. In the viewer the page is shown at full strength: **no dim wash** (this is the unaltered manual; DS 7.10 full-page mode). Brackets, region tint and callouts are drawn and "Marks" hides them. The stage's own page tag ("p. 12") is not shown here - the header already says "Page 12 of 20".
3. Page navigation: previous / next buttons (56 on `sm`), and a thumbnail strip.
4. Unreadable pages (`unreadablePages`) carry a warn tag "We couldn't read this page" on the page and on its thumbnail.

**Layout**

| Width | Layout |
|---|---|
| 375 | Full-screen overlay (`surface-sunken`). Header 48. Stage fills. Bottom bar 56 + safe area: previous, page counter (tap opens a thumbnail grid sheet, 3 columns), next. |
| 768 | Full-screen. Thumbnail strip along the bottom (72 high tiles, horizontal scroll, current outlined in `accent`). |
| 1280 | Full-screen overlay with a left thumbnail column (160 wide, vertical scroll) and the stage to the right. Entering from the player keeps the top bar of the viewer only. |

**Interactions**: swipe left/right at 1x or arrows to change page; `Esc` or Close returns to exactly the prior state (step, text scroll, zoom, open assistant sheet). Changing pages clears the region brackets (they belong to one page) and hides the Marks toggle. Focus returns to the control that opened the viewer.

The overlay covers the whole viewport including any scrollbar gutter (`position: fixed; inset: 0`); no strip of the player may show beside it and no control may be clipped by it. Thumbnails that have not loaded are `surface-sunken` skeleton tiles, never blank white tiles (white reads as an empty page). The thumbnail grid sheet (375) opens at the `half` detent when the document has 9 pages or fewer, otherwise `full`.

**States**: page loading (skeleton page at the page's aspect ratio); page failed ("Couldn't load this page" + "Try again"); single-page document (no navigation controls); opened without a region (no brackets, no Marks toggle).

---

## 9. Completion

Shown after "Done - finish" on the last step (a view within the player route; refreshing a finished guide's player URL without `?step` shows it again).

**Content hierarchy**
1. Segmented progress, fully `success`. Static: no completion animation.
2. Success check disc (56) and `display-xl` "Finished." then `body-lg`: "You completed all 24 steps of <guide title>."
3. **Skipped steps** (only if any step is not marked done): Warning-styled card "2 steps aren't marked done" with a list of those steps (rail rows, tappable -> player at that step). In this case the title is "Not finished yet." (true whether 1 or 9 steps remain; "Almost there." was wrong when most steps were skipped), the `body-lg` line is "You've done 3 of 24 steps of <guide title>.", and the check disc is replaced by a 56px progress ring (4px stroke, track `line`, fill `accent`) with the count "3/24" in `tag` centred inside. The ring is never drawn smaller or without the count: a small bare arc reads as a loading spinner.
4. **Missing parts reminder** (only if any part is still marked missing): list of the parts and "Needed in steps ...".
5. Authority note: "Keep the original manual - it has the care, warranty and safety information."
6. Actions: Primary "Back to library"; Secondary "Review the steps" (player at step 1, review mode); Quiet "Open original manual".

No confetti, no ratings prompt, no invented claims ("your wardrobe is ready to use").

**Layout**: one centred column, max-width 480 (375: top-aligned at 64, buttons full width 56; 768: vertically centred, buttons stacked full width 56; 1280: vertically centred, Primary and Secondary side by side at 50% each (height 48), the Quiet link centred on its own line below). Button labels never wrap at any width.

**States**: skipped-steps variant and missing-parts variant as above; save failure -> toast per 6.4, screen still shows.

---

## 10. Edge flows

### 10.1 Rejected: not a manual
Trigger: the pipeline reports the document is not instructions.
The Processing URL (`/d/[documentId]`) shows this state instead of the stage list, also on a later visit: page icon with a "?" bracket, `display-lg` "This doesn't look like instructions", `body-lg` "We look for manuals and step-by-step guides - for example assembly or setup instructions. This file seems to be something else.", Primary "Try a different file" (-> Capture, empty), Quiet "Back to library". No guide is created. No override ("analyse anyway") in v1.

**The Library keeps a card for it (D-016 item 2)**, so the user can see what happened to the upload and remove it. This applies to rejected uploads here and to failed ones (10.3):
- Card (DS 7.2, failed state): first-page thumbnail, the file name or "Untitled manual" as title, and a state line in `body-sm` with the danger icon - rejected: "Not a manual"; failed: "Couldn't finish - Try again". No progress ring, no step meta.
- Tap: opens `/d/[documentId]`, which shows this state (or the 10.3 state).
- Overflow menu: one item, "Delete". Same confirm dialog as a guide, with the sentence "Delete this upload? The file will be removed from this device's library."; toast "Upload deleted".
- These cards sort with the others by last used and never appear in the "Continue" hero.
- "Try a different file" does not remove the card; only Delete does.

### 10.2 Unreadable page(s)
Trigger: `guide.unreadablePages` is not empty; the guide is still produced.
- Overview: Warning banner (Caution style) "We couldn't read page 7. Steps from that page may be missing. Check it in the original." For several: "pages 7, 8 and 12". Actions: Quiet "View page 7" (Original viewer) and Secondary "Start again with new photos" (PDF uploads: "Start again with a new file").
- "Start again with new photos" (D-009; replacing single pages is out of MVP): opens Capture (`/new`) **empty**, with an Info banner "Add every page again, including page 7. Your current guide stays in your library." It is an ordinary new upload: a new document and a new guide. Nothing is pre-filled, the current guide and its progress are untouched, so no confirm dialog is needed.
- Player: no per-step marker (the data cannot say which steps are affected). The Original viewer tags the page (section 8).
- If **every** page is unreadable the job fails instead (10.3) with the message "We couldn't read these pages. Try photos in brighter light, with each page flat and filling the frame."

### 10.3 Failed analysis
Trigger: job status failed.
Processing screen: the title becomes "We couldn't finish your guide"; the failed stage row gets the danger marker; stages before it stay done, stages after it stay pending. The "about a minute" note and the standalone "Back to library" are removed. Below the list: Error banner (label "COULDN'T FINISH") with a stage-specific message. Actions inside the banner: the Primary in the table, then Quiet "Back to library".

| Failed at (row, section 4) | Message | Action |
|---|---|---|
| Reading pages | "We couldn't read this file's pages." | "Try again" / "Use a different file" |
| Finding parts and building steps | "We couldn't build a guide from this manual. This is on our side." | "Try again" |
| Double-checking, Finishing | "We built the steps but couldn't verify them against the original, so we haven't shown them." | "Try again" |
| Repeated failure (3rd) | Adds: "It's still not working. Your manual is saved; try again later." | "Back to library" (Primary; no "Try again") |

"Try again" restarts from the failed stage (stages are idempotent); the list resumes, it does not restart from the top. The Library shows the failed card (10.1, D-016) until a retry succeeds or the user deletes it. An unverified guide is never shown.

### 10.4 Missing part
1. Overview checklist -> row overflow -> "I'm missing this". The row becomes Missing (DS 7.4) and lists "Needed in steps 4, 9" (all steps whose `partsUsed` include the part). Undo via the same menu ("I found it").
2. Readiness line: "1 part marked missing". Under it, one sentence computed from the data: "You can do steps 1-3 before you need it." (steps before the first affected one; if the first step needs it: "You need it from the first step.").
3. Start is not blocked; the Start confirm sheet says "1 part is marked missing. Steps 4 and 9 need it."
4. Player: affected steps show a Missing-part banner (Caution style): "You marked Cam lock (B) as missing. This step needs 4." with Quiet "I found it". Part chip shows the Missing state; rail rows show the warn flag. The Primary still works.
5. No advice on substitutes or where to buy: not in the manual.
6. Completion lists parts still marked missing.

Stored in `progress.checklist_json` as a per-item state: `unchecked | have | missing`.

### 10.5 Resume
- Progress (current step, completed steps, checklist) is saved continuously; identity is the device session.
- Library "Continue" and unfinished-card taps open the player directly at `current_step`, with toast "Picking up at step 7". Overview's Primary reads "Continue at step 7".
- Opening `/g/[id]/play` with no `?step` resolves to the saved step; with `?step`, the URL wins.
- If the saved step id no longer exists (guide re-analysed under a new schema): open at the first not-done step and toast "We updated this guide - check where you are."
- A guide with all steps done opens to Completion from "Continue", and to review mode from the rail.
- Session lost (cookies cleared, other device): the Library is empty; no recovery in MVP. The Library footer note sets this expectation.

## 11. Open questions
Resolved by D-009 and now reflected above: highlights carry their own page; severity is `caution | warning`; Processing lives at `/d/[documentId]`; "Replace and re-analyse" is replaced by "Start again with new photos".

Still open (for the engineer / orchestrator):
1. Is `warning.text` always the manual's wording, or can it be a normalised or translated version of `sourceQuote`? DS 7.12 handles both cases; confirm which occurs.
2. Resolved at the M2 review: the checkpoint can carry its own manual quote, and the UI handles all three cases (DS 7.15). Confirm the field name in `docs/ARCHITECTURE.md`.
3. "Start again with a new file" is this spec's label for PDF uploads; D-009 names only the photo wording.
