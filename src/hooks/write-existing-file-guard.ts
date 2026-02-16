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

// Only guard the Write tool — apply_patch has its own built-in guards (issue #1871)
const WRITE_TOOL_NAMES = new Set(["write"])

function extractFilePaths(args: Record<string, unknown>): string[] {
  const filePath =
    (args.filePath as string) ?? (args.path as string) ?? (args.file_path as string)
  return filePath ? [filePath] : []
}

export function handleWriteExistingFileGuard(
  tool: string,
  args: Record<string, unknown>,
  directory: string,
): void {
  if (!WRITE_TOOL_NAMES.has(tool.toLowerCase())) return

  const filePaths = extractFilePaths(args)

  for (const filePath of filePaths) {
    const resolvedPath = normalize(isAbsolute(filePath) ? filePath : resolve(directory, filePath))

    if (existsSync(resolvedPath)) {
      throw new Error(
        `File "${filePath}" already exists. Use the Edit tool instead of Write to modify existing files.`,
      )
    }
  }
}
