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

export function handleWriteExistingFileGuard(
  tool: string,
  args: Record<string, unknown>,
  directory: string,
): void {
  if (tool.toLowerCase() !== "write") return

  const filePath =
    (args.filePath as string) ?? (args.path as string) ?? (args.file_path as string)
  if (!filePath) return

  const resolvedPath = normalize(isAbsolute(filePath) ? filePath : resolve(directory, filePath))

  if (existsSync(resolvedPath)) {
    throw new Error(
      "File already exists. Use the Edit tool instead of Write to modify existing files.",
    )
  }
}
