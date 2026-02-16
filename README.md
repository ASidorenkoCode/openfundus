# OpenFundus

> All-in-one [OpenCode](https://github.com/opencode-ai/opencode) plugin: cross-session memory, selective context reduction, and session protection hooks

OpenFundus combines three subsystems into a single plugin:

1. **Memory** — Persistent cross-session memory with full-text search, tagging, linking, and auto-recall
2. **SCR (Selective Context Reduction)** — Token-aware context pruning, deduplication, and compression
3. **Hooks** — Eight session protection and enhancement hooks that run automatically

## Installation

```bash
bun add openfundus
```

Add to your OpenCode config (`opencode.json`):

```json
{
  "plugins": ["openfundus"]
}
```

## Memory

### Overview

OpenFundus stores important findings, decisions, and code patterns in a local SQLite database with FTS5 full-text search. Memories persist across sessions and are automatically recalled when relevant.

- **Full-text search** with BM25 ranking and relevance decay (90-day half-life)
- **Deduplication** via Jaccard similarity to prevent storing near-duplicates
- **Auto-recall** injects relevant memories into the system prompt at session start
- **Auto-extraction** detects preferences, bug fixes, and conventions from tool outputs
- **Mistake tracking** stores tool errors as anti-pattern memories to avoid repeating them
- **File knowledge caching** remembers file contents to skip redundant reads

### Memory Tools

| Tool | Description |
|------|-------------|
| `memory_store` | Store a memory with content, category, tags, scope (project/global), and optional dedup bypass |
| `memory_search` | Full-text search with BM25 ranking, category filter, and configurable result limit |
| `memory_update` | Update content, category, or source of an existing memory |
| `memory_delete` | Delete a memory by ID |
| `memory_list` | List recent memories with category and scope filters |
| `memory_refresh` | Boost a memory's relevance score to prevent decay |
| `memory_tag` | Add, remove, or list tags on a memory; list all tags; search by tag |
| `memory_link` | Create relationships between memories (related, supersedes, contradicts, extends) |
| `memory_stats` | Show total count, category breakdown, and database size |
| `memory_cleanup` | FTS optimization, purge old memories, enforce limits, vacuum database |
| `memory_export` | Export memories to versioned JSON with tags and links |
| `memory_import` | Import memories from JSON with conflict handling and link restoration |
| `memory_file_check` | Check if a file has changed since last read; returns cached content if unchanged |

### Memory Categories

`decision` | `pattern` | `debugging` | `preference` | `convention` | `discovery` | `anti-pattern` | `general`

### Memory Configuration

Configure under the `openrecall` key in `opencode.json` plugins config:

```json
{
  "plugins": {
    "openfundus": {
      "autoRecall": true,
      "autoExtract": true,
      "searchLimit": 10,
      "maxMemories": 0,
      "globalMemories": false
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbPath` | string | `~/.local/share/opencode/openrecall.db` | Database file path |
| `autoRecall` | boolean | `true` | Auto-inject relevant memories on session start |
| `autoExtract` | boolean | `true` | Auto-extract patterns from tool outputs |
| `searchLimit` | number | `10` | Default max search results |
| `maxMemories` | number | `0` | Memory limit (0 = unlimited) |
| `globalMemories` | boolean | `false` | Enable cross-project global memories |
| `agentModel` | string | `""` | Model to use for agent extraction |

## SCR (Selective Context Reduction)

### Overview

SCR manages the LLM's context window by removing redundant or low-value content. It runs automatically alongside memory features and provides three tools plus automatic reduction strategies.

### SCR Tools

| Tool | Description |
|------|-------------|
| `prune` | Remove completed tool call/result pairs from context by their numeric IDs |
| `distill` | Replace a tool's output with a condensed summary, preserving key information |
| `compress` | Collapse a range of messages into a summary using text boundaries |

### Automatic Strategies

SCR applies these strategies transparently during the message transform phase:

- **Deduplication** — Detects and removes duplicate tool calls (e.g., reading the same file twice)
- **Supersede Writes** — When a file is written/edited multiple times, keeps only the latest version
- **Purge Errors** — Removes old error outputs that are no longer relevant

### SCR CLI Commands

Use `/scr` in the OpenCode TUI:

| Command | Description |
|---------|-------------|
| `/scr help` | Show all available SCR commands |
| `/scr context` | Display current context usage and prunable tools |
| `/scr stats` | Show token savings statistics (session and all-time) |
| `/scr sweep [n]` | Auto-prune the oldest N tool results |
| `/scr manual [on\|off]` | Toggle manual mode (disables automatic nudges) |
| `/scr prune` | Trigger prune on next assistant turn |
| `/scr distill` | Trigger distill on next assistant turn |
| `/scr compress` | Trigger compress on next assistant turn |

### SCR Configuration

SCR reads its config from `~/.config/opencode/scr.jsonc` (or `scr.json`). Example:

```jsonc
{
  "enabled": true,
  "debug": false,
  "strategies": {
    "deduplication": { "enabled": true },
    "supersedeWrites": { "enabled": true },
    "purgeErrors": { "enabled": true, "turns": 3 }
  },
  "tools": {
    "prune": { "permission": "allow" },
    "distill": { "permission": "allow", "showDistillation": true },
    "compress": { "permission": "allow", "showCompression": true },
    "settings": {
      "nudgeEnabled": true,
      "nudgeFrequency": 4,
      "protectedTools": ["memory_store", "memory_search"],
      "contextLimit": "80%"
    }
  },
  "commands": { "enabled": true }
}
```

| Key | Description |
|-----|-------------|
| `enabled` | Enable/disable SCR entirely |
| `debug` | Write debug logs to `~/.config/opencode/logs/scr/` |
| `tools.*.permission` | `"allow"` (auto), `"ask"` (confirm), or `"deny"` (disabled) |
| `tools.settings.nudgeEnabled` | Periodically remind the model to prune |
| `tools.settings.nudgeFrequency` | Nudge every N tool calls |
| `tools.settings.contextLimit` | Token threshold for compress nudge (absolute number or `"80%"`) |
| `tools.settings.protectedTools` | Tools that should never be pruned |
| `tools.settings.modelLimits` | Per-model context limits, e.g. `{ "anthropic/claude-sonnet-4-5-20250929": "75%" }` |
| `strategies.deduplication.enabled` | Auto-remove duplicate tool calls |
| `strategies.supersedeWrites.enabled` | Keep only latest write to each file |
| `strategies.purgeErrors.enabled` | Auto-remove old error outputs |
| `strategies.purgeErrors.turns` | How many turns back to purge errors |

## Session Protection Hooks

These hooks run automatically and require no configuration.

### 1. Preemptive Compaction

Monitors context usage and auto-triggers OpenCode's built-in compaction at 78% capacity. Prevents the model from hitting the context limit mid-task.

### 2. Compaction Todo Preserver

Snapshots the current todo list before compaction runs, then restores it after. Prevents todos from being lost when the context is compacted.

### 3. Edit Error Recovery

When an `Edit` tool call fails (e.g., the `old_string` was not found), injects a reminder to re-read the file before retrying. Prevents the model from repeatedly failing on stale file content.

### 4. Tool Output Truncator

Truncates excessively large tool outputs to prevent context bloat:
- `Grep`, `Glob`, `WebFetch`: ~40,000 characters
- All other tools: ~200,000 characters

Appends a truncation notice so the model knows the output was cut.

### 5. Non-Interactive Environment

Prepends environment variables to shell commands that invoke `git` to prevent interactive prompts that would hang:
- `GIT_EDITOR=:` `GIT_PAGER=cat` `GIT_TERMINAL_PROMPT=0`

Also warns when interactive tools (`less`, `vim`, `nano`, etc.) are detected.

### 6. Context Window Monitor

At 70%+ context usage, appends a brief status line to tool outputs reminding the model how much context remains. Helps the model make informed decisions about whether to prune.

### 7. Write-Existing-File Guard

Blocks `Write` tool calls that target existing files and throws an error directing the model to use `Edit` instead. Prevents accidental file overwrites.

### 8. Session Recovery

Detects API errors (`tool_result_missing`, `thinking_block_order`, `thinking_disabled_violation`) and automatically retries the failed message. Prevents sessions from dying due to transient API issues.

## Structured Compaction

When OpenCode compacts the session context, OpenFundus injects a structured summary template that preserves:

1. Original user requests (verbatim)
2. Final goal and expected deliverable
3. Work completed with file paths
4. Remaining tasks
5. Active working context (files, code in progress, references, state)
6. Mistakes and anti-patterns encountered
7. Key decisions and discoveries

This ensures continuity after compaction without losing critical context.

## Data Storage

- **Memory database**: `~/.local/share/opencode/openrecall.db` (configurable)
- **SCR session state**: `~/.local/share/opencode/storage/plugin/scr/{sessionId}.json`
- **SCR logs**: `~/.config/opencode/logs/scr/` (when debug is enabled)
- All data is stored locally

## Development

```bash
bun install
bun test
bun run typecheck
```

## License

MIT
