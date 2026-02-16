let tmuxChecked = false
let tmuxAvailable = false

export async function isTmuxAvailable(): Promise<boolean> {
  if (tmuxChecked) return tmuxAvailable
  tmuxChecked = true

  if (!process.env.TMUX) {
    tmuxAvailable = false
    return false
  }

  try {
    await Bun.$`which tmux`.quiet()
    tmuxAvailable = true
  } catch {
    tmuxAvailable = false
  }
  return tmuxAvailable
}

export async function spawnTmuxPane(
  serverUrl: string,
  sessionID: string,
  name: string,
): Promise<string> {
  const cmd = `opencode run --attach ${serverUrl} --session ${sessionID}`
  const result =
    await Bun.$`tmux split-window -h -P -F "#{pane_id}" -t $TMUX_PANE ${cmd}`.text()
  return result.trim()
}

export async function closeTmuxPane(paneId: string): Promise<void> {
  try {
    await Bun.$`tmux kill-pane -t ${paneId}`.quiet()
  } catch {
    // pane may already be closed
  }
}
