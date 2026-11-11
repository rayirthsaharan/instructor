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
