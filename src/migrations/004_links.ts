import type { Database } from "bun:sqlite"

export const version = 4
export const description = "Add memory relationships/linking"

export function up(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_links (
      source_id TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL CHECK(relationship IN ('related','supersedes','contradicts','extends')),
      PRIMARY KEY (source_id, target_id)
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_links_relationship ON memory_links(relationship)`)
}

export function down(db: Database) {
  db.run("DROP INDEX IF EXISTS idx_links_relationship")
  db.run("DROP INDEX IF EXISTS idx_links_target")
  db.run("DROP TABLE IF EXISTS memory_links")
}
