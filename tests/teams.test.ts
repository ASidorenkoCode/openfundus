import { describe, expect, test, beforeEach } from "bun:test"
import {
  addAgent,
  removeAgent,
  getAgent,
  listAgents,
  updateStatus,
  clearAll,
  type TeamAgent,
} from "../src/teams/state"

function makeAgent(overrides: Partial<TeamAgent> = {}): TeamAgent {
  return {
    sessionID: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: "test-agent",
    role: "Test role",
    task: "Test task",
    status: "running",
    createdAt: Date.now(),
    ...overrides,
  }
}

describe("teams.state", () => {
  beforeEach(() => {
    clearAll()
  })

  test("addAgent and getAgent", () => {
    const agent = makeAgent({ name: "researcher" })
    addAgent(agent)

    const retrieved = getAgent(agent.sessionID)
    expect(retrieved).toBeDefined()
    expect(retrieved!.name).toBe("researcher")
    expect(retrieved!.status).toBe("running")
  })

  test("getAgent returns undefined for unknown session", () => {
    expect(getAgent("nonexistent")).toBeUndefined()
  })

  test("removeAgent", () => {
    const agent = makeAgent()
    addAgent(agent)
    expect(getAgent(agent.sessionID)).toBeDefined()

    const removed = removeAgent(agent.sessionID)
    expect(removed).toBe(true)
    expect(getAgent(agent.sessionID)).toBeUndefined()
  })

  test("removeAgent returns false for unknown session", () => {
    expect(removeAgent("nonexistent")).toBe(false)
  })

  test("listAgents returns all agents", () => {
    const a1 = makeAgent({ name: "agent-1" })
    const a2 = makeAgent({ name: "agent-2" })
    addAgent(a1)
    addAgent(a2)

    const agents = listAgents()
    expect(agents).toHaveLength(2)
    expect(agents.map((a) => a.name).sort()).toEqual(["agent-1", "agent-2"])
  })

  test("listAgents returns empty array when no agents", () => {
    expect(listAgents()).toHaveLength(0)
  })

  test("updateStatus changes agent status", () => {
    const agent = makeAgent({ status: "running" })
    addAgent(agent)

    updateStatus(agent.sessionID, "done")
    expect(getAgent(agent.sessionID)!.status).toBe("done")

    updateStatus(agent.sessionID, "error")
    expect(getAgent(agent.sessionID)!.status).toBe("error")
  })

  test("updateStatus is a no-op for unknown session", () => {
    // should not throw
    updateStatus("nonexistent", "done")
  })

  test("clearAll removes all agents", () => {
    addAgent(makeAgent({ name: "a" }))
    addAgent(makeAgent({ name: "b" }))
    expect(listAgents()).toHaveLength(2)

    clearAll()
    expect(listAgents()).toHaveLength(0)
  })

  test("agents preserve tmuxPane", () => {
    const agent = makeAgent({ tmuxPane: "%42" })
    addAgent(agent)
    expect(getAgent(agent.sessionID)!.tmuxPane).toBe("%42")
  })
})
