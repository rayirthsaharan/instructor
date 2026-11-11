# Development Status

Last updated: 2026-11-11 by orchestrator. **Read this first when resuming.**

## Where we are
- M-1 (development system, product definition): done. User approved direction, MVP scope, stack and design (D-010).
- M0 (foundations): done.
- **M1 (capture and pipeline): done.** A user can add a PDF or page photos, watch honest processing stages, and land on a guide (placeholder page). Everything runs on the mock AI provider: the bundled Lumen bookcase manual gets its real fixture guide; any other upload gets a clearly labelled demo guide.
- Verified by the orchestrator at M1 close: `npm run check` 492/492 unit tests, typecheck and lint clean; `npm run build` ok; `npm run e2e -- --trace off` 110/110.
- **M2 (guide experience: overview + prep checklist, step player, original viewer): in progress.** See IMPLEMENTATION_PLAN.
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
