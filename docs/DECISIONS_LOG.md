# Decisions Log

Append-only. Newest at the bottom. Format: `D-nnn | date | owner | status` then decision, reason, alternatives.
Status: proposed (needs user approval), accepted, superseded by D-nnn.

## D-001 | 2026-11-11 | orchestrator | accepted
**Multi-model team via project subagents.** Roles and models are fixed in `.claude/agents/*.md` using full model IDs (`claude-fable-5-2`, `claude-sonnet-5-5`, `claude-opus-5-5`); routing rules live in `CLAUDE.md`. Reason: the agent file's `model` field is applied automatically on delegation, so the user never selects a model.

## D-002 | 2026-11-11 | orchestrator | proposed
**Source-anchored visuals instead of generated illustrations.** Steps show crops of the original manual pages with overlays. Reason: generated depictions of physical assembly are unverifiable and conflict with the "never invent" invariant. Alternative postponed: generative/3D visuals once a verification method exists.

## D-003 | 2026-11-11 | orchestrator | proposed
**Beachhead: physical assembly and setup manuals.** Reason: focus evaluation and design where diagrams, parts lists and frustration are highest. The Guide schema stays general.

## D-004 | 2026-11-11 | orchestrator | proposed
**MVP scope = F1-F7 (P0), F8-F9 (P1); no accounts, payments, URL import, photo-check, sharing.** See PRD sections 3-4.

## D-005 | 2026-11-11 | orchestrator | proposed
**Stack: Next.js + TypeScript + Tailwind, SQLite/Drizzle, local storage adapter, in-process DB-backed jobs, Claude behind an `AIProvider` with a mock.** See ARCHITECTURE section 2 for reasons and rejected options. Assumes a single long-running Node container at deploy time.

## D-006 | 2026-11-11 | orchestrator | accepted
**No external spending without approval.** Development and tests default to `AI_PROVIDER=mock`. Real analysis requires the user to supply an Anthropic API key.

## D-007 | 2026-11-11 | senior-engineer (review), orchestrator (accepted) | accepted, subject to D-005 approval
**Architecture amendments before coding:** separate worker process with leased jobs; dedupe keyed by content hash + pipeline version with global sharing for PDFs only; code-detected diagram panels chosen by id instead of model-drawn boxes; chunked analysis merged in code; hardened upload rendering; Guide contract fixes (highlights carry a page, single source of step order, `sourceQuote`, stable step ids). Details: ARCHITECTURE section 10. Reason: each item is cheap now and expensive after data exists.

## D-008 | 2026-11-11 | ui-ux-designer | proposed (part of design v1)
**Visual identity "Chalk Line" and interaction rules.** (1) Manual pages are never recoloured or inverted, including dark mode; a "Marks" toggle hides overlays. (2) Highlights are corner brackets plus a dim wash, because regions are coarse. (3) Only the primary button completes a step; swipes and arrows only navigate. (4) Irreversible steps: notice on the prior step, banner, "I checked - done"; non-modal, no hold gesture. (5) An unchecked checklist or missing part never blocks Start; checklist items are `unchecked | have | missing`. (6) Only low confidence shows a marker. (7) Fonts: Bricolage Grotesque, Atkinson Hyperlegible Next and Mono.

## D-009 | 2026-11-11 | orchestrator | accepted
**Answers to the designer's open questions.** (a) Highlights carry their own page (D-007 item 6); do not assume `sources[0]`. (b) `warnings[].severity` is the enum `caution | warning`. (c) "Replace and re-analyse" for an unreadable page is out of MVP; the UI offers "Start again with new photos" instead. (d) Processing has its own resumable URL `/d/[documentId]` (not `/new` in place), so leaving and returning works; this overrides USER_FLOWS section 1 until the designer aligns it in M0.

