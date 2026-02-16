import type { SessionState, WithParts } from "./context"
import type { Logger } from "./log"
import type { PluginConfig } from "./config"
import { syncToolCache } from "./context/cache"
import { deduplicate, supersedeWrites, purgeErrors } from "./reducers"
import { prune, insertPruneToolContext } from "./transform"
import { buildToolIdList, isIgnoredUserMessage } from "./transform/helpers"
import { checkSession } from "./context"
import { renderSystemPrompt } from "./prompts"
import { handleStatsCommand } from "./cli/stats"
import { handleContextCommand } from "./cli/context"
import { handleHelpCommand } from "./cli/help"
import { handleSweepCommand } from "./cli/sweep"
import { handleManualToggleCommand, handleManualTriggerCommand } from "./cli/manual"
import { ensureSessionInitialized } from "./context/session"
import { getCurrentParams } from "./reducers/helpers"

const INTERNAL_AGENT_SIGNATURES = [
    "You are a title generator",
    "You are a helpful AI assistant tasked with summarizing conversations",
    "Summarize what was done in this conversation",
]

function applyPendingManualTriggerPrompt(
    state: SessionState,
    messages: WithParts[],
    logger: Logger,
): void {
    const pending = state.pendingManualTrigger
    if (!pending) {
        return
    }

    if (!state.sessionId || pending.sessionId !== state.sessionId) {
        state.pendingManualTrigger = null
        return
    }

    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]!
        if (msg.info.role !== "user" || isIgnoredUserMessage(msg)) {
            continue
        }

        for (const part of msg.parts) {
            if (part.type !== "text" || part.ignored || part.synthetic) {
                continue
            }

            part.text = pending.prompt
            state.pendingManualTrigger = null
            logger.debug("Applied pending manual trigger prompt", { sessionId: pending.sessionId })
            return
        }
    }

    state.pendingManualTrigger = null
}

export function createSystemPromptHandler(
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
) {
    return async (
        input: { sessionID?: string; model: { limit: { context: number } } },
        output: { system: string[] },
    ) => {
        if (input.model?.limit?.context) {
            state.modelContextLimit = input.model.limit.context
            logger.debug("Cached model context limit", { limit: state.modelContextLimit })
        }

        if (state.isSubAgent) {
            return
        }

        const systemText = output.system.join("\n")
        if (INTERNAL_AGENT_SIGNATURES.some((sig) => systemText.includes(sig))) {
            logger.info("Skipping SCR system prompt injection for internal agent")
            return
        }

        const flags = {
            prune: config.tools.prune.permission !== "deny",
            distill: config.tools.distill.permission !== "deny",
            compress: config.tools.compress.permission !== "deny",
            manual: state.manualMode,
        }

        if (!flags.prune && !flags.distill && !flags.compress) {
            return
        }

        output.system.push(renderSystemPrompt(flags))
    }
}

export function createChatMessageTransformHandler(
    client: any,
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
) {
    return async (input: {}, output: { messages: WithParts[] }) => {
        await checkSession(client, state, logger, output.messages, config.manualMode.enabled)

        if (state.isSubAgent) {
            return
        }

        try {
            syncToolCache(state, config, logger, output.messages)
            buildToolIdList(state, output.messages, logger)

            deduplicate(state, logger, config, output.messages)
            supersedeWrites(state, logger, config, output.messages)
            purgeErrors(state, logger, config, output.messages)

            prune(state, logger, config, output.messages)
            insertPruneToolContext(state, config, logger, output.messages)

            applyPendingManualTriggerPrompt(state, output.messages, logger)

            if (state.sessionId) {
                await logger.saveContext(state.sessionId, output.messages)
            }
        } catch (e) {
            logger.error("SCR message transform failed", { error: String(e) })
        }
    }
}

export function createCommandExecuteHandler(
    client: any,
    state: SessionState,
    logger: Logger,
    config: PluginConfig,
    workingDirectory: string,
) {
    return async (
        input: { command: string; sessionID: string; arguments: string },
        output: { parts: any[] },
    ) => {
        if (!config.commands.enabled) {
            return
        }

        if (input.command === "scr") {
            const messagesResponse = await client.session.messages({
                path: { id: input.sessionID },
            })
            const messages = (messagesResponse.data || messagesResponse) as WithParts[]

            await ensureSessionInitialized(
                client,
                state,
                input.sessionID,
                logger,
                messages,
                config.manualMode.enabled,
            )

            const args = (input.arguments || "").trim().split(/\s+/).filter(Boolean)
            const subcommand = args[0]?.toLowerCase() || ""
            const subArgs = args.slice(1)

            const commandCtx = {
                client,
                state,
                config,
                logger,
                sessionId: input.sessionID,
                messages,
            }

            if (subcommand === "context") {
                await handleContextCommand(commandCtx)
                throw new Error("__SCR_CONTEXT_HANDLED__")
            }

            if (subcommand === "stats") {
                await handleStatsCommand(commandCtx)
                throw new Error("__SCR_STATS_HANDLED__")
            }

            if (subcommand === "sweep") {
                await handleSweepCommand({
                    ...commandCtx,
                    args: subArgs,
                    workingDirectory,
                })
                throw new Error("__SCR_SWEEP_HANDLED__")
            }

            if (subcommand === "manual") {
                await handleManualToggleCommand(commandCtx, subArgs[0]?.toLowerCase())
                throw new Error("__SCR_MANUAL_HANDLED__")
            }

            if (
                (subcommand === "prune" || subcommand === "distill" || subcommand === "compress") &&
                config.tools[subcommand].permission !== "deny"
            ) {
                const userFocus = subArgs.join(" ").trim()
                const prompt = await handleManualTriggerCommand(commandCtx, subcommand, userFocus)
                if (!prompt) {
                    throw new Error("__SCR_MANUAL_TRIGGER_BLOCKED__")
                }

                state.pendingManualTrigger = {
                    sessionId: input.sessionID,
                    prompt,
                }
                const rawArgs = (input.arguments || "").trim()
                output.parts.length = 0
                output.parts.push({
                    type: "text",
                    text: rawArgs ? `/scr ${rawArgs}` : `/scr ${subcommand}`,
                })
                return
            }

            await handleHelpCommand(commandCtx)
            throw new Error("__SCR_HELP_HANDLED__")
        }
    }
}
