import { getDb } from "./db"

export interface Memory {
  id: string
  content: string
  category: string
  session_id: string | null
  project_id: string | null
  source: string | null
  time_created: number
  time_updated: number
  access_count: number
  time_last_accessed: number | null
}

export interface StoreInput {
  content: string
  category?: string
  sessionId?: string
  projectId?: string
  source?: string
  tags?: string[]
  global?: boolean
  force?: boolean
}

export interface SearchInput {
  query: string
  category?: string
  projectId?: string
  limit?: number
  decayRate?: number
}

export interface SearchResult {
  memory: Memory
  rank: number
}

function generateId(): string {
  return crypto.randomUUID()
}

// FTS5 special characters that need escaping (includes - prefix NOT, ` backtick, . period)
const FTS5_SPECIAL = /["*(){}[\]:^~!&|@#$%+=\\<>,;?/\-`.'']/g

// Common English stop words to strip for better matching
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "about", "it",
  "its", "this", "that", "these", "those", "i", "we", "you", "he",
  "she", "they", "me", "him", "her", "us", "them", "my", "your",
  "his", "our", "their", "what", "which", "who", "whom", "how",
  "when", "where", "why", "not", "no", "nor", "so", "if", "or",
  "and", "but", "than", "too", "very", "just",
])

// FTS5 boolean operators that must not appear as tokens in queries
const FTS5_OPERATORS = new Set(["and", "or", "not", "near"])

export function sanitizeQuery(raw: string): string {
  // Remove FTS5 special characters
  let query = raw.replace(FTS5_SPECIAL, " ")

  // Tokenize and filter
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t) && !FTS5_OPERATORS.has(t))

  if (tokens.length === 0) {
    // Fallback: use original words without special chars, still filtering operators
    const fallback = raw
      .replace(FTS5_SPECIAL, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !FTS5_OPERATORS.has(t.toLowerCase()))
      .join(" ")
      .trim()
    return fallback || raw.replace(/[^\w\s]/g, " ").trim()
  }

  // Join with implicit AND (FTS5 default)
  return tokens.join(" ")
}

/** Normalize text for deduplication comparison */
function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ")
}

/** Check for duplicate/near-duplicate memories */
export function findDuplicate(
  content: string,
  projectId: string | null,
): { type: "exact" | "near"; memory: Memory } | null {
  const db = getDb()
  const normalized = normalizeText(content)

  // Check exact match (normalized)
  let query = "SELECT * FROM memory WHERE 1=1"
  const params: any[] = []

  if (projectId) {
    query += " AND (project_id = ? OR project_id IS NULL)"
    params.push(projectId)
  }

  const candidates = db.prepare(query + " ORDER BY time_created DESC LIMIT 100").all(...params) as Memory[]

  for (const m of candidates) {
    if (normalizeText(m.content) === normalized) {
      return { type: "exact", memory: m }
    }
  }

  // Check near-duplicate via FTS5 search
  try {
    const sanitized = sanitizeQuery(content)
    // Filter tokens again to ensure no FTS5 operators remain after sanitization
    const tokens = sanitized.trim().split(/\s+/).filter(
      (t) => t.length > 0 && !FTS5_OPERATORS.has(t.toLowerCase()),
    )
    if (tokens.length > 0) {
      // Use OR on the longest/most distinctive tokens to find candidates broadly,
      // then filter with Jaccard similarity to confirm near-duplicates.
      // This avoids the original issue of matching on any single common word
      // by limiting to the top distinctive tokens only.
      const sorted = [...tokens].sort((a, b) => b.length - a.length)
      const queryTokens = sorted.slice(0, Math.max(3, Math.ceil(tokens.length * 0.6)))
      const orQuery = queryTokens.join(" OR ")
      let ftsQuery = `
        SELECT m.*, fts.rank
        FROM memory_fts fts
        JOIN memory m ON m.id = fts.memory_id
        WHERE memory_fts MATCH ?
      `
      const ftsParams: any[] = [orQuery]

      if (projectId) {
        ftsQuery += " AND (m.project_id = ? OR m.project_id IS NULL)"
        ftsParams.push(projectId)
      }

      ftsQuery += " ORDER BY rank LIMIT 5"

      const results = db.prepare(ftsQuery).all(...ftsParams) as (Memory & { rank: number })[]

      for (const r of results) {
        // BM25 rank is negative; very high similarity = very negative rank
        // Heuristic: if normalized content is very similar in length and keywords overlap heavily
        const rNorm = normalizeText(r.content)
        const similarity = computeSimilarity(normalized, rNorm)
        if (similarity > 0.6) {
          return { type: "near", memory: r }
        }
      }
    }
  } catch (e) {
    // FTS5 query can still fail on unexpected input; log and fall through to allow store
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[OpenRecall] FTS5 dedup query failed:", msg)
  }

  return null
}

