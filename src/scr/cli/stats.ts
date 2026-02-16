/**
 * SCR Stats command handler.
 * Shows reduction statistics for the current session and all-time totals.
 */

import type { Logger } from "../log"
import type { SessionState, WithParts } from "../context"
import { sendIgnoredMessage } from "../notification"
import { formatTokenCount } from "../notification"
import { loadAllSessionStats, type AggregatedStats } from "../context/persistence"
import { getCurrentParams } from "../reducers/helpers"

export interface StatsCommandContext {
    client: any
    state: SessionState
    logger: Logger
    sessionId: string
    messages: WithParts[]
}

function formatStatsMessage(
    sessionTokens: number,
    sessionTools: number,
    sessionMessages: number,
    allTime: AggregatedStats,
): string {
    const lines: string[] = []

    lines.push("╭───────────────────────────────────────────────────────────╮")
    lines.push("│                    SCR Statistics                         │")
    lines.push("╰───────────────────────────────────────────────────────────╯")
    lines.push("")
    lines.push("Session:")
    lines.push("─".repeat(60))
    lines.push(`  Tokens reduced:  ~${formatTokenCount(sessionTokens)}`)
    lines.push(`  Tools reduced:    ${sessionTools}`)
    lines.push(`  Messages reduced: ${sessionMessages}`)
    lines.push("")
    lines.push("All-time:")
    lines.push("─".repeat(60))
    lines.push(`  Tokens saved:    ~${formatTokenCount(allTime.totalTokens)}`)
    lines.push(`  Tools reduced:    ${allTime.totalTools}`)
    lines.push(`  Messages reduced: ${allTime.totalMessages}`)
    lines.push(`  Sessions:         ${allTime.sessionCount}`)

    return lines.join("\n")
}

export async function handleStatsCommand(ctx: StatsCommandContext): Promise<void> {
    const { client, state, logger, sessionId, messages } = ctx

    // Session stats from in-memory state
    const sessionTokens = state.stats.totalPruneTokens
    const sessionTools = state.prune.tools.size
    const sessionMessages = state.prune.messages.size

    // All-time stats from storage files
    const allTime = await loadAllSessionStats(logger)

    const message = formatStatsMessage(sessionTokens, sessionTools, sessionMessages, allTime)

    const params = getCurrentParams(state, messages, logger)
    await sendIgnoredMessage(client, sessionId, message, params, logger)

    logger.info("Stats command executed", {
        sessionTokens,
        sessionTools,
        sessionMessages,
        allTimeTokens: allTime.totalTokens,
        allTimeTools: allTime.totalTools,
        allTimeMessages: allTime.totalMessages,
    })
}
