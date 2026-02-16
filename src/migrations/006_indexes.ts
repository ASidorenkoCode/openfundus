import type { Database } from "bun:sqlite"

export const version = 6
export const description = "Add missing indexes for common query patterns"

export function up(db: Database) {
  db.run("CREATE INDEX IF NOT EXISTS idx_memory_time_created ON memory (time_created)")
  db.run("CREATE INDEX IF NOT EXISTS idx_memory_access_count ON memory (access_count)")
  db.run("CREATE INDEX IF NOT EXISTS idx_memory_project_category ON memory (project_id, category)")
}

export function down(db: Database) {
  db.run("DROP INDEX IF EXISTS idx_memory_time_created")
  db.run("DROP INDEX IF EXISTS idx_memory_access_count")
  db.run("DROP INDEX IF EXISTS idx_memory_project_category")
}
