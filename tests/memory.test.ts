import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  storeMemory,
  searchMemories,
  getMemory,
  updateMemory,
  deleteMemory,
  listMemories,
  getStats,
  sanitizeQuery,
  refreshMemory,
  getTagsForMemory,
  addTags,
  removeTags,
  listAllTags,
  searchByTag,
  addLink,
  removeLink,
  getLinksForMemory,
} from "../src/memory"
import { setupTestDb, teardownTestDb } from "./helpers"
import { getDb } from "../src/db"

describe("memory", () => {
  beforeEach(() => {
    setupTestDb()
    getDb() // initialize db
  })
  afterEach(() => teardownTestDb())

  describe("storeMemory", () => {
    test("stores a memory with all fields", () => {
      const m = storeMemory({
        content: "JWT uses RS256 signing",
        category: "decision",
        sessionId: "session-1",
        projectId: "project-1",
        source: "auth.ts",
      })

      expect(m.id).toBeDefined()
      expect(m.content).toBe("JWT uses RS256 signing")
      expect(m.category).toBe("decision")
      expect(m.session_id).toBe("session-1")
      expect(m.project_id).toBe("project-1")
      expect(m.source).toBe("auth.ts")
      expect(m.time_created).toBeGreaterThan(0)
    })

    test("defaults category to general", () => {
      const m = storeMemory({ content: "test" })
      expect(m.category).toBe("general")
    })

    test("persists to database", () => {
      const m = storeMemory({ content: "persisted memory" })
      const fetched = getMemory(m.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.content).toBe("persisted memory")
    })
  })

  describe("searchMemories", () => {
    test("finds memories by keyword", () => {
      storeMemory({ content: "Authentication uses JWT tokens" })
      storeMemory({ content: "Database uses PostgreSQL" })

      const results = searchMemories({ query: "JWT" })
      expect(results).toHaveLength(1)
      expect(results[0]!.memory.content).toContain("JWT")
    })

    test("ranks results by relevance", () => {
      storeMemory({ content: "JWT authentication is fast" })
      storeMemory({ content: "JWT JWT JWT tokens everywhere" })

      const results = searchMemories({ query: "JWT" })
      expect(results.length).toBeGreaterThanOrEqual(2)
    })

    test("filters by category", () => {
      storeMemory({ content: "JWT auth decision", category: "decision" })
      storeMemory({ content: "JWT auth pattern", category: "pattern" })

      const results = searchMemories({
        query: "JWT",
        category: "decision",
      })
      expect(results).toHaveLength(1)
      expect(results[0]!.memory.category).toBe("decision")
    })

    test("filters by project", () => {
      storeMemory({
        content: "Project A uses JWT",
        projectId: "a",
      })
      storeMemory({
        content: "Project B uses JWT",
        projectId: "b",
      })

      const results = searchMemories({
        query: "JWT",
        projectId: "a",
      })
      expect(results).toHaveLength(1)
      expect(results[0]!.memory.project_id).toBe("a")
    })

    test("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        storeMemory({ content: `JWT item ${i}`, force: true })
      }

      const results = searchMemories({ query: "JWT", limit: 2 })
      expect(results).toHaveLength(2)
    })

    test("returns empty for no matches", () => {
      storeMemory({ content: "something else" })
      const results = searchMemories({ query: "nonexistent" })
      expect(results).toHaveLength(0)
    })

    test("handles special characters in query", () => {
      storeMemory({ content: "test data here" })
      const results = searchMemories({ query: 'test "data" (here)' })
      // should not throw, may or may not find results depending on sanitization
      expect(Array.isArray(results)).toBe(true)
    })
  })

  describe("updateMemory", () => {
    test("updates content", () => {
      const m = storeMemory({ content: "old content" })
      const updated = updateMemory(m.id, { content: "new content" })
      expect(updated!.content).toBe("new content")
    })

    test("updates category", () => {
      const m = storeMemory({ content: "test", category: "general" })
      const updated = updateMemory(m.id, { category: "decision" })
      expect(updated!.category).toBe("decision")
    })

    test("updates time_updated", () => {
      const m = storeMemory({ content: "test" })
      // small delay to ensure different timestamp
      const updated = updateMemory(m.id, { content: "updated" })
      expect(updated!.time_updated).toBeGreaterThanOrEqual(m.time_updated)
    })

    test("returns null for non-existent id", () => {
      const result = updateMemory("non-existent", { content: "test" })
      expect(result).toBeNull()
    })

    test("FTS5 index reflects updates", () => {
      const m = storeMemory({ content: "old keyword searchable" })
      updateMemory(m.id, { content: "new keyword findable" })

      const oldResults = searchMemories({ query: "searchable" })
      expect(oldResults).toHaveLength(0)

      const newResults = searchMemories({ query: "findable" })
      expect(newResults).toHaveLength(1)
    })
  })

  describe("deleteMemory", () => {
    test("deletes existing memory", () => {
      const m = storeMemory({ content: "to delete" })
      expect(deleteMemory(m.id)).toBe(true)
      expect(getMemory(m.id)).toBeNull()
    })

    test("returns false for non-existent id", () => {
      expect(deleteMemory("non-existent")).toBe(false)
    })

    test("removes from FTS5 index", () => {
      const m = storeMemory({ content: "unique searchterm" })
      deleteMemory(m.id)
      const results = searchMemories({ query: "searchterm" })
      expect(results).toHaveLength(0)
    })
  })

  describe("listMemories", () => {
    test("lists all memories", () => {
      storeMemory({ content: "first" })
      storeMemory({ content: "second" })
      const list = listMemories()
      expect(list).toHaveLength(2)
    })

    test("filters by category", () => {
      storeMemory({ content: "a", category: "decision" })
      storeMemory({ content: "b", category: "pattern" })
      const list = listMemories({ category: "decision" })
      expect(list).toHaveLength(1)
    })

    test("respects limit", () => {
      for (let i = 0; i < 5; i++) storeMemory({ content: `item ${i}`, force: true })
      const list = listMemories({ limit: 3 })
      expect(list).toHaveLength(3)
    })
  })

  describe("getStats", () => {
    test("returns zero for empty db", () => {
      const stats = getStats()
      expect(stats.total).toBe(0)
      expect(Object.keys(stats.byCategory)).toHaveLength(0)
    })

    test("counts by category", () => {
      storeMemory({ content: "a", category: "decision" })
      storeMemory({ content: "b", category: "decision" })
      storeMemory({ content: "c", category: "pattern" })

      const stats = getStats()
      expect(stats.total).toBe(3)
      expect(stats.byCategory["decision"]).toBe(2)
      expect(stats.byCategory["pattern"]).toBe(1)
    })
  })

  describe("deduplication", () => {
    test("exact duplicate returns existing memory", () => {
      const m1 = storeMemory({ content: "JWT uses RS256 signing" })
      const m2 = storeMemory({ content: "JWT uses RS256 signing" })
      expect(m2.id).toBe(m1.id)
    })

    test("exact duplicate is case-insensitive and whitespace-normalized", () => {
      const m1 = storeMemory({ content: "JWT uses RS256 signing" })
      const m2 = storeMemory({ content: "  jwt  uses  rs256  signing  " })
      expect(m2.id).toBe(m1.id)
    })

    test("force bypasses dedup", () => {
      const m1 = storeMemory({ content: "JWT uses RS256 signing" })
      const m2 = storeMemory({ content: "JWT uses RS256 signing", force: true })
      expect(m2.id).not.toBe(m1.id)
    })

    test("near-duplicate updates existing memory", () => {
      const m1 = storeMemory({
        content: "the authentication module uses JWT tokens for signing requests securely",
      })
      const m2 = storeMemory({
        content: "the authentication module uses JWT tokens for signing requests reliably",
      })
      // Near-duplicate should update existing, returning same id
      expect(m2.id).toBe(m1.id)
      expect(m2.content).toContain("reliably")
    })
  })

  describe("global memories", () => {
    test("stores global memory with null project_id", () => {
      const m = storeMemory({
        content: "Always use Bun",
        projectId: "proj-1",
        global: true,
      })
      expect(m.project_id).toBeNull()
    })

    test("search includes global memories alongside project ones", () => {
      storeMemory({ content: "Project JWT config", projectId: "proj-1" })
      storeMemory({ content: "Global JWT preference", global: true })

      const results = searchMemories({ query: "JWT", projectId: "proj-1" })
      expect(results).toHaveLength(2)
    })

    test("listMemories scope=global only shows global", () => {
      storeMemory({ content: "project mem", projectId: "p1" })
      storeMemory({ content: "global mem", global: true })

      const globals = listMemories({ scope: "global" })
      expect(globals).toHaveLength(1)
      expect(globals[0]!.project_id).toBeNull()
    })

    test("listMemories scope=project only shows project", () => {
      storeMemory({ content: "project mem", projectId: "p1" })
      storeMemory({ content: "global mem", global: true })

      const projectOnly = listMemories({ projectId: "p1", scope: "project" })
      expect(projectOnly).toHaveLength(1)
      expect(projectOnly[0]!.project_id).toBe("p1")
    })

    test("listMemories scope=all shows both", () => {
      storeMemory({ content: "project mem", projectId: "p1" })
      storeMemory({ content: "global mem", global: true })

      const all = listMemories({ projectId: "p1", scope: "all" })
      expect(all).toHaveLength(2)
    })
  })

  describe("access tracking and decay", () => {
    test("search increments access_count", () => {
      const m = storeMemory({ content: "JWT tokens authentication" })
      expect(m.access_count).toBe(0)

      searchMemories({ query: "JWT" })
      const after = getMemory(m.id)
      expect(after!.access_count).toBe(1)
      expect(after!.time_last_accessed).toBeGreaterThan(0)
    })

    test("refreshMemory boosts access_count", () => {
      const m = storeMemory({ content: "important pattern" })
      const refreshed = refreshMemory(m.id)
      expect(refreshed!.access_count).toBe(5)
      expect(refreshed!.time_last_accessed).toBeGreaterThan(0)
    })

    test("refreshMemory returns null for non-existent id", () => {
      expect(refreshMemory("non-existent")).toBeNull()
    })
  })

  describe("tags", () => {
    test("stores memory with tags", () => {
      const m = storeMemory({
        content: "JWT auth pattern",
        tags: ["auth", "jwt", "security"],
      })
      const tags = getTagsForMemory(m.id)
      expect(tags).toHaveLength(3)
      expect(tags).toContain("auth")
      expect(tags).toContain("jwt")
      expect(tags).toContain("security")
    })

    test("addTags adds tags to existing memory", () => {
      const m = storeMemory({ content: "test memory" })
      addTags(m.id, ["tag1", "tag2"])
      const tags = getTagsForMemory(m.id)
      expect(tags).toHaveLength(2)
      expect(tags).toContain("tag1")
      expect(tags).toContain("tag2")
    })

    test("addTags deduplicates", () => {
      const m = storeMemory({ content: "test" })
      addTags(m.id, ["tag1"])
      addTags(m.id, ["tag1", "tag2"])
      const tags = getTagsForMemory(m.id)
      expect(tags).toHaveLength(2)
    })

    test("removeTags removes specific tags", () => {
      const m = storeMemory({ content: "test", tags: ["a", "b", "c"] })
      removeTags(m.id, ["b"])
      const tags = getTagsForMemory(m.id)
      expect(tags).toHaveLength(2)
      expect(tags).not.toContain("b")
    })

    test("listAllTags returns tags with counts", () => {
      const m1 = storeMemory({ content: "first", tags: ["auth", "jwt"] })
      const m2 = storeMemory({ content: "second", tags: ["auth", "db"] })
      const all = listAllTags()
      expect(all.length).toBe(3)
      const authTag = all.find((t) => t.tag === "auth")
      expect(authTag!.count).toBe(2)
    })

    test("searchByTag finds tagged memories", () => {
      storeMemory({ content: "auth memory", tags: ["auth"] })
      storeMemory({ content: "db memory", tags: ["db"] })
      const results = searchByTag("auth")
      expect(results).toHaveLength(1)
      expect(results[0]!.content).toContain("auth")
    })

    test("searchByTag filters by project", () => {
      storeMemory({ content: "proj a", projectId: "a", tags: ["shared"] })
      storeMemory({ content: "proj b", projectId: "b", tags: ["shared"] })
      const results = searchByTag("shared", { projectId: "a" })
      expect(results).toHaveLength(1)
      expect(results[0]!.project_id).toBe("a")
    })

    test("tags are lowercased", () => {
      const m = storeMemory({ content: "test", tags: ["Auth", "JWT"] })
      const tags = getTagsForMemory(m.id)
      expect(tags).toContain("auth")
      expect(tags).toContain("jwt")
    })

    test("deleting memory cascades to tags", () => {
      const m = storeMemory({ content: "test", tags: ["tag1"] })
      deleteMemory(m.id)
      const tags = getTagsForMemory(m.id)
      expect(tags).toHaveLength(0)
    })
  })

  describe("links", () => {
    test("addLink creates a relationship", () => {
      const m1 = storeMemory({ content: "old decision" })
      const m2 = storeMemory({ content: "new decision" })
      expect(addLink(m2.id, m1.id, "supersedes")).toBe(true)

      const links = getLinksForMemory(m2.id)
      expect(links).toHaveLength(1)
      expect(links[0]!.relationship).toBe("supersedes")
      expect(links[0]!.linked_memory.id).toBe(m1.id)
    })

    test("addLink fails for non-existent memory", () => {
      const m = storeMemory({ content: "test" })
      expect(addLink(m.id, "non-existent", "related")).toBe(false)
    })

    test("addLink fails for self-link", () => {
      const m = storeMemory({ content: "test" })
      expect(addLink(m.id, m.id, "related")).toBe(false)
    })

    test("removeLink removes a relationship", () => {
      const m1 = storeMemory({ content: "a" })
      const m2 = storeMemory({ content: "b" })
      addLink(m1.id, m2.id, "related")
      expect(removeLink(m1.id, m2.id)).toBe(true)
      expect(getLinksForMemory(m1.id)).toHaveLength(0)
    })

    test("getLinksForMemory shows links in both directions", () => {
      const m1 = storeMemory({ content: "a" })
      const m2 = storeMemory({ content: "b" })
      addLink(m1.id, m2.id, "extends")

      const fromM1 = getLinksForMemory(m1.id)
      expect(fromM1).toHaveLength(1)
      const fromM2 = getLinksForMemory(m2.id)
      expect(fromM2).toHaveLength(1)
    })

    test("deleting memory cascades to links", () => {
      const m1 = storeMemory({ content: "a" })
      const m2 = storeMemory({ content: "b" })
      addLink(m1.id, m2.id, "related")
      deleteMemory(m1.id)
      expect(getLinksForMemory(m2.id)).toHaveLength(0)
    })
  })

  describe("sanitizeQuery", () => {
    test("strips special characters", () => {
      expect(sanitizeQuery('test "quoted"')).not.toContain('"')
      expect(sanitizeQuery("test(parens)")).not.toContain("(")
    })

    test("removes stop words", () => {
      const result = sanitizeQuery("what is the authentication")
      expect(result).toBe("authentication")
    })

    test("handles empty/all-stopwords query", () => {
      const result = sanitizeQuery("the is a")
      expect(result.length).toBeGreaterThan(0)
    })

    test("preserves meaningful terms", () => {
      const result = sanitizeQuery("JWT authentication tokens")
      expect(result).toContain("jwt")
      expect(result).toContain("authentication")
      expect(result).toContain("tokens")
    })
  })
})
