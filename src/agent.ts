import { storeMemory, searchByTag, getTagsForMemory, deleteMemory, updateMemory, setTags } from "./memory"
import { isDbAvailable } from "./db"
import * as fs from "fs"
import * as path from "path"

// Key project files to scan on startup
const KEY_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "LICENSE",
  "package.json",
  "tsconfig.json",
  "opencode.json",
  ".claude/CLAUDE.md",
  "CLAUDE.md",
  ".cursorrules",
  ".github/CODEOWNERS",
]

// Max content length per memory chunk
const MAX_CHUNK = 400

// Track which files have been scanned this process lifetime
const scannedFiles = new Set<string>()

/**
 * Get a file's current git commit hash and mtime for freshness tracking.
 */
export function getFileFingerprint(filePath: string, directory?: string): { gitHash?: string; mtime: number } {
  let mtime = 0
  try { mtime = fs.statSync(filePath).mtimeMs } catch {}

  let gitHash: string | undefined
  try {
    const { execSync } = require("child_process")
    gitHash = execSync(`git log -1 --format=%H -- "${filePath}"`, {
      cwd: directory || path.dirname(filePath),
      encoding: "utf-8",
      timeout: 3000,
    }).trim()
    if (!gitHash) gitHash = undefined
  } catch {}

  return { gitHash, mtime }
}

/**
 * Build fingerprint tags for a file path.
 */
function buildFingerprintTags(filePath: string, directory?: string): string[] {
  const absPath = path.resolve(directory || "", filePath)
  const fp = getFileFingerprint(absPath, directory)
  const tags: string[] = [`filepath:${absPath}`]
  tags.push(`git:${fp.gitHash || ""}`)
  tags.push(`mtime:${fp.mtime}`)
  return tags
}

/**
 * Remove all existing memories tagged with a specific filepath.
 */
function purgeFileMemories(absPath: string, projectId: string): number {
  const tag = `filepath:${absPath}`.toLowerCase()
  const existing = searchByTag(tag, { projectId, limit: 50 })
  for (const m of existing) {
    deleteMemory(m.id)
  }
  return existing.length
}

/**
 * Check if a file already has a fresh memory. Returns true if fresh (skip store).
 * If stale, purges old memories so caller can store fresh ones.
 */
function isFileFreshInMemory(absPath: string, projectId: string, directory?: string): boolean {
  const tag = `filepath:${absPath}`.toLowerCase()
  const existing = searchByTag(tag, { projectId, limit: 1 })
  if (existing.length === 0) return false

  const memory = existing[0]!
  const memoryTags = getTagsForMemory(memory.id)

  let storedGitHash: string | undefined
  let storedMtime: number | undefined
  for (const t of memoryTags) {
    if (t.startsWith("git:")) storedGitHash = t.slice(4)
    if (t.startsWith("mtime:")) storedMtime = parseFloat(t.slice(6))
  }

  const current = getFileFingerprint(absPath, directory)

  // Compare git hash first
  if (current.gitHash && storedGitHash && current.gitHash === storedGitHash) {
    return true // fresh
  }

  // Fall back to mtime
  if (!current.gitHash && storedMtime !== undefined && current.mtime > 0) {
    if (Math.abs(current.mtime - storedMtime) < 1000) return true // fresh
  }

  // Stale — purge old memories for this file
  purgeFileMemories(absPath, projectId)
  return false
}

/**
 * Upsert a single file memory: update existing or create new.
 * For read-tool tracking where we want exactly one memory per file.
 */
function upsertFileMemory(
  content: string,
  projectId: string,
  filePath: string,
  tags: string[],
  source: string,
  sessionId?: string,
): void {
  const absPath = path.resolve(filePath)
  const tag = `filepath:${absPath}`.toLowerCase()
  const existing = searchByTag(tag, { projectId, limit: 1 })

  if (existing.length > 0) {
    const memory = existing[0]!
    updateMemory(memory.id, { content, source })
    // Refresh fingerprint tags
    const fpTags = buildFingerprintTags(filePath)
    const nonFpTags = getTagsForMemory(memory.id).filter(
      (t) => !t.startsWith("git:") && !t.startsWith("mtime:"),
    )
    setTags(memory.id, [...nonFpTags, ...fpTags])
  } else {
    storeMemory({
      content,
      category: "discovery",
      projectId,
      sessionId,
      source,
      tags,
      force: true,
    })
  }
}

