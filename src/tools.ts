import { tool } from "@opencode-ai/plugin"
import {
  storeMemory,
  searchMemories,
  updateMemory,
  deleteMemory,
  listMemories,
  getStats,
  refreshMemory,
  getMemory,
  addTags,
  removeTags,
  getTagsForMemory,
  listAllTags,
  searchByTag,
  addLink,
  removeLink,
  getLinksForMemory,
} from "./memory"
import { getConfig } from "./config"
import { isDbAvailable } from "./db"
import { checkFileFreshness } from "./agent"
import {
  runMaintenance,
  purgeOldMemories,
  getDbSize,
  vacuumDb,
} from "./maintenance"

function safeExecute<T>(fn: () => T, fallback: string): T | string {
  if (!isDbAvailable()) {
    return "[OpenRecall] Memory database is unavailable. Plugin may not have initialized correctly."
  }
  try {
    return fn()
  } catch (e: any) {
    console.error("[OpenRecall] Tool error:", e)
    return `${fallback}: ${e.message || e}`
  }
}

export function createTools(projectId: string) {
  const config = getConfig()
  return {
    memory_store: tool({
      description:
        "Store an important finding, decision, pattern, or learning in persistent cross-session memory. " +
        "Use this to save things worth remembering: architectural decisions, debugging insights, " +
        "user preferences, code patterns, project conventions, or important discoveries. " +
        "These memories persist across sessions and can be searched later.",
      args: {
        content: tool.schema
          .string()
          .describe(
            "The memory content to store. Be specific and include context. " +
              "Good: 'The auth module uses JWT with RS256 signing, keys stored in /etc/app/keys'. " +
              "Bad: 'auth uses JWT'.",
          ),
        category: tool.schema
          .enum([
            "decision",
            "pattern",
            "debugging",
            "preference",
            "convention",
            "discovery",
            "general",
          ])
          .optional()
          .describe(
            "Category of this memory. " +
              "decision: architectural/design decisions. " +
              "pattern: code patterns and idioms. " +
              "debugging: debugging insights and solutions. " +
              "preference: user preferences and workflow. " +
              "convention: project conventions and standards. " +
              "discovery: important findings. " +
              "general: anything else.",
          ),
        source: tool.schema
          .string()
          .optional()
          .describe(
            "Where this memory came from, e.g. a file path or context description",
          ),
        tags: tool.schema
          .string()
          .optional()
          .describe(
            "Comma-separated tags for this memory, e.g. 'auth,jwt,security'. " +
              "Tags help organize and filter memories across categories.",
          ),
        global: tool.schema
          .boolean()
          .optional()
          .describe(
            "If true, this memory applies to ALL projects (not just the current one). " +
              "Use for user preferences, workflow conventions, or cross-project knowledge.",
          ),
        force: tool.schema
          .boolean()
          .optional()
          .describe(
            "If true, skip deduplication check and always create a new memory. " +
              "By default, duplicates are detected and merged.",
          ),
      },
      async execute(args, context) {
        return safeExecute(() => {
          const tags = args.tags
            ? args.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
            : undefined
          const memory = storeMemory({
            content: args.content,
            category: args.category || "general",
            sessionId: context.sessionID,
            projectId,
            source: args.source,
            tags,
            global: args.global,
            force: args.force,
          })
          const scope = memory.project_id ? "project" : "global"
          return `Stored ${scope} memory [${memory.id}] in category "${memory.category}".`
        }, "Failed to store memory")
      },
    }),

    memory_search: tool({
      description:
        "Search persistent cross-session memory for relevant past context. " +
        "Use this to recall previous findings, decisions, patterns, or debugging insights. " +
        "Searches across all sessions using full-text search with BM25 ranking. " +
        "Query with natural language or keywords.",
      args: {
        query: tool.schema
          .string()
          .describe(
            "Search query. Use keywords or natural language. " +
              "Examples: 'authentication JWT', 'database migration strategy', 'user preference dark mode'.",
          ),
        category: tool.schema
          .enum([
            "decision",
            "pattern",
            "debugging",
            "preference",
            "convention",
            "discovery",
            "general",
          ])
          .optional()
          .describe("Filter results to a specific category"),
        limit: tool.schema
          .number()
          .optional()
          .describe("Max results to return (default: 10)"),
      },
      async execute(args) {
        return safeExecute(() => {
          const results = searchMemories({
            query: args.query,
            category: args.category,
            projectId,
            limit: args.limit || config.searchLimit,
          })

          if (results.length === 0) {
            return "No memories found matching the query."
          }

          const formatted = results
            .map((r, i) => {
              const time = new Date(r.memory.time_created * 1000).toISOString()
              return [
                `[${i + 1}] ${r.memory.category.toUpperCase()}`,
                `    ${r.memory.content}`,
                r.memory.source ? `    Source: ${r.memory.source}` : "",
                `    Stored: ${time} | ID: ${r.memory.id}`,
              ]
                .filter(Boolean)
                .join("\n")
            })
            .join("\n\n")

          return `Found ${results.length} memories:\n\n${formatted}`
        }, "Failed to search memories")
      },
    }),

    memory_update: tool({
      description:
        "Update an existing memory's content, category, or source. " +
        "Use this to refine or correct a previously stored memory without losing its ID and creation timestamp.",
      args: {
        id: tool.schema.string().describe("The memory ID to update"),
        content: tool.schema
          .string()
          .optional()
          .describe("New content to replace the existing content"),
        category: tool.schema
          .enum([
            "decision",
            "pattern",
            "debugging",
            "preference",
            "convention",
            "discovery",
            "general",
          ])
          .optional()
          .describe("New category"),
        source: tool.schema
          .string()
          .optional()
          .describe("New source description"),
      },
      async execute(args) {
        return safeExecute(() => {
          const updated = updateMemory(args.id, {
            content: args.content,
            category: args.category,
            source: args.source,
          })
          if (!updated) return `Memory ${args.id} not found.`
          return `Updated memory ${args.id}. Category: "${updated.category}".`
        }, "Failed to update memory")
      },
    }),

    memory_delete: tool({
      description: "Delete a specific memory by its ID.",
      args: {
        id: tool.schema.string().describe("The memory ID to delete"),
      },
      async execute(args) {
        return safeExecute(() => {
          const deleted = deleteMemory(args.id)
          return deleted
            ? `Deleted memory ${args.id}.`
            : `Memory ${args.id} not found.`
        }, "Failed to delete memory")
      },
    }),

    memory_list: tool({
      description:
        "List recent memories, optionally filtered by category and scope. " +
        "Use this to browse what has been remembered without a specific search query.",
      args: {
        category: tool.schema
          .enum([
            "decision",
            "pattern",
            "debugging",
            "preference",
            "convention",
            "discovery",
            "general",
          ])
          .optional()
          .describe("Filter by category"),
        scope: tool.schema
          .enum(["project", "global", "all"])
          .optional()
          .describe(
            "Filter by scope: 'project' (current project only), 'global' (cross-project), " +
              "'all' (both). Default: 'all'.",
          ),
        limit: tool.schema
          .number()
          .optional()
          .describe("Max results (default: 20)"),
      },
      async execute(args) {
        return safeExecute(() => {
          const memories = listMemories({
            category: args.category,
            projectId,
            scope: args.scope || "all",
            limit: args.limit || 20,
          })

          if (memories.length === 0) {
            return "No memories stored yet."
          }

          const formatted = memories
            .map((m, i) => {
              const time = new Date(m.time_created * 1000).toISOString()
              return [
                `[${i + 1}] ${m.category.toUpperCase()}`,
                `    ${m.content}`,
                m.source ? `    Source: ${m.source}` : "",
                `    Stored: ${time} | ID: ${m.id}`,
              ]
                .filter(Boolean)
                .join("\n")
            })
            .join("\n\n")

          return `${memories.length} memories:\n\n${formatted}`
        }, "Failed to list memories")
      },
    }),

    memory_refresh: tool({
      description:
        "Manually boost a memory's relevance so it ranks higher in future searches. " +
        "Use this when you encounter a memory that is still highly relevant and should not decay.",
      args: {
        id: tool.schema.string().describe("The memory ID to refresh"),
      },
      async execute(args) {
        return safeExecute(() => {
          const refreshed = refreshMemory(args.id)
          if (!refreshed) return `Memory ${args.id} not found.`
          return `Refreshed memory ${args.id}. Access count: ${refreshed.access_count}.`
        }, "Failed to refresh memory")
      },
    }),

    memory_tag: tool({
      description:
        "Manage tags on a memory: add, remove, or list tags. " +
        "Also list all known tags with counts, or find memories by tag.",
      args: {
        action: tool.schema
          .enum(["add", "remove", "list", "list_all", "search"])
          .describe(
            "Action to perform. " +
              "add: add tags to a memory. " +
              "remove: remove tags from a memory. " +
              "list: list tags for a specific memory. " +
              "list_all: list all known tags with counts. " +
              "search: find memories with a specific tag.",
          ),
        id: tool.schema
          .string()
          .optional()
          .describe("Memory ID (required for add/remove/list)"),
        tags: tool.schema
          .string()
          .optional()
          .describe("Comma-separated tags (required for add/remove/search)"),
      },
      async execute(args) {
        return safeExecute(() => {
          const tagList = args.tags
            ? args.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
            : []

          switch (args.action) {
            case "add": {
              if (!args.id) return "Memory ID is required for add action."
              if (tagList.length === 0) return "At least one tag is required."
              addTags(args.id, tagList)
              return `Added tags [${tagList.join(", ")}] to memory ${args.id}.`
            }
            case "remove": {
              if (!args.id) return "Memory ID is required for remove action."
              if (tagList.length === 0) return "At least one tag is required."
              removeTags(args.id, tagList)
              return `Removed tags [${tagList.join(", ")}] from memory ${args.id}.`
            }
            case "list": {
              if (!args.id) return "Memory ID is required for list action."
              const tags = getTagsForMemory(args.id)
              if (tags.length === 0) return `No tags on memory ${args.id}.`
              return `Tags for ${args.id}: ${tags.join(", ")}`
            }
            case "list_all": {
              const all = listAllTags()
              if (all.length === 0) return "No tags exist yet."
              return all.map((t) => `  ${t.tag}: ${t.count} memories`).join("\n")
            }
            case "search": {
              if (tagList.length === 0) return "A tag is required for search."
              const memories = searchByTag(tagList[0]!, { projectId })
              if (memories.length === 0) return `No memories tagged "${tagList[0]}".`
              const formatted = memories
                .map((m, i) => {
                  const time = new Date(m.time_created * 1000).toISOString()
                  return `[${i + 1}] ${m.category.toUpperCase()}\n    ${m.content}\n    Stored: ${time} | ID: ${m.id}`
                })
                .join("\n\n")
              return `Memories tagged "${tagList[0]}":\n\n${formatted}`
            }
            default:
              return "Unknown action."
          }
        }, "Failed to manage tags")
      },
    }),

    memory_link: tool({
      description:
        "Manage relationships between memories: link, unlink, or view links. " +
        "Relationships: 'related' (general connection), 'supersedes' (replaces older memory), " +
        "'contradicts' (conflicts with another), 'extends' (builds upon another).",
      args: {
        action: tool.schema
          .enum(["link", "unlink", "list"])
          .describe(
            "Action: link (create relationship), unlink (remove relationship), " +
              "list (show all links for a memory).",
          ),
        source_id: tool.schema
          .string()
          .describe("The source memory ID"),
        target_id: tool.schema
          .string()
          .optional()
          .describe("The target memory ID (required for link/unlink)"),
        relationship: tool.schema
          .enum(["related", "supersedes", "contradicts", "extends"])
          .optional()
          .describe("Relationship type (required for link)"),
      },
      async execute(args) {
        return safeExecute(() => {
          switch (args.action) {
            case "link": {
              if (!args.target_id) return "Target memory ID is required for link action."
              if (!args.relationship) return "Relationship type is required for link action."
              const ok = addLink(args.source_id, args.target_id, args.relationship)
              if (!ok) return "Failed to link: one or both memory IDs not found, or same ID."
              return `Linked ${args.source_id} → ${args.relationship} → ${args.target_id}.`
            }
            case "unlink": {
              if (!args.target_id) return "Target memory ID is required for unlink action."
              const removed = removeLink(args.source_id, args.target_id)
              return removed
                ? `Unlinked ${args.source_id} from ${args.target_id}.`
                : "Link not found."
            }
            case "list": {
              const links = getLinksForMemory(args.source_id)
              if (links.length === 0) return `No links for memory ${args.source_id}.`
              const formatted = links
                .map((l, i) => {
                  const dir = l.source_id === args.source_id ? "→" : "←"
                  return `[${i + 1}] ${dir} ${l.relationship}: ${l.linked_memory.content} (ID: ${l.linked_memory.id})`
                })
                .join("\n")
              return `Links for ${args.source_id}:\n${formatted}`
            }
            default:
              return "Unknown action."
          }
        }, "Failed to manage memory links")
      },
    }),

    memory_stats: tool({
      description: "Show memory statistics: total count and breakdown by category.",
      args: {},
      async execute() {
        return safeExecute(() => {
          const stats = getStats()

          if (stats.total === 0) {
            return "No memories stored yet."
          }

          const breakdown = Object.entries(stats.byCategory)
            .map(([cat, count]) => `  ${cat}: ${count}`)
            .join("\n")

          const sizeBytes = getDbSize()
          const sizeStr =
            sizeBytes > 1048576
              ? `${(sizeBytes / 1048576).toFixed(1)} MB`
              : `${(sizeBytes / 1024).toFixed(1)} KB`

          return `Total memories: ${stats.total}\nDB size: ${sizeStr}\n\nBy category:\n${breakdown}`
        }, "Failed to get memory stats")
      },
    }),

    memory_cleanup: tool({
      description:
        "Run database maintenance: optimize FTS index, enforce memory limits, " +
        "optionally purge old unused memories or vacuum the database.",
      args: {
        purge_days: tool.schema
          .number()
          .optional()
          .describe(
            "Purge memories older than this many days that have never been accessed. " +
              "Only affects unaccessed memories.",
          ),
        vacuum: tool.schema
          .boolean()
          .optional()
          .describe("If true, also vacuum the database to reclaim disk space."),
      },
      async execute(args) {
        return safeExecute(() => {
          const result = runMaintenance()
          const lines = [
            `FTS optimized: ${result.ftsOptimized ? "yes" : "no"}`,
            `Memories trimmed (over limit): ${result.memoriesTrimmed}`,
          ]

          if (args.purge_days) {
            const purged = purgeOldMemories(args.purge_days)
            lines.push(`Purged (older than ${args.purge_days} days, never accessed): ${purged}`)
          }

          if (args.vacuum) {
            vacuumDb()
            lines.push("Database vacuumed.")
          }

          const sizeBytes = getDbSize()
          const sizeStr =
            sizeBytes > 1048576
              ? `${(sizeBytes / 1048576).toFixed(1)} MB`
              : `${(sizeBytes / 1024).toFixed(1)} KB`
          lines.push(`DB size: ${sizeStr}`)

          return `Maintenance complete:\n${lines.join("\n")}`
        }, "Failed to run maintenance")
      },
    }),

    memory_export: tool({
      description:
        "Export memories to JSON format for backup or migration. " +
        "Includes all metadata, tags, and relationships.",
      args: {
        category: tool.schema
          .enum([
            "decision", "pattern", "debugging", "preference",
            "convention", "discovery", "general",
          ])
          .optional()
          .describe("Filter by category"),
        scope: tool.schema
          .enum(["project", "global", "all"])
          .optional()
          .describe("Filter by scope (default: all)"),
      },
      async execute(args) {
        return safeExecute(() => {
          const memories = listMemories({
            category: args.category,
            projectId,
            scope: args.scope || "all",
            limit: 10000,
          })

          const exportData = {
            version: 1,
            exported_at: new Date().toISOString(),
            memories: memories.map((m) => ({
              id: m.id,
              content: m.content,
              category: m.category,
              source: m.source,
              project_id: m.project_id,
              time_created: m.time_created,
              time_updated: m.time_updated,
              access_count: m.access_count,
              tags: getTagsForMemory(m.id),
              links: getLinksForMemory(m.id).map((l) => ({
                target_id: l.source_id === m.id ? l.target_id : l.source_id,
                relationship: l.relationship,
              })),
            })),
          }

          return JSON.stringify(exportData, null, 2)
        }, "Failed to export memories")
      },
    }),

    memory_import: tool({
      description:
        "Import memories from JSON format (as produced by memory_export). " +
        "Handles ID conflicts by skipping duplicates.",
      args: {
        data: tool.schema
          .string()
          .describe("The JSON string of exported memories to import"),
      },
      async execute(args) {
        return safeExecute(() => {
          let parsed: any
          try {
            parsed = JSON.parse(args.data)
          } catch {
            return "Invalid JSON data."
          }

          if (!parsed.memories || !Array.isArray(parsed.memories)) {
            return "Invalid export format: missing 'memories' array."
          }

          let added = 0
          let skipped = 0
          let errors = 0
          const idMap = new Map<string, string>()

          for (const entry of parsed.memories) {
            try {
              // Skip if memory with same ID already exists
              if (getMemory(entry.id)) {
                idMap.set(entry.id, entry.id)
                skipped++
                continue
              }

              const memory = storeMemory({
                content: entry.content,
                category: entry.category || "general",
                projectId: entry.project_id || undefined,
                source: entry.source || undefined,
                tags: entry.tags,
                global: !entry.project_id,
                force: true,
              })
              idMap.set(entry.id, memory.id)
              added++
            } catch {
              errors++
            }
          }

          // Restore links using the ID map
          let linksRestored = 0
          for (const entry of parsed.memories) {
            if (entry.links && Array.isArray(entry.links)) {
              for (const link of entry.links) {
                const sourceId = idMap.get(entry.id)
                const targetId = idMap.get(link.target_id)
                if (sourceId && targetId) {
                  try {
                    addLink(sourceId, targetId, link.relationship)
                    linksRestored++
                  } catch { /* skip invalid links */ }
                }
              }
            }
          }

          return [
            `Import complete:`,
            `  Added: ${added}`,
            `  Skipped (existing): ${skipped}`,
            `  Errors: ${errors}`,
            `  Links restored: ${linksRestored}`,
          ].join("\n")
        }, "Failed to import memories")
      },
    }),

    memory_file_check: tool({
      description:
        "MANDATORY: Call this BEFORE every file read. Returns cached file content if the file is unchanged, " +
        "saving a read call. If this returns 'File unchanged' with content, you MUST use that content and " +
        "MUST NOT call read on the file. Only read the file if this returns 'No memory found' or 'File has been modified'.",
      args: {
        file_path: tool.schema
          .string()
          .describe(
            "The absolute or relative path of the file to check. " +
              "This should be the same path you would pass to the read tool.",
          ),
      },
      async execute(args) {
        return safeExecute(() => {
          const result = checkFileFreshness(args.file_path, projectId)

          if (!result) {
            return "No memory found for this file. Read it normally."
          }

          if (result.fresh) {
            return `File unchanged since last read. Memory content:\n${result.storedContent}`
          }

          return "File has been modified since last read. Please re-read it."
        }, "Failed to check file freshness")
      },
    }),
  }
}
