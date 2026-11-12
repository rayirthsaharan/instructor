# Implementation Plan

Status legend: `[ ]` todo, `[~]` in progress, `[x]` done (QA passed and orchestrator verified), `[!]` blocked.
Each task names its owner agent. Every feature task runs the feature loop in `CLAUDE.md`.

## M-1. Development system
- [x] Agent definitions, CLAUDE.md, project docs (orchestrator)
- [x] `scripts/validate-agents.mjs` (software-engineer -> qa-engineer)
- [x] Product vision, MVP and PRD drafted (orchestrator)
- [x] Design system and user flows v1 (ui-ux-designer)
- [x] Architecture risk review (senior-engineer) - amendments in ARCHITECTURE section 10
- [x] User approval of PRD scope, stack and design (D-010)

## M0. Foundations - DONE 2026-11-11 (QA passed, security review applied, orchestrator verified)
- [x] Align USER_FLOWS with D-007/D-009/D-010 (ui-ux-designer)
- [x] Scaffold app: Next.js + TS + Tailwind + Drizzle/SQLite + Vitest + Playwright; storage adapter; leased job queue + worker
- [x] Design tokens, UI primitives and gallery `/dev/ui` (designer approved)
- [x] Guide schema, `validateGuide` (branded `ValidatedGuide`), selectors, sample manual fixture
- [x] AIProvider interface + MockProvider
- [x] Senior-engineer security review and fixes (D-012)
- [!] Spike: diagram-panel location accuracy on sample manuals (senior-engineer) - **needs user approval of test plan and cost first (D-010)**; scheduled after the mocked experience is complete

## M1. Capture and pipeline - DONE 2026-11-11 (QA passed, security review applied, orchestrator verified)
- [x] Anonymous session cookie, ownership scoping, storage, upload API with validation and rate limits
- [x] Page rendering in a sandboxed child process (PDF) and image normalisation (photos)
- [x] Pipeline stages ingest/render/analyse/verify/publish on the mock provider; content-hash dedupe with ownership rules
- [x] Guides list, guide read, progress save, delete APIs (`docs/API.md`)
- [x] Library, Capture and Processing screens (designer approved)
- [x] Senior-engineer security review of the upload path (H-019) - all findings fixed
- [ ] AnthropicProvider (real analysis + verify) - **deferred: needs user approval for API spend (D-010)**

## M2. Guide experience - DONE 2026-11-12 (designer approved, QA passed, orchestrator verified)
- [x] Shared guide store with operation-based progress saves (D-018)
- [x] Guide overview and prep checklist (F3)
- [x] Step player: source visual with brackets, callouts and dim wash, zoom/pan, marks toggle, navigation, progress, resume (F4)
- [x] Original viewer (F6)
- [x] Read-aloud, wake lock, irreversible and low-confidence treatments, provenance labelling (F4, D-011)
- [x] Completion screen
- Note: the milestone security review for M2 is combined with M3's (the only new server surface in M2 is the PATCH progress route, written by the senior engineer).

## M3. Assistant
- [ ] Chat API with streaming, grounding and validated citations (F5)
- [ ] Assistant sheet UI, suggested questions, citation chips (F5)
- [ ] "Explain simpler" with cache

## M4. Library and polish
- [ ] Library/home, continue, delete (F7)
- [ ] Empty/error/loading states, motion pass, accessibility pass (designer review -> engineer)
- [ ] Rate limits, security review (senior-engineer), performance pass
- [ ] P1: notes/bookmarks (F8), print view (F9)
- [ ] End-to-end regression suite green; MVP sign-off (orchestrator)
