# Instructor - Design System

Status: **v1.** Owner: `ui-ux-designer`. Screen specs live in `docs/USER_FLOWS.md`. Tokens here map 1:1 to CSS variables (Tailwind theme reads them).

## 1. Identity: "Chalk Line"

A carpenter snaps a chalk line to mark exactly where the work happens. Instructor does the same to a manual: it does not redraw it, it **marks it up**. The product looks like the original paper manual lying on a workbench, annotated by someone who knows the job.

Four rules carry the identity:

1. **Paper and graphite.** Warm off-white surfaces, near-black warm ink, hairline rules. No gradients, no glass, no decorative illustration. The only pictures are the manual's own pages.
2. **One marking colour.** Chalk blue is the only saturated colour in normal use. It means "look here / act here": highlights on the diagram, the primary action, focus, progress. Amber, red, green and violet appear only with their semantic meaning (section 2.3).
3. **Brackets, not boxes.** A marked region is framed by four corner brackets (like crop marks), never a tight outline or an arrow tip. The data gives coarse, panel-level regions; brackets say "look in this area" without claiming pixel precision.
4. **Workshop labels.** Part letters, quantities, page numbers and step counters are set in a monospaced face, like stamped labels on a parts bag. Everything a user must match against the physical world looks the same everywhere.

Voice: short, calm, second person, verbs first ("Push the dowel in until it stops"). Never cheerleading. Uncertainty is stated plainly ("We're less sure about this step").

## 2. Colour

Contrast ratios were calculated by hand with the WCAG 2.1 relative-luminance formula and rounded down to one decimal. **Engineer: add an automated contrast test over these token pairs; if any pair computes below the stated minimum, tell the designer rather than adjusting the value.**

### 2.1 Neutral and accent tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#F6F3EC` | `#141310` | App background ("bench") |
| `--color-surface` | `#FFFFFF` | `#1E1C18` | Cards, sheets, bars |
| `--color-surface-raised` | `#FFFFFF` | `#29261F` | Overlays (sheet, menu, toast in dark uses this) |
| `--color-surface-sunken` | `#ECE8DE` | `#0E0D0B` | Wells: visual stage letterbox, input track, skeleton base |
| `--color-ink` | `#1B1A17` | `#F2EEE4` | Primary text, icons |
| `--color-ink-muted` | `#5C584F` | `#B5AFA2` | Secondary text |
| `--color-ink-subtle` | `#8A857A` | `#8A857A` | Control borders, placeholder icons, disabled text. Never body text |
| `--color-line` | `#DDD8CC` | `#38342B` | Decorative hairlines and dividers only |
| `--color-accent` | `#1F4FD8` | `#8FB0FF` | Chalk blue: primary fill, links, focus, progress |
| `--color-accent-hover` | `#173FB3` | `#A9C2FF` | |
| `--color-accent-pressed` | `#12328F` | `#C2D4FF` | |
| `--color-on-accent` | `#FFFFFF` | `#0E1A3D` | Text/icon on accent fill |
| `--color-accent-soft` | `#E4EBFD` | `#1A2547` | Selected rows, active chip background |
| `--color-scrim` | `rgba(27,26,23,0.48)` | `rgba(0,0,0,0.60)` | Behind sheets and dialogs |

Contrast (text on background):

| Pair | Light | Dark |
|---|---|---|
| ink on bg / surface | 15.7 / 17.4 | 16.0 / 14.6 |
| ink-muted on bg / surface | 6.3 / 7.0 | 8.5 / 7.7 (6.9 on raised) |
| ink-subtle on bg / surface (non-text, needs 3.0) | 3.3 / 3.6 | 5.0 / 4.6 |
| accent on bg / surface | 5.9 / 6.6 | 8.6 / 7.9 |
| on-accent on accent | 6.6 | 7.9 |
| accent on accent-soft | 5.5 | not below 6 (verify in test) |

`--color-line` is below 3:1 on purpose: it must never be the only thing that identifies a control. Controls use `ink-subtle` borders.

### 2.2 Semantic tokens

Each meaning has three tokens: `-fg` (text and icons on surface or on its own soft background), `-soft` (banner/chip background), `-solid` (filled badge; text on it uses the stated on-colour).

