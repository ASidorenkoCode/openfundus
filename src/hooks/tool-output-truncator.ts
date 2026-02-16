/**
 * Tool Output Truncator Hook
 *
 * Truncates large tool outputs to prevent context bloat. Applies aggressive limits
 * to search tools (Grep, Glob, WebFetch) and a generous default for other tools.
 *
 * Uses character-based estimation (~4 chars per token).
 *
 * Inspired by oh-my-opencode's tool-output-truncator hook.
 */

const CHARS_PER_TOKEN = 4

// Token limits (converted to char limits internally)
const DEFAULT_MAX_TOKENS = 50_000 // ~200k chars
const WEBFETCH_MAX_TOKENS = 10_000 // ~40k chars

const DEFAULT_MAX_CHARS = DEFAULT_MAX_TOKENS * CHARS_PER_TOKEN
const WEBFETCH_MAX_CHARS = WEBFETCH_MAX_TOKENS * CHARS_PER_TOKEN

/** Tools that frequently produce oversized output */
const TRUNCATABLE_TOOLS = new Set([
  "grep",
  "Grep",
  "glob",
  "Glob",
  "webfetch",
  "WebFetch",
  "interactive_bash",
  "Interactive_bash",
  "bash",
  "Bash",
])

const TOOL_SPECIFIC_LIMITS: Record<string, number> = {
  webfetch: WEBFETCH_MAX_CHARS,
  WebFetch: WEBFETCH_MAX_CHARS,
}

export function handleToolOutputTruncation(
  tool: string,
  output: { output: string },
): void {
  if (!TRUNCATABLE_TOOLS.has(tool)) return
  if (typeof output.output !== "string") return

  const maxChars = TOOL_SPECIFIC_LIMITS[tool] ?? DEFAULT_MAX_CHARS
  if (output.output.length <= maxChars) return

  // Truncate at a line boundary if possible
  const truncated = output.output.slice(0, maxChars)
  const lastNewline = truncated.lastIndexOf("\n")
  const cutPoint = lastNewline > maxChars * 0.8 ? lastNewline : maxChars

  const originalLines = output.output.split("\n").length
  const keptLines = output.output.slice(0, cutPoint).split("\n").length
  const droppedLines = originalLines - keptLines

  output.output =
    output.output.slice(0, cutPoint) +
    `\n\n[Output truncated: showing ${keptLines} of ${originalLines} lines (${droppedLines} lines omitted). Use more specific queries to reduce output size.]`
}
