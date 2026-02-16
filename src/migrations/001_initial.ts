import type { Database } from "bun:sqlite"

export const version = 1
export const description = "Initial schema: memory table, FTS5, triggers, indexes"

export function up(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      session_id TEXT,
      project_id TEXT,
      source TEXT,
      time_created INTEGER NOT NULL DEFAULT (unixepoch()),
      time_updated INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `)

  // Standalone FTS5 table — stores its own copy of indexed text
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      memory_id UNINDEXED,
      content,
      category,
      source,
      tokenize='porter unicode61'
    )
  `)

  // Triggers to keep FTS in sync with memory table
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
      INSERT INTO memory_fts(memory_id, content, category, source)
      VALUES (NEW.id, NEW.content, NEW.category, NEW.source);
    END
  `)

  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
      DELETE FROM memory_fts WHERE memory_id = OLD.id;
    END
  `)

  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
      DELETE FROM memory_fts WHERE memory_id = OLD.id;
      INSERT INTO memory_fts(memory_id, content, category, source)
      VALUES (NEW.id, NEW.content, NEW.category, NEW.source);
    END
  `)

  db.run(
    `CREATE INDEX IF NOT EXISTS idx_memory_session ON memory(session_id)`,
  )
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category)`,
  )
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project_id)`,
  )
}

export function down(db: Database) {
  db.run("DROP INDEX IF EXISTS idx_memory_project")
  db.run("DROP INDEX IF EXISTS idx_memory_category")
  db.run("DROP INDEX IF EXISTS idx_memory_session")
  db.run("DROP TRIGGER IF EXISTS memory_au")
  db.run("DROP TRIGGER IF EXISTS memory_ad")
  db.run("DROP TRIGGER IF EXISTS memory_ai")
  db.run("DROP TABLE IF EXISTS memory_fts")
  db.run("DROP TABLE IF EXISTS memory")
}
