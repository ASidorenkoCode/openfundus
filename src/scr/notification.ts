import type { ToolParameterEntry } from "./context"
import { extractParameterKey } from "./transform/helpers"
import { countTokens } from "./reducers/helpers"
import type { Logger } from "./log"
import type { SessionState } from "./context"
import type { PluginConfig } from "./config"

// === Formatting utilities ===

export function countDistillationTokens(distillation?: string[]): number {
    if (!distillation || distillation.length === 0) return 0
    return countTokens(distillation.join("\n"))
}

export function formatExtracted(distillation?: string[]): string {
    if (!distillation || distillation.length === 0) {
        return ""
    }
    let result = `\n\n▣ Extracted`
    for (const finding of distillation) {
        result += `\n───\n${finding}`
    }
    return result
}

export function formatStatsHeader(totalTokensSaved: number, pruneTokenCounter: number): string {
    const totalTokensSavedStr = `~${formatTokenCount(totalTokensSaved + pruneTokenCounter)}`
    return [`▣ SCR | ${totalTokensSavedStr} saved total`].join("\n")
}

export function formatTokenCount(tokens: number): string {
    if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}K`.replace(".0K", "K") + " tokens"
    }
    return tokens.toString() + " tokens"
}

export function truncate(str: string, maxLen: number = 60): string {
    if (str.length <= maxLen) return str
    return str.slice(0, maxLen - 3) + "..."
}

export function formatProgressBar(
    total: number,
    start: number,
    end: number,
    width: number = 20,
): string {
    if (total <= 0) return `│${" ".repeat(width)}│`

    const startIdx = Math.floor((start / total) * width)
    const endIdx = Math.min(width - 1, Math.floor((end / total) * width))

    let bar = ""
    for (let i = 0; i < width; i++) {
        if (i >= startIdx && i <= endIdx) {
            bar += "░"
        } else {
            bar += "█"
        }
    }

    return `│${bar}│`
}

export function shortenPath(input: string, workingDirectory?: string): string {
    const inPathMatch = input.match(/^(.+) in (.+)$/)
    if (inPathMatch) {
        const prefix = inPathMatch[1]!
        const pathPart = inPathMatch[2]!
        const shortenedPath = shortenSinglePath(pathPart, workingDirectory)
        return `${prefix} in ${shortenedPath}`
    }

    return shortenSinglePath(input, workingDirectory)
}

function shortenSinglePath(path: string, workingDirectory?: string): string {
    if (workingDirectory) {
        if (path.startsWith(workingDirectory + "/")) {
            return path.slice(workingDirectory.length + 1)
        }
        if (path === workingDirectory) {
            return "."
        }
    }

    return path
}

export function formatPrunedItemsList(
    pruneToolIds: string[],
    toolMetadata: Map<string, ToolParameterEntry>,
    workingDirectory?: string,
): string[] {
    const lines: string[] = []

    for (const id of pruneToolIds) {
        const metadata = toolMetadata.get(id)

        if (metadata) {
            const paramKey = extractParameterKey(metadata.tool, metadata.parameters)
            if (paramKey) {
                // Use 60 char limit to match notification style
                const displayKey = truncate(shortenPath(paramKey, workingDirectory), 60)
                lines.push(`→ ${metadata.tool}: ${displayKey}`)
            } else {
                lines.push(`→ ${metadata.tool}`)
            }
        }
    }

    const knownCount = pruneToolIds.filter((id) => toolMetadata.has(id)).length
    const unknownCount = pruneToolIds.length - knownCount

    if (unknownCount > 0) {
        lines.push(`→ (${unknownCount} tool${unknownCount > 1 ? "s" : ""} with unknown metadata)`)
    }

    return lines
}

export function formatPruningResultForTool(
    prunedIds: string[],
    toolMetadata: Map<string, ToolParameterEntry>,
    workingDirectory?: string,
): string {
    const lines: string[] = []
    lines.push(`Context reduction complete. Reduced ${prunedIds.length} tool outputs.`)
    lines.push("")

    if (prunedIds.length > 0) {
        lines.push(`Semantically reduced (${prunedIds.length}):`)
        lines.push(...formatPrunedItemsList(prunedIds, toolMetadata, workingDirectory))
    }

    return lines.join("\n").trim()
}

// === Notification functions ===

export type PruneReason = "completion" | "noise" | "extraction"
export const PRUNE_REASON_LABELS: Record<PruneReason, string> = {
    completion: "Task Complete",
    noise: "Noise Removal",
    extraction: "Extraction",
}

function buildMinimalMessage(
    state: SessionState,
    reason: PruneReason | undefined,
    distillation: string[] | undefined,
    showDistillation: boolean,
): string {
    const extractedTokens = countDistillationTokens(distillation)
    const extractedSuffix =
        extractedTokens > 0 ? ` (distilled ${formatTokenCount(extractedTokens)})` : ""
    const reasonSuffix = reason && extractedTokens === 0 ? ` — ${PRUNE_REASON_LABELS[reason]}` : ""
    let message =
        formatStatsHeader(state.stats.totalPruneTokens, state.stats.pruneTokenCounter) +
        reasonSuffix +
        extractedSuffix

    return message + formatExtracted(showDistillation ? distillation : undefined)
}

function buildDetailedMessage(
    state: SessionState,
    reason: PruneReason | undefined,
    pruneToolIds: string[],
    toolMetadata: Map<string, ToolParameterEntry>,
    workingDirectory: string,
    distillation: string[] | undefined,
    showDistillation: boolean,
): string {
    let message = formatStatsHeader(state.stats.totalPruneTokens, state.stats.pruneTokenCounter)

    if (pruneToolIds.length > 0) {
        const pruneTokenCounterStr = `~${formatTokenCount(state.stats.pruneTokenCounter)}`
        const extractedTokens = countDistillationTokens(distillation)
        const extractedSuffix =
            extractedTokens > 0 ? `, distilled ${formatTokenCount(extractedTokens)}` : ""
        const reasonLabel =
            reason && extractedTokens === 0 ? ` — ${PRUNE_REASON_LABELS[reason]}` : ""
        message += `\n\n▣ Reducing (${pruneTokenCounterStr}${extractedSuffix})${reasonLabel}`

        const itemLines = formatPrunedItemsList(pruneToolIds, toolMetadata, workingDirectory)
        message += "\n" + itemLines.join("\n")
    }

    return (message + formatExtracted(showDistillation ? distillation : undefined)).trim()
}

const TOAST_BODY_MAX_LINES = 12
const TOAST_SUMMARY_MAX_CHARS = 600

function truncateToastBody(body: string, maxLines: number = TOAST_BODY_MAX_LINES): string {
    const lines = body.split("\n")
    if (lines.length <= maxLines) {
        return body
    }
    const kept = lines.slice(0, maxLines - 1)
    const remaining = lines.length - maxLines + 1
    return kept.join("\n") + `\n... and ${remaining} more`
}

function truncateToastSummary(summary: string, maxChars: number = TOAST_SUMMARY_MAX_CHARS): string {
    if (summary.length <= maxChars) {
        return summary
    }
    return summary.slice(0, maxChars - 3) + "..."
}

function truncateExtractedSection(
    message: string,
    maxChars: number = TOAST_SUMMARY_MAX_CHARS,
): string {
    const marker = "\n\n▣ Extracted"
    const index = message.indexOf(marker)
    if (index === -1) {
        return message
    }
    const extracted = message.slice(index)
    if (extracted.length <= maxChars) {
        return message
    }
    return message.slice(0, index) + truncateToastSummary(extracted, maxChars)
}

export async function sendUnifiedNotification(
    client: any,
    logger: Logger,
    config: PluginConfig,
    state: SessionState,
    sessionId: string,
    pruneToolIds: string[],
    toolMetadata: Map<string, ToolParameterEntry>,
    reason: PruneReason | undefined,
    params: any,
    workingDirectory: string,
    distillation?: string[],
): Promise<boolean> {
    const hasPruned = pruneToolIds.length > 0
    if (!hasPruned) {
        return false
    }

    if (config.pruneNotification === "off") {
        return false
    }

    const showDistillation = config.tools.distill.showDistillation

    const message =
        config.pruneNotification === "minimal"
            ? buildMinimalMessage(state, reason, distillation, showDistillation)
            : buildDetailedMessage(
                  state,
                  reason,
                  pruneToolIds,
                  toolMetadata,
                  workingDirectory,
                  distillation,
                  showDistillation,
              )

    if (config.pruneNotificationType === "toast") {
        let toastMessage = truncateExtractedSection(message)
        toastMessage =
            config.pruneNotification === "minimal" ? toastMessage : truncateToastBody(toastMessage)

        await client.tui.showToast({
            body: {
                title: "SCR: Reduction Notification",
                message: toastMessage,
                variant: "info",
                duration: 5000,
            },
        })
        return true
    }

    await sendIgnoredMessage(client, sessionId, message, params, logger)
    return true
}

export async function sendCompressNotification(
    client: any,
    logger: Logger,
    config: PluginConfig,
    state: SessionState,
    sessionId: string,
    toolIds: string[],
    messageIds: string[],
    topic: string,
    summary: string,
    startResult: any,
    endResult: any,
    totalMessages: number,
    params: any,
): Promise<boolean> {
    if (config.pruneNotification === "off") {
        return false
    }

    let message: string

    if (config.pruneNotification === "minimal") {
        message = formatStatsHeader(state.stats.totalPruneTokens, state.stats.pruneTokenCounter)
    } else {
        message = formatStatsHeader(state.stats.totalPruneTokens, state.stats.pruneTokenCounter)

        const pruneTokenCounterStr = `~${formatTokenCount(state.stats.pruneTokenCounter)}`
        const progressBar = formatProgressBar(
            totalMessages,
            startResult.messageIndex,
            endResult.messageIndex,
            25,
        )
        message += `\n\n▣ Compressing (${pruneTokenCounterStr}) ${progressBar}`
        message += `\n→ Topic: ${topic}`
        message += `\n→ Items: ${messageIds.length} messages`
        if (toolIds.length > 0) {
            message += ` and ${toolIds.length} tools condensed`
        } else {
            message += ` condensed`
        }
        if (config.tools.compress.showCompression) {
            message += `\n→ Compression: ${summary}`
        }
    }

    if (config.pruneNotificationType === "toast") {
        let toastMessage = message
        if (config.tools.compress.showCompression) {
            const truncatedSummary = truncateToastSummary(summary)
            if (truncatedSummary !== summary) {
                toastMessage = toastMessage.replace(
                    `\n→ Compression: ${summary}`,
                    `\n→ Compression: ${truncatedSummary}`,
                )
            }
        }
        toastMessage =
            config.pruneNotification === "minimal" ? toastMessage : truncateToastBody(toastMessage)

        await client.tui.showToast({
            body: {
                title: "SCR: Compress Notification",
                message: toastMessage,
                variant: "info",
                duration: 5000,
            },
        })
        return true
    }

    await sendIgnoredMessage(client, sessionId, message, params, logger)
    return true
}

export async function sendIgnoredMessage(
    client: any,
    sessionID: string,
    text: string,
    params: any,
    logger: Logger,
): Promise<void> {
    const agent = params.agent || undefined
    const variant = params.variant || undefined
    const model =
        params.providerId && params.modelId
            ? {
                  providerID: params.providerId,
                  modelID: params.modelId,
              }
            : undefined

    try {
        await client.session.prompt({
            path: {
                id: sessionID,
            },
            body: {
                noReply: true,
                agent: agent,
                model: model,
                variant: variant,
                parts: [
                    {
                        type: "text",
                        text: text,
                        ignored: true,
                    },
                ],
            },
        })
    } catch (error: any) {
        logger.error("Failed to send notification", { error: error.message })
    }
}
