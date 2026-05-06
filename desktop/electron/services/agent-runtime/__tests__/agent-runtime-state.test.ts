import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

describe("AgentRuntimeService — per-conversation adapter resolution", () => {
  it("resolves adapter using conversation agentType instead of project default", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const adapter = new BlockingAdapter()

    // Track what agentType the adapterFactory receives
    const factoryCalls: string[] = []
    const adapterFactory = vi.fn((view: { agentType: string }) => {
      factoryCalls.push(view.agentType)
      return adapter
    })

    // Mock providerConfig that returns a view with whatever agentType is passed in
    const providerConfig = {
      getActiveAgentType: vi.fn().mockResolvedValue("codex"),
      resolveRuntimeConfig: vi.fn((_projectId: string, agentType: string) =>
        Promise.resolve({
          projectId: "project-1",
          agentType,
          providers: [],
          env: {},
          envAllowlist: [],
        }),
      ),
    }

    // Pre-seed a conversation with agentType "claude-code"
    const convId = "conv-cc-1"
    await conversations.upsert({
      id: convId,
      schemaVersion: 1,
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      agentType: "claude-code",
      history: [],
      active: true,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    })

    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      agentType: "codex",
      providerConfig: providerConfig as never,
      adapterFactory,
      now: fixedNow,
    })

    const p = service.send(baseMessage("hello"))
    await tick()
    adapter.resolveNext("reply", "thread-1")
    await p

    // The adapter factory should have been called with "claude-code" (conversation's type),
    // not "codex" (the project default from getActiveAgentType)
    expect(factoryCalls).toEqual(["claude-code"])
    expect(providerConfig.resolveRuntimeConfig).toHaveBeenCalledWith(
      "project-1",
      "claude-code",
      expect.anything(),
    )
    // getActiveAgentType should NOT have been called since the override was provided
    expect(providerConfig.getActiveAgentType).not.toHaveBeenCalled()
  })

  it("falls back to project default when conversation has no agentType", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const adapter = new BlockingAdapter()

    const factoryCalls: string[] = []
    const adapterFactory = vi.fn((view: { agentType: string }) => {
      factoryCalls.push(view.agentType)
      return adapter
    })

    const providerConfig = {
      getActiveAgentType: vi.fn().mockResolvedValue("codex"),
      resolveRuntimeConfig: vi.fn((_projectId: string, agentType: string) =>
        Promise.resolve({
          projectId: "project-1",
          agentType,
          providers: [],
          env: {},
          envAllowlist: [],
        }),
      ),
    }

    // Pre-seed a conversation WITHOUT agentType
    const convId = "conv-no-type"
    await conversations.upsert({
      id: convId,
      schemaVersion: 1,
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      history: [],
      active: true,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    })

    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      agentType: "codex",
      providerConfig: providerConfig as never,
      adapterFactory,
      now: fixedNow,
    })

    const p = service.send(baseMessage("hello"))
    await tick()
    adapter.resolveNext("reply", "thread-1")
    await p

    // Should fall back to getActiveAgentType since conversation.agentType is undefined
    expect(factoryCalls).toEqual(["codex"])
    expect(providerConfig.getActiveAgentType).toHaveBeenCalled()
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

describe("AgentRuntimeService — idle session reclaim", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function createService() {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const adapter = new BlockingAdapter()
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      logger: logger as never,
      now: fixedNow,
    })
    return { service, adapter, conversations, logger }
  }

  function mockLiveSession() {
    return {
      agentType: "codex",
      close: vi.fn().mockResolvedValue(undefined),
      alive: vi.fn().mockReturnValue(true),
      send: vi.fn(),
      nextEvent: vi.fn(),
      respondPermission: vi.fn(),
      currentSessionId: vi.fn().mockReturnValue("session-1"),
    }
  }

  it("closes liveSession after 10 minutes of inactivity", async () => {
    const { service, adapter, logger } = createService()

    // Create a conversation by sending a message
    const p = service.send(baseMessage("hello"))
    await vi.advanceTimersByTimeAsync(0)
    adapter.resolveNext("done", "thread-1")
    await p

    // Inject a mock liveSession into the state
    const states = (service as never as { states: Map<string, { liveSession?: unknown; lastActivity: number; busy: boolean; activeTurns: number; queue: unknown[] }> }).states
    const stateEntry = [...states.values()][0]!
    const session = mockLiveSession()
    stateEntry.liveSession = session
    // Set lastActivity to 11 minutes ago
    stateEntry.lastActivity = Date.now() - 11 * 60 * 1000

    await service.reclaimIdleSessions()

    expect(session.close).toHaveBeenCalledOnce()
    expect(stateEntry.liveSession).toBeUndefined()
    expect(logger.info).toHaveBeenCalledWith(
      "Reclaimed idle agent session.",
      expect.objectContaining({ conversationId: expect.any(String) }),
    )
  })

  it("does NOT close liveSession if activity is recent", async () => {
    const { service, adapter } = createService()

    const p = service.send(baseMessage("hello"))
    await vi.advanceTimersByTimeAsync(0)
    adapter.resolveNext("done", "thread-1")
    await p

    const states = (service as never as { states: Map<string, { liveSession?: unknown; lastActivity: number; busy: boolean; activeTurns: number; queue: unknown[] }> }).states
    const stateEntry = [...states.values()][0]!
    const session = mockLiveSession()
    stateEntry.liveSession = session
    // Set lastActivity to 5 minutes ago (within threshold)
    stateEntry.lastActivity = Date.now() - 5 * 60 * 1000

    await service.reclaimIdleSessions()

    expect(session.close).not.toHaveBeenCalled()
    expect(stateEntry.liveSession).toBe(session)
  })

  it("does NOT close liveSession if session is busy", async () => {
    const { service, adapter } = createService()

    const p = service.send(baseMessage("hello"))
    await vi.advanceTimersByTimeAsync(0)
    adapter.resolveNext("done", "thread-1")
    await p

    const states = (service as never as { states: Map<string, { liveSession?: unknown; lastActivity: number; busy: boolean; activeTurns: number; queue: unknown[] }> }).states
    const stateEntry = [...states.values()][0]!
    const session = mockLiveSession()
    stateEntry.liveSession = session
    // Set lastActivity to 11 minutes ago but mark as busy
    stateEntry.lastActivity = Date.now() - 11 * 60 * 1000
    stateEntry.busy = true

    await service.reclaimIdleSessions()

    expect(session.close).not.toHaveBeenCalled()
    expect(stateEntry.liveSession).toBe(session)
  })
})