## D-010 | 2026-11-11 | user | accepted
**User approvals.** D-002, D-003, D-004, D-005 (+D-007), D-008 are approved and now `accepted`. Conditions and additions from the user:
- Architecture must stay portable: all database access goes through `src/lib/db` (repository functions; no SQLite-specific SQL or driver types outside it), storage through `StorageAdapter`, jobs through a queue interface, so PostgreSQL or another deployment can be adopted later. No extra infrastructure in the MVP.
- No paid API usage without asking first. Build the complete experience on mocked analysis. Before the diagram-location accuracy test, present the test design, expected API usage and estimated cost and wait for approval.
- Accuracy is a core requirement: never invent; every step keeps its page/diagram reference; **verified information is visibly distinguished from AI interpretation**; uncertainty is communicated; warnings and safety text are preserved and never simplified in a way that changes meaning.
- Usability over animation or visual complexity. Maintainable and testable, not over-engineered.
- Report to the user at each milestone: what was built, what was tested, what needs approval.

## D-011 | 2026-11-11 | orchestrator | accepted
**Provenance rules for the Guide contract (implements D-010 accuracy requirements).**
- `warning.text` may be a plain-language restatement, but `warning.sourceQuote` (verbatim) is required whenever the manual states the warning in words; the UI always shows the verbatim quote. A warning read from a pictogram has no quote and is marked `interpretedFromDiagram: true`.
- `why`, `commonMistake` and `checkpoint` are each `{ text, origin: "manual" | "inferred", sourceQuote? }`. `origin: "manual"` requires a `sourceQuote`. Inferred guidance is labelled in the UI as coming from Instructor, never presented as the manual's words, and may never contain measurements, quantities or specifications.
- "Start again with a new file" (PDF) alongside "Start again with new photos" is accepted.

## D-012 | 2026-11-11 | senior-engineer (review), orchestrator (accepted) | accepted
**M0 security review outcomes.** Fencing token is mandatory on every job mutation and job results are written in one fenced transaction; handlers receive an AbortSignal that fires on lease loss. Storage never modifies or follows symlinks that leave the root. Only `validateGuide` can produce a `ValidatedGuide` (branded type); storage and UI accept nothing else; assistant citations and step simplifications are validated too. All repository functions and the `JobQueue` interface are async so the database can change later (D-010). Analyses carry `source_kind` with a CHECK that mock and photo-set results are owner-scoped. Configuration is read through `src/lib/config.ts`, which rejects a weak session secret in production.

## D-013 | 2026-11-11 | software-engineer, ui-ux-designer (accepted) | accepted
**UI implementation choices.** Sheets and dialogs use the native `<dialog>` element with an added Tab-wrap trap and page scroll lock. `BottomSheet` takes `lgPresentation: panel | dialog` for >= 1024px. The component gallery `/dev/ui` returns 404 in production unless `ENABLE_DEV_UI=1`. Dark styles use a custom Tailwind variant that honours `data-theme`.

## D-014 | 2026-11-11 | software-engineer | accepted
**Migrations that rebuild tables run with foreign keys off**, followed by `foreign_key_check`, then foreign keys back on. Covered by an upgrade test with existing rows.

## D-015 | 2026-11-11 | orchestrator | accepted
**M1 decisions.** (1) The Processing screen shows only stages the API reports: Reading pages (ingest + render), Finding parts and building steps (analyse, one stage), Double-checking (verify), finishing (publish) - honesty applies to progress as well as content; USER_FLOWS section 4 to be aligned by the designer. (2) `rate_limited` (too many uploads; 429/503) and `quota_exceeded` (monthly free-guide quota, off by default) are separate error codes with separate copy. (3) Proxy headers are ignored unless `TRUST_PROXY_HOPS` is set. (4) With the mock provider, the Lumen fixture manual gets its real fixture guide; any other upload gets a clearly labelled synthetic demo guide (one low-confidence step per page, nothing invented) so the whole flow can be exercised without API cost. (5) HEIC is converted in the browser where it can decode it and otherwise rejected with a clear message; no conversion dependency in the MVP.

