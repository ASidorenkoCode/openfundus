import { storeMemory } from "./memory"

// Rate limit: max mistakes stored per session to avoid flooding
const MAX_MISTAKES_PER_SESSION = 10
const sessionMistakeCount = new Map<string, number>()

// Deduplicate within session: track error signatures already stored
const sessionErrorSignatures = new Map<string, Set<string>>()

// Tools that execute commands where errors are meaningful
const EXECUTABLE_TOOLS = new Set(["bash", "shell", "terminal", "command"])
const FILE_WRITE_TOOLS = new Set(["write", "edit", "patch"])

// Patterns that indicate meaningful failures (not just normal output)
const ERROR_PATTERNS = [
  // Test failures
  /(\d+)\s+(?:fail|failed|failing)\b/i,
  /FAIL\s+[\w./]+/,
  /(?:test|spec|describe|it)\s+.*(?:failed|error)/i,
  /AssertionError|expect\(.*\)\.to/i,
  // Build/compile errors
  /(?:error|Error)\s*(?:TS|ts)\d+/,
  /SyntaxError:|TypeError:|ReferenceError:|ModuleNotFoundError:/,
  /Cannot find module/i,
  /compilation failed/i,
  /Build failed/i,
  // Command failures
  /command not found/i,
  /ENOENT|EACCES|EPERM/,
  /exit code [1-9]\d*/i,
  /Permission denied/i,
  // Git errors
  /CONFLICT \(content\)/,
  /merge conflict/i,
  /fatal: /,
  // Package/dependency errors
  /Could not resolve/i,
  /peer dep|unmet peer dependency/i,
  /ERR_MODULE_NOT_FOUND/,
]

// Patterns that are just noise, not real mistakes
const FALSE_POSITIVE_PATTERNS = [
  /^warning:/im,            // Warnings aren't mistakes
  /deprecated/i,             // Deprecation notices
  /npm warn/i,               // npm warnings
  /\d+ warnings?$/im,        // Warning counts
]

function getErrorSignature(tool: string, output: string): string {
  // Create a short signature from the error for dedup
  // Take the first matching error pattern line
  for (const pattern of ERROR_PATTERNS) {
    const match = output.match(pattern)
    if (match) {
      return `${tool}:${match[0].slice(0, 80)}`
    }
  }
  return ""
}

function extractErrorContext(output: string, maxLen: number = 300): string {
  const lines = output.split("\n")

  // Find error-relevant lines
  const errorLines: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const isError = ERROR_PATTERNS.some((p) => p.test(line))
    if (isError) {
      // Include 1 line before for context
      if (i > 0 && errorLines.length === 0) {
        errorLines.push(lines[i - 1]!)
      }
      errorLines.push(line)
      // Include 1 line after
      if (i + 1 < lines.length) {
        errorLines.push(lines[i + 1]!)
      }
    }
  }

  if (errorLines.length === 0) return ""

  const context = errorLines.join("\n").trim()
  if (context.length <= maxLen) return context

  return context.slice(0, maxLen - 3) + "..."
}

function getToolContext(tool: string, args: any): string {
  if (EXECUTABLE_TOOLS.has(tool)) {
    const cmd = typeof args === "string" ? args : args?.command || args?.cmd || ""
    if (cmd) return `Command: ${String(cmd).slice(0, 100)}`
  }
  if (FILE_WRITE_TOOLS.has(tool)) {
    const file = args?.file_path || args?.path || args?.file || ""
    if (file) return `File: ${file}`
  }
  return `Tool: ${tool}`
}

export function trackMistake(
  tool: string,
  args: any,
  output: string,
  sessionId: string,
  projectId: string,
): void {
  if (!output || typeof output !== "string") return
  if (output.length < 20) return

  // Rate limit per session
  const count = sessionMistakeCount.get(sessionId) ?? 0
  if (count >= MAX_MISTAKES_PER_SESSION) return

  // Check if output contains real errors
  const hasError = ERROR_PATTERNS.some((p) => p.test(output))
  if (!hasError) return

  // Filter out false positives
  const isFalsePositive = FALSE_POSITIVE_PATTERNS.some((p) => p.test(output))
    && !ERROR_PATTERNS.some((p) => {
      const match = output.match(p)
      return match && !FALSE_POSITIVE_PATTERNS.some((fp) => fp.test(match[0]))
    })
  if (isFalsePositive) return

  // Deduplicate within session
  const signature = getErrorSignature(tool, output)
  if (!signature) return

  if (!sessionErrorSignatures.has(sessionId)) {
    sessionErrorSignatures.set(sessionId, new Set())
  }
  const seen = sessionErrorSignatures.get(sessionId)!
  if (seen.has(signature)) return
  seen.add(signature)

  // Extract relevant error context
  const errorContext = extractErrorContext(output)
  if (!errorContext) return

  const toolContext = getToolContext(tool, args)

  const content = `[Anti-pattern] ${toolContext}\n${errorContext}`

  storeMemory({
    content,
    category: "anti-pattern",
    projectId,
    sessionId,
    source: `mistake-tracking: ${tool}`,
    tags: ["anti-pattern", "mistake", tool],
  })

  sessionMistakeCount.set(sessionId, count + 1)
}

/** Clean up session tracking state */
export function clearMistakeTracking(sessionId: string): void {
  sessionMistakeCount.delete(sessionId)
  sessionErrorSignatures.delete(sessionId)
}