/** Simple word-overlap similarity (Jaccard index) */
function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(" ").filter((w) => w.length > 1))
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 1))
  if (wordsA.size === 0 && wordsB.size === 0) return 1
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }
  const union = new Set([...wordsA, ...wordsB]).size
  return intersection / union
}

const MAX_MEMORY_CONTENT_LENGTH = 10_000

export function storeMemory(input: StoreInput): Memory {
  const db = getDb()
  const id = generateId()
  const now = Math.floor(Date.now() / 1000)

  if (!input.content || input.content.trim().length === 0) {
    throw new Error("Memory content cannot be empty")
  }
  if (input.content.length > MAX_MEMORY_CONTENT_LENGTH) {
    throw new Error(`Memory content exceeds maximum length of ${MAX_MEMORY_CONTENT_LENGTH} characters`)
  }

  // Global memories have no project_id
  const projectId = input.global ? null : (input.projectId || null)

  // Deduplication check (skip if force=true)
  if (!input.force) {
    const dup = findDuplicate(input.content, projectId)
    if (dup?.type === "exact") {
      // Return existing memory instead of creating duplicate
      return dup.memory
    }
    // For near-duplicates, update existing memory with newer content
    if (dup?.type === "near") {
      const updated = updateMemory(dup.memory.id, {
        content: input.content,
        category: input.category || dup.memory.category,
        source: input.source || dup.memory.source || undefined,
      })
      return updated || dup.memory
    }
  }

  db.prepare(
    `INSERT INTO memory (id, content, category, session_id, project_id, source, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.content,
    input.category || "general",
    input.sessionId || null,
    projectId,
    input.source || null,
    now,
    now,
  )

  if (input.tags && input.tags.length > 0) {
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)",
    )
    for (const tag of input.tags) {
      stmt.run(id, tag.toLowerCase().trim())
    }
  }

  return {
    id,
    content: input.content,
    category: input.category || "general",
    session_id: input.sessionId || null,
    project_id: projectId,
    source: input.source || null,
    time_created: now,
    time_updated: now,
    access_count: 0,
    time_last_accessed: null,
  }
}

/** Default decay rate: half-life of ~90 days */
const DEFAULT_DECAY_RATE = 0.0077

export function searchMemories(input: SearchInput): SearchResult[] {
  const db = getDb()
  const limit = input.limit || 10

  const sanitized = sanitizeQuery(input.query)
  if (!sanitized.trim()) return []

  // Fetch more than needed so we can re-rank with decay
  const fetchLimit = Math.min(limit * 3, 100)

  // Use FTS5 for full-text search with BM25 ranking
  let query = `
    SELECT m.*, fts.rank
    FROM memory_fts fts
    JOIN memory m ON m.id = fts.memory_id
    WHERE memory_fts MATCH ?
  `
  const params: any[] = [sanitized]

  if (input.category) {
    query += ` AND m.category = ?`
    params.push(input.category)
  }

  if (input.projectId) {
    // Include project-specific AND global (project_id IS NULL) memories
    query += ` AND (m.project_id = ? OR m.project_id IS NULL)`
    params.push(input.projectId)
  }

  query += ` ORDER BY rank LIMIT ?`
  params.push(fetchLimit)

  let rows: (Memory & { rank: number })[]
  try {
    rows = db.prepare(query).all(...params) as (Memory & { rank: number })[]
  } catch (e) {
    // FTS5 query can fail on unexpected input; log and return empty
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[OpenRecall] FTS5 search query failed:", msg, "| sanitized query:", sanitized)
    return []
  }

  const now = Math.floor(Date.now() / 1000)
  const decayRate = input.decayRate ?? DEFAULT_DECAY_RATE

  // Apply time decay and access boost, then re-rank
  const scored = rows.map((row) => {
    const ageDays = (now - row.time_created) / 86400
    const decayFactor = 1 / (1 + ageDays * decayRate)

    // Boost for recently/frequently accessed memories
    const accessBoost = 1 + Math.log2(1 + (row.access_count || 0)) * 0.1

    // BM25 rank is negative (lower = better match).
    // Divide by decayFactor so older memories get less negative (worse rank).
    // Divide by accessBoost so frequently accessed memories get more negative (better rank).
    const finalRank = row.rank / (decayFactor * accessBoost)

    return { row, finalRank }
  })

  // Sort by finalRank (most negative = best match)
  scored.sort((a, b) => a.finalRank - b.finalRank)
  const top = scored.slice(0, limit)

  // Update access tracking for returned results
  if (top.length > 0) {
    const stmt = db.prepare(
      "UPDATE memory SET access_count = access_count + 1, time_last_accessed = ? WHERE id = ?",
    )
    for (const { row } of top) {
      stmt.run(now, row.id)
    }
  }

  return top.map(({ row, finalRank }) => ({
    memory: {
      id: row.id,
      content: row.content,
      category: row.category,
      session_id: row.session_id,
      project_id: row.project_id,
      source: row.source,
      time_created: row.time_created,
      time_updated: row.time_updated,
      access_count: (row.access_count || 0) + 1,
      time_last_accessed: now,
    },
    rank: finalRank,
  }))
}

export interface UpdateInput {
  content?: string
  category?: string
  source?: string
}

export function updateMemory(id: string, input: UpdateInput): Memory | null {
  const db = getDb()
  const existing = getMemory(id)
  if (!existing) return null

  const fields: string[] = []
  const params: any[] = []

  if (input.content !== undefined) {
    fields.push("content = ?")
    params.push(input.content)
  }
  if (input.category !== undefined) {
    fields.push("category = ?")
    params.push(input.category)
  }
  if (input.source !== undefined) {
    fields.push("source = ?")
    params.push(input.source)
  }

  if (fields.length === 0) return existing

  fields.push("time_updated = ?")
  const now = Math.floor(Date.now() / 1000)
  params.push(now)
  params.push(id)

  db.prepare(`UPDATE memory SET ${fields.join(", ")} WHERE id = ?`).run(
    ...params,
  )

  return getMemory(id)
}

export function getMemory(id: string): Memory | null {
  const db = getDb()
  return (db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as Memory) || null
}

export function deleteMemory(id: string): boolean {
  const db = getDb()
  const result = db.prepare("DELETE FROM memory WHERE id = ?").run(id)
  return result.changes > 0
}

export function listMemories(opts?: {
  category?: string
  projectId?: string
  sessionId?: string
  scope?: "project" | "global" | "all"
  limit?: number
}): Memory[] {
  const db = getDb()
  let query = "SELECT * FROM memory WHERE 1=1"
  const params: any[] = []

  if (opts?.category) {
    query += " AND category = ?"
    params.push(opts.category)
  }

  const scope = opts?.scope || "all"
  if (opts?.projectId && scope === "project") {
    query += " AND project_id = ?"
    params.push(opts.projectId)
  } else if (scope === "global") {
    query += " AND project_id IS NULL"
  } else if (opts?.projectId && scope === "all") {
    query += " AND (project_id = ? OR project_id IS NULL)"
    params.push(opts.projectId)
  }

  if (opts?.sessionId) {
    query += " AND session_id = ?"
    params.push(opts.sessionId)
  }

  query += " ORDER BY time_created DESC LIMIT ?"
  params.push(opts?.limit || 20)

  return db.prepare(query).all(...params) as Memory[]
}

export function getStats(): {
  total: number
  byCategory: Record<string, number>
} {
  const db = getDb()
  const total = (
    db.prepare("SELECT COUNT(*) as count FROM memory").get() as {
      count: number
    }
  ).count

  const categories = db
    .prepare(
      "SELECT category, COUNT(*) as count FROM memory GROUP BY category",
    )
    .all() as { category: string; count: number }[]

  const byCategory: Record<string, number> = {}
  for (const row of categories) {
    byCategory[row.category] = row.count
  }

  return { total, byCategory }
}

export function refreshMemory(id: string): Memory | null {
  const db = getDb()
  const existing = getMemory(id)
  if (!existing) return null

  const now = Math.floor(Date.now() / 1000)
  db.prepare(
    "UPDATE memory SET access_count = access_count + 5, time_last_accessed = ? WHERE id = ?",
  ).run(now, id)

  return getMemory(id)
}

// --- Tag operations ---

export function getTagsForMemory(memoryId: string): string[] {
  const db = getDb()
  const rows = db
    .prepare("SELECT tag FROM memory_tags WHERE memory_id = ?")
    .all(memoryId) as { tag: string }[]
  return rows.map((r) => r.tag)
}

export function setTags(memoryId: string, tags: string[]): void {
  const db = getDb()
  db.prepare("DELETE FROM memory_tags WHERE memory_id = ?").run(memoryId)
  if (tags.length > 0) {
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)",
    )
    for (const tag of tags) {
      stmt.run(memoryId, tag.toLowerCase().trim())
    }
  }
}

export function addTags(memoryId: string, tags: string[]): void {
  const db = getDb()
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)",
  )
  for (const tag of tags) {
    stmt.run(memoryId, tag.toLowerCase().trim())
  }
}

export function removeTags(memoryId: string, tags: string[]): void {
  const db = getDb()
  const stmt = db.prepare(
    "DELETE FROM memory_tags WHERE memory_id = ? AND tag = ?",
  )
  for (const tag of tags) {
    stmt.run(memoryId, tag.toLowerCase().trim())
  }
}

export function listAllTags(): { tag: string; count: number }[] {
  const db = getDb()
  return db
    .prepare(
      "SELECT tag, COUNT(*) as count FROM memory_tags GROUP BY tag ORDER BY count DESC",
    )
    .all() as { tag: string; count: number }[]
}

export function searchByTag(
  tag: string,
  opts?: { projectId?: string; limit?: number },
): Memory[] {
  const db = getDb()
  let query = `
    SELECT m.* FROM memory m
    JOIN memory_tags t ON t.memory_id = m.id
    WHERE t.tag = ?
  `
  const params: any[] = [tag.toLowerCase().trim()]

  if (opts?.projectId) {
    query += " AND m.project_id = ?"
    params.push(opts.projectId)
  }

  query += " ORDER BY m.time_created DESC LIMIT ?"
  params.push(opts?.limit || 20)

  return db.prepare(query).all(...params) as Memory[]
}

// --- Link operations ---

export type LinkRelationship = "related" | "supersedes" | "contradicts" | "extends"

export interface MemoryLink {
  source_id: string
  target_id: string
  relationship: LinkRelationship
}

export function addLink(
  sourceId: string,
  targetId: string,
  relationship: LinkRelationship,
): boolean {
  const db = getDb()
  // Verify both memories exist
  if (!getMemory(sourceId) || !getMemory(targetId)) return false
  if (sourceId === targetId) return false

  db.prepare(
    "INSERT OR REPLACE INTO memory_links (source_id, target_id, relationship) VALUES (?, ?, ?)",
  ).run(sourceId, targetId, relationship)
  return true
}

export function removeLink(sourceId: string, targetId: string): boolean {
  const db = getDb()
  const result = db
    .prepare("DELETE FROM memory_links WHERE source_id = ? AND target_id = ?")
    .run(sourceId, targetId)
  return result.changes > 0
}

export function getLinksForMemory(memoryId: string): (MemoryLink & { linked_memory: Memory })[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT l.source_id, l.target_id, l.relationship,
              m.id, m.content, m.category, m.session_id, m.project_id,
              m.source, m.time_created, m.time_updated, m.access_count, m.time_last_accessed
       FROM memory_links l
       JOIN memory m ON (
         CASE WHEN l.source_id = ? THEN l.target_id ELSE l.source_id END = m.id
       )
       WHERE l.source_id = ? OR l.target_id = ?`,
    )
    .all(memoryId, memoryId, memoryId) as any[]

  return rows.map((row) => ({
    source_id: row.source_id,
    target_id: row.target_id,
    relationship: row.relationship,
    linked_memory: {
      id: row.id,
      content: row.content,
      category: row.category,
      session_id: row.session_id,
      project_id: row.project_id,
      source: row.source,
      time_created: row.time_created,
      time_updated: row.time_updated,
      access_count: row.access_count,
      time_last_accessed: row.time_last_accessed,
    },
  }))
}
