import { Database } from "bun:sqlite"
import { mkdirSync, existsSync } from "fs"
import { dirname } from "path"
import { getConfig } from "./config"
import { migrations } from "./migrations"

let db: Database | null = null
let initFailed = false

export function isDbAvailable(): boolean {
  return db !== null && !initFailed
}

export function getDb(): Database {
  if (db) return db

  if (initFailed) {
    throw new Error("OpenRecall: database initialization previously failed")
  }

  try {
    const dbPath = getConfig().dbPath
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    db = new Database(dbPath)

    db.run("PRAGMA journal_mode = WAL")
    db.run("PRAGMA synchronous = NORMAL")
    db.run("PRAGMA busy_timeout = 5000")
    db.run("PRAGMA foreign_keys = ON")

    runMigrations(db)

    return db
  } catch (e) {
    initFailed = true
    db = null
    console.error("[OpenRecall] Database initialization failed:", e)
    throw e
  }
}

function runMigrations(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  const applied = new Set(
    (
      db.prepare("SELECT version FROM _migrations").all() as {
        version: number
      }[]
    ).map((r) => r.version),
  )

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue

    db.run("BEGIN")
    try {
      migration.up(db)
      db.run(
        "INSERT INTO _migrations (version, description) VALUES (?, ?)",
        [migration.version, migration.description],
      )
      db.run("COMMIT")
    } catch (e) {
      db.run("ROLLBACK")
      throw new Error(
        `Migration ${migration.version} (${migration.description}) failed: ${e}`,
      )
    }
  }
}

export function closeDb() {
  if (db) {
    try {
      db.run("PRAGMA optimize")
    } catch {
      // ignore optimization errors on close
    }
    db.close()
    db = null
  }
}
