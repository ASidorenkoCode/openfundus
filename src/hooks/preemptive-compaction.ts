/**
 * Preemptive Compaction Hook
 *
 * Auto-triggers session compaction when context usage reaches 78% of the limit,
 * preventing abrupt context window exhaustion.
 *
 * Inspired by oh-my-opencode's preemptive-compaction hook.
 */

const DEFAULT_ACTUAL_LIMIT = 200_000

const ANTHROPIC_ACTUAL_LIMIT =
  process.env.ANTHROPIC_1M_CONTEXT === "true" ||
  process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
    ? 1_000_000
    : DEFAULT_ACTUAL_LIMIT

const PREEMPTIVE_COMPACTION_THRESHOLD = 0.78

interface TokenInfo {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

interface CachedCompactionState {
  providerID: string
  modelID: string
  tokens: TokenInfo
}

interface CompactionClient {
  session: {
    summarize: (opts: any) => Promise<any>
  }
}

const compactionInProgress = new Set<string>()
const compactedSessions = new Set<string>()
const tokenCache = new Map<string, CachedCompactionState>()

export function createPreemptiveCompactionHook(client: CompactionClient, directory: string) {
  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    _output: { title: string; output: string; metadata: unknown },
  ) => {
    const { sessionID } = input
    if (compactedSessions.has(sessionID) || compactionInProgress.has(sessionID)) return

    const cached = tokenCache.get(sessionID)
    if (!cached) return

    const actualLimit =
      cached.providerID === "anthropic" ? ANTHROPIC_ACTUAL_LIMIT : DEFAULT_ACTUAL_LIMIT

    const totalInputTokens = (cached.tokens.input ?? 0) + (cached.tokens.cache?.read ?? 0)
    const usageRatio = totalInputTokens / actualLimit

    if (usageRatio < PREEMPTIVE_COMPACTION_THRESHOLD) return
    if (!cached.modelID) return

    compactionInProgress.add(sessionID)

    try {
      await client.session.summarize({
        path: { id: sessionID },
        body: { providerID: cached.providerID, modelID: cached.modelID, auto: true },
        query: { directory },
      })
      compactedSessions.add(sessionID)
    } catch (e) {
      console.error("[OpenRecall] Preemptive compaction failed:", e)
    } finally {
      compactionInProgress.delete(sessionID)
    }
  }

  const handleEvent = (event: { type: string; properties?: unknown }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const id = (props?.id as string) ?? (props?.info as any)?.id
      if (id) {
        compactionInProgress.delete(id)
        compactedSessions.delete(id)
        tokenCache.delete(id)
      }
    }

    if (event.type === "message.updated") {
      const info = props?.info as {
        role?: string
        sessionID?: string
        providerID?: string
        modelID?: string
        finish?: boolean
        tokens?: TokenInfo
      } | undefined

      if (!info || info.role !== "assistant" || !info.finish) return
      if (!info.sessionID || !info.providerID || !info.tokens) return

      tokenCache.set(info.sessionID, {
        providerID: info.providerID,
        modelID: info.modelID ?? "",
        tokens: info.tokens,
      })
    }
  }

  return { toolExecuteAfter, handleEvent }
}

export function clearPreemptiveCompaction(sessionId: string) {
  compactionInProgress.delete(sessionId)
  compactedSessions.delete(sessionId)
  tokenCache.delete(sessionId)
}
