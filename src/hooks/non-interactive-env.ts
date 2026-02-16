/**
 * Non-Interactive Environment Hook
 *
 * Prepends non-interactive environment variables to git commands so they don't
 * hang waiting for editor/pager/prompt input. Also warns about banned interactive
 * commands (vim, nano, less, etc.).
 *
 * Inspired by oh-my-opencode's non-interactive-env hook.
 */

/** Environment variables injected before git commands */
const NON_INTERACTIVE_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  // Block interactive editors (git rebase, commit --amend, etc.)
  GIT_EDITOR: ":",
  EDITOR: ":",
  VISUAL: "",
  GIT_SEQUENCE_EDITOR: ":",
  GIT_MERGE_AUTOEDIT: "no",
  // Block pagers
  GIT_PAGER: "cat",
  PAGER: "cat",
}

/** Commands that will always hang in non-interactive mode */
const BANNED_COMMANDS = ["vim", "nano", "vi", "emacs", "less", "more", "man"]
const BANNED_PATTERNS = BANNED_COMMANDS.map((cmd) => new RegExp(`\\b${cmd}\\b`))

/** Interactive git modes that should be warned about */
const INTERACTIVE_GIT_PATTERNS = [/\bgit\s+add\s+-p\b/, /\bgit\s+rebase\s+-i\b/]

/**
 * Windows nul redirect sanitization.
 * When OpenCode uses Git Bash on Windows, `>nul` / `2>nul` creates a literal
 * undeletable file named "nul" instead of routing to the null device.
 * Rewrite to `/dev/null` which Git Bash understands.
 * See: opencode#13406, opencode#13369, opencode#11586, opencode#8108
 */
const IS_WINDOWS = process.platform === "win32"

/**
 * Sanitize Windows nul redirections in a command string.
 * Only rewrites `>nul` / `2>nul` when they appear as standalone redirections
 * (not inside quotes, comments, or as part of a path like `>nul/backup.txt`).
 * Matches: `>nul`, `2>nul`, `> nul`, `2> NUL` at end-of-string or followed
 * by whitespace, semicolon, pipe, ampersand, or closing paren.
 */
function sanitizeNulRedirects(command: string): string {
  // Skip if the command is clearly quoted/heredoc heavy — too risky to rewrite
  if (command.includes("<<")) return command

  // Match >nul or >>nul only when followed by end-of-string, whitespace, or shell metachar
  // The negative lookahead (?![/\\w]) prevents matching >nul/path or >nullify
  return command.replace(
    /(\d?)(>>?)\s*nul(?![/\\\w])/gi,
    "$1$2/dev/null",
  )
}

function buildEnvPrefix(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => (value === "" ? `${key}=` : `${key}=${value}`))
    .join(" ")
}

export function handleNonInteractiveEnv(
  tool: string,
  output: { args: Record<string, unknown>; message?: string },
): void {
  if (tool.toLowerCase() !== "bash") return

  const command = output.args.command as string | undefined
  if (!command) return

  // Warn about banned interactive commands
  for (let i = 0; i < BANNED_PATTERNS.length; i++) {
    if (BANNED_PATTERNS[i]!.test(command)) {
      output.message = `Warning: '${BANNED_COMMANDS[i]}' is an interactive command that may hang in non-interactive environments.`
      return
    }
  }

  // Warn about interactive git modes
  for (const pattern of INTERACTIVE_GIT_PATTERNS) {
    if (pattern.test(command)) {
      output.message =
        "Warning: Interactive git modes (add -p, rebase -i) may hang. Use non-interactive alternatives."
      return
    }
  }

  // Windows: rewrite >nul to >/dev/null to prevent undeletable nul files
  if (IS_WINDOWS) {
    const sanitized = sanitizeNulRedirects(command)
    if (sanitized !== command) {
      output.args.command = sanitized
    }
  }

  // Only prepend env vars for git commands
  const currentCommand = output.args.command as string
  if (!/\bgit\b/.test(currentCommand)) return

  // Idempotency: skip if env vars are already prepended (issue #1822)
  if (currentCommand.includes("GIT_TERMINAL_PROMPT=")) return

  const envPrefix = buildEnvPrefix(NON_INTERACTIVE_ENV)
  output.args.command = `${envPrefix} ${currentCommand}`
}
