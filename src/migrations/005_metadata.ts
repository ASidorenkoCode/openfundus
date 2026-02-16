import type { Database } from "bun:sqlite"

export const version = 5
export const description = "Add metadata table for maintenance tracking"

export function up(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
}

export function down(db: Database) {
  db.run("DROP TABLE IF EXISTS metadata")
}
