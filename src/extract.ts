import { storeMemory, findDuplicate } from "./memory"
import { isDbAvailable } from "./db"
import { getConfig } from "./config"

// Rate limit: max extractions per session
const sessionExtractionCount = new Map<string, number>()
const MAX_EXTRACTIONS_PER_SESSION = 20

// Preference patterns
const PREFERENCE_PATTERNS = [
  /\b(?:always|never|prefer|don'?t|avoid)\b.*\b(?:use|do|make|write|create|run|call)\b/i,
  /\b(?:i (?:always|never|prefer to|like to|want to))\b/i,
  /\buser (?:prefers?|wants?|likes?)\b/i,
]

// Bug fix patterns — tool output indicating a fix was applied
const BUG_FIX_PATTERNS = [
  /\bfixed?\b.*\b(?:by|with|using|adding|removing|changing)\b/i,
  /\b(?:the )?(?:issue|bug|error|problem) was\b/i,
  /\bresolved?\b.*\b(?:by|with)\b/i,
  /\bworkaround\b/i,
]

// Convention patterns
const CONVENTION_PATTERNS = [
  /\b(?:convention|standard|rule|guideline)\b.*\b(?:is|are|should|must)\b/i,
  /\bproject (?:uses?|follows?|requires?)\b/i,
]

interface ExtractionCandidate {
  content: string
  category: string
  source: string
}

/** Extract potential memories from tool execution output */
export function extractFromToolOutput(
  toolName: string,
  args: any,
  output: string,
  sessionId: string,
  projectId: string,
): void {
  const config = getConfig()
  if (!config.autoExtract) return
  if (!isDbAvailable()) return

  // Don't extract from our own memory tools
  if (toolName.startsWith("memory_")) return

  // Rate limit
  const count = sessionExtractionCount.get(sessionId) || 0
  if (count >= MAX_EXTRACTIONS_PER_SESSION) return

  const candidates: ExtractionCandidate[] = []

  // Check tool output for extractable patterns
  const outputStr = typeof output === "string" ? output : String(output)

  // Detect preferences from tool output or args
  for (const pattern of PREFERENCE_PATTERNS) {
    if (pattern.test(outputStr)) {
      // Extract the matching sentence
      const sentences = outputStr.split(/[.!?\n]/).filter((s) => s.trim().length > 10)
      for (const sentence of sentences) {
        if (pattern.test(sentence)) {
          candidates.push({
            content: sentence.trim(),
            category: "preference",
            source: `auto-extracted from ${toolName}`,
          })
          break
        }
      }
    }
  }

  // Detect bug fixes
  for (const pattern of BUG_FIX_PATTERNS) {
    if (pattern.test(outputStr)) {
      const sentences = outputStr.split(/[.!?\n]/).filter((s) => s.trim().length > 15)
      for (const sentence of sentences) {
        if (pattern.test(sentence)) {
          candidates.push({
            content: sentence.trim(),
            category: "debugging",
            source: `auto-extracted from ${toolName}`,
          })
          break
        }
      }
    }
  }

  // Detect conventions
  for (const pattern of CONVENTION_PATTERNS) {
    if (pattern.test(outputStr)) {
      const sentences = outputStr.split(/[.!?\n]/).filter((s) => s.trim().length > 10)
      for (const sentence of sentences) {
        if (pattern.test(sentence)) {
          candidates.push({
            content: sentence.trim(),
            category: "convention",
            source: `auto-extracted from ${toolName}`,
          })
          break
        }
      }
    }
  }

  // Store candidates (dedup will handle duplicates)
  for (const candidate of candidates) {
    if (count + candidates.indexOf(candidate) >= MAX_EXTRACTIONS_PER_SESSION) break

    try {
      // Skip if too short or too long
      if (candidate.content.length < 15 || candidate.content.length > 500) continue

      storeMemory({
        content: candidate.content,
        category: candidate.category,
        sessionId,
        projectId,
        source: candidate.source,
      })

      sessionExtractionCount.set(
        sessionId,
        (sessionExtractionCount.get(sessionId) || 0) + 1,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[OpenRecall] Auto-extraction store failed for "${candidate.content.slice(0, 50)}...":`, msg)
    }
  }
}

/** Clear extraction tracking for a session */
export function clearSessionExtraction(sessionId: string): void {
  sessionExtractionCount.delete(sessionId)
}
