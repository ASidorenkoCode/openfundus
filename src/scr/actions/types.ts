import type { SessionState } from "../context"
import type { PluginConfig } from "../config"
import type { Logger } from "../log"

export interface PruneToolContext {
    client: any
    state: SessionState
    logger: Logger
    config: PluginConfig
    workingDirectory: string
}