| Meaning | Token stem | Light fg / soft / solid (on) | Dark fg / soft / solid (on) | Light fg on surface / on soft | Dark fg on surface / on soft |
|---|---|---|---|---|---|
| Warning (manual's cautions) | `--color-warn` | `#8A5300` / `#FFF1D0` / `#F2A900` (ink `#1B1A17`) | `#F5C04A` / `#3A2C0A` / `#F5C04A` (`#1B1A17`) | 6.3 / 5.6 | 10.1 / 8.1 |
| Irreversible step, danger, errors | `--color-danger` | `#B3261E` / `#FCE9E6` / `#B3261E` (`#FFFFFF`) | `#FF8A7A` / `#401612` / `#FF8A7A` (`#3A0A06`) | 6.5 / 5.5 | 7.4 / 6.8 |
| Success, completed | `--color-success` | `#1E6B3A` / `#E3F3E6` / `#1E6B3A` (`#FFFFFF`) | `#7FD49A` / `#12301C` / `#7FD49A` (`#0B2414`) | 6.5 / 5.6 | 9.5 / not below 7 |
| Low confidence, interpretation | `--color-unsure` | `#6B3FA0` / `#F0E8FA` / `#6B3FA0` (`#FFFFFF`) | `#C9A8F5` / `#2A1D42` / `#C9A8F5` (`#1F1233`) | 7.3 / 6.1 | 8.4 / not below 6 |

`--color-warn-solid` light (`#F2A900`) is only 2.0:1 against white: it is a fill for ink-coloured content (8.6:1), never a text or thin-line colour on light surfaces.

Colour is never the only signal. Each meaning has a fixed icon and a fixed word:

| Meaning | Icon | Label | Extra non-colour cue |
|---|---|---|---|
| Warning | triangle with "!" | "Caution" / "Warning" (by severity) | 4px left bar |
| Irreversible | padlock | "Can't be undone" | 2px full border + hatched 8px top strip |
| Success | check | "Done" | filled check disc |
| Low confidence | dashed circle with "?" | "Double-check with the original" | dashed border, dashed brackets on the diagram |
| Interpreted from diagram | eye | "Read from the picture" | uses `unsure` colours, solid border |
| Approximate region (`regionFallback`) | dashed square | "Approximate area" | dashed brackets on the diagram |

The `unsure` family is the single signal for "this is Instructor's reading, not the manual's own content". The opposite - the manual's exact words - has no colour: it is a neutral quote labelled "From your manual" (7.16).

### 2.3 Diagram-marking tokens

The manual page is **always rendered unaltered on white, in both themes**: no inversion, no tint, no filter. A recoloured diagram can misrepresent the source. In dark mode the page sits on `surface-sunken`, which frames it without changing it. Because the page is always light, marking tokens have one value for both themes.

| Token | Value | Use |
|---|---|---|
| `--mark-stroke` | `#1F4FD8` | Bracket stroke, 3px screen-constant (`vector-effect: non-scaling-stroke`) |
| `--mark-halo` | `#FFFFFF` | 1.5px halo outside the stroke (total 6px white under 3px blue) so brackets read on coloured or photographed pages |
| `--mark-fill` | `rgba(31,79,216,0.10)` | Tint inside a marked region |
| `--mark-fill-active` | `rgba(31,79,216,0.22)` | Region whose part chip or callout is selected |
| `--mark-dim` | `rgba(246,243,236,0.62)` | Wash over everything outside all marked regions. Content stays legible through it |
| `--mark-callout-bg` / `-fg` | `#1F4FD8` / `#FFFFFF` | Numbered callout disc (6.6:1) with 2px white ring |
| `--mark-unsure-stroke` | `#6B3FA0` | Dashed (6 on, 5 off) brackets for low-confidence steps and for any region with `regionFallback: true` |
| `--mark-cite-stroke` | `#1F4FD8` | Same brackets at 4px for the first 2s, then 3px, for a region opened from a citation (no pulse animation) |

Blue stroke on white is 6.6:1; the white halo guarantees at least that against any page content.

## 3. Typography

All three families are free web fonts (Google Fonts); self-host through `next/font` with `display: swap`, Latin subset, variable files.

| Role | Family | Fallback stack | Why |
|---|---|---|---|
| Display | **Bricolage Grotesque** (variable, 400-700) | `ui-sans-serif, system-ui, sans-serif` | Characterful, slightly condensed grotesque; reads like stencilled workshop signage at large sizes |
| Text | **Atkinson Hyperlegible Next** (variable, 400-700) | `system-ui, -apple-system, "Segoe UI", sans-serif` | Designed for legibility at a distance and at low vision; unambiguous l/I/1 and O/0, which matters for part labels |
| Label | **Atkinson Hyperlegible Mono** (400, 600) | `ui-monospace, "SF Mono", Menlo, monospace` | Part letters, quantities, page and step counters |

Scale (rem at 16px root; sizes respond to the user's browser font size, never set in px in CSS):

| Token | Family / weight | Mobile size / line | >= 1024 size / line | Tracking | Use |
|---|---|---|---|---|---|
| `display-xl` | Display 700 | 32 / 36 | 44 / 48 | -0.02em | Guide title on overview, completion |
| `display-lg` | Display 700 | 26 / 30 | 32 / 36 | -0.015em | Screen titles |
| `display-md` | Display 600 | 20 / 26 | 22 / 28 | -0.01em | Card titles, sheet titles, step title |
| `glance` | Text 500 | 22 / 30 | 24 / 34 | 0 | **Step instruction.** Readable at 70 cm on a propped phone |
| `body-lg` | Text 400 | 18 / 26 | 18 / 28 | 0 | Checkpoint, warning text, chat messages |
| `body` | Text 400 | 16 / 24 | 16 / 24 | 0 | Default |
| `body-sm` | Text 400 | 14 / 20 | 14 / 20 | 0.005em | Meta, helper text. Minimum text size in the product |
| `label` | Mono 600 | 13 / 16 | 13 / 16 | 0.04em, uppercase | Eyebrows ("STEP 7 OF 24"), section labels |
| `tag` | Mono 600 | 14 / 16 | 14 / 16 | 0.02em | Part label ("A", "104321"), quantity ("x4"), page ("p. 12") |
| `button` | Text 600 | 17 / 24 | 16 / 24 | 0 | Buttons |

Rules: max line length 62ch for body, 34ch for `glance`. Emphasis is weight 700, never italics. Numerals in `tag` and progress are tabular. Never truncate an instruction, warning or checkpoint; titles may clamp to 2 lines.

## 4. Spacing, radius, elevation

**Spacing** (4px base): `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-10` 40, `-12` 48, `-16` 64. Page gutter: 16 (mobile), 24 (tablet), 32 (desktop). Vertical rhythm between blocks on a screen: 24; within a block: 12.

**Radius** - deliberately tight; this is a workshop tool, not a bubble UI: `--radius-xs` 4 (tags, callouts' focus ring offset), `--radius-sm` 8 (chips, inputs, buttons), `--radius-md` 12 (cards, banners, visual stage), `--radius-lg` 20 (bottom sheet top corners, dialogs), `--radius-full` 999 (callout discs, progress, toggles only).

**Elevation** - borders first, shadows only for things that float:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--elev-0` | 1px `line` border, no shadow | 1px `line` border | Cards, rows, banners |
| `--elev-1` | `0 1px 2px rgba(27,26,23,0.08), 0 2px 8px rgba(27,26,23,0.06)` | `0 1px 2px rgba(0,0,0,0.5)` + 1px `line` | Sticky bars, floating controls on the visual |
| `--elev-2` | `0 8px 24px rgba(27,26,23,0.14), 0 2px 6px rgba(27,26,23,0.08)` | `0 12px 32px rgba(0,0,0,0.6)` + `surface-raised` | Bottom sheet, menu, toast, dialog |

**Sizes**: touch target minimum 44x44; **in the step player 56x56** for every control in the action bar. Minimum gap between adjacent targets: 8. Icons 24 (20 inside chips), 2px stroke, rounded joins, one icon set (Lucide or equivalent line set; do not mix).

## 5. Motion

| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 80ms | Press feedback, checkbox tick |
| `--dur-fast` | 140ms | Hover, chip select, toast, step change, bracket fade-in |
| `--dur-base` | 220ms | Disclosure open, sheet open and close, progress fill, stage resize |
| `--dur-slow` | 360ms | Zoom-to-region only |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Entering, most transitions |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exiting |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Zoom and pan animation, progress fill |

**Motion budget (D-010: usability over animation).** Motion is allowed only where it answers one of three questions: *did my tap register?* (state change), *where did this come from?* (sheet, zoom), *is it still working?* (processing). Nothing overshoots, bounces, scales on press, staggers, pulses or shimmers, and nothing animates to celebrate. There is no `ease-snap` token. The complete list of animated things:
- **Snap** (marking a region - the name is kept, the motion is plain): brackets and dim wash fade 0 to 1, `dur-fast` `ease-out`. No scale.
- **Step change**: old text is replaced by new text with one `dur-fast` opacity fade; no slide or offset. The visual cross-fades in place over the same time.
- **Sheet**: translateY 100% to 0, `dur-base` `ease-out`; exit `dur-base` `ease-in`; scrim fades with it. Kept because it shows the sheet sits over the step and where it goes when dismissed.
- **Zoom and pan**: animated (`dur-slow` `ease-in-out`) so the user keeps their place on the page.
- **Progress fill**, **disclosure open**, **visual-stage resize**: `dur-base`.
- **Processing arc** (7.14): the only looping motion in the product.
- Hover, press, select, tick, toast: colour or opacity changes only (`dur-instant` / `dur-fast`).

Interaction feedback must start within 100ms; never block input on an animation; a new step change interrupts a running one.

**Reduced motion** (`prefers-reduced-motion: reduce`): the sheet and zoom transforms are removed (sheet appears, zoom jumps); every remaining transition becomes an 80ms opacity change; the processing arc becomes a static icon plus text.

## 6. Breakpoints and grid

| Name | Range | Design reference | Columns / gutter / margin |
|---|---|---|---|
| `sm` | 0-599 | 375 | 4 / 16 / 16 |
| `md` | 600-1023 | 768 | 8 / 24 / 24 |
| `lg` | >= 1024 | 1280 | 12 / 24 / 32, content max-width 1200 |
| `landscape-compact` | height < 500 and landscape | 667x375 | Step player switches to side-by-side (see flows) |

Minimum supported width 320. All fixed bars respect `env(safe-area-inset-*)`.

## 7. Components

States listed for every interactive component: default, hover (pointer devices only), focus-visible, active/pressed, disabled, plus loading/selected/error where relevant.

**Focus ring (global):** 2px `accent` outline, 2px offset, on `:focus-visible` only; on accent-filled elements the ring is 2px `surface` gap then 2px `accent`. Never removed.

### 7.1 Button
Anatomy: container, optional leading icon (24), label (`button`), optional trailing icon. Radius `sm`. Padding 0 20. One primary per screen region.

| Variant | Default | Hover | Active | Disabled |
|---|---|---|---|---|
| Primary | `accent` fill, `on-accent` text | `accent-hover` | `accent-pressed` | `surface-sunken` fill, `ink-subtle` text, no border |
| Secondary | `surface` fill, 1.5px `ink-subtle` border, `ink` text | `surface-sunken` fill | border `ink`, `surface-sunken` fill | as primary disabled |
| Quiet | no fill, `accent` text | `accent-soft` fill | `accent-soft` + `accent-pressed` text | `ink-subtle` text |
| Danger | `danger-solid` fill, its on-colour | 8% black overlay | 16% overlay | as primary disabled |
| Icon | 44x44 (56 in player), icon only, **requires `aria-label`** | `surface-sunken` | `line` fill | 40% opacity |

Pressed states change colour only; nothing scales (section 5).

Sizes: `md` height 48, `lg` height 56 (player, full-width mobile CTAs), `sm` height 44 with 14px label (dense desktop only). Loading: label stays, leading 20px spinner replaces the icon, `aria-busy="true"`, button not disabled visually but ignores input. Disabled buttons keep a readable label and, where the reason is not obvious, a helper line below explains it.

### 7.2 Card
`surface`, `elev-0`, radius `md`, padding 16 (20 on `lg`). Interactive cards (library): whole card is one link; hover border `ink-subtle`; active `surface-sunken`; focus ring on the card. Secondary actions inside (overflow menu) are separate 44px targets outside the link's text flow. States for the **Guide card**: ready, in progress (progress bar + "Step 7 of 24"), finished (success check + "Finished"), processing (skeleton thumbnail + stage text), failed (danger icon + "Couldn't finish - Try again").

### 7.3 Chip and Part chip
**Chip** (filter, suggestion): height 36 visual inside a 44 hit area, radius `sm`, 1px `ink-subtle` border, `body-sm` 600. Selected: `accent-soft` fill, `accent` border and text, leading check. Hover: `surface-sunken`. Disabled: 40% opacity.

**Part chip** - anatomy left to right: quantity tag (`tag`, "x4", on `surface-sunken`, omitted when the step and the part both give no quantity), callout marker (a 24px copy of the callout disc, same number, same colours, no white ring; present only when a highlight on this step has this `partId`, otherwise omitted with no placeholder), name (`body` 600, 1 line clamp), manual label (`tag`, `ink-muted`, e.g. "A" or "104321"; omitted when `manualLabel` is absent - never synthesise one). Height 48, radius `sm`, `surface`, 1px `ink-subtle`.
- Tap: selects the chip and the matching highlight (`highlights[].partId`) becomes `mark-fill-active`; second tap opens the Part sheet (name, label, quantity, description, larger crop, "Show in manual").
- States: default; hover; selected (`accent-soft`, `accent` border); **missing** (user marked it missing in prep: `warn-soft` fill, warn icon, text "Missing"); focus; no disabled state.
- **No thumbnail in the chip** (M2 review). A 32px crop of a parts-list cell is illegible and adds noise next to the full picture in the stage directly above. The part's picture lives where it can be read: the 48px checklist thumbnail on the Overview and the large crop in the Part sheet (second tap). The number is what ties the chip to the picture.
- Tool chips use the same shape with a wrench icon (20) in the marker position and "Not in the box" (`body-sm`, `ink-muted`) when `included` is false.

### 7.4 Checklist row
Anatomy: checkbox 28x28 (radius `xs`, 2px `ink-subtle` border) inside a full-row 56px-min target; thumbnail 48x48 (parts); name (`body` 600); meta line (`tag`: label and "x8"); trailing 44px overflow button ("I'm missing this", "Show in manual").

| State | Treatment |
|---|---|
| Unchecked | as above |
| Checked ("got it") | checkbox `success-solid` with check (appears within `dur-instant`, no draw-in); name stays full contrast (no strikethrough - users re-read it) |
| Missing | checkbox replaced by warn triangle; row `warn-soft`; third line "Needed in steps 4, 9" as links |
| Hover / active | `surface-sunken` for both |
| Focus | ring on the row; overflow button separately focusable |
| Loading | skeleton row |

Semantics: `role="checkbox"` with `aria-checked`; missing is announced as "marked missing".

### 7.5 Progress
- **Segmented bar** (player, overview): one segment per phase, width proportional to its step count, 2px gaps, height 6, radius `full`; track `line`, fill `accent`; a fully complete phase fills `success-fg`. Fill animates `dur-base` `ease-in-out`; a completing phase just changes colour.
- **Counter**: `label` "STEP 7 OF 24". Always paired with the bar - the bar alone is not the accessible value. `role="progressbar"` with `aria-valuenow/max` and `aria-valuetext="Step 7 of 24, Assemble the frame"`.
- **Ring** (library card): 28px, 3px stroke, percent of completed steps.
- **Stage list** (processing): see 7.14.

### 7.6 Step rail
A list of all steps grouped by phase. One component, two presentations: bottom sheet on `sm`/`md`, permanent left column (280px) on `lg`.

Row anatomy (min height 56): status marker 24 (empty ring = not done; `success` check disc = done; `accent` filled ring = current), step number (`tag`), title (`body`, 2-line clamp), trailing flags in fixed order: padlock (irreversible), "?" (low confidence), warn triangle (uses a part marked missing). Phase header: `label`, sticky, with "3/6".
States: default; hover `surface-sunken`; current `accent-soft` with 3px `accent` left bar and `aria-current="step"`; focus ring; done rows keep full-contrast titles. Opening scrolls the current row to centre. Any step can be opened at any time (no locking).

### 7.7 Bottom sheet
`surface-raised`, top radius `lg`, `elev-2`, scrim behind. Anatomy: grab handle (36x4, `ink-subtle`, in a 44px-tall drag zone), header (title `display-md`, close icon button 44), scrollable body, optional sticky footer. Detents: `half` (56% of viewport height) and `full` (viewport minus 48). Drag between detents; drag down past 30% or fling to dismiss; tap scrim or Esc dismisses. On `md` centred with max-width 560; on `lg` sheets become right-side panels (400px) or centred dialogs (max 560) as specified per screen.
Accessibility: `role="dialog"`, `aria-modal="true"`, labelled by its title, focus moves to the sheet title on open, focus is trapped, returns to the invoking control on close. Every sheet has a visible close button; drag is never the only way to dismiss.

### 7.8 Toast
Bottom-centre on `sm` (above the action bar: bottom offset = bar height + 12), bottom-left on `lg`. `ink` fill with `bg` text in light; `surface-raised` with `ink` text and 1px `line` in dark. Radius `sm`, `elev-2`, padding 12 16, max-width 420, optional leading icon and one Quiet action ("Undo"). Duration 4s (8s with an action); pauses on hover/focus; max one visible, newest replaces. `role="status"` (`aria-live="polite"`); errors that need action are **not** toasts - they are inline banners. Enter and exit: opacity fade, `dur-fast`.

### 7.9 Upload dropzone
Anatomy: dashed 2px `ink-subtle` border, radius `md`, `surface`, min-height 220 (`sm`) / 280; icon (page with bracket corners), title `display-md` "Add your manual", helper `body-sm` "PDF or photos of the pages - up to 60 pages, 40 MB", two buttons: Primary "Take photos" (mobile only, camera capture) and Secondary "Choose files" (on desktop this is Primary and the helper adds "or drop them here").

| State | Treatment |
|---|---|
| Default | as above |
| Hover (desktop) | border `ink` |
| Drag-over | border solid `accent`, `accent-soft` fill, title "Drop to add" |
| Focus | ring on the buttons; the zone itself is not a tab stop |
| Uploading | zone replaced by file rows: name, size, determinate bar, cancel icon |
| Error | inline danger banner **above** the zone with the specific message; zone stays usable |
| Disabled (limit reached) | 40% opacity, helper explains the limit |

Page-photo thumbnails (after photos are added): 3-column grid (`sm`), 5 (`md`), 6 (`lg`); each tile 3:4, page number tag, remove icon button (44), drag handle; reorder by drag **and** by "Move earlier / Move later" in the tile menu (keyboard and screen-reader path).

### 7.10 Source visual (highlight overlay, zoom and pan)
The most important component. It shows a piece of the original page with Instructor's markings on top.

Layers, bottom to top:
1. **Stage**: `surface-sunken`, radius `md` (0 when edge-to-edge on `sm`).
2. **Page image**: unaltered; `object-fit: contain`. Initial view = the step's `sources[i].region`, padded by 6% of the page on each side (12% when that source has `regionFallback: true`, so an imprecise box still shows its surroundings) and clamped to the page; if the region is absent: the full page. The fit is always "contain": the padded region is never cropped. When the stage's proportions differ from the region's (e.g. the tall desktop stage and a wide panel), the spare room shows more of the same page around the region - centred on the region, clamped to the page - rather than empty letterbox. Seeing the neighbouring panels there is intended; layer 3 does the focusing.
3. **Dim wash** (`mark-dim`) over everything outside the **step's own source region** on the page being shown (union with any highlight that reaches outside it). The step's panel - including the manual's own caption and small print inside it - stays at full strength; only the rest of the page is dimmed. If the step has no usable region on this page, the wash covers everything outside the union of the highlights, and is drawn only when there is at least one. Never drawn in full-page mode (Original viewer).
4. **Brackets**: each highlight is `{ source, panelId?, label?, partId? }` and is drawn on the page given by its own `highlight.source.pageIndex`, at `highlight.source.region` - never assumed to be on `sources[0]`. A highlight whose page is not the one shown is not drawn; the pager reaches it (USER_FLOWS 6.6). One set of four L-shaped corners per highlight; arm length = 18% of the region's shorter side, clamped 12-28px on screen; stroke per 2.3; corners rounded 2px; region tinted `mark-fill`.
5. **Callouts**: 28px disc at the region's top-left corner, centred on the corner, kept inside the stage. Content: **always the highlight's 1-based index** in the step's `highlights` order, counted across all of the step's pages so a number is unique within the step (M2 review; the `label` is never put in the disc). Reasons: a disc holding "A" or "G" imitates the manual's own circled part letters and could be taken for part of the source; mixed letters and numbers in one picture are ambiguous; and a number can be repeated on the linked part chip (7.3). The `label` is used as the disc's accessible name and tooltip ("Marked area 1: Top edge"), and when a callout with a label and no `partId` is selected it is shown as a `tag` on `surface` (92%) beside the disc until deselected. Hit area 44. Linked to a part chip when `partId` is set.
6. **Controls** (`elev-1`, `surface` at 92% opacity, radius `sm`), bottom-right: zoom out, zoom in, reset ("Fit"), and top-right: "Marks" toggle (eye icon; hides layers 3-5 so nothing we draw can ever obscure the source), "Original page" (opens the Original viewer at this page). Bottom-left: page tag "p. 12" and, with several sources, a pager "1 / 2" with previous/next (44px).

Behaviour:
- Zoom range 1x (fit) to 5x. Pinch; double-tap toggles fit and 2.5x at the tap point; Ctrl/Cmd+wheel or trackpad pinch on desktop; buttons step x1.5. Pan by drag when zoomed; panning is bounded to the page.
- Strokes, callouts and arm lengths stay constant in screen pixels at every zoom.
- Step-change swipes are accepted on the visual only at 1x.
- Keyboard (stage is focusable, `role="group"`, `aria-roledescription="zoomable image"`): `+`/`-` zoom, `0` fit, arrows pan, `M` toggles marks.
- Tapping a callout selects it and its part chip (and vice versa); selected region uses `mark-fill-active`.

States: loading (skeleton stage with bracket corners in `line`, no spinner); loaded; marks hidden (toggle shows `aria-pressed="false"`, small "Marks off" tag); **low confidence** (dashed `mark-unsure-stroke` brackets, and the stage carries a persistent "Double-check with the original" tag bottom-centre); **approximate region** (any drawn region whose source has `regionFallback: true`: that region's brackets are dashed `mark-unsure-stroke`, and the stage carries one "Approximate area" tag bottom-centre, `unsure` colours; when the step is also low confidence, only the low-confidence tag is shown); **no usable region** (full page, no brackets, tag "Whole page shown"); **image failed** (stage shows icon, "Couldn't load this page", Secondary "Try again"; the instruction text remains usable); zoomed (reset button becomes accent).

Status tags ("Double-check with the original", "Approximate area", "Whole page shown"): bottom-centre; when the bottom row has no room beside the page tag and the zoom controls (`sm`, landscape), centred 8 above that row. "Marks" off hides the status tag together with layers 3-5 (the text-panel banner still carries the message), so nothing Instructor draws can sit on the manual's content.

Full-page mode (Original viewer): no dim wash, no page tag (the viewer's header names the page); brackets, tint and callouts as above.

Alt text: `"Manual page 12, area for step 7: <step title>"`. Highlights are exposed as a list: "Marked area 1: Cam lock (part B)". The picture is not described beyond what the Guide data contains.

### 7.11 Citation chip
Inline or trailing chip that points to the source. Anatomy: page-with-brackets icon 16, text in `tag`: "Step 7 · p. 12" (step part omitted when the citation has no `stepId`; page is `pageIndex + 1`). Height 28 visual, 44 hit area (vertical padding via pseudo-element), radius `xs`, `accent-soft` fill, `accent` text. Hover: `accent` border. Active: `accent` fill, `on-accent` text. Focus ring. It is a button: opens the Original viewer at the page with the region bracketed (`mark-cite-stroke`, 4px for 2s). `aria-label="Open manual page 12, step 7"`. A citation that fails validation is not rendered at all.

### 7.12 Banners: warning and irreversible
Shared anatomy: icon 24, label (`label`), text (`body-lg`, never truncated, never collapsed), optional source line (warnings; see below), optional citation chip. Radius `md`, padding 12 16. Banners are static content (`role="note"`), not alerts, except when they appear in response to an action.

| Banner | Treatment |
|---|---|
| **Caution** (`severity: "caution"`) | `warn-soft` fill, 4px `warn-fg` left bar, triangle, label "CAUTION" |
| **Warning** (`severity: "warning"`; also any unrecognised value) | same plus 1.5px `warn-fg` full border, label "WARNING", text weight 600 |
| **Irreversible** | `danger-soft` fill, 2px `danger-fg` border, 8px hatched top strip (45-degree stripes `danger-fg` / `danger-soft`), padlock, label "CAN'T BE UNDONE", fixed text "Check the picture and the parts before you do this step." followed by nothing invented |
| **Low confidence** | `unsure-soft`, 1.5px dashed `unsure-fg` border, label "DOUBLE-CHECK", text "We're less sure we read this step correctly. Compare it with the original page.", Quiet button "Show original page" |
| **Read from the picture** (`interpretedFromDiagram`) | compact one-line `unsure-soft` tag: eye icon + "Read from the picture - the manual has no words here" |
| **Error** (system) | `danger-soft`, 4px left bar, label names the problem, one action button |
| **Info / authority** | `surface-sunken`, 1px `line`, text "The original manual is the authority. If this guide and the manual differ, follow the manual." |

**Warnings keep the manual's wording (D-010).** The UI never rewrites, shortens, softens, collapses or "simplifies" a warning, and the manual's exact words are always on screen, not behind a tap. The banner's source line, under the text, has exactly three cases:

| Data | Banner text | Source line |
|---|---|---|
| `sourceQuote` equals `text` (compare after trimming and collapsing whitespace) | `text` | `body-sm` `ink-muted`: "From your manual" + page tag "p. 12" (button -> Original viewer at the warning's source) |
| `sourceQuote` differs from `text` (normalised or translated) | `text` | The full Source quote (7.16) inside the banner, always expanded, with `lang` set to the manual's language |
| no `sourceQuote` (e.g. a warning pictogram with no words) | `text` | "Read from the picture" tag (eye icon, `unsure` colours) + page tag - the user is told this wording is Instructor's reading of a symbol |

Read-aloud speaks the banner text, then the quote when it differs.

### 7.13 Chat message
- **User**: right-aligned bubble, `accent-soft` fill, `ink` text, radius `md` with 4px bottom-right, max-width 85%.
- **Assistant**: no bubble; full-width text on the sheet surface with a 3px `accent` left rule and 12px inset (reads as a margin note). `body-lg`. Citation chips follow the sentence they support or sit in a row under the message.
- **Context tag** above the first message of each step: `label` "ABOUT STEP 7".
- States: streaming (text appears as received, a 2px `accent` caret at the end, `aria-live="polite"` announced once on completion, not per token; Stop button replaces Send); complete; **not in manual** (`unsure-soft` block with dashed-circle icon, label "NOT IN YOUR MANUAL", then the model's statement; no citations); error (inline `danger-fg` text "That didn't go through." + Quiet "Try again"); rate-limited (info banner with the limit reason).
- Composer: multiline input (min-height 48, max 4 lines, 16px text to avoid iOS zoom), Send icon button 48 (disabled when empty), suggested-question chips above when the thread for this step is empty.

### 7.14 Skeleton and processing
- **Skeleton**: `surface-sunken` blocks, radius matching the real element, static tone, no shimmer or pulse (the processing arc and button spinner are the only "working" indicators). Skeletons mirror the final layout (same heights) so nothing shifts. Text skeletons are 60-90% width lines. `aria-hidden="true"` with one visually hidden "Loading" status per region.
- **Processing stage list**: one row per stage the API reports, never more (D-015) - "Reading pages", "Finding parts and building steps", "Double-checking", "Finishing" (mapping and detail lines: USER_FLOWS section 4). Row: marker 24 + `body-lg` label + optional `body-sm` detail. Marker states: pending (empty ring `ink-subtle`), active (ring with a rotating 90-degree `accent` arc, 1s linear; reduced motion: solid `accent` ring), done (`success` check disc), failed (`danger` cross disc). The active row label is weight 600. The list is `aria-live="polite"`; each stage change is announced once.
- **Spinner**: only inside buttons (20px). Never a full-screen spinner.

### 7.15 Smaller parts
- **Disclosure** ("Why", "Common mistake", "Explain simpler"): full-width row 48, chevron points right (closed) or down (open), `body` 600; content `body-lg` on `surface-sunken` inset; `aria-expanded`.
- **Checkpoint block**: `success-soft` fill, radius `md`, padding 12 16, check-in-circle icon, label "YOU'LL KNOW IT'S RIGHT WHEN", text `body-lg`. The checkpoint text is shown exactly once. Provenance follows the same three cases as warnings (7.12), compared after trimming and collapsing whitespace:
  - quote equals the checkpoint text: the text, then an 8px gap and one source line in `body-sm` `ink-muted`: "From your manual" + page tag "p. 3" (44px-target button -> Original viewer at the checkpoint's source). **No blockquote, no repeated sentence.**
  - quote differs: the text, then the full Source quote (7.16) inside the block, 12px below the text, always expanded.
  - no quote: the text only (Instructor's wording, unmarked).
  Not interactive apart from the page tag.
- **Menu**: `surface-raised`, `elev-2`, radius `sm`, rows 48, destructive row in `danger-fg`.
- **Dialog** (destructive confirm only): centred, max 400, title, one sentence, Secondary "Cancel" + Danger action; focus starts on Cancel.
- **Text input**: height 48, 1.5px `ink-subtle` border, radius `sm`; focus border `accent` + ring; error border `danger-fg` + message below with icon.
- **Toggle**: 52x32 track, used for "Keep screen on" and "Read aloud automatically"; `role="switch"`.

### 7.16 Provenance: the manual's words vs Instructor's reading (D-010)
The user must be able to tell, at a glance, what comes straight from the manual and what Instructor worked out. Three levels, two visible treatments, no new colours and no badges on ordinary content:

| Level | What it covers | Treatment |
|---|---|---|
| **The manual's own words** | `sourceQuote` on warnings and on steps (steps that contain numbers carry one) | **Source quote**, below |
| **Instructor's wording of the manual** (the default) | Step title, instruction, checkpoint, part names, summary | Unmarked. Always one tap from its page ("Show original page", the page tag). Explained once on the Overview |
| **Instructor's interpretation** | `interpretedFromDiagram`, `regionFallback`, `confidence: low`, "Why this matters", "Common mistake", "Simpler wording", assistant answers | `unsure` family or an explicit caption, per the table below |

**Source quote** (the only "verified" marker): a `<blockquote>` with a 3px `ink` left rule, 12px inset, no fill, no border. First line: `label` "FROM YOUR MANUAL" followed by the page tag (`tag`, "p. 12"; a 44px-target button that opens the Original viewer at that source). Then the quote in `body`, `ink`, rendered **verbatim**: no trimming, no case change, no translation, no added quotation marks, never truncated or collapsed; `lang` = the manual's language. Not interactive apart from the page tag. It is rendered only when the data has a `sourceQuote`; the UI never builds one from other fields. Neutral ink, not green: green means "done", and a "verified" tick would claim more than a matched quote proves.

**Never the same words twice (M2 review).** Wherever a Source quote would sit directly under Instructor text that is identical to it (compare after trimming and collapsing whitespace; nothing fuzzier - a quote that differs by one character is shown in full), the blockquote is replaced by a single source line under that text: `body-sm` `ink-muted` "From your manual" + the page tag button. The sentence above it then *is* the manual's sentence, and the line says so. This applies to the step instruction, the checkpoint (7.15) and warnings (7.12, where it was already the rule).

| Signal | Where | Treatment |
|---|---|---|
| `step.sourceQuote` | Under the instruction | Source quote; the one-line source line when it equals the instruction |
| Checkpoint's manual quote | Inside the checkpoint block | 7.15 |
| `warning.sourceQuote` | In the warning banner | 7.12 |
| `interpretedFromDiagram` | Under the instruction (after the quote, if both) | One-line tag, 7.12: eye + "Read from the picture - the manual has no words here" |
| `regionFallback` | On the visual | Dashed brackets + "Approximate area" tag, 7.10. Nothing in the text panel |
| `confidence: low` | Banner, visual, rail | 7.12, 7.10, 7.6 (unchanged) |
| `why`, `commonMistake` | Inside the opened disclosure, first line | `body-sm` `ink-muted`: "Instructor's explanation - not the manual's wording." |
| Simpler wording | Inside the opened disclosure | Existing note (USER_FLOWS 6.4) |

Overview key (second sentence of the authority note, shown once per guide, not per step): "Steps are Instructor's wording of your manual. Text marked FROM YOUR MANUAL is the manual's exact words."

Noise rules: at most one Source quote and one tag per step outside banners; `confidence: medium` and ordinary reworded text get no marker; no per-sentence markers, percentages or confidence meters.

## 8. Accessibility rules

1. WCAG 2.1 AA minimum: text 4.5:1 (3:1 for >= 24px or >= 19px bold), non-text and component boundaries 3:1. Use only the token pairs listed in section 2.
2. Targets >= 44x44 everywhere, 56x56 in the player action bar, >= 8 apart.
3. Meaning never by colour alone: every semantic state has an icon and a word (2.2).
4. Everything works with keyboard alone; visible focus always; focus order follows reading order; overlays trap and restore focus; Esc closes the top overlay.
5. Every gesture has a visible-control equivalent (swipe -> buttons; pinch -> zoom buttons; drag-reorder -> move menu; sheet drag -> close button).
6. Text resizes to 200% without loss; layouts reflow at 320 CSS px with no horizontal scroll (the source visual is exempt as a zoomable image).
7. Screen readers: landmarks per screen (`header`, `main`, `nav`); one `h1` per screen; step changes move focus to the step heading and announce "Step 7 of 24: <title>"; live regions are polite and announce once.
8. Motion: honour `prefers-reduced-motion` (section 5); nothing flashes; no auto-playing motion longer than 5s except the processing indicator, which has a static fallback.
9. The source page image is never altered, and overlays can always be turned off ("Marks").
10. Read-aloud is user-initiated (or explicitly switched to automatic), stoppable with one tap, and never the only way to get content.
11. Themes: follow `prefers-color-scheme`; a manual switch may be added later; both themes must pass rules 1-3.
12. Language: plain words, sentences under 20 words in UI copy, no jargon the manual did not use. Errors say what happened and what to do next.

## 9. Open points
- Resolved (D-009): severity is `caution | warning` (7.12); highlights carry their own page (7.10).
- Open: whether `warning.text` can differ from `sourceQuote` (USER_FLOWS section 11). 7.12 and 7.16 are safe either way.
- Resolved (M2 review, 2026-11-12): checkpoint provenance and de-duplication (7.15, 7.16); part chips carry the callout number instead of a thumbnail (7.3); callout discs always show the index (7.10); the dim wash spares the step's own region and is off in the Original viewer (7.10); "contain" fit on the desktop stage is intended (7.10).
