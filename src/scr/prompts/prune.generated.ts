// AUTO-GENERATED FILE - DO NOT EDIT
// Generated from prune.md by scripts/generate-prompts.ts
// To modify, edit prune.md and run `npm run generate:prompts`

export const PRUNE = `Use this tool to remove tool outputs from context entirely. No preservation - pure deletion.

THE PRUNABLE TOOLS LIST
A \`<prunable-tools>\` section surfaces in context showing outputs eligible for removal. Each line reads \`ID: tool, parameter (~token usage)\` (e.g., \`20: read, /path/to/file.ts (~1500 tokens)\`). Reference outputs by their numeric ID - these are your ONLY valid targets for pruning.

THE WAYS OF PRUNE
\`prune\` is surgical deletion - eliminating noise (irrelevant or unhelpful outputs), superseded information (older outputs replaced by newer data), or wrong targets (you accessed something that turned out to be irrelevant). Use it to keep your context lean and focused.

BATCH WISELY! Pruning is most effective when consolidated. Don't prune a single tiny output - accumulate several candidates before acting.

Do NOT prune when:
NEEDED LATER: You plan to edit the file or reference this context for implementation.
UNCERTAINTY: If you might need to re-examine the original, keep it.

Before pruning, ask: _"Is this noise, or will it serve me?"_ If the latter, keep it. Pruning that forces re-fetching is a net loss.

THE FORMAT OF PRUNE
\`ids\`: Array of numeric IDs (as strings) from the \`<prunable-tools>\` list
`