## D-016 | 2026-11-11 | orchestrator | accepted
**M1 review outcomes.** (1) "It's still not working" is driven by user-initiated retries (`retryCount`), not the server's internal attempt counter. (2) A rejected ("not a manual") or failed upload keeps a deletable card in the Library, so the user can see what happened and remove it; this overrides USER_FLOWS 10.1 until the designer aligns it. (3) Any failure after analysis (including publish) uses the title "We couldn't finish your guide". (4) Focus moves to the page heading on every route change.

## D-017 | 2026-11-12 | ui-ux-designer (accepted by orchestrator) | accepted
**M2 design rulings.** (1) Callout discs always show a 1-based index, never the part letter (a lettered disc would imitate the manual's own circled labels); part chips carry that number instead of a thumbnail. (2) No repeated words: when a manual quote is identical to the instruction, checkpoint or warning text, show the text once with a "From your manual" source line and page tag; show the full quote only when it differs. (3) The dim wash never covers the step's own source region, and is off in the Original viewer. (4) The source visual fits the page ("contain") at desktop sizes; it never crops content away. (5) Step changes replace browser history; overlays push. (6) The safety acknowledgement gates the first Start only and is not persisted. (7) Completion with skipped steps is titled "Not finished yet." (8) Short primary labels on small screens ("I checked"; "Done" with an arrow in landscape) with the full label for assistive technology.

## D-018 | 2026-11-12 | senior-engineer (accepted by orchestrator) | accepted
**Progress writes are operations, not snapshots.** The app saves with `PATCH /api/guides/:id/progress` carrying only what changed (`complete`, `uncomplete`, `currentStepId`, `checklist`), applied in one transaction and returning the merged progress. Completing and un-completing steps commute, so two tabs or devices cannot erase each other's work; the current step and each checklist item are last-write-wins. Clients adopt the response and re-read progress when the tab regains focus. `PUT` (whole-record replace) remains only for tooling and test seeding. Reason: QA reproduced data loss with two tabs under the snapshot contract.

## D-019 | 2026-11-12 | software-engineer (accepted by orchestrator) | accepted
**Assistant answer guards.** (1) A question and its answer are stored together, only after the guards pass; a failed or cancelled answer leaves nothing. (2) While streaming, text is held back from the first word containing a number or quantity until the answer is verified against the cited steps, so an unverified measurement is never shown; on `done` the client replaces the streamed text with the verified message. (3) An answer whose numbers are not found in the cited steps is replaced by the explicit not-in-manual response. (4) Answers never state page numbers in prose; pages are carried by citations. (5) A rejected simplification is not cached. (6) Invalid citations are dropped; an answer left with none is flagged `note: no_citation`.

## D-020 | 2026-11-12 | senior-engineer (review), orchestrator (accepted) | accepted - supersedes D-019 item 6
**Assistant hardening before any real model.** (1) An answer that is not grounded, or is left with no valid citation, is replaced by the fixed not-in-manual text - model-written free text never reaches the UI without a valid citation (`note: no_citation` is retired). (2) The quantity check normalises text (NFKC, strips format characters), treats unit words, roman numerals, mixed-script words and number words as quantities, and holds the whole answer for manuals that are not in English. (3) Numbers are matched as number+unit pairs against each cited step separately, with at most 3 citations as evidence. (4) Web and email addresses in an answer must appear in a cited step. (5) Answers have a 60 s timeout, the provider is stopped at the length cap, and a session may have one stream at a time. (6) Streamed deltas are cleaned of control and text-direction characters. (7) The real provider adapter receives only the assembled prompt, simplify gets its own prompt builder, and simplify output is cleaned and length-capped before caching. (8) Message history keeps the last 200 per guide.

## D-021 | 2026-11-12 | ui-ux-designer (accepted by orchestrator) | accepted
**Assistant UI rulings.** (1) Desktop (>= 1024): the assistant is a non-modal dock in the right column with a pinned step summary above the chat - all warning and irreversible banners always visible and never collapsible, then a toggle row that collapses only the instruction and checkpoint (max-height 44%). Warnings are never hidden behind another surface. (2) Below 1024 the assistant is a bottom sheet, opening at full height. (3) Enter sends on desktop pointers; on touch Enter is a newline and the Send button sends. (4) Citations are two chips: "Step n" (navigates; hidden when it cites the current step) and "p. n" (opens the viewer). (5) Stop discards the partial answer and keeps the question. (6) Cut from the MVP spec: Helpful / Not helpful buttons, offline indicator on Ask, message-limit banner. (7) While an answer is held for verification the UI shows provisional text muted with a status line ("Looking in your manual..." -> "Checking this against your manual..." -> after 20 s "Still checking. This can take up to a minute."). (8) Provenance colour rule: ink left rule = the manual's words; accent left rule = Instructor's explanation. (9) Not-in-manual copy: "I couldn't find this in your manual, so I won't guess. Check the original manual or ask the manufacturer."

## D-022 | 2026-11-12 | orchestrator | accepted - refines D-020 item 2 and D-021 item 1
**Quantity guard calibration and dock banners.** QA measured the hardened guard rejecting 7 of 10 everyday-English answers. Rules now: (1) Digits, fractions, roman numerals and number words from two upward are quantities and must match evidence. (2) "one", "single", "both", "once", "a few", "pair" are ordinary words, not quantities - unless directly followed by a measurement unit ("one inch"). (3) A unit word is a quantity only when attached to a number, a number word, or "a/an" + measurement unit ("an inch", "a litre"); bare "minute", "foot", "pound", "degree", "day" are ordinary words. (4) "step N" in prose is allowed when N is a real step number of the guide. (5) Ordinals "first" and "second" are ordinary; "third" and above must appear in the evidence. (6) Before matching, text is normalised: diacritics stripped, case folded, known look-alike characters mapped to Latin; in an English guide any remaining word in a non-Latin script causes the answer to be rejected. Residual risk accepted: "use one screw" where the manual says a different count is not caught by rule 2; counts of two or more are. (7) Desktop dock: banners are never height-capped or clipped; the 44% cap applies only to the collapsible instruction + checkpoint; the chat keeps a minimum height and the dock column scrolls as a whole when the window is too short.

## D-023 | 2026-11-13 | orchestrator | accepted - completes D-022
**Final guard and dock rules for M3.** (1) On desktop windows under 560px tall the assistant opens as the modal bottom sheet, not the dock, so a warning can never sit under the action bar. (2) Article + time unit is a quantity even when followed by "to" ("leave it for an hour to dry" is rejected); the only exemption is the idiom "take a minute to". (3) "million", "thousand", "hundred", "dozen", "half", "halfway", and multiplier forms ("x2", "2x", "twofold", "double", "twice") are quantities. (4) "pair" is an ordinary word unless a unit follows. (5) The reduced-motion rule covers `::backdrop`.

## D-024 | 2026-11-13 | orchestrator | proposed (needs user approval)
**Real-model accuracy test.** Plan, API usage and cost estimate in `docs/REAL_MODEL_PROPOSAL.md`: 3 real manuals x 3 models (Opus 5.5, Sonnet 5.5, Haiku 5.5) x up to 3 prompt variants x 2 repeats, expected about $25, requested hard cap $50. No spend until the user approves and supplies an API key.

## D-025 | 2026-11-13 | user | accepted - resolves D-024
**Real-model accuracy test approved with changes.** Hard cap **$10**. Model: **Claude Haiku 5.5 (`claude-haiku-5-5`) only** - no Opus or Sonnet runs. Test manuals: chosen by the team from ones that are free to use for testing. The API key is supplied through the environment's secret settings, never in chat or the repo. Haiku 5.5 is therefore the model for analysis, verification and the assistant unless the user decides otherwise after the results.
