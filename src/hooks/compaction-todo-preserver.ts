/**
 * Compaction Todo Preserver Hook
 *
 * Captures a snapshot of session todos before compaction and restores them
 * afterwards, since compaction can wipe the todo list.
 *
 * Inspired by oh-my-opencode's compaction-todo-preserver hook.
 */

interface TodoSnapshot {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority?: "low" | "medium" | "high"
}

interface TodoClient {
  session: {
    todo: (opts: { path: { id: string } }) => Promise<unknown>
  }
}

const snapshots = new Map<string, TodoSnapshot[]>()

function extractTodos(response: unknown): TodoSnapshot[] {
  const payload = response as { data?: unknown }
  if (Array.isArray(payload?.data)) return payload.data as TodoSnapshot[]
  if (Array.isArray(response)) return response as TodoSnapshot[]
  return []
}

export function createCompactionTodoPreserverHook(client: TodoClient) {
  /** Capture current todos for a session (call before compaction) */
  const capture = async (sessionID: string): Promise<void> => {
    if (!sessionID) return
    try {
      const response = await client.session.todo({ path: { id: sessionID } })
      const todos = extractTodos(response)
      if (todos.length > 0) {
        snapshots.set(sessionID, todos)
      }
    } catch {
      // Silent fail — don't block compaction
    }
  }

  /** Restore todos after compaction if they were lost */
  const restore = async (sessionID: string): Promise<void> => {
    const snapshot = snapshots.get(sessionID)
    if (!snapshot || snapshot.length === 0) return

    try {
      // Check if todos still exist post-compaction
      const response = await client.session.todo({ path: { id: sessionID } })
      const currentTodos = extractTodos(response)
      if (currentTodos.length > 0) {
        // Todos survived compaction, no restore needed
        snapshots.delete(sessionID)
        return
      }
    } catch {
      // Can't check — try to restore anyway
    }

    // Try to restore via dynamic import of opencode internals
    try {
      const loader = "opencode/session/todo"
      const mod = (await import(/* @vite-ignore */ loader)) as {
        Todo?: { update?: (input: { sessionID: string; todos: TodoSnapshot[] }) => Promise<void> }
      }
      if (typeof mod.Todo?.update === "function") {
        await mod.Todo.update({ sessionID, todos: snapshot })
      }
    } catch {
      // Todo.update not available — silent fail
    } finally {
      snapshots.delete(sessionID)
    }
  }

  const handleEvent = async (event: { type: string; properties?: unknown }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const id = (props?.id as string) ?? (props?.info as any)?.id
      if (id) snapshots.delete(id)
    }

    if (event.type === "session.compacted") {
      const id =
        (props?.sessionID as string) ?? (props?.id as string) ?? (props?.info as any)?.id
      if (id) await restore(id)
    }
  }

  return { capture, handleEvent }
}

export function clearTodoSnapshots(sessionId: string) {
  snapshots.delete(sessionId)
}
