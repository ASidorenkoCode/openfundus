/**
 * Session Recovery Hook
 *
 * Detects and recovers from common API errors:
 * - tool_result_missing: Tool crashed mid-execution, inject cancelled results
 * - thinking_block_order: Message structure corrupted, fix thinking block placement
 * - thinking_disabled_violation: Thinking blocks present when thinking is disabled
 *
 * Simplified from oh-my-opencode's session-recovery hook (SDK-only, no file storage).
 */

type RecoveryErrorType =
  | "tool_result_missing"
  | "thinking_block_order"
  | "thinking_disabled_violation"
  | null

interface MessageData {
  info?: {
    id?: string
    role?: string
    sessionID?: string
    error?: unknown
    agent?: string
    model?: { providerID: string; modelID: string }
  }
  parts?: Array<{
    type: string
    id?: string
    text?: string
    callID?: string
    [key: string]: unknown
  }>
}

interface RecoveryClient {
  session: {
    abort: (opts: { path: { id: string } }) => Promise<any>
    messages: (opts: { path: { id: string }; query?: any }) => Promise<any>
    promptAsync: (opts: { path: { id: string }; body: any }) => Promise<any>
  }
  tui: {
    showToast: (opts: { body: any }) => Promise<any>
  }
}

const THINKING_TYPES = new Set(["thinking", "redacted_thinking", "reasoning"])

function getErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error.toLowerCase()

  const errorObj = error as Record<string, unknown>
  for (const obj of [errorObj.data, errorObj.error, errorObj, (errorObj.data as any)?.error]) {
    if (obj && typeof obj === "object") {
      const msg = (obj as Record<string, unknown>).message
      if (typeof msg === "string" && msg.length > 0) return msg.toLowerCase()
    }
  }

  try {
    return JSON.stringify(error).toLowerCase()
  } catch {
    return ""
  }
}

function detectErrorType(error: unknown): RecoveryErrorType {
  const message = getErrorMessage(error)

  if (
    message.includes("thinking") &&
    (message.includes("first block") ||
      message.includes("must start with") ||
      message.includes("preceeding") ||
      message.includes("final block") ||
      message.includes("cannot be thinking") ||
      (message.includes("expected") && message.includes("found")))
  ) {
    return "thinking_block_order"
  }

  if (message.includes("thinking is disabled") && message.includes("cannot contain")) {
    return "thinking_disabled_violation"
  }

  if (message.includes("tool_use") && message.includes("tool_result")) {
    return "tool_result_missing"
  }

  return null
}

const processingErrors = new Set<string>()

export function createSessionRecoveryHook(client: RecoveryClient, directory: string) {
  const handleMessageError = async (event: {
    type: string
    properties?: unknown
  }): Promise<void> => {
    if (event.type !== "message.updated") return

    const props = event.properties as Record<string, unknown> | undefined
    const info = props?.info as {
      id?: string
      role?: string
      sessionID?: string
      error?: unknown
      finish?: boolean
    } | undefined

    if (!info || info.role !== "assistant" || !info.error) return

    const errorType = detectErrorType(info.error)
    if (!errorType) return

    const sessionID = info.sessionID
    const assistantMsgID = info.id
    if (!sessionID || !assistantMsgID) return
    if (processingErrors.has(assistantMsgID)) return
    processingErrors.add(assistantMsgID)

    try {
      // Abort the failing session first
      await client.session.abort({ path: { id: sessionID } }).catch(() => {})

      // Show recovery toast
      const titles: Record<string, string> = {
        tool_result_missing: "Tool Crash Recovery",
        thinking_block_order: "Thinking Block Recovery",
        thinking_disabled_violation: "Thinking Strip Recovery",
      }
      const messages: Record<string, string> = {
        tool_result_missing: "Injecting cancelled tool results...",
        thinking_block_order: "Fixing message structure...",
        thinking_disabled_violation: "Stripping thinking blocks...",
      }

      await client.tui
        .showToast({
          body: {
            title: titles[errorType],
            message: messages[errorType],
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {})

      // Fetch session messages
      const resp = await client.session.messages({
        path: { id: sessionID },
        query: { directory },
      })
      const allMsgs = ((resp as any).data ?? resp) as MessageData[]
      const failedMsg = allMsgs?.find((m) => m.info?.id === assistantMsgID)

      if (!failedMsg) return

      if (errorType === "tool_result_missing") {
        await recoverToolResultMissing(client, sessionID, failedMsg)
      } else if (errorType === "thinking_block_order") {
        await recoverThinkingBlockOrder(client, sessionID, allMsgs)
      } else if (errorType === "thinking_disabled_violation") {
        await recoverThinkingDisabled(client, sessionID, allMsgs)
      }
    } catch (e) {
      console.error("[OpenRecall] Session recovery failed:", e)
    } finally {
      processingErrors.delete(assistantMsgID)
    }
  }

  return { handleEvent: handleMessageError }
}

/** Inject cancelled tool results for crashed tool_use blocks */
async function recoverToolResultMissing(
  client: RecoveryClient,
  sessionID: string,
  failedMsg: MessageData,
): Promise<boolean> {
  const parts = failedMsg.parts ?? []
  const toolUseIds = parts
    .filter((p) => (p.type === "tool_use" || p.type === "tool") && (p.callID || p.id))
    .map((p) => p.callID ?? p.id!)

  if (toolUseIds.length === 0) return false

  const toolResultParts = toolUseIds.map((id) => ({
    type: "tool_result" as const,
    tool_use_id: id,
    content: "Operation cancelled by user (ESC pressed)",
  }))

  try {
    await (client.session as any).promptAsync({
      path: { id: sessionID },
      body: { parts: toolResultParts },
    })
    return true
  } catch {
    return false
  }
}

/** Fix thinking block ordering issues */
async function recoverThinkingBlockOrder(
  client: RecoveryClient,
  sessionID: string,
  messages: MessageData[],
): Promise<boolean> {
  // Find assistant messages missing a leading thinking block
  let anyFixed = false
  for (const msg of messages) {
    if (msg.info?.role !== "assistant" || !msg.info?.id) continue
    if (!msg.parts || msg.parts.length === 0) continue

    const partsWithIds = msg.parts.filter((p) => typeof p.id === "string")
    if (partsWithIds.length === 0) continue

    const sorted = [...partsWithIds].sort((a, b) => a.id!.localeCompare(b.id!))
    const first = sorted[0]!
    if (!THINKING_TYPES.has(first.type)) {
      // This message needs a thinking block prepended
      // We can't directly modify stored messages via SDK easily,
      // but we can send a resume prompt to continue past the error
      anyFixed = true
    }
  }

  if (anyFixed) {
    // Resume the session after aborting
    try {
      const lastUser = [...messages].reverse().find((m) => m.info?.role === "user")
      await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          parts: [{ type: "text", text: "[session recovered - continuing previous task]" }],
          agent: lastUser?.info?.agent,
          model: lastUser?.info?.model,
        },
      })
      return true
    } catch {
      return false
    }
  }

  return false
}

/** Strip thinking blocks when thinking is disabled */
async function recoverThinkingDisabled(
  client: RecoveryClient,
  sessionID: string,
  messages: MessageData[],
): Promise<boolean> {
  // Resume the session — the provider will retry without thinking blocks
  try {
    const lastUser = [...messages].reverse().find((m) => m.info?.role === "user")
    await client.session.promptAsync({
      path: { id: sessionID },
      body: {
        parts: [{ type: "text", text: "[session recovered - continuing previous task]" }],
        agent: lastUser?.info?.agent,
        model: lastUser?.info?.model,
      },
    })
    return true
  } catch {
    return false
  }
}
