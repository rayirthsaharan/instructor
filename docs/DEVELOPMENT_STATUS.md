# Development Status

Last updated: 2026-11-11 by orchestrator. **Read this first when resuming.**

## Where we are
- M-1, M0, M1: done (see IMPLEMENTATION_PLAN).
- **M2 (guide experience) is built and in final QA re-check.** Overview + prep checklist (`/g/[id]`), Step player and Original viewer (`/g/[id]/play`), Completion (`/g/[id]/done`), shared guide store. Designer approved with fixes (all 18 applied, D-017). QA's first pass failed on two-tab data loss; the senior engineer fixed it with an operation-based `PATCH` progress contract (D-018); QA's other defects are fixed.
- Last full run by an engineer: `npm run check` 598/598; e2e 223 passed, 2 failed - both QA-owned tests awaiting update (`e2e/qa-m2-experience.spec.ts:413` expects old copy "Almost there."; `e2e/qa-m1-flow.spec.ts:331` keyboard test - cause not yet known).
- **Interrupted:** the QA re-check (brief in the orchestrator's last message to QA: update those two tests, verify D-018, re-check the four QA defects and designer P1 items, and investigate whether the source-visual image-error block really detaches in the app - an engineer masked it with a `toPass` retry in `e2e/m2-player-flow.spec.ts`) stopped on the account usage limit. Resume it, or start a fresh `qa-engineer` with the same brief.

## Next actions
1. Finish the M2 QA re-check; fix anything it confirms; orchestrator runs `npm run check`, `npm run build`, `npm run e2e -- --trace off`; close M2 in IMPLEMENTATION_PLAN and report to the user.
2. M3 (assistant on the mock provider): chat API with streaming and validated citations, assistant sheet, "Explain it more simply" with cache (`simplifyStepChecked` exists).
3. M4: polish, performance, security review, P1 extras (notes/bookmarks, print).
4. Before any real-model work: present the user a test plan and cost estimate (D-010).
- Run locally: `npm run dev:all` (web + worker). API contract: `docs/API.md`.

## Rules in force (from the user, D-010)
- No paid API usage without asking. Everything runs on `AI_PROVIDER=mock`. The diagram-location accuracy spike needs a test plan + cost estimate presented to the user first.
- Accuracy invariants: never invent; every step keeps its source page; manual-sourced vs inferred content is visibly distinguished; warnings verbatim.
- Report to the user at each milestone: built / tested / needs approval.

## Multi-model system - verification record (Claude Code 2.1.322)
- Models confirmed from transcripts: designer on `claude-fable-5-2`, engineer and QA on `claude-sonnet-5-5`, senior engineer on `claude-opus-5-5`.
- **Delegation by project agent name is verified**: after a session restart, `software-engineer` and `qa-engineer` were called by name with no model override and ran on `claude-sonnet-5-5`. A session that *creates* `.claude/agents/` cannot see the agents until it restarts; the fallback in `CLAUDE.md` covers that case.
- All four project agents have now been called by name; `senior-engineer` ran on `claude-opus-5-5`, `software-engineer` and `qa-engineer` on `claude-sonnet-5-5` (confirmed from transcripts).
- Usage limits: heavy parallel runs can hit the account's 5-hour limit; interrupted agents keep their work and can be resumed with a message.

## How to inspect agents
- `/agents` - project agents and configured models. `/tasks` - running subagents and the model each uses (Claude Code >= 2.1.242).
- Transcripts: `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl` (each assistant message records `"model"`).
- `npm run validate:agents` - static check of the definitions.

## Version notes
- Fable 5.2 needs Claude Code >= 2.1.321; Sonnet 5.5 >= 2.1.284; Opus 5.5 >= 2.1.280.
- Agent frontmatter `model` outranks `CLAUDE_CODE_SUBAGENT_MODEL` only from 2.1.251.

## Open issues
- Number-word quantity rule is strict; tune against real model output later.
- USER_FLOWS 10.1 still says a rejected upload leaves no Library card; the app keeps a deletable card (D-016) - designer to align.
- A small race remains between a concurrent delete and a shared page-image write (render re-checks files before finishing).
- The "We already know this manual" toast is not built (no API signal).
- Validator script known limitations (accepted): unclosed frontmatter followed by a later `---`; headings inside code fences.
- Build prints two harmless font-metric warnings for the Atkinson fonts.
