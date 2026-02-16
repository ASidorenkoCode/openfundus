import { tool } from "@opencode-ai/plugin"
import { getClient } from "../client"
import {
  addAgent,
  getAgent,
  listAgents,
  updateStatus,
  removeAgent,
  clearAll,
  type TeamAgent,
} from "./state"
import { isTmuxAvailable, spawnTmuxPane, closeTmuxPane } from "./tmux"

export function createTeamTools(serverUrl: URL) {
  return {
    team_spawn: tool({
      description:
        "Spawn a new child agent session to work on a subtask in parallel. " +
        "The child session runs concurrently and can be monitored with team_status. " +
        "If tmux is available, the session opens in a visible split pane; otherwise it runs headless.",
      args: {
        name: tool.schema
          .string()
          .describe(
            "Short identifier for this agent (e.g. 'researcher', 'tester')",
          ),
        role: tool.schema
          .string()
          .describe(
            "Role description injected as system context (e.g. 'You are a test-writing specialist')",
          ),
        task: tool.schema
          .string()
          .describe("The task prompt to send to the child session"),
        model: tool.schema
          .object({
            providerID: tool.schema.string(),
            modelID: tool.schema.string(),
          })
          .optional()
          .describe("Optional model override for the child session"),
      },
      async execute(args, ctx) {
        const client = getClient()
        const session = await client.session.create({
          body: {
            parentID: ctx.sessionID,
            title: `[team:${args.name}] ${args.task.slice(0, 80)}`,
          },
        })

        const sessionID = session.data!.id

        const agent: TeamAgent = {
          sessionID,
          name: args.name,
          role: args.role,
          task: args.task,
          status: "running",
          createdAt: Date.now(),
        }

        // Try tmux pane if available
        const tmux = await isTmuxAvailable()
        if (tmux) {
          try {
            const paneId = await spawnTmuxPane(
              serverUrl.toString(),
              sessionID,
              args.name,
            )
            agent.tmuxPane = paneId
          } catch {
            // Fall back to headless
          }
        }

        addAgent(agent)

        // Fire-and-forget prompt to the child session
        await client.session.promptAsync({
          path: { id: sessionID },
          body: {
            system: args.role,
            parts: [{ type: "text", text: args.task }],
            ...(args.model ? { model: args.model } : {}),
          },
        })

        return `Spawned agent "${args.name}" (session: ${sessionID})${agent.tmuxPane ? ` in tmux pane ${agent.tmuxPane}` : " (headless)"}`
      },
    }),

    team_status: tool({
      description:
        "List all spawned team agents with their current status, session IDs, and task descriptions. " +
        "Polls the server for live session status.",
      args: {},
      async execute(_args) {
        const client = getClient()
        const agents = listAgents()
        if (agents.length === 0) {
          return "No team agents are currently spawned."
        }

        // Fetch live status from the server
        const statusRes = await client.session.status()
        const statuses = statusRes.data ?? {}

        const lines = agents.map((a) => {
          const live = (statuses as Record<string, any>)[a.sessionID]
          let liveStatus = a.status
          if (live) {
            if (live.type === "busy") liveStatus = "running"
            else if (live.type === "idle") {
              if (a.status === "running") {
                updateStatus(a.sessionID, "done")
                liveStatus = "done"
              }
            }
          }

          return [
            `[${a.name}]`,
            `  session: ${a.sessionID}`,
            `  status: ${liveStatus}`,
            `  role: ${a.role}`,
            `  task: ${a.task.slice(0, 120)}`,
            a.tmuxPane ? `  tmux: ${a.tmuxPane}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        })

        return lines.join("\n\n")
      },
    }),

    team_message: tool({
      description:
        "Send a follow-up message to a specific team agent's session. " +
        "Use this to provide additional instructions, ask for progress, or redirect the agent.",
      args: {
        sessionID: tool.schema
          .string()
          .describe("The session ID of the agent to message"),
        message: tool.schema
          .string()
          .describe("The message to send to the agent"),
      },
      async execute(args) {
        const client = getClient()
        const agent = getAgent(args.sessionID)
        if (!agent) {
          return `No team agent found with session ID: ${args.sessionID}`
        }

        await client.session.promptAsync({
          path: { id: args.sessionID },
          body: {
            parts: [{ type: "text", text: args.message }],
          },
        })

        updateStatus(args.sessionID, "running")
        return `Message sent to agent "${agent.name}" (${args.sessionID})`
      },
    }),

    team_abort: tool({
      description:
        "Abort a specific team agent's session. Stops any ongoing processing and closes the tmux pane if applicable.",
      args: {
        sessionID: tool.schema
          .string()
          .describe("The session ID of the agent to abort"),
      },
      async execute(args) {
        const client = getClient()
        const agent = getAgent(args.sessionID)
        if (!agent) {
          return `No team agent found with session ID: ${args.sessionID}`
        }

        await client.session.abort({ path: { id: args.sessionID } })

        if (agent.tmuxPane) {
          await closeTmuxPane(agent.tmuxPane)
        }

        updateStatus(args.sessionID, "error")
        removeAgent(args.sessionID)
        return `Aborted agent "${agent.name}" (${args.sessionID})`
      },
    }),

    team_cleanup: tool({
      description:
        "Abort all running team agents and close all tmux panes. " +
        "Use this to clean up when the team's work is complete or to start fresh.",
      args: {},
      async execute(_args) {
        const client = getClient()
        const agents = listAgents()
        if (agents.length === 0) {
          return "No team agents to clean up."
        }

        const results: string[] = []
        for (const agent of agents) {
          try {
            if (agent.status === "running") {
              await client.session.abort({ path: { id: agent.sessionID } })
            }
            if (agent.tmuxPane) {
              await closeTmuxPane(agent.tmuxPane)
            }
            results.push(`Cleaned up "${agent.name}" (${agent.sessionID})`)
          } catch (e) {
            results.push(
              `Failed to clean up "${agent.name}": ${e instanceof Error ? e.message : String(e)}`,
            )
          }
        }

        clearAll()
        return results.join("\n")
      },
    }),
  }
}
