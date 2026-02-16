/**
 * Context Window Monitor Hook
 *
 * Displays a reminder when context usage exceeds 70% for Anthropic models,
 * informing the model it still has room and shouldn't rush.
 *
 * Inspired by oh-my-opencode's context-window-monitor hook.
 */

const ANTHROPIC_DISPLAY_LIMIT = 1_000_000
const ANTHROPIC_ACTUAL_LIMIT =
  process.env.ANTHROPIC_1M_CONTEXT === "true" ||
  process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
    ? 1_000_000
    : 200_000

const CONTEXT_WARNING_THRESHOLD = 0.7

const CONTEXT_REMINDER = `[CONTEXT WINDOW MONITOR]

You are using Anthropic Claude with 1M context window.
You have plenty of context remaining - do NOT rush or skip tasks.
Complete your work thoroughly and methodically.`

interface TokenInfo {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

interface CachedTokenState {
  providerID: string
  tokens: TokenInfo
}

const remindedSessions = new Set<string>()
const tokenCache = new Map<string, CachedTokenState>()

export function handleContextWindowMonitor(
  sessionID: string,
  output: { output: string },
): void {
  if (remindedSessions.has(sessionID)) return

  const cached = tokenCache.get(sessionID)
  if (!cached || cached.providerID !== "anthropic") return

  const totalInputTokens = (cached.tokens.input ?? 0) + (cached.tokens.cache?.read ?? 0)
  const actualUsagePercentage = totalInputTokens / ANTHROPIC_ACTUAL_LIMIT

  if (actualUsagePercentage < CONTEXT_WARNING_THRESHOLD) return

  remindedSessions.add(sessionID)

  const displayUsagePercentage = totalInputTokens / ANTHROPIC_DISPLAY_LIMIT
  const usedPct = (displayUsagePercentage * 100).toFixed(1)
  const remainingPct = ((1 - displayUsagePercentage) * 100).toFixed(1)
  const usedTokens = totalInputTokens.toLocaleString()
  const limitTokens = ANTHROPIC_DISPLAY_LIMIT.toLocaleString()

  output.output += `\n\n${CONTEXT_REMINDER}\n[Context Status: ${usedPct}% used (${usedTokens}/${limitTokens} tokens), ${remainingPct}% remaining]`
}

export function handleContextWindowEvent(event: { type: string; properties?: unknown }): void {
  const props = event.properties as Record<string, unknown> | undefined

  if (event.type === "session.deleted") {
    const id = (props?.id as string) ?? (props?.info as any)?.id
    if (id) {
      remindedSessions.delete(id)
      tokenCache.delete(id)
    }
  }

  if (event.type === "message.updated") {
    const info = props?.info as {
      role?: string
      sessionID?: string
      providerID?: string
      finish?: boolean
      tokens?: TokenInfo
    } | undefined

    if (!info || info.role !== "assistant" || !info.finish) return
    if (!info.sessionID || !info.providerID || !info.tokens) return

    tokenCache.set(info.sessionID, {
      providerID: info.providerID,
      tokens: info.tokens,
    })
  }
}

export function clearContextWindowMonitor(sessionId: string) {
  remindedSessions.delete(sessionId)
  tokenCache.delete(sessionId)
}
