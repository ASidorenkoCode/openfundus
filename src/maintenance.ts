import { getDb, isDbAvailable } from "./db"
import { getConfig } from "./config"
import { statSync } from "fs"

const CLEANUP_INTERVAL_DAYS = 7

export function getMetadata(key: string): string | null {
  const db = getDb()
  const row = db.prepare("SELECT value FROM metadata WHERE key = ?").get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setMetadata(key: string, value: string): void {
  const db = getDb()
  db.prepare(
    "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
  ).run(key, value)
}

export function optimizeFts(): void {
  const db = getDb()
  db.prepare("INSERT INTO memory_fts(memory_fts) VALUES('optimize')").run()
}

export function vacuumDb(): void {
  const db = getDb()
  db.exec("VACUUM")
}

export function getDbSize(): number {
  const config = getConfig()
  try {
    return statSync(config.dbPath).size
  } catch {
    return 0
  }
}

export function purgeOldMemories(olderThanDays: number): number {
  const db = getDb()
  const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400
  const result = db
    .prepare(
      "DELETE FROM memory WHERE time_created < ? AND access_count = 0 AND time_last_accessed IS NULL",
    )
    .run(cutoff)
  return result.changes
}

export function enforceMaxMemories(): number {
  const config = getConfig()
  if (config.maxMemories <= 0) return 0

  const db = getDb()
  const count = (
    db.prepare("SELECT COUNT(*) as count FROM memory").get() as { count: number }
  ).count

  if (count <= config.maxMemories) return 0

  const excess = count - config.maxMemories
  // Delete oldest, least-accessed memories first
  const result = db
    .prepare(
      `DELETE FROM memory WHERE id IN (
        SELECT id FROM memory
        ORDER BY access_count ASC, time_created ASC
        LIMIT ?
      )`,
    )
    .run(excess)
  return result.changes
}

export function runMaintenance(): {
  ftsOptimized: boolean
  memoriesPurged: number
  memoriesTrimmed: number
  dbSizeBytes: number
} {
  const result = {
    ftsOptimized: false,
    memoriesPurged: 0,
    memoriesTrimmed: 0,
    dbSizeBytes: 0,
  }

  try {
    optimizeFts()
    result.ftsOptimized = true
  } catch (e) {
    console.error("[OpenRecall] FTS optimization failed:", e)
  }

  try {
    result.memoriesTrimmed = enforceMaxMemories()
  } catch (e) {
    console.error("[OpenRecall] Max memories enforcement failed:", e)
  }

  result.dbSizeBytes = getDbSize()

  setMetadata("last_maintenance", String(Math.floor(Date.now() / 1000)))

  return result
}

export function shouldRunMaintenance(): boolean {
  if (!isDbAvailable()) return false

  try {
    const last = getMetadata("last_maintenance")
    if (!last) return true

    const lastTs = parseInt(last, 10)
    const now = Math.floor(Date.now() / 1000)
    const daysSinceLast = (now - lastTs) / 86400
    return daysSinceLast >= CLEANUP_INTERVAL_DAYS
  } catch {
    return false
  }
}

export function maybeRunMaintenance(): void {
  if (shouldRunMaintenance()) {
    try {
      runMaintenance()
    } catch (e) {
      console.error("[OpenRecall] Auto-maintenance failed:", e)
    }
  }
}
