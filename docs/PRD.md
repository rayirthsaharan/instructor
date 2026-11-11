# Instructor - Product Requirements Document

Status: **v1 approved by the user (D-010).** Owner: lead orchestrator.

## 1. Product vision

**Instructor is the patient expert who has already read your manual.** Give it any instruction booklet - a PDF, or photos of the paper that came in the box - and in about a minute it hands back a guided session: what you are making, what you need on the table before you start, and then one clear step at a time, each shown on the manual's own diagram with the relevant parts lit up, a plain-English instruction, and a way to know you did it right. When you are stuck, you ask, and the answer points at the exact place in the original.

The promise is not "a summary of your manual". It is **"you will finish this, correctly, the first time."**

### What we changed from the original concept, and why

| Original idea | Problem | Refined direction |
|---|---|---|
| AI-generated diagrams and illustrations for every step | The highest-risk feature in the concept. Generated pictures of physical objects are confidently wrong (wrong hole, wrong orientation), and a wrong picture is worse than no picture. It also contradicts the "never invent" requirement. | **Source-anchored visuals.** Each step shows the *manual's own* diagram, cropped to the relevant panel, with our overlays (highlights, numbered callouts, dimming of what is irrelevant). Accurate by construction, cheap, and it teaches users to trust the tool. Generative/3D visuals are postponed until they can be verified. |
| "Any instructions for anything" | Too broad to be excellent at. Quality of interpretation is the product. | **Beachhead: physical assembly and setup** - flat-pack furniture, home equipment, appliances, electronics, toys. Diagram-heavy, parts-list-driven, high frustration, done by non-experts. The data model stays general, but design and evaluation target this. |
| Simplify the text | Simplification alone is a commodity (any chatbot does it). | The value is in **structure the manual never had**: a prep phase, per-step parts and tools, "you'll know it's right when...", irreversible-step warnings, and continuous progress. |
| Chatbot attached to the manual | Generic and easy to copy. | Assistant is **step-aware and cited**: it knows the current step, the parts in play and what is done, answers only from the manual, and links to page and region. It says "the manual doesn't say" instead of guessing. |
| Many secondary features (sharing, search across manuals, URL import, photo-of-progress checks) | Each is plausible; together they delay the core loop. | Cut to the loop that proves the product: **upload -> understand -> prepare -> follow -> ask -> finish.** |

### Product principles
1. **Faithful before friendly.** Never invent a part, measurement, torque value or step. Every item carries a source reference. Uncertainty is visible.
2. **One thing at a time.** The current step owns the screen. Everything else is one tap away, never in the way.
3. **Hands are busy.** Big targets, glanceable type, read-aloud, screen stays awake.
4. **Show the original.** The source page is always reachable without losing your place. Trust comes from being checkable.
5. **Pay for understanding once.** A manual is analysed once and reused forever.

## 2. Target users and use cases

**Primary - "The reluctant assembler."** An adult who just bought something that needs assembly or setup (flat-pack wardrobe, crib, exercise bike, router, dishwasher install kit). Not technical, mildly anxious, often on a phone, often with the paper manual in hand. Jobs: know if I have everything; not make a mistake I must undo; finish tonight.

**Secondary**
- **Second-hand buyers and renters** who have only a PDF found online, or a worn booklet.
- **Non-native readers** of the manual's language, and people who struggle with dense text (plain-language rewriting helps here; translation is a later extension).
- **Helpers** - the family member or handyman who assembles for others and wants speed.

**Future B2B (not MVP):** manufacturers and retailers who publish an Instructor guide behind a QR code in the box to cut support calls and returns.

## 3. Core features (MVP)

Priorities: P0 = MVP cannot ship without it; P1 = MVP if time allows.

### F1. Capture (P0)
- Upload one PDF, or one or more page photos (JPEG/PNG/HEIC->converted, WebP). On mobile, the file input offers the camera.
- Reorder/remove page photos before analysing.
- Limits (MVP): 60 pages, 40 MB. Clear errors for oversize, corrupt, password-protected and unsupported files.
- The original is stored unchanged and is always viewable.
- *Accept:* a 20-page PDF and a set of 6 phone photos both upload and reach analysis; invalid files produce a specific, human message.

