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
