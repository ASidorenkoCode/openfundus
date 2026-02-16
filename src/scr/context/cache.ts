import type { SessionState, ToolStatus, WithParts } from "./session"
import type { Logger } from "../log"
import type { PluginConfig } from "../config"
import { isMessageCompacted } from "../utils"
import { countToolTokens } from "../reducers/helpers"

const MAX_TOOL_CACHE_SIZE = 1000

/**
 * Sync tool parameters from session messages.
 */
export function syncToolCache(
    state: SessionState,
    config: PluginConfig,
    logger: Logger,
    messages: WithParts[],
): void {
    try {
        logger.info("Syncing tool parameters from OpenCode messages")

        state.nudgeCounter = 0
        let turnCounter = 0

        for (const msg of messages) {
            if (isMessageCompacted(state, msg)) {
                continue
            }

            const parts = Array.isArray(msg.parts) ? msg.parts : []
            for (const part of parts) {
                if (part.type === "step-start") {
                    turnCounter++
                    continue
                }

                if (part.type !== "tool" || !part.callID) {
                    continue
                }

                const turnProtectionEnabled = config.turnProtection.enabled
                const turnProtectionTurns = config.turnProtection.turns
                const isProtectedByTurn =
                    turnProtectionEnabled &&
                    turnProtectionTurns > 0 &&
                    state.currentTurn - turnCounter < turnProtectionTurns

                if (part.tool === "distill" || part.tool === "compress" || part.tool === "prune") {
                    state.nudgeCounter = 0
                    state.lastToolPrune = true
                } else {
                    state.lastToolPrune = false
                    const allProtectedTools = config.tools.settings.protectedTools
                    if (!allProtectedTools.includes(part.tool) && !isProtectedByTurn) {
                        state.nudgeCounter++
                    }
                }

                if (state.toolParameters.has(part.callID)) {
                    continue
                }

                if (isProtectedByTurn) {
                    continue
                }

                const allProtectedTools = config.tools.settings.protectedTools
                const isProtectedTool = allProtectedTools.includes(part.tool)
                const tokenCount = isProtectedTool ? undefined : countToolTokens(part)

                state.toolParameters.set(part.callID, {
                    tool: part.tool,
                    parameters: part.state?.input ?? {},
                    status: part.state.status as ToolStatus | undefined,
                    error: part.state.status === "error" ? part.state.error : undefined,
                    turn: turnCounter,
                    tokenCount,
                })
                logger.info(
                    `Cached tool id: ${part.callID} (turn ${turnCounter}${tokenCount !== undefined ? `, ~${tokenCount} tokens` : ""})`,
                )
            }
        }

        logger.info(
            `Synced cache - size: ${state.toolParameters.size}, currentTurn: ${state.currentTurn}, nudgeCounter: ${state.nudgeCounter}`,
        )
        trimToolParametersCache(state)
    } catch (error) {
        logger.warn("Failed to sync tool parameters from OpenCode", {
            error: error instanceof Error ? error.message : String(error),
        })
    }
}

/**
 * Trim the tool parameters cache to prevent unbounded memory growth.
 * Prioritizes evicting already-pruned tools, then falls back to FIFO.
 */
export function trimToolParametersCache(state: SessionState): void {
    if (state.toolParameters.size <= MAX_TOOL_CACHE_SIZE) {
        return
    }

    const excess = state.toolParameters.size - MAX_TOOL_CACHE_SIZE

    // First pass: evict already-pruned tools (they're dead weight in the cache)
    const prunedKeys: string[] = []
    for (const key of state.toolParameters.keys()) {
        if (state.prune.tools.has(key)) {
            prunedKeys.push(key)
        }
    }
    for (const key of prunedKeys) {
        state.toolParameters.delete(key)
        if (state.toolParameters.size <= MAX_TOOL_CACHE_SIZE) {
            return
        }
    }

    // Second pass: FIFO eviction for remaining excess
    if (state.toolParameters.size > MAX_TOOL_CACHE_SIZE) {
        const remaining = state.toolParameters.size - MAX_TOOL_CACHE_SIZE
        const keysToRemove = Array.from(state.toolParameters.keys()).slice(0, remaining)
        for (const key of keysToRemove) {
            state.toolParameters.delete(key)
        }
    }
}