### F2. Understanding pipeline (P0)
- Background job with honest staged progress ("Reading pages", "Finding parts", "Building steps", "Double-checking").
- Output is a validated structured **Guide**: title, summary, estimated time, difficulty, people needed, tools, parts (name, manual part number/letter, quantity, source region), phases, steps, warnings, glossary.
- Each step: plain-language title and instruction (short), the parts and tools used with quantities, optional "why this matters", common mistake, **checkpoint** ("you'll know it's right when..."), warnings preserved verbatim in meaning, an **irreversible** flag, a confidence level, and one or more **source references** (page + normalised region).
- A verification pass checks the draft against the source: every measurement/quantity/part number must appear in the source; steps without a valid source reference are flagged; low-confidence items are marked for the UI.
- Non-manual documents are rejected politely ("This doesn't look like instructions").
- Identical files (content hash) are never re-analysed.
- *Accept:* output always validates against the schema or the job fails with a retryable error; no step is shown without a source reference; re-uploading the same file returns the existing guide with zero AI calls.

### F3. Guide overview and prep (P0)
- "Here's the plan": what you are building, time, difficulty, people needed, phase outline.
- **Before you start** checklist: tools, then parts with quantities and the manual's own part picture/number so users can identify and count them. Tick-off state is saved. Missing a part is noted and the affected steps are shown.
- *Accept:* a user can see at a glance whether they can start; checklist state survives reload.

### F4. Step player (P0) - the heart of the product
- One step per screen: source-anchored visual (crop of the manual page with highlighted regions and callouts; pinch/scroll zoom and pan), instruction, parts-for-this-step chips, checkpoint, warnings.
- Progressive disclosure: "Why", "Common mistake", "Explain simpler" and "Show original page" are collapsed by default.
- Navigation: next/back, swipe on touch, arrow keys on desktop, a step rail/sheet to jump anywhere; mark complete; progress always visible; phases grouped.
- Irreversible steps get a distinct "check before you continue" treatment.
- Low-confidence steps show a "double-check with the original" marker.
- Position and completion persist; reopening resumes exactly where the user stopped.
- Read-aloud of the current step (browser speech synthesis) and keep-screen-awake (Wake Lock) where supported.
- Completion screen at the end.
- *Accept:* usable one-handed on a 375 px phone; resume works after closing the tab; every step can open its original page with the region highlighted.

### F5. Step-aware assistant (P0)
- Opens over the player without losing the step. Suggested questions for the current step ("What does this mean?", "Which piece is this?", "Why am I doing this?").
- Grounded in the guide and the source; aware of the current step and completed steps. Answers cite step and page as tappable chips that open the source at that region.
- If the manual does not contain the answer, it says so. It never supplies outside specifications as if they were from the manual.
- Streaming responses. Conversation is kept per guide.
- *Accept:* answers reference the current step by default; an out-of-manual question gets an explicit "not in your manual" response; citations open the right page.

### F6. Original viewer (P0)
- Full original, page by page, zoomable, reachable from any step and any citation, returns to the same step.

### F7. Library and resume (P0)
- Home lists the user's guides with progress and "Continue". Delete a guide (and its files).
- MVP identity is an anonymous per-device session (signed cookie); no sign-up wall.

### F8. Personal notes and bookmarks on steps (P1)
### F9. Printable simplified guide (P1) - print stylesheet of the guide, with source page references.

## 4. Postponed (with reasons)
- **Accounts, cross-device sync, sharing** - needs auth and a privacy model; not needed to prove the loop. First post-MVP item.
- **Photo "did I do this right?" check and part identification from a user photo** - high value but high risk of confident wrong answers; needs an evaluation set first. Planned v1.1 as an explicitly hedged feature.
- **Manual by URL** - SSRF surface and copyright questions; upload covers the need.
- **Search across manuals** - only useful with many manuals per user.
- **Voice commands ("next step")** - read-aloud ships in MVP; reliable hands-free input is a separate project.
- **Generated illustrations, 3D, animation** - only after a verification method exists.
- **Translation** - natural extension of the pipeline; postponed to keep evaluation tractable.
- **Native apps** - the web app is installable (PWA) and uses the camera through the browser.

