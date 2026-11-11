# Implementation Plan

Status legend: `[ ]` todo, `[~]` in progress, `[x]` done (QA passed and orchestrator verified), `[!]` blocked.
Each task names its owner agent. Every feature task runs the feature loop in `CLAUDE.md`.

## M-1. Development system
- [x] Agent definitions, CLAUDE.md, project docs (orchestrator)
- [x] `scripts/validate-agents.mjs` (software-engineer -> qa-engineer)
- [x] Product vision, MVP and PRD drafted (orchestrator)
- [~] Design system and user flows v1 (ui-ux-designer)
- [~] Architecture risk review (senior-engineer)
- [!] **User approval of PRD scope and stack** - gate for M0

## M0. Foundations
- [ ] Scaffold app: Next.js + TS + Tailwind + Drizzle/SQLite + Vitest + Playwright; commands documented (software-engineer)
- [ ] Design tokens and UI primitives from DESIGN_SYSTEM.md (software-engineer; designer reviews)
- [ ] Guide schema + validators + fixture guide for a sample manual (software-engineer)
- [ ] AIProvider interface + MockProvider (software-engineer)
- [ ] Spike: region accuracy on 3 sample manuals; decide crop/padding/fallback rules (senior-engineer) - needs API key approval

## M1. Capture and pipeline
- [ ] Session cookie, storage adapter, upload API with validation (software-engineer)
- [ ] Capture screen: PDF/photos, reorder, errors (software-engineer)
- [ ] Page rendering stage (software-engineer)
- [ ] Job runner, stages, progress API, processing screen (software-engineer)
- [ ] AnthropicProvider: analyse + verify with structured outputs (software-engineer; senior-engineer reviews prompts and injection posture)
- [ ] Content-hash dedupe (software-engineer)

## M2. Guide experience
- [ ] Guide overview and prep checklist (F3)
- [ ] Step player: source visual with highlights, zoom/pan, navigation, progress, resume (F4)
- [ ] Original viewer (F6)
- [ ] Read-aloud, wake lock, irreversible and low-confidence treatments (F4)
- [ ] Completion screen

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
