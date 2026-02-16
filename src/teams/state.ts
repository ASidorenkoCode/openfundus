export interface TeamAgent {
  sessionID: string
  name: string
  role: string
  task: string
  status: "running" | "done" | "error"
  createdAt: number
  tmuxPane?: string
}

const agents = new Map<string, TeamAgent>()

export function addAgent(agent: TeamAgent): void {
  agents.set(agent.sessionID, agent)
}

export function removeAgent(sessionID: string): boolean {
  return agents.delete(sessionID)
}

export function getAgent(sessionID: string): TeamAgent | undefined {
  return agents.get(sessionID)
}

export function listAgents(): TeamAgent[] {
  return Array.from(agents.values())
}

export function updateStatus(
  sessionID: string,
  status: TeamAgent["status"],
): void {
  const agent = agents.get(sessionID)
  if (agent) {
    agent.status = status
  }
}

export function clearAll(): void {
  agents.clear()
}