/**
 * Check if a stored file memory is still fresh by comparing fingerprints.
 * Returns { fresh, memory, storedContent } or null if no memory found.
 */
export function checkFileFreshness(filePath: string, projectId: string, directory?: string): {
  fresh: boolean
  memory: any
  storedContent: string
} | null {
  if (!isDbAvailable()) return null

  const absPath = path.resolve(directory || "", filePath)
  const tag = `filepath:${absPath}`

  const memories = searchByTag(tag, { projectId, limit: 1 })
  if (memories.length === 0) return null

  const memory = memories[0]!
  const memoryTags = getTagsForMemory(memory.id)

  // Extract stored git hash and mtime from tags
  let storedGitHash: string | undefined
  let storedMtime: number | undefined
  for (const t of memoryTags) {
    if (t.startsWith("git:")) storedGitHash = t.slice(4)
    if (t.startsWith("mtime:")) storedMtime = parseFloat(t.slice(6))
  }

  const current = getFileFingerprint(absPath, directory)

  // Compare git hash first (most reliable)
  if (current.gitHash && storedGitHash) {
    return {
      fresh: current.gitHash === storedGitHash,
      memory,
      storedContent: memory.content,
    }
  }

  // Fall back to mtime comparison
  if (storedMtime !== undefined && current.mtime > 0) {
    return {
      fresh: Math.abs(current.mtime - storedMtime) < 1000, // 1s tolerance
      memory,
      storedContent: memory.content,
    }
  }

  // Can't determine freshness — treat as stale
  return { fresh: false, memory, storedContent: memory.content }
}

interface ExtractionCounter {
  count: number
  extracting: boolean
}

const sessionCounters = new Map<string, ExtractionCounter>()

export function getCounter(sessionID: string): ExtractionCounter {
  let counter = sessionCounters.get(sessionID)
  if (!counter) {
    counter = { count: 0, extracting: false }
    sessionCounters.set(sessionID, counter)
  }
  return counter
}

export function incrementCounter(sessionID: string): number {
  const counter = getCounter(sessionID)
  counter.count++
  return counter.count
}

export function shouldTrigger(sessionID: string, interval: number): boolean {
  const counter = getCounter(sessionID)
  return counter.count > 0 && counter.count % interval === 0 && !counter.extracting
}

export function clearCounter(sessionID: string): void {
  sessionCounters.delete(sessionID)
}

/**
 * Scan key project files on startup and store their content as memories.
 * Only stores files that haven't been scanned yet or have been modified since last scan.
 */
export function scanProjectFiles(directory: string, projectId: string): void {
  if (!isDbAvailable()) return

  let stored = 0

  for (const relPath of KEY_FILES) {
    try {
      const fullPath = path.join(directory, relPath)
      if (!fs.existsSync(fullPath)) continue

      const stat = fs.statSync(fullPath)
      if (!stat.isFile()) continue
      // Skip large files (> 50KB)
      if (stat.size > 50 * 1024) continue

      // Skip if already scanned this process lifetime
      const cacheKey = `${fullPath}:${stat.mtimeMs}`
      if (scannedFiles.has(cacheKey)) continue
      scannedFiles.add(cacheKey)

      // Skip if memory already has fresh content for this file
      if (isFileFreshInMemory(fullPath, projectId, directory)) continue

      const content = fs.readFileSync(fullPath, "utf-8")
      if (!content.trim()) continue

      // For package.json, extract key info
      if (relPath === "package.json") {
        storePackageJsonMemory(content, projectId, fullPath, directory)
        stored++
        continue
      }

      // Store file content in chunks
      stored += storeFileChunks(content, projectId, fullPath, directory)
    } catch (e) {
      // Silent fail per file — don't break startup
    }
  }

  // Also scan for recently modified files via git
  try {
    stored += scanRecentGitFiles(directory, projectId)
  } catch {
    // Git might not be available
  }

  if (stored > 0) {
    console.error(`[OpenRecall] Startup scan: stored ${stored} file memories`)
  }
}

