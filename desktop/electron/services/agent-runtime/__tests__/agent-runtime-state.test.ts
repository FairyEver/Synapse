import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import type { ProviderService } from "../../provider"
import { AgentRuntimeService } from "../agent-runtime-service"
import type {
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
} from "../types"

describe("AgentRuntimeService — per-conversation state isolation", () => {
  it.each([
    ["ws-a", "hello", "world"],
    ["ws-b", "world", "hello"],
  ])("two conversations get independent state objects (%s starts first)", async (firstWorkspaceKey, firstContent, secondContent) => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const sessions = new BlockingSessionFactory()
    let releaseSecondCreation!: () => void
    const secondCreationReleased = new Promise<void>((resolve) => { releaseSecondCreation = resolve })
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService() as unknown as ProviderService,
      createSession: async ({ conversation }) => {
        if (conversation.workspaceKey !== firstWorkspaceKey) {
          await secondCreationReleased
        }
        return sessions.create()
      },
      now: fixedNow,
    })

    const p1 = service.send(baseMessage("hello", "ws-a"))
    const p2 = service.send(baseMessage("world", "ws-b"))
    try {
      // SDK startup can finish in either order; match replies to the actual input.
      await vi.waitFor(() => expect(sessions.started).toEqual([firstContent]))
      releaseSecondCreation()
      await vi.waitFor(() => expect(sessions.started).toEqual([firstContent, secondContent]))

      await sessions.resolveFor("hello", "reply-a", "thread-a")
      const r1 = await p1
      expect(r1.resultText).toBe("reply-a")

      const allConversations = await conversations.list()
      const convA = allConversations.find((conversation) => conversation.workspaceKey === "ws-a")!
      const convB = allConversations.find((conversation) => conversation.workspaceKey === "ws-b")!
      expect(r1.conversationId).toBe(convA.id)
      expect(service.getConversationRuntimeSnapshot(convA.id).lifecycle).toBe("idle")
      expect(service.getConversationRuntimeSnapshot(convB.id).lifecycle).toBe("running")

      await sessions.resolveFor("world", "reply-b", "thread-b")
      const r2 = await p2
      expect(r2.resultText).toBe("reply-b")
      expect(r2.conversationId).toBe(convB.id)
    } finally {
      releaseSecondCreation()
      await service.shutdown()
      await Promise.allSettled([p1, p2])
    }
  })

  it("state is keyed by conversationId, not composite key", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const sessions = new BlockingSessionFactory()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService() as unknown as ProviderService,
      createSession: () => sessions.create(),
      now: fixedNow,
    })

    // Send a message to create a conversation
    const p1 = service.send(baseMessage("first"))
    await tick()
    await sessions.resolveFor("first", "done-1", "thread-1")
    await p1

    // The conversation should exist in the repository
    const allConversations = await conversations.list()
    expect(allConversations).toHaveLength(1)
    expect(allConversations[0]!.sessionKey).toBe("s1")
    expect(allConversations[0]!.projectId).toBe("project-1")
  })

  it("deleting one conversation state does not affect another", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const sessions = new BlockingSessionFactory()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService() as unknown as ProviderService,
      createSession: () => sessions.create(),
      now: fixedNow,
    })

    // Create two conversations via different workspace keys
    const p1 = service.send(baseMessage("msg-a", "ws-a"))
    await tick()
    await sessions.resolveFor("msg-a", "reply-a", "thread-a")
    await p1

    const p2 = service.send(baseMessage("msg-b", "ws-b"))
    await tick()
    await sessions.resolveFor("msg-b", "reply-b", "thread-b")
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
    await sessions.resolveFor("msg-c", "reply-c", "thread-c")
    const r3 = await p3
    expect(r3.resultText).toBe("reply-c")
  })
})

describe("AgentRuntimeService — SDK session factory", () => {
  it("uses the injected SDK session factory", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const sessions = new BlockingSessionFactory()

    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService() as unknown as ProviderService,
      createSession: () => sessions.create(),
      now: fixedNow,
    })

    const p = service.send(baseMessage("hello"))
    await tick()
    await sessions.resolveFor("hello", "reply", "thread-1")
    const result = await p

    expect(result.resultText).toBe("reply")
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

class BlockingSessionFactory {
  readonly started: string[] = []
  private readonly sessions: BlockingSession[] = []

  create(): AgentLiveSession {
    const session = new BlockingSession(this)
    this.sessions.push(session)
    return session
  }

  async resolveFor(messageContent: string, resultText: string, agentSessionId: string): Promise<void> {
    const matchesMessage = (candidate: BlockingSession) => candidate.pendingMessage?.content === messageContent
    await vi.waitFor(() => expect(this.sessions.some(matchesMessage)).toBe(true))
    const session = this.sessions.find(matchesMessage)
    if (!session) throw new Error(`No pending session for message: ${messageContent}`)
    session.emitResult(resultText, agentSessionId)
  }
}

class BlockingSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  pendingMessage?: AgentMessage
  private readonly events: AgentEvent[] = []
  private readonly waiters: Array<(event: AgentEvent | null) => void> = []
  private closed = false

  constructor(private readonly factory: BlockingSessionFactory) {}

  async send(message: AgentMessage): Promise<boolean> {
    this.factory.started.push(message.content)
    this.pendingMessage = message
    return true
  }

  async respondPermission(
    _requestId: string,
    _decision: AgentPermissionDecision,
  ): Promise<void> {}

  nextEvent(): Promise<AgentEvent | null> {
    const event = this.events.shift()
    if (event) return Promise.resolve(event)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }

  currentSessionId(): string | undefined {
    return undefined
  }

  alive(): boolean {
    return !this.closed
  }

  async close(): Promise<void> {
    this.closed = true
    for (const waiter of this.waiters) waiter(null)
    this.waiters.length = 0
  }

  emitResult(resultText: string, sdkSessionId: string): void {
    this.pendingMessage = undefined
    this.push({ type: "text", content: resultText, sdkSessionId })
    this.push({ type: "result", content: resultText, done: true, sdkSessionId })
  }

  private push(event: AgentEvent): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(event)
      return
    }
    this.events.push(event)
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

class FakeProviderService {
  async getActiveProvider(): Promise<{ id: string }> {
    return { id: "anthropic" }
  }

  async buildEnv(): Promise<Record<string, string>> {
    return {}
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
    const sessions = new BlockingSessionFactory()
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService() as unknown as ProviderService,
      createSession: () => sessions.create(),
      logger: logger as never,
      now: fixedNow,
    })
    return { service, sessions, conversations, logger }
  }

  function mockLiveSession() {
    return {
      agentType: "claude-code",
      close: vi.fn().mockResolvedValue(undefined),
      alive: vi.fn().mockReturnValue(true),
      send: vi.fn(),
      nextEvent: vi.fn(),
      respondPermission: vi.fn(),
      currentSessionId: vi.fn().mockReturnValue("session-1"),
    }
  }

  it("closes liveSession after 10 minutes of inactivity", async () => {
    const { service, sessions, logger } = createService()

    // Create a conversation by sending a message
    const p = service.send(baseMessage("hello"))
    await vi.advanceTimersByTimeAsync(0)
    await sessions.resolveFor("hello", "done", "thread-1")
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
    const { service, sessions } = createService()

    const p = service.send(baseMessage("hello"))
    await vi.advanceTimersByTimeAsync(0)
    await sessions.resolveFor("hello", "done", "thread-1")
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
    const { service, sessions } = createService()

    const p = service.send(baseMessage("hello"))
    await vi.advanceTimersByTimeAsync(0)
    await sessions.resolveFor("hello", "done", "thread-1")
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
