import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { setupTestDb, teardownTestDb } from "./helpers"
import OpenRecallPlugin from "../src/index"
import { getDb, isDbAvailable } from "../src/db"
import { getMemory } from "../src/memory"

// Mock PluginInput
function createMockInput() {
  return {
    project: { id: "test-project" },
    directory: "/tmp/test",
    worktree: "/tmp/test",
    serverUrl: new URL("http://localhost:3000"),
    client: {
      session: { list: async () => [], get: async () => null },
      message: { list: async () => [] },
    },
    $: {} as any,
  } as any
}

describe("plugin e2e", () => {
  beforeEach(() => setupTestDb())
  afterEach(() => teardownTestDb())

  test("plugin initializes and returns all hooks", async () => {
    const input = createMockInput()
    const hooks = await OpenRecallPlugin(input)

    expect(hooks.config).toBeDefined()
    expect(hooks.event).toBeDefined()
    expect(hooks.tool).toBeDefined()
    expect(hooks["chat.message"]).toBeDefined()
    expect(hooks["tool.execute.after"]).toBeDefined()
    expect(hooks["experimental.chat.system.transform"]).toBeDefined()
    expect(hooks["experimental.session.compacting"]).toBeDefined()
  })

  test("config hook initializes database", async () => {
    const input = createMockInput()
    const hooks = await OpenRecallPlugin(input)

    // Config hook should init DB
    await hooks.config!({} as any)

    expect(isDbAvailable()).toBe(true)
    const db = getDb()
    expect(db).toBeDefined()
  })

  test("tool registration provides all memory tools", async () => {
    const input = createMockInput()
    const hooks = await OpenRecallPlugin(input)
    await hooks.config!({} as any)

    const tools = hooks.tool as Record<string, any>
    expect(tools.memory_store).toBeDefined()
    expect(tools.memory_search).toBeDefined()
    expect(tools.memory_update).toBeDefined()
    expect(tools.memory_delete).toBeDefined()
    expect(tools.memory_list).toBeDefined()
    expect(tools.memory_stats).toBeDefined()
    expect(tools.memory_refresh).toBeDefined()
    expect(tools.memory_tag).toBeDefined()
    expect(tools.memory_link).toBeDefined()
    expect(tools.memory_cleanup).toBeDefined()
    expect(tools.memory_export).toBeDefined()
    expect(tools.memory_import).toBeDefined()
  })

  test("store → search → delete lifecycle via tools", async () => {
    const input = createMockInput()
    const hooks = await OpenRecallPlugin(input)
    await hooks.config!({} as any)

    const tools = hooks.tool as Record<string, any>
    const context = { sessionID: "test-session" }

    // Store
    const storeResult = await tools.memory_store.execute(
      { content: "E2E test memory about authentication patterns", category: "pattern" },
      context,
    )
    expect(storeResult).toContain("Stored")

    // Extract ID from result
    const idMatch = storeResult.match(/\[([^\]]+)\]/)
    expect(idMatch).not.toBeNull()
    const memoryId = idMatch![1]!

    // Search
    const searchResult = await tools.memory_search.execute(
      { query: "authentication" },
      context,
    )
    expect(searchResult).toContain("authentication")

    // Verify in DB
    const memory = getMemory(memoryId)
    expect(memory).not.toBeNull()
    expect(memory!.content).toContain("authentication")

    // Delete
    const deleteResult = await tools.memory_delete.execute(
      { id: memoryId },
      context,
    )
    expect(deleteResult).toContain("Deleted")
    expect(getMemory(memoryId)).toBeNull()
  })

  test("system prompt hook injects memory context", async () => {
    const input = createMockInput()
    const hooks = await OpenRecallPlugin(input)
    await hooks.config!({} as any)

    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]!(
      { sessionID: "test-session", model: {} as any },
      output,
    )

    expect(output.system.length).toBeGreaterThan(0)
    expect(output.system[0]).toContain("memory")
  })

  test("compaction hook adds context", async () => {
    const input = createMockInput()
    const hooks = await OpenRecallPlugin(input)
    await hooks.config!({} as any)

    const output = { context: [] as string[], prompt: undefined }
    await hooks["experimental.session.compacting"]!(
      { sessionID: "test-session" },
      output,
    )

    expect(output.context.length).toBeGreaterThan(0)
    expect(output.context[0]).toContain("memory_store")
  })

  test("event hook tracks session lifecycle", async () => {
    const input = createMockInput()
    const hooks = await OpenRecallPlugin(input)
    await hooks.config!({} as any)

    // Session created
    await hooks.event!({
      event: {
        type: "session.created",
        properties: { id: "session-1", title: "Test Session" },
      } as any,
    })

    // Session deleted
    await hooks.event!({
      event: {
        type: "session.deleted",
        properties: { id: "session-1" },
      } as any,
    })

    // Should not throw
  })

  test("graceful degradation with missing DB", async () => {
    const input = createMockInput()
    const hooks = await OpenRecallPlugin(input)

    // Don't call config (no DB init)
    // Tools should return error message, not throw
    const tools = hooks.tool as Record<string, any>
    const result = await tools.memory_store.execute(
      { content: "test" },
      { sessionID: "test" },
    )
    expect(result).toContain("unavailable")
  })
})
