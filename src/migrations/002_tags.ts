import type { Database } from "bun:sqlite"

export const version = 2
export const description = "Add memory tagging system"

export function up(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_tags (
      memory_id TEXT NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (memory_id, tag)
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_tags_tag ON memory_tags(tag)`)
}

export function down(db: Database) {
  db.run("DROP INDEX IF EXISTS idx_tags_tag")
  db.run("DROP TABLE IF EXISTS memory_tags")
}
