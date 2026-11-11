# Development Status

Last updated: 2026-11-11 by orchestrator. **Read this first when resuming.**

## Where we are
Milestone M-1 (development system + product definition) is complete. No application code exists yet.

Done:
- Agent team defined in `.claude/agents/` and routing rules in `CLAUDE.md`; `node scripts/validate-agents.mjs` passes; 24/24 validator tests pass.
- PRD, architecture (with senior-engineer amendments, section 10), design system and user flows v1, implementation plan.
- One full feature loop was exercised on the validator script (engineer -> QA -> fix -> orchestrator verification).

## Next action
**Blocked on user approval** of: beachhead + source-anchored visuals (D-002, D-003), MVP scope (D-004), stack (D-005), design identity (D-008), and whether/when to supply an Anthropic API key (D-006). After approval start M0 in `IMPLEMENTATION_PLAN.md`:
1. `ui-ux-designer`: align USER_FLOWS with D-007/D-009 (small).
2. `software-engineer`: scaffold app per ARCHITECTURE sections 2, 9, 10.
3. `senior-engineer`: region/panel spike (needs API key).

## Verification record for the multi-model system (2026-11-11, Claude Code 2.1.322)
- Verified from subagent transcripts: designer task ran on `claude-fable-5-2`, engineer and QA tasks on `claude-sonnet-5-5`, senior-engineer task on `claude-opus-5-5`. All three models are available on this account.
- **Not yet verified:** delegation by project agent name (`subagent_type: software-engineer` etc.). The session that created `.claude/agents/` could not see the new agents ("Agent type not found"); Claude Code loads a newly created agents directory only at session start. In that session the fallback in `CLAUDE.md` was used (general-purpose agent + model alias + "read your agent file"). **First thing in the next session:** delegate one small task by agent name and confirm the model in `/tasks`; then update this section.

## How to inspect agents
- `/agents` - lists project agents and their configured models.
- `/tasks` - running subagents with the model each is using (Claude Code >= 2.1.242).
- Transcripts: `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl` (each assistant message records `"model"`).
- `node scripts/validate-agents.mjs` - static check of the definitions.

## Version notes
- Fable 5.2 needs Claude Code >= 2.1.321; Sonnet 5.5 >= 2.1.284; Opus 5.5 >= 2.1.280.
- Agent frontmatter `model` takes precedence over `CLAUDE_CODE_SUBAGENT_MODEL` only from 2.1.251; on older versions that env var overrides the agent files.

## Open issues
- USER_FLOWS not yet aligned with D-007/D-009.
- Validator known limitations (accepted): unclosed frontmatter followed by a later `---` is misparsed; headings inside code fences count.
- Design contrast ratios are hand-calculated; automated test required in M0.