## 5. Differentiators to build toward
1. **Source-anchored visuals** (MVP) - highlights on the real diagram, not a reinterpretation.
2. **Checkpoints and irreversible-step warnings** (MVP) - the two things manuals most often omit and that cause most rework.
3. **Parts triage** (MVP) - count and identify before starting; know which steps a missing part blocks.
4. **Explain-it-differently ladder** (MVP) - simpler wording on demand, cached per step.
5. **Shared manual library** (later) - the same manual hash is analysed once for everyone; popular products become instant. This is the cost moat and the bridge to B2B.
6. **Progress photo check** (v1.1) and **manufacturer QR guides** (B2B).

## 6. Technical challenges and mitigations
| Challenge | Mitigation |
|---|---|
| Wordless, diagram-only manuals (IKEA style) | Multimodal analysis of page images, not OCR text alone; steps describe what the diagram shows and are marked as interpretation when no text exists. |
| Accurate regions on pages (models are imprecise at pixel coordinates) | Ask for panel-level regions (coarse, normalised boxes), validate geometry, pad crops, and fall back to the full page when a region is invalid or low-confidence. Never rely on a box being pixel-perfect. Spike early (see plan M0). |
| Hallucinated specs | Schema-validated output; verification pass that checks numbers, quantities and part IDs against the source; confidence shown in UI; one-tap original. |
| Long manuals vs context and cost | Page rasterisation at a bounded resolution; chunked analysis by page range with a merge step; hard page limit in MVP. |
| Cost per manual | Content-hash dedupe; analyse once; prompt caching for assistant context; cheaper model for chat than for analysis; per-device rate limits. |
| Prompt injection inside documents | Document content is passed as data; system prompt forbids following embedded instructions; output is schema-constrained; no tools with side effects are given to the model. |
| Photo quality (skew, glare, wrong order) | Client-side downscale and orientation fix; user can reorder; the model reports unreadable pages and the UI asks for a retake. |
| Liability for safety-critical tasks (gas, mains electricity, child safety) | Warnings are preserved, never softened; a persistent "the original manual is authoritative" notice; safety-critical categories get a stronger notice. |

## 7. Business model (recommendation)
- **Free:** 2 guides per month, full player, limited assistant messages. Demonstrates the magic at the moment of need.
- **Plus (about USD 6/month or USD 39/year):** unlimited guides, unlimited assistant, notes, print, later photo-check and sync.
- **Single-guide pass (about USD 2.99):** for the common once-a-year user who will not subscribe. Likely the main consumer revenue.
- **B2B (the real upside):** per-product pricing for brands/retailers who publish verified guides via QR code; value is measured in fewer support contacts and returns.
- Unit economics target: AI cost per analysed manual well under the single-guide price; the shared-library dedupe drives marginal cost toward zero for popular products.
- Payments are **not** in the MVP; the MVP enforces limits by configuration only.

## 8. Success metrics
- Guide completion rate (started -> finished) >= 60%.
- Time from upload to first step <= 90 s for a 20-page manual.
- "Open original" used on < 25% of steps (trust without dependence) and assistant "not helpful" rate < 10%.
- Zero known invented specifications in the evaluation set.

## 9. Non-functional requirements
- Mobile-first, responsive to desktop; WCAG 2.1 AA; reduced-motion support.
- Player interactions feel instant (< 100 ms); step data is loaded once per guide.
- Uploaded files are private to the owning session; validated type and size; stored outside the web root.
- Works without an AI key in development and tests (mock provider with fixtures).

## 10. Open questions for the user
1. Approve the beachhead (physical assembly/setup) and the source-anchored-visuals decision?
2. Approve the MVP scope (F1-F7, with F8-F9 if time allows) and the postponed list?
3. Approve the proposed stack in `docs/ARCHITECTURE.md`?
4. Real AI analysis needs an Anthropic API key and incurs usage cost. Until approved, development runs on the mock provider.
