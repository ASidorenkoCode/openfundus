import type { Message, Part } from "@opencode-ai/sdk/v2"
import type { Logger } from "../log"
import { loadSessionState } from "./persistence"
import {
    isSubAgentSession,
    findLastCompactionTimestamp,
    countTurns,
    resetOnCompaction,
    loadPruneMap,
} from "./index"
import { getLastUserMessage } from "../utils"

// === Types (formerly state/types.ts) ===

export interface WithParts {
    info: Message
    parts: Part[]
}

export type ToolStatus = "pending" | "running" | "completed" | "error"

export interface ToolParameterEntry {
    tool: string
    parameters: any
    status?: ToolStatus
    error?: string
    turn: number
    tokenCount?: number
}

export interface SessionStats {
    pruneTokenCounter: number
    totalPruneTokens: number
}

export interface CompressSummary {
    anchorMessageId: string
    summary: string
}

export interface Prune {
    tools: Map<string, number>
    messages: Map<string, number>
}

export interface PendingManualTrigger {
    sessionId: string
    prompt: string
}

export interface SessionState {
    sessionId: string | null
    isSubAgent: boolean
    manualMode: boolean
    pendingManualTrigger: PendingManualTrigger | null
    prune: Prune
    compressSummaries: CompressSummary[]
    stats: SessionStats
    toolParameters: Map<string, ToolParameterEntry>
    toolIdList: string[]
    nudgeCounter: number
    lastToolPrune: boolean
    lastCompaction: number
    currentTurn: number
    variant: string | undefined
    modelContextLimit: number | undefined
}

// === State management (formerly state/state.ts) ===

export const checkSession = async (
    client: any,
    state: SessionState,
    logger: Logger,
    messages: WithParts[],
    manualModeDefault: boolean,
): Promise<void> => {
    const lastUserMessage = getLastUserMessage(messages)
    if (!lastUserMessage) {
        return
    }

    const lastSessionId = lastUserMessage.info.sessionID

    if (state.sessionId === null || state.sessionId !== lastSessionId) {
        logger.info(`Session changed: ${state.sessionId} -> ${lastSessionId}`)
        try {
            await ensureSessionInitialized(
                client,
                state,
                lastSessionId,
                logger,
                messages,
                manualModeDefault,
            )
        } catch (err: any) {
            logger.error("Failed to initialize session state", { error: err.message })
        }
    }

    const lastCompactionTimestamp = findLastCompactionTimestamp(messages)
    if (lastCompactionTimestamp > state.lastCompaction) {
        state.lastCompaction = lastCompactionTimestamp
        resetOnCompaction(state)
        logger.info("Detected compaction - reset stale state", {
            timestamp: lastCompactionTimestamp,
        })
    }

    state.currentTurn = countTurns(state, messages)
}

export function createSessionState(): SessionState {
    return {
        sessionId: null,
        isSubAgent: false,
        manualMode: false,
        pendingManualTrigger: null,
        prune: {
            tools: new Map<string, number>(),
            messages: new Map<string, number>(),
        },
        compressSummaries: [],
        stats: {
            pruneTokenCounter: 0,
            totalPruneTokens: 0,
        },
        toolParameters: new Map<string, ToolParameterEntry>(),
        toolIdList: [],
        nudgeCounter: 0,
        lastToolPrune: false,
        lastCompaction: 0,
        currentTurn: 0,
        variant: undefined,
        modelContextLimit: undefined,
    }
}

export function resetSessionState(state: SessionState): void {
    state.sessionId = null
    state.isSubAgent = false
    state.manualMode = false
    state.pendingManualTrigger = null
    state.prune = {
        tools: new Map<string, number>(),
        messages: new Map<string, number>(),
    }
    state.compressSummaries = []
    state.stats = {
        pruneTokenCounter: 0,
        totalPruneTokens: 0,
    }
    state.toolParameters.clear()
    state.toolIdList = []
    state.nudgeCounter = 0
    state.lastToolPrune = false
    state.lastCompaction = 0
    state.currentTurn = 0
    state.variant = undefined
    state.modelContextLimit = undefined
}

export async function ensureSessionInitialized(
    client: any,
    state: SessionState,
    sessionId: string,
    logger: Logger,
    messages: WithParts[],
    manualModeDefault: boolean,
): Promise<void> {
    if (state.sessionId === sessionId) {
        return
    }

    // logger.info("session ID = " + sessionId)
    // logger.info("Initializing session state", { sessionId: sessionId })

    resetSessionState(state)
    state.manualMode = manualModeDefault
    state.sessionId = sessionId

    const isSubAgent = await isSubAgentSession(client, sessionId)
    state.isSubAgent = isSubAgent
    // logger.info("isSubAgent = " + isSubAgent)

    state.lastCompaction = findLastCompactionTimestamp(messages)
    state.currentTurn = countTurns(state, messages)

    const persisted = await loadSessionState(sessionId, logger)
    if (persisted === null) {
        return
    }

    state.prune.tools = loadPruneMap(persisted.prune.tools, persisted.prune.toolIds)
    state.prune.messages = loadPruneMap(persisted.prune.messages, persisted.prune.messageIds)
    state.compressSummaries = persisted.compressSummaries || []
    state.stats = {
        pruneTokenCounter: persisted.stats?.pruneTokenCounter || 0,
        totalPruneTokens: persisted.stats?.totalPruneTokens || 0,
    }
}
