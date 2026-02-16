/**
 * Edit Error Recovery Hook
 *
 * Detects common Edit tool failures (oldString not found, strings must be different,
 * multiple matches) and injects a recovery reminder forcing the AI to re-read the file
 * before retrying.
 *
 * Inspired by oh-my-opencode's edit-error-recovery hook.
 */

const EDIT_ERROR_PATTERNS = [
  "oldstring and newstring must be different",
  "oldstring not found",
  "oldstring found multiple times",
]

const EDIT_ERROR_REMINDER = `
[EDIT ERROR - IMMEDIATE ACTION REQUIRED]

You made an Edit mistake. STOP and do this NOW:

1. READ the file immediately to see its ACTUAL current state
2. VERIFY what the content really looks like (your assumption was wrong)
3. CONTINUE with corrected action based on the real file content

DO NOT attempt another edit until you've read and verified the file state.
`

export function handleEditErrorRecovery(
  tool: string,
  output: { output: string },
): void {
  if (tool.toLowerCase() !== "edit") return
  if (typeof output.output !== "string") return

  const outputLower = output.output.toLowerCase()
  const hasEditError = EDIT_ERROR_PATTERNS.some((pattern) => outputLower.includes(pattern))

  if (hasEditError) {
    output.output += `\n${EDIT_ERROR_REMINDER}`
  }
}
