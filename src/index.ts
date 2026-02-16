import type { PluginInput, Hooks } from "@opencode-ai/plugin"
import { createTools } from "./tools"
import { getDb } from "./db"
import { isDbAvailable } from "./db"
import { initConfig, getConfig, type OpenRecallConfig } from "./config"
import { initClient } from "./client"
import { storeMemory, searchMemories, listMemories, getStats, sanitizeQuery } from "./memory"
import { maybeRunMaintenance } from "./maintenance"
import { extractFromToolOutput, clearSessionExtraction } from "./extract"
import { incrementCounter, clearCounter, scanProjectFiles, extractFileKnowledge } from "./agent"
import { createScrPlugin } from "./scr"
import { trackMistake, clearMistakeTracking } from "./mistakes"
import {
  createPreemptiveCompactionHook,
  clearPreemptiveCompaction,
  createCompactionTodoPreserverHook,
  clearTodoSnapshots,
  handleEditErrorRecovery,
  checkEditErrorsInMessages,
  clearEditErrorTracking,
  handleToolOutputTruncation,
  handleNonInteractiveEnv,
  handleContextWindowMonitor,
  handleContextWindowEvent,
  clearContextWindowMonitor,
  handleWriteExistingFileGuard,
  createSessionRecoveryHook,
} from "./hooks"

// In-memory cache of session metadata for enriching memories
interface SessionInfo {
  title?: string
  directory?: string
}
const sessionContext = new Map<string, SessionInfo>()

// Cache recalled memories per session to avoid repeated lookups
const recalledMemories = new Map<string, string>()
// Buffer for edit error reminders (filled by messages transform, consumed by system transform)
const editErrorSystemPrompt: { system: string[] } = { system: [] }
// Track which sessions have had their first message processed
const sessionFirstMessage = new Set<string>()

