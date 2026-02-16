/**
 * Edit Error Recovery Hook
 *
 * Detects edit/apply_patch tool failures in the message history and injects
 * a recovery reminder into the system prompt, forcing the AI to re-read the
 * file before retrying.
 *
 * Works via experimental.chat.system.transform since tool.execute.after does
 * NOT fire when tools throw errors (OpenCode limitation).
 *
 * Inspired by oh-my-opencode's edit-error-recovery hook.
 */

export const EDIT_ERROR_PATTERNS = [
  "oldstring and newstring must be different",
  "oldstring not found",
  "oldstring found multiple times",
  // apply_patch errors
  "apply_patch verification failed",
  "patch rejected",
  "hunk application failed",
]

const EDIT_TOOL_NAMES = new Set(["edit", "apply_patch"])

const EDIT_ERROR_REMINDER = `[EDIT ERROR RECOVERY]
A recent edit/apply_patch tool call failed. Before retrying:
1. READ the target file to see its ACTUAL current state
2. VERIFY the content matches your assumption
3. Only then retry the edit with corrected old_string/patch
DO NOT attempt another edit without reading the file first.`

/** Track which sessions have already been reminded to avoid spamming */
const remindedCallIds = new Set<string>()

/**
 * Scan recent messages for edit tool errors. Called from
 * experimental.chat.system.transform to inject a reminder.
 */
export function checkEditErrorsInMessages(
  messages: Array<{ info: { role: string }; parts: any[] }>,
  output: { system: string[] },
): void {
  // Look at only the last few messages for recent errors
  const recentMessages = messages.slice(-6)

  for (const msg of recentMessages) {
    if (!msg.parts || !Array.isArray(msg.parts)) continue

    for (const part of msg.parts) {
      if (part.type !== "tool") continue
      if (!EDIT_TOOL_NAMES.has(part.tool?.toLowerCase?.())) continue

      // Check for error status
      const state = part.state
      if (!state) continue

      const isError = state.status === "error"
      const errorText = (state.error || state.output || "").toLowerCase()
      const hasKnownPattern = EDIT_ERROR_PATTERNS.some((p) => errorText.includes(p))

      if (isError || hasKnownPattern) {
        const callId = part.id || `${msg.info.role}-${part.tool}`
        if (remindedCallIds.has(callId)) continue

        remindedCallIds.add(callId)
        output.system.push(EDIT_ERROR_REMINDER)
        return // One reminder per turn is enough
      }
    }
  }
}

export function clearEditErrorTracking() {
  remindedCallIds.clear()
}

/**
 * Legacy handler for tool.execute.after (kept for tools that return errors
 * as strings instead of throwing). Unlikely to fire for edit/apply_patch
 * but kept as a safety net.
 */
export function handleEditErrorRecovery(
  tool: string,
  output: { output: string },
): void {
  if (!EDIT_TOOL_NAMES.has(tool.toLowerCase())) return
  if (typeof output.output !== "string") return

  const outputLower = output.output.toLowerCase()
  const hasEditError = EDIT_ERROR_PATTERNS.some((pattern) => outputLower.includes(pattern))

  if (hasEditError) {
    output.output += `\n${EDIT_ERROR_REMINDER}`
  }
}
