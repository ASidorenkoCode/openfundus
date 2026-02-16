import type { Database } from "bun:sqlite"

export const version = 3
export const description = "Add access tracking columns for relevance decay"

export function up(db: Database) {
  db.run(`ALTER TABLE memory ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0`)
  db.run(`ALTER TABLE memory ADD COLUMN time_last_accessed INTEGER`)
}

export function down(db: Database) {
  // SQLite doesn't support DROP COLUMN before 3.35.0, but Bun ships recent SQLite
  db.run(`ALTER TABLE memory DROP COLUMN access_count`)
  db.run(`ALTER TABLE memory DROP COLUMN time_last_accessed`)
}
