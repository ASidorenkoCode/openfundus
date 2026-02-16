import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { getDb, closeDb, isDbAvailable } from "../src/db"
import { setupTestDb, teardownTestDb } from "./helpers"

describe("db", () => {
  beforeEach(() => setupTestDb())
  afterEach(() => teardownTestDb())

  test("creates database and returns instance", () => {
    const db = getDb()
    expect(db).toBeDefined()
    expect(isDbAvailable()).toBe(true)
  })

  test("returns same instance on repeated calls", () => {
    const db1 = getDb()
    const db2 = getDb()
    expect(db1).toBe(db2)
  })

  test("creates memory table", () => {
    const db = getDb()
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory'",
      )
      .all() as { name: string }[]
    expect(tables).toHaveLength(1)
  })

  test("creates FTS5 virtual table", () => {
    const db = getDb()
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'",
      )
      .all() as { name: string }[]
    expect(tables).toHaveLength(1)
  })

  test("creates _migrations table with migration 1 applied", () => {
    const db = getDb()
    const rows = db.prepare("SELECT * FROM _migrations").all() as {
      version: number
      description: string
    }[]
    expect(rows).toHaveLength(6)
    expect(rows[0]!.version).toBe(1)
    expect(rows[1]!.version).toBe(2)
    expect(rows[2]!.version).toBe(3)
    expect(rows[3]!.version).toBe(4)
    expect(rows[4]!.version).toBe(5)
    expect(rows[5]!.version).toBe(6)
  })

  test("sets WAL mode", () => {
    const db = getDb()
    const mode = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string
    }
    expect(mode.journal_mode).toBe("wal")
  })

  test("closeDb cleans up", () => {
    getDb()
    expect(isDbAvailable()).toBe(true)
    closeDb()
    expect(isDbAvailable()).toBe(false)
  })
})
