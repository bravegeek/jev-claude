# jev-claude

Levels 5–9 of [disler/ten-levels-of-jev](https://github.com/disler/ten-levels-of-jev) for Claude Code. The level logic is imported from a clone at `~/dev/ten-levels-of-jev` (override with `JEV_REPO`), not copied.

> **Data leaves your machine.** Every Jev call goes to an external model (OpenRouter by default). The hooks send your prompts, commands, file edits and tool output; the MCP tools send whole file contents. Secret-looking files are refused, but anything else in the project can be sent.

| Level | Where | What happens |
|---|---|---|
| 5 model routing, you | `hooks/prompt.ts`, UserPromptSubmit | suggests `/model opus` or `/model sonnet` on the first request and on a task switch |
| 5 model routing, subagents | `mcp/server.ts` | `route_model`; the server tells Claude to call it before starting a subagent |
| 6A bash gate | `hooks/guard.ts`, PreToolUse Bash | denies irreversible or destructive commands |
| 6B write gate | `hooks/guard.ts`, PreToolUse Write/Edit | denies writes outside the project, and content holding credentials |
| 6C result screen | `hooks/guard.ts`, PostToolUse Read/Bash | adds a warning next to output that carries instructions aimed at Claude |
| 7 should I compact | `hooks/prompt.ts` → `hooks/compact.ts`, UserPromptSubmit | tells *you* when to compact, with a ready-made `/compact <instructions>` |
| 8 cheap reads | `mcp/server.ts` | `ask_jev_file_bool`, `_choice`, `_score` |
| 9 files at scale | `mcp/server.ts` | `ask_jev_files`, `pick_first_file` |

## Setup

```bash
# key (OpenRouter); or export OPENROUTER_API_KEY
mkdir -p ~/.config/jev && read -s k && echo "$k" > ~/.config/jev/openrouter_key && chmod 600 ~/.config/jev/openrouter_key

# levels 5 (subagents), 8-9, every project
claude mcp add --scope user jev -- node ~/dev/jev-claude/mcp/server.ts

# levels 5 (you), 6-7, one project at a time (writes .claude/settings.local.json, git-excluded)
node ~/dev/jev-claude/bin/enable.ts ~/dev/some-project        # --off to remove
```

## Differences from the pi version

- **5** Hooks cannot change the model, so the suggestion goes to you. It only speaks on the first request or when level 7 says the task changed, since switching mid-task throws away the prompt cache. Jev's questions are the repo's; the thresholds are not. Live, the "least costly model" pick leaned fast and was unsure on hard tasks (powerful at 0.38–0.60), while the effort Score split cleanly (routine ≤ 0.98, hard ≥ 1.36). So in `lib/route.ts` effort leads: ≥ 1.5 or a confident powerful pick → Opus; < 1.0 with a confident fast pick → Sonnet (Haiku for mechanical subagent work, < 0.75); between → no suggestion, Sonnet for subagents.

- **6C** cannot rewrite a built-in tool's output, so the warning is added as context beside it.
- **7** Claude cannot compact itself, and a PreCompact hook cannot change the instructions. So the tier goes to you as a message, and the cut-point pick (7C) is baked into the `/compact` command it suggests. Lines are raised to 60k/100k/140k tokens (`JEV_COMPACT_LINES`); the repo's demo lines sit below Claude Code's system prompt.
- **6B** exempts Claude Code's own `~/.claude` and scratchpad from the outside-the-project check. Their content is still screened.
- **8/9** refuse paths outside the project and likely secret files (`.env`, `*.pem`, `id_rsa`, …). MCP tools skip Claude Code's Read permissions, and the file goes to an external model.

## Behaviour

- Fails open. If Jev errors or takes more than 5s (`JEV_HOOK_TIMEOUT_MS`), the tool call goes ahead. The gate is a signal, not a control; see the repo's level 6 notes.
- Every decision is logged to `~/.cache/jev-claude/decisions.jsonl`.
- `JEV_GUARD=off`, `JEV_COMPACT=off`, `JEV_ROUTE=off`, `JEV_GATES=A,C` switch parts off for a session.
- Each gated tool call adds one Jev call (~300ms).

## Tests

`npm test` runs offline against the repo's mock backend. It checks the wiring: hook I/O, deny format, fail-open, transcript parsing, path rules, and an MCP round trip. The mock picks by word overlap, so it says nothing about judgment quality.