export default async function OpenRecallPlugin(
  inputRef: PluginInput,
): Promise<Hooks> {
  const projectId = inputRef.project.id

  // Store SDK client for hooks and tools to access OpenCode data
  initClient(inputRef.client)

  // Initialize SCR plugin
  const scrHooks = await createScrPlugin(inputRef)

  // Initialize stateful hooks
  const preemptiveCompaction = createPreemptiveCompactionHook(
    inputRef.client as any,
    inputRef.directory,
  )
  const todoPreserver = createCompactionTodoPreserverHook(inputRef.client as any)
  const sessionRecovery = createSessionRecoveryHook(inputRef.client as any, inputRef.directory)

  return {
    // Load config from opencode.json plugin options
    async config(cfg: any) {
      // OpenRecall config
      const pluginConfig = cfg?.plugins?.openrecall as
        | Partial<OpenRecallConfig>
        | undefined
      initConfig(pluginConfig)

      // Initialize database after config is loaded
      try {
        getDb()
        // Run periodic maintenance if needed (every 7 days)
        maybeRunMaintenance()
        // Scan key project files on startup to pre-populate memory
        scanProjectFiles(inputRef.directory, projectId)
      } catch (e) {
        console.error(
          "[OpenRecall] Failed to initialize database. Memory features will be unavailable.",
          e,
        )
      }

      // SCR config (registers commands, primary_tools, permissions)
      if (scrHooks.config) {
        await scrHooks.config(cfg)
      }
    },

    // Detect first message in a session and auto-recall relevant memories
    async "chat.message"(input, output) {
      const sessionId = input.sessionID

      // Increment message counter for agent extraction triggering
      incrementCounter(sessionId)

      const config = getConfig()
      if (config.autoRecall && isDbAvailable()) {
        if (!sessionFirstMessage.has(sessionId)) {
          sessionFirstMessage.add(sessionId)

          try {
            // Extract text from the user's first message
            const userText = extractUserText(output)
            if (userText) {
              // Search for relevant memories using the first message as query
              const sanitized = sanitizeQuery(userText)
              let recalled: string[] = []

              if (sanitized.trim()) {
                const results = searchMemories({
                  query: sanitized,
                  projectId,
                  limit: config.searchLimit,
                })
                recalled = results.map((r) => {
                  const time = new Date(r.memory.time_created * 1000).toISOString()
                  return `[${r.memory.category.toUpperCase()}] ${r.memory.content} (${time})`
                })
              }

              // Fall back to recent memories if no search matches
              if (recalled.length === 0) {
                const recent = listMemories({ projectId, limit: 5 })
                recalled = recent.map((m) => {
                  const time = new Date(m.time_created * 1000).toISOString()
                  return `[${m.category.toUpperCase()}] ${m.content} (${time})`
                })
              }

              if (recalled.length > 0) {
                recalledMemories.set(
                  sessionId,
                  "Relevant memories from previous sessions:\n" +
                    recalled.map((r, i) => `${i + 1}. ${r}`).join("\n"),
                )
              }
            }
          } catch (e) {
            console.error("[OpenRecall] Auto-recall failed:", e)
          }
        }
      }

      // SCR: cache variant from chat messages
      if (scrHooks["chat.message"]) {
        await scrHooks["chat.message"](input, output)
      }
    },

    // Track session lifecycle events and delegate to hook event handlers
    async event({ event }: { event: any }) {
      if (!event || typeof event !== "object") return
      const type = event.type as string | undefined
      if (!type) return

      if (type === "session.created" || type === "session.updated") {
        const properties = event.properties as
          | { id?: string; title?: string; directory?: string }
          | undefined
        if (properties?.id) {
          sessionContext.set(properties.id, {
            title: properties.title,
            directory: properties.directory,
          })
        }
      }

      if (type === "session.deleted") {
        const properties = event.properties as { id?: string } | undefined
        if (properties?.id) {
          sessionContext.delete(properties.id)
          recalledMemories.delete(properties.id)
          sessionFirstMessage.delete(properties.id)
          clearSessionExtraction(properties.id)
          clearCounter(properties.id)
          clearMistakeTracking(properties.id)
          clearPreemptiveCompaction(properties.id)
          clearTodoSnapshots(properties.id)
          clearContextWindowMonitor(properties.id)
          clearEditErrorTracking()
        }
      }

      // Delegate to hook event handlers
      try {
        preemptiveCompaction.handleEvent(event)
      } catch {
        // Silent fail
      }
      try {
        handleContextWindowEvent(event)
      } catch {
        // Silent fail
      }
      try {
        await todoPreserver.handleEvent(event)
      } catch {
        // Silent fail
      }
      try {
        await sessionRecovery.handleEvent(event)
      } catch {
        // Silent fail
      }
    },

    // Pre-execution guards: non-interactive env, write guard
    async "tool.execute.before"(input, output) {
      // Non-interactive env: prepend env vars to git commands, warn about interactive tools
      try {
        handleNonInteractiveEnv(input.tool, output as any)
      } catch {
        // Silent fail
      }

      // Coerce replaceAll from string to boolean (#1736 — LLMs sometimes output "false"/"true")
      if (input.tool.toLowerCase() === "edit") {
        const args = (output as any).args
        if (args && typeof args.replaceAll === "string") {
          args.replaceAll = args.replaceAll === "true"
        }
      }

      // Write guard: block Write on existing files, force Edit
      try {
        handleWriteExistingFileGuard(input.tool, (output as any).args ?? {}, inputRef.directory)
      } catch (e) {
        // Re-throw guard errors — they should block the tool
        if (e instanceof Error && e.message.includes("Use the Edit tool")) throw e
      }
    },

    // Auto-extract memories from tool execution results (OpenRecall only)
    async "tool.execute.after"(input, output) {
      const config = getConfig()

      // Pattern-based extraction from tool outputs
      if (config.autoExtract) {
        try {
          extractFromToolOutput(
            input.tool,
            input.args,
            output.output,
            input.sessionID,
            projectId,
          )
        } catch {
          // Silent fail
        }
      }

      // Track file reads/edits as project knowledge
      try {
        extractFileKnowledge(
          input.tool,
          input.args,
          output.output,
          input.sessionID,
          projectId,
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error("[OpenRecall] extractFileKnowledge error:", msg)
      }

      // Mistake tracking: detect errors and store as anti-patterns
      if (isDbAvailable()) {
        try {
          trackMistake(
            input.tool,
            input.args,
            output.output,
            input.sessionID,
            projectId,
          )
        } catch {
          // Silent fail — never block tool execution
        }
      }

      // Edit error recovery: inject re-read reminder on Edit failures
      try {
        handleEditErrorRecovery(input.tool, output)
      } catch {
        // Silent fail
      }

      // Tool output truncation: prevent context bloat from large outputs
      try {
        handleToolOutputTruncation(input.tool, output)
      } catch {
        // Silent fail
      }

      // Context window monitor: remind model it has room at 70%+ usage
      try {
        handleContextWindowMonitor(input.sessionID, output)
      } catch {
        // Silent fail
      }

      // Preemptive compaction: auto-trigger at 78% context usage
      try {
        await preemptiveCompaction.toolExecuteAfter(input, output)
      } catch {
        // Silent fail
      }
    },

    // Expose both OpenRecall memory tools and SCR tools
    tool: {
      ...createTools(projectId),
      ...(scrHooks.tool || {}),
    },

    // Inject both memory context and SCR system prompt
    "experimental.chat.system.transform": async (input, output) => {
      // OpenRecall: inject memory context
      const lines: string[] = [
        "IMPORTANT: You have persistent cross-session memory tools (memory_store, memory_search, memory_list, memory_update, memory_delete, memory_tag, memory_link, memory_refresh, memory_stats, memory_export, memory_import, memory_cleanup, memory_file_check).",
        "MANDATORY FILE ACCESS RULE: You MUST call memory_file_check(file_path) BEFORE every file read. " +
          "If memory_file_check returns content (\"File unchanged\"), you MUST use that content and MUST NOT call read/Read on that file. " +
          "Only call read/Read if memory_file_check returns \"No memory found\" or \"File has been modified\". " +
          "Calling read on a file after memory_file_check already returned its content is FORBIDDEN — it wastes tokens and time. " +
          "This rule applies to ALL files, every time, with no exceptions.",
        "When the user asks you to remember, save, store, or note something, you MUST call memory_store immediately.",
        "Use memory_store to save important findings, decisions, user preferences, and patterns. Your final responses are automatically distilled into memory.",
        "Errors and failures from tool execution are automatically tracked as anti-pattern memories. Search for category 'anti-pattern' to recall past mistakes and avoid repeating them.",
      ]

      // Add dynamic summary if DB is available
      if (isDbAvailable()) {
        try {
          const stats = getStats()
          if (stats.total > 0) {
            const catSummary = Object.entries(stats.byCategory)
              .map(([cat, count]) => `${count} ${cat}`)
              .join(", ")
            lines.push(`[OpenRecall] ${stats.total} memories stored: ${catSummary}.`)

            // Show last few recent memories as brief summaries
            const recent = listMemories({ projectId, limit: 3 })
            if (recent.length > 0) {
              const previews = recent
                .map((m) => {
                  const preview = m.content.length > 60
                    ? m.content.slice(0, 57) + "..."
                    : m.content
                  return `"${preview}"`
                })
                .join(" | ")
              lines.push(`Recent: ${previews}`)
            }
          }
        } catch {
          // Silent fail
        }
      }

      output.system.push(lines.join("\n"))

      // Inject auto-recalled memories if available
      const sessionId = input.sessionID
      if (sessionId) {
        const memories = recalledMemories.get(sessionId)
        if (memories) {
          output.system.push(memories)
        }
      }

      // Edit error recovery: inject buffered reminders from messages transform
      if (editErrorSystemPrompt.system.length > 0) {
        output.system.push(...editErrorSystemPrompt.system)
        editErrorSystemPrompt.system = []
      }

      // SCR: inject system prompt
      if (scrHooks["experimental.chat.system.transform"]) {
        await scrHooks["experimental.chat.system.transform"](input, output)
      }
    },

    // SCR message reduction pipeline + edit error recovery scan
    "experimental.chat.messages.transform": async (input: any, output: any) => {
      // Scan messages for edit/apply_patch errors and store reminder for system prompt
      try {
        checkEditErrorsInMessages(output.messages, editErrorSystemPrompt)
      } catch {
        // Silent fail
      }

      // SCR: run message reduction pipeline
      if (scrHooks["experimental.chat.messages.transform"]) {
        await (scrHooks["experimental.chat.messages.transform"] as any)(input, output)
      }
    },

    // Auto-distill the LLM's final response text into memory (OpenRecall only)
    "experimental.text.complete": async (input, output) => {
      if (!isDbAvailable()) return
      const text = output.text
      if (!text || text.length < 200) return

      try {
        // Truncate at sentence boundary within first 500 chars
        const summary = truncateAtSentence(text, 500)
        storeMemory({
          content: summary,
          category: "discovery",
          projectId,
          sessionId: input.sessionID,
          source: "auto-distill: assistant response",
          tags: ["auto-distill", "assistant-response"],
        })
      } catch {
        // Silent fail — never block the response
      }
    },

    // Structured session summary for compaction (inspired by oh-my-opencode)
    "experimental.session.compacting": async (_input, output) => {
      // Capture todos before compaction wipes them
      try {
        const sessionId = (_input as any).sessionID
        if (sessionId) await todoPreserver.capture(sessionId)
      } catch {
        // Silent fail
      }
      // Build memory context to include in compaction summary
      let memoryContext = ""
      if (isDbAvailable()) {
        try {
          const recent = listMemories({ projectId, limit: 5 })
          if (recent.length > 0) {
            const items = recent.map((m) => `- [${m.category}] ${m.content}`).join("\n")
            memoryContext = `\n### Relevant Stored Memories\n${items}\n`
          }
        } catch {
          // Silent fail
        }
      }

      output.context.push(
        `When summarizing this session, you MUST include the following sections in your summary:

## 1. User Requests (As-Is)
- List all original user requests exactly as they were stated
- Preserve the user's exact wording and intent

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected

## 3. Work Completed
- What has been done so far
- Files created/modified with their paths
- Features implemented
- Problems solved

## 4. Remaining Tasks
- What still needs to be done
- Pending items from the original request
- Follow-up tasks identified during the work

## 5. Active Working Context (For Seamless Continuation)
- **Files**: Paths of files currently being edited or frequently referenced
- **Code in Progress**: Key code snippets, function signatures, or data structures under active development
- **External References**: Documentation URLs, library APIs, or external resources being consulted
- **State & Variables**: Important variable names, configuration values, or runtime state relevant to ongoing work

## 6. Mistakes & Anti-Patterns Encountered
- Approaches that failed and why (so they are not repeated)
- Error messages that were encountered and their solutions
- Commands or patterns that did NOT work in this project

## 7. Key Decisions & Discoveries
- Architectural decisions made and their rationale
- Important discoveries about the codebase, APIs, or dependencies
- User preferences or conventions observed

IMPORTANT: Before compacting, use memory_store to persist any important findings, decisions, anti-patterns, or user preferences from this session. These will be available in future sessions even after compaction.
${memoryContext}
This structured summary is critical for maintaining continuity after compaction.`,
      )
    },

    // SCR: command handler (SCR only)
    "command.execute.before": scrHooks["command.execute.before"] as any,
  }
}

/** Extract text content from a user message output */
function extractUserText(output: { message: any; parts: any[] }): string {
  // Try to get text from parts first
  if (output.parts && Array.isArray(output.parts)) {
    const texts = output.parts
      .filter((p: any) => p.type === "text" && p.text)
      .map((p: any) => p.text)
    if (texts.length > 0) return texts.join(" ")
  }

  // Fall back to message content
  if (output.message) {
    const msg = output.message as any
    if (typeof msg.content === "string") return msg.content
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((c: any) => c.type === "text" && c.text)
        .map((c: any) => c.text)
        .join(" ")
    }
  }

  return ""
}

/** Truncate text at the last sentence boundary within maxLen */
function truncateAtSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text

  const chunk = text.slice(0, maxLen)
  // Find last sentence-ending punctuation followed by a space or end
  const match = chunk.match(/^([\s\S]*[.!?])\s/m)
  if (match?.[1] && match[1].length >= maxLen * 0.5) {
    return match[1]
  }
  // Fallback: cut at last space
  const lastSpace = chunk.lastIndexOf(" ")
  if (lastSpace > maxLen * 0.5) {
    return chunk.slice(0, lastSpace) + "..."
  }
  return chunk + "..."
}
