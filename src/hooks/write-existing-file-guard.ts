/**
 * Write-Existing-File Guard Hook
 *
 * Blocks the Write tool from overwriting existing files, forcing use of Edit
 * instead. This prevents accidental file overwrites that lose content.
 *
 * Inspired by oh-my-opencode's write-existing-file-guard hook.
 */

import { existsSync } from "fs"
import { resolve, isAbsolute, normalize } from "path"

const WRITE_TOOL_NAMES = new Set(["write", "apply_patch"])

/**
 * Extract file paths from tool args. Handles both Write (filePath/path/file_path)
 * and apply_patch (patchText containing file paths in patch headers).
 */
function extractFilePaths(tool: string, args: Record<string, unknown>): string[] {
  const lower = tool.toLowerCase()

  if (lower === "write") {
    const filePath =
      (args.filePath as string) ?? (args.path as string) ?? (args.file_path as string)
    return filePath ? [filePath] : []
  }

  if (lower === "apply_patch") {
    const patchText = args.patchText as string
    if (!patchText) return []

    // Extract file paths from patch headers like "*** Add File: path/to/file"
    const addFilePattern = /^\*\*\*\s+Add File:\s+(.+)$/gm
    const paths: string[] = []
    let match: RegExpExecArray | null
    while ((match = addFilePattern.exec(patchText)) !== null) {
      if (match[1]) paths.push(match[1].trim())
    }
    return paths
  }

  return []
}

export function handleWriteExistingFileGuard(
  tool: string,
  args: Record<string, unknown>,
  directory: string,
): void {
  if (!WRITE_TOOL_NAMES.has(tool.toLowerCase())) return

  const filePaths = extractFilePaths(tool, args)

  for (const filePath of filePaths) {
    const resolvedPath = normalize(isAbsolute(filePath) ? filePath : resolve(directory, filePath))

    if (existsSync(resolvedPath)) {
      throw new Error(
        `File "${filePath}" already exists. Use the Edit tool instead of Write to modify existing files.`,
      )
    }
  }
}