function storePackageJsonMemory(content: string, projectId: string, filePath: string, directory?: string): void {
  try {
    const pkg = JSON.parse(content)
    const parts: string[] = []

    if (pkg.name) parts.push(`name: ${pkg.name}`)
    if (pkg.description) parts.push(`description: ${pkg.description}`)
    if (pkg.scripts) {
      const scripts = Object.keys(pkg.scripts).join(", ")
      parts.push(`scripts: ${scripts}`)
    }
    if (pkg.dependencies) {
      const deps = Object.keys(pkg.dependencies).slice(0, 15).join(", ")
      parts.push(`dependencies: ${deps}`)
    }
    if (pkg.devDependencies) {
      const devDeps = Object.keys(pkg.devDependencies).slice(0, 10).join(", ")
      parts.push(`devDependencies: ${devDeps}`)
    }
    if (pkg.type) parts.push(`type: ${pkg.type}`)
    if (pkg.main || pkg.module) parts.push(`entry: ${pkg.main || pkg.module}`)

    const summary = parts.join(" | ")
    if (summary.length > 10) {
      const fpTags = buildFingerprintTags(filePath, directory)
      storeMemory({
        content: summary.slice(0, MAX_CHUNK),
        category: "discovery",
        projectId,
        source: `file-scan: ${filePath}`,
        tags: ["project-config", "package.json", ...fpTags],
      })
    }
  } catch {
    // Invalid JSON, skip
  }
}

function storeFileChunks(content: string, projectId: string, filePath: string, directory?: string): number {
  // Split by sections (headers in markdown, or double newlines)
  const sections = content.split(/\n#{1,3}\s+|\n\n/).filter((s) => s.trim().length > 20)
  let stored = 0

  const fpTags = buildFingerprintTags(filePath, directory)

  // Store up to 5 chunks per file to avoid flooding
  const maxChunks = 5
  for (let i = 0; i < Math.min(sections.length, maxChunks); i++) {
    const chunk = sections[i]!.trim()
    if (chunk.length < 20) continue

    const truncated = chunk.length > MAX_CHUNK ? chunk.slice(0, MAX_CHUNK) + "..." : chunk

    try {
      storeMemory({
        content: truncated,
        category: "discovery",
        projectId,
        source: `file-scan: ${filePath} (section ${i + 1})`,
        tags: ["file-content", path.basename(filePath).toLowerCase(), ...fpTags],
      })
      stored++
    } catch {
      // Dedup or other error, skip
    }
  }

  return stored
}

function scanRecentGitFiles(directory: string, projectId: string): number {
  // Use git to find recently modified tracked files (last 7 days)
  const { execSync } = require("child_process")
  let stored = 0

  try {
    const result = execSync("git log --diff-filter=M --name-only --pretty=format: --since=7.days.ago HEAD", {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
    })

    const files = [...new Set(
      result.split("\n").filter((f: string) => f.trim().length > 0),
    )].slice(0, 20)

    if (files.length > 0) {
      const summary = `Recently modified files (last 7 days): ${files.join(", ")}`
      storeMemory({
        content: summary.slice(0, MAX_CHUNK),
        category: "discovery",
        projectId,
        source: "file-scan: git-recent",
        tags: ["git", "recent-changes"],
      })
      stored++
    }
  } catch {
    // Git not available or failed
  }

  return stored
}

/**
 * Extract file knowledge from tool execution.
 * Called from tool.execute.after to track what files the LLM reads/edits.
 */
export function extractFileKnowledge(
  toolName: string,
  args: any,
  output: string,
  sessionId: string,
  projectId: string,
): void {
  if (!isDbAvailable()) return

  // Only track file-related tools
  const fileTools = new Set(["read", "edit", "write", "glob", "grep"])
  if (!fileTools.has(toolName)) return

  try {
    const filePath = args?.filePath || args?.file_path || args?.path
    if (!filePath || typeof filePath !== "string") return

    if (toolName === "read") {
      // Store file content summary from read output
      if (!output || output.length < 30) return

      // Take the first ~400 chars as a content preview
      const preview = output.slice(0, MAX_CHUNK)
      const basename = path.basename(filePath)
      const fpTags = buildFingerprintTags(filePath)

      upsertFileMemory(
        `File ${basename}: ${preview}`,
        projectId,
        filePath,
        ["file-content", basename.toLowerCase(), ...fpTags],
        `tool-read: ${filePath}`,
        sessionId,
      )
    } else if (toolName === "edit" || toolName === "write") {
      // Store what was edited/written
      const basename = path.basename(filePath)
      const editInfo = args?.old_string
        ? `Edited ${basename}: replaced content in ${filePath}`
        : `Wrote to ${basename}: ${filePath}`

      storeMemory({
        content: editInfo.slice(0, MAX_CHUNK),
        category: "discovery",
        projectId,
        sessionId,
        source: `tool-${toolName}: ${filePath}`,
        tags: ["file-edit", basename.toLowerCase()],
      })
    }
  } catch {
    // Silent fail
  }
}
