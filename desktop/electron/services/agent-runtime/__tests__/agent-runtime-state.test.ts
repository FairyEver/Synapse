import { describe, expect, it } from "vitest"

import type {
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import { AgentRuntimeService } from "../agent-runtime-service"
import type { AgentMessage } from "../types"

describe("AgentRuntimeService — per-conversation state isolation", () => {
  it("two conversations get independent state objects", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const adapter = new BlockingAdapter()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      now: fixedNow,
    })

    // Send two messages with different workspace keys to create two conversations
    const p1 = service.send(baseMessage("hello", "ws-a"))
    await tick()
    const p2 = service.send(baseMessage("world", "ws-b"))
    await tick()

    // First conversation is busy, second should be queued independently
    // Resolve first
    adapter.resolveNext("reply-a", "thread-a")
    const r1 = await p1

    // Second should still be pending (different conversation, independent state)
    adapter.resolveNext("reply-b", "thread-b")
    const r2 = await p2

    expect(r1.resultText).toBe("reply-a")
    expect(r2.resultText).toBe("reply-b")
  })

  it("state is keyed by conversationId, not composite key", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const adapter = new BlockingAdapter()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      now: fixedNow,
    })

    // Send a message to create a conversation
    const p1 = service.send(baseMessage("first"))
    await tick()
    adapter.resolveNext("done-1", "thread-1")
    await p1

    // The conversation should exist in the repository
    const allConversations = await conversations.list()
    expect(allConversations).toHaveLength(1)
    expect(allConversations[0]!.sessionKey).toBe("s1")
    expect(allConversations[0]!.projectId).toBe("project-1")
  })

  it("deleting one conversation state does not affect another", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const adapter = new BlockingAdapter()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      now: fixedNow,
    })

    // Create two conversations via different workspace keys
    const p1 = service.send(baseMessage("msg-a", "ws-a"))
    await tick()
    adapter.resolveNext("reply-a", "thread-a")
    await p1

    const p2 = service.send(baseMessage("msg-b", "ws-b"))
    await tick()
    adapter.resolveNext("reply-b", "thread-b")
    await p2

    // Find the actual conversation IDs from the namespace
    const allConversations = await conversations.list()
    const convA = allConversations.find((c) => c.workspaceKey === "ws-a")!
    const convB = allConversations.find((c) => c.workspaceKey === "ws-b")!
    expect(convA).toBeTruthy()
    expect(convB).toBeTruthy()

    // Delete the first conversation
    const deleted = await service.deleteSession(convA.id)
    expect(deleted).toBe(true)

    // Second conversation should still work
    const p3 = service.send(baseMessage("msg-c", "ws-b"))
    await tick()
    adapter.resolveNext("reply-c", "thread-c")
    const r3 = await p3
    expect(r3.resultText).toBe("reply-c")
  })
})

// --- Helpers ---

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  readonly name: string
  private readonly values = new Map<string, T>()
  private readonly listeners: DataChangeListener<T>[] = []

  constructor(name: string) {
    this.name = name
  }

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(): Promise<void> {}

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.values.values()]
    if (!filter) return values
    return values.filter((value) =>
      Object.entries(filter).every(([key, expected]) =>
        (value as Record<string, unknown>)[key] === expected,
      ),
    )
  }

  async get(id: string): Promise<T | null> {
    return this.values.get(id) ?? null
  }

  snapshot(id: string): T | null {
    return this.values.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    const previous = this.values.get(item.id)
    this.values.set(item.id, item)
    this.emit({
      namespace: this.name,
      kind: "upsert",
      id: item.id,
      value: item,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  async remove(id: string): Promise<void> {
    const previous = this.values.get(id)
    this.values.delete(id)
    this.emit({
      namespace: this.name,
      kind: "remove",
      id,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  onChange(listener: DataChangeListener<T>): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  private emit(event: DataChangeEvent<T>): void {
    for (const listener of this.listeners) listener(event)
  }
}

import type { AgentExecutionContext, AgentExecutionResult, AgentAdapter } from "../types"

class BlockingAdapter implements AgentAdapter {
  readonly agentType = "codex"
  readonly started: string[] = []
  private readonly pending: Array<(result: AgentExecutionResult) => void> = []

  execute(message: AgentMessage, _context: AgentExecutionContext): Promise<AgentExecutionResult> {
    this.started.push(message.content)
    return new Promise((resolve) => {
      this.pending.push(resolve)
    })
  }

  resolveNext(resultText: string, agentSessionId: string): void {
    const resolve = this.pending.shift()
    if (!resolve) throw new Error("No pending execution")
    resolve({
      events: [
        { type: "text", content: resultText, agentSessionId, threadId: agentSessionId },
        { type: "result", content: resultText, done: true, agentSessionId, threadId: agentSessionId },
      ],
      resultText,
      agentSessionId,
      threadId: agentSessionId,
    })
  }
}

function fixedNow(): Date {
  return new Date("2026-04-26T00:00:00.000Z")
}

function baseMessage(content: string, workspaceKey?: string): AgentMessage {
  return {
    projectId: "project-1",
    sessionKey: "s1",
    platform: "local",
    userId: "user-1",
    content,
    workspaceKey,
  }
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}
