/**
 * SCR Help command handler.
 * Shows available SCR commands and their descriptions.
 */

import type { Logger } from "../log"
import type { PluginConfig } from "../config"
import type { SessionState, WithParts } from "../context"
import { sendIgnoredMessage } from "../notification"
import { getCurrentParams } from "../reducers/helpers"

export interface HelpCommandContext {
    client: any
    state: SessionState
    config: PluginConfig
    logger: Logger
    sessionId: string
    messages: WithParts[]
}

const BASE_COMMANDS: [string, string][] = [
    ["/scr context", "Show token usage breakdown for current session"],
    ["/scr stats", "Show SCR reduction statistics"],
    ["/scr sweep [n]", "Reduce tools since last user message, or last n tools"],
    ["/scr manual [on|off]", "Toggle manual mode or set explicit state"],
]

const TOOL_COMMANDS: Record<string, [string, string]> = {
    prune: ["/scr prune [focus]", "Trigger manual reduce tool execution"],
    distill: ["/scr distill [focus]", "Trigger manual deduplicate tool execution"],
    compress: ["/scr compress [focus]", "Trigger manual compress tool execution"],
}

function getVisibleCommands(config: PluginConfig): [string, string][] {
    const commands = [...BASE_COMMANDS]
    for (const tool of ["prune", "distill", "compress"] as const) {
        if (config.tools[tool].permission !== "deny") {
            commands.push(TOOL_COMMANDS[tool]!)
        }
    }
    return commands
}

function formatHelpMessage(manualMode: boolean, config: PluginConfig): string {
    const commands = getVisibleCommands(config)
    const colWidth = Math.max(...commands.map(([cmd]) => cmd.length)) + 4
    const lines: string[] = []

    lines.push("╭─────────────────────────────────────────────────────────────────────────╮")
    lines.push("│                              SCR Commands                               │")
    lines.push("╰─────────────────────────────────────────────────────────────────────────╯")
    lines.push("")
    lines.push(`  ${"Manual mode:".padEnd(colWidth)}${manualMode ? "ON" : "OFF"}`)
    lines.push("")
    for (const [cmd, desc] of commands) {
        lines.push(`  ${cmd.padEnd(colWidth)}${desc}`)
    }
    lines.push("")

    return lines.join("\n")
}

export async function handleHelpCommand(ctx: HelpCommandContext): Promise<void> {
    const { client, state, logger, sessionId, messages } = ctx

    const { config } = ctx
    const message = formatHelpMessage(state.manualMode, config)

    const params = getCurrentParams(state, messages, logger)
    await sendIgnoredMessage(client, sessionId, message, params, logger)

    logger.info("Help command executed")
}
