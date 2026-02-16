import { join } from "path"
import { homedir } from "os"

export const DEFAULT_CATEGORIES = [
  "decision",
  "pattern",
  "debugging",
  "preference",
  "convention",
  "discovery",
  "anti-pattern",
  "general",
] as const

export type Category = (typeof DEFAULT_CATEGORIES)[number]

export interface OpenRecallConfig {
  dbPath: string
  categories: string[]
  maxMemories: number
  autoRecall: boolean
  autoExtract: boolean
  searchLimit: number
  globalMemories: boolean
  agentModel: string
}

function getDefaultDbPath(): string {
  const home = homedir()
  const xdgData = process.env.XDG_DATA_HOME || join(home, ".local", "share")
  return join(xdgData, "opencode", "openrecall.db")
}

const DEFAULTS: OpenRecallConfig = {
  dbPath: getDefaultDbPath(),
  categories: [...DEFAULT_CATEGORIES],
  maxMemories: 0, // 0 = unlimited
  autoRecall: true,
  autoExtract: true,
  searchLimit: 10,
  globalMemories: false,
  agentModel: "",
}

let currentConfig: OpenRecallConfig = { ...DEFAULTS }

export function getConfig(): OpenRecallConfig {
  return currentConfig
}

export function initConfig(userConfig?: Partial<OpenRecallConfig>): OpenRecallConfig {
  currentConfig = { ...DEFAULTS }

  if (userConfig) {
    if (userConfig.dbPath) currentConfig.dbPath = userConfig.dbPath
    if (userConfig.categories && userConfig.categories.length > 0) {
      currentConfig.categories = userConfig.categories
    }
    if (typeof userConfig.maxMemories === "number") {
      currentConfig.maxMemories = userConfig.maxMemories
    }
    if (typeof userConfig.autoRecall === "boolean") {
      currentConfig.autoRecall = userConfig.autoRecall
    }
    if (typeof userConfig.autoExtract === "boolean") {
      currentConfig.autoExtract = userConfig.autoExtract
    }
    if (typeof userConfig.searchLimit === "number" && userConfig.searchLimit > 0) {
      currentConfig.searchLimit = userConfig.searchLimit
    }
    if (typeof userConfig.globalMemories === "boolean") {
      currentConfig.globalMemories = userConfig.globalMemories
    }
    if (typeof userConfig.agentModel === "string" && userConfig.agentModel.trim()) {
      currentConfig.agentModel = userConfig.agentModel.trim()
    }
  }

  return currentConfig
}
