// AUTO-GENERATED FILE - DO NOT EDIT
// Generated from compress-nudge.md by scripts/generate-prompts.ts
// To modify, edit compress-nudge.md and run `npm run generate:prompts`

export const COMPRESS_NUDGE = `<instruction name=context_limit_reached>
CRITICAL CONTEXT LIMIT
Your session context has exceeded the configured limit. Strict adherence to context compression is required.

PROTOCOL
You should prioritize context management, but do not interrupt a critical atomic operation if one is in progress. Once the immediate step is done, you must perform context management.

IMMEDIATE ACTION REQUIRED
PHASE COMPLETION: If a phase is complete, use the \`compress\` tool to condense the entire sequence into a detailed summary
</instruction>
`
