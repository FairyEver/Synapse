import { describe, expect, it, vi } from "vitest"

import type {
  AgentEventEntryV1,
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import type { ProviderService } from "../../provider"
import { AgentCommandRouter } from "../command-router"
import { ConversationRouter } from "../conversation-router"
import { AgentGovernanceService } from "../governance"
import { AgentSessionRepository, conversationId } from "../session-repository"
import { SessionManager } from "../session-manager"
import type {
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
  AgentRuntimeTurnResult,
} from "../types"

describe("ConversationRouter", () => {
  it("binds new conversations to the active provider and passes ProviderService env to the SDK session", async () => {
    const { conversations, router, providerService, factoryCalls } = createRouter({
      activeProviderId: "anthropic",
      env: { ANTHROPIC_API_KEY: "sk-test" },
      session: new ScriptedSession([
        {
          type: "result",
          content: "done",
          done: true,
          sdkSessionId: "sdk-1",
        },
      ], "sdk-1"),
    })

    const result = await router.send(baseMessage("hello"))

    expect(result.resultText).toBe("done")
    expect(providerService.buildEnvCalls).toEqual([
      { providerId: "anthropic", projectId: "project-1", actorId: "user-1" },
    ])
    expect(factoryCalls).toEqual([
      expect.objectContaining({
        providerId: "anthropic",
        env: { ANTHROPIC_API_KEY: "sk-test" },
      }),
    ])
    await expect(conversations.get(result.conversationId)).resolves.toMatchObject({
      providerId: "anthropic",
      sdkSessionId: "sdk-1",
    })
  })

  it("keeps an existing conversation on its original provider id", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    await conversations.upsert(conversation({
      providerId: "deepseek",
      sdkSessionId: "sdk-old",
    }))
    const session = new ScriptedSession([
      { type: "result", content: "again", done: true, sdkSessionId: "sdk-old" },
    ], "sdk-old")
    const { router, factoryCalls } = createRouter({
      conversations,
      activeProviderId: "anthropic",
      session,
    })

    await router.send(baseMessage("resume"))

    expect(factoryCalls[0]).toEqual(expect.objectContaining({
      providerId: "deepseek",
      sdkSessionId: "sdk-old",
    }))
    await expect(conversations.get(conversationId("local", "s1", "active"))).resolves.toMatchObject({
      providerId: "deepseek",
    })
  })

  it("returns an error event when governance blocks a message", async () => {
    const governance = new AgentGovernanceService({
      bannedWords: ["blocked"],
    })
    const { router, factoryCalls } = createRouter({
      governance,
      message: new ScriptedSession([]),
    })

    const result = await router.send({
      ...baseMessage("blocked"),
      chatType: "direct",
    })

    expect(result).toEqual(expect.objectContaining({
      error: 'Message contains banned word "blocked"',
      events: [expect.objectContaining({ type: "error" })],
    }))
    expect(factoryCalls).toEqual([])
  })

  it("routes slash commands before sending to the SDK session", async () => {
    const commandRouter = {
      handle: vi.fn(async (): Promise<AgentRuntimeTurnResult> => ({
        conversationId: conversationId("local", "s1", "active"),
        events: [{ type: "result", content: "command handled", done: true }],
        resultText: "command handled",
      })),
    } as unknown as AgentCommandRouter
    const session = new ScriptedSession([
      { type: "result", content: "should not run", done: true },
    ])
    const { router } = createRouter({ commandRouter, session })

    const result = await router.send(baseMessage("/status"))

    expect(result.resultText).toBe("command handled")
    expect(commandRouter.handle).toHaveBeenCalledTimes(1)
    expect(session.sent).toEqual([])
  })

  it("persists full agent events when an agent.events namespace is wired", async () => {
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const { router } = createRouter({
      agentEvents,
      session: new ScriptedSession([
        { type: "text", content: "partial", sdkSessionId: "sdk-1" },
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
    })

    await router.send(baseMessage("hello"))

    expect(await agentEvents.list()).toEqual([
      expect.objectContaining({ eventType: "text" }),
      expect.objectContaining({ eventType: "result" }),
    ])
  })

  it("uses SDK assistant text as the canonical turn result over result content", async () => {
    const { conversations, router } = createRouter({
      session: new ScriptedSession([
        {
          type: "assistant",
          contentBlocks: [{ type: "text", text: "你好！有什么可以帮助你的吗？" }],
          message: {
            role: "assistant",
            content: [{ type: "text", text: "你好！有什么可以帮助你的吗？" }],
          },
          sdkSessionId: "sdk-1",
        },
        {
          type: "result",
          content: "你好可以你的?",
          done: true,
          metadata: { model: "claude-sonnet-4-5" },
          sdkSessionId: "sdk-1",
        },
      ], "sdk-1"),
    })

    const result = await router.send(baseMessage("你好"))
    const savedConversation = await conversations.get(result.conversationId)

    expect(result.resultText).toBe("你好！有什么可以帮助你的吗？")
    expect(savedConversation?.history.filter((entry) => entry.role === "assistant")).toEqual([
      expect.objectContaining({ content: "你好！有什么可以帮助你的吗？" }),
    ])
  })

  it("falls back to SDK result content when no assistant message was emitted", async () => {
    const { conversations, router } = createRouter({
      session: new ScriptedSession([
        {
          type: "result",
          content: "fallback answer",
          done: true,
          sdkSessionId: "sdk-1",
        },
      ], "sdk-1"),
    })

    const result = await router.send(baseMessage("hello"))
    const savedConversation = await conversations.get(result.conversationId)

    expect(result.resultText).toBe("fallback answer")
    expect(savedConversation?.history.filter((entry) => entry.role === "assistant")).toEqual([
      expect.objectContaining({ content: "fallback answer" }),
    ])
  })

  it("closes the SDK session when a side session times out", async () => {
    const session = new TimeoutSession()
    const { router } = createRouter({ session })

    const result = await router.sendSideSessionWithTimeout(baseMessage("relay"), "Relay", 1)

    expect(result.timedOut).toBe(true)
    expect(session.closed).toBe(true)
  })

  it("does not create an SDK session for a queued turn that already aborted", async () => {
    const first = new ControlledSession("sdk-1")
    const second = new ControlledSession("sdk-2")
    const { router, factoryCalls } = createRouter({ sessions: [first, second] })

    const firstTurn = router.send(baseMessage("first"))
    await waitFor(() => first.sent.includes("first"))

    const abortController = new AbortController()
    const secondTurn = router.send(baseMessage("second"), { abortSignal: abortController.signal })
    abortController.abort("timeout")

    first.emitResult("done")

    await expect(firstTurn).resolves.toMatchObject({ resultText: "done" })
    await expect(secondTurn).resolves.toMatchObject({ error: "cancelled" })
    expect(factoryCalls).toHaveLength(1)
    expect(second.sent).toEqual([])
  })

  it("keeps persisted tool metadata and event payloads bounded and sanitized", async () => {
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const raw = {
      command: "pwd",
      secret: "sk-secret",
      large: "x".repeat(50_000),
    }
    const { conversations, router } = createRouter({
      agentEvents,
      session: new ScriptedSession([
        {
          type: "toolUse",
          toolName: "Bash",
          toolInput: "pwd",
          toolInputRaw: raw,
          sdkSessionId: "sdk-1",
        },
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
    })

    const result = await router.send(baseMessage("hello"))
    const saved = await conversations.get(result.conversationId)
    const toolEntry = saved?.history.find((entry) => entry.role === "tool")
    const persisted = await agentEvents.list()

    expect(toolEntry?.metadata).toEqual(expect.not.objectContaining({
      toolInputRaw: expect.anything(),
    }))
    expect(JSON.stringify(persisted[0]?.payload)).not.toContain("sk-secret")
    expect(JSON.stringify(persisted[0]?.payload).length).toBeLessThan(12_000)
  })
})

function createRouter(input: {
  readonly conversations?: MemoryNamespace<ConversationEntryV1>
  readonly agentEvents?: MemoryNamespace<AgentEventEntryV1>
  readonly activeProviderId?: string
  readonly env?: Record<string, string>
  readonly session?: AgentLiveSession
  readonly sessions?: readonly AgentLiveSession[]
  readonly message?: AgentLiveSession
  readonly governance?: AgentGovernanceService
  readonly commandRouter?: AgentCommandRouter
} = {}) {
  const conversations = input.conversations ?? new MemoryNamespace<ConversationEntryV1>("conversations")
  const providerService = new FakeProviderService(input.activeProviderId ?? "anthropic", input.env ?? {})
  const repository = new AgentSessionRepository({
    projectId: "project-1",
    conversations,
    now: fixedNow,
  })
  const states = new Map()
  const pendingPermissions = new Map()
  const factoryCalls: Array<{
    readonly conversationId: string
    readonly providerId: string
    readonly sdkSessionId?: string
    readonly env: Record<string, string>
  }> = []
  const sessions = [...input.sessions ?? []]
  const sessionManager = new SessionManager({
    projectId: "project-1",
    workDir: "/repo",
    repository,
    providerService: providerService as unknown as ProviderService,
    states,
    pendingPermissions,
    now: fixedNow,
    createSession: (options) => {
      factoryCalls.push({
        conversationId: options.conversation.id,
        providerId: options.providerId,
        sdkSessionId: options.sdkSessionId,
        env: options.env,
      })
      return sessions.shift() ?? input.session ?? input.message ?? new ScriptedSession([
        { type: "result", content: "done", done: true },
      ])
    },
  })
  const router = new ConversationRouter({
    deps: {
      projectId: "project-1",
      workDir: "/repo",
      governance: input.governance,
      agentEvents: input.agentEvents,
      now: fixedNow,
    },
    repository,
    sessionManager,
    commandRouter: input.commandRouter,
    pendingPermissions,
  })

  return { conversations, router, providerService, factoryCalls }
}

function conversation(patch: Partial<ConversationEntryV1> = {}): ConversationEntryV1 {
  return {
    id: conversationId("local", "s1", "active"),
    schemaVersion: 1,
    projectId: "project-1",
    sessionKey: "s1",
    platform: "local",
    history: [],
    active: true,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
    ...patch,
  }
}

function baseMessage(content: string): AgentMessage {
  return {
    projectId: "project-1",
    sessionKey: "s1",
    platform: "local",
    userId: "user-1",
    content,
  }
}

function fixedNow(): Date {
  return new Date("2026-04-26T00:00:00.000Z")
}

class FakeProviderService {
  readonly buildEnvCalls: Array<{
    readonly providerId: string
    readonly projectId?: string
    readonly actorId?: string
  }> = []

  constructor(
    private readonly activeProviderId: string,
    private readonly env: Record<string, string>,
  ) {}

  async getActiveProvider(): Promise<{ id: string }> {
    return { id: this.activeProviderId }
  }

  async buildEnv(
    providerId: string,
    context?: { readonly projectId?: string; readonly actor?: { readonly id?: string } },
  ): Promise<Record<string, string>> {
    this.buildEnvCalls.push({
      providerId,
      projectId: context?.projectId,
      actorId: context?.actor?.id,
    })
    return this.env
  }
}

class ScriptedSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  readonly sent: string[] = []
  private readonly events: AgentEvent[]
  private closed = false

  constructor(events: readonly AgentEvent[], private readonly sessionId?: string) {
    this.events = [...events]
  }

  async send(message: AgentMessage): Promise<void> {
    this.sent.push(message.content)
  }

  async respondPermission(
    _requestId: string,
    _decision: AgentPermissionDecision,
  ): Promise<void> {}

  async nextEvent(): Promise<AgentEvent | null> {
    return this.events.shift() ?? null
  }

  currentSessionId(): string | undefined {
    return this.sessionId
  }

  alive(): boolean {
    return !this.closed && this.events.length > 0
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

class TimeoutSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  closed = false

  async send(): Promise<void> {}
  async respondPermission(): Promise<void> {}

  nextEvent(): Promise<AgentEvent | null> {
    if (this.closed) return Promise.resolve(null)
    return new Promise(() => {})
  }

  currentSessionId(): string | undefined {
    return "timeout-sdk"
  }

  alive(): boolean {
    return !this.closed
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

class ControlledSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  readonly sent: string[] = []
  private readonly events: AgentEvent[] = []
  private readonly waiters: Array<(event: AgentEvent | null) => void> = []
  private closed = false

  constructor(private readonly sessionId: string) {}

  async send(message: AgentMessage): Promise<void> {
    this.sent.push(message.content)
  }

  async respondPermission(): Promise<void> {}

  nextEvent(): Promise<AgentEvent | null> {
    const event = this.events.shift()
    if (event) return Promise.resolve(event)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }

  currentSessionId(): string | undefined {
    return this.sessionId
  }

  alive(): boolean {
    return !this.closed
  }

  async close(): Promise<void> {
    this.closed = true
    for (const waiter of this.waiters) waiter(null)
    this.waiters.length = 0
  }

  emitResult(content: string): void {
    this.push({ type: "result", content, done: true, sdkSessionId: this.sessionId })
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

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  readonly name: string
  private readonly values = new Map<string, T>()
  private readonly listeners: DataChangeListener<T>[] = []

  constructor(name: string) {
    this.name = name
  }

  async getSingleton(): Promise<T | null> { return null }
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

  async upsert(item: T): Promise<void> {
    const previous = this.values.get(item.id)
    this.values.set(item.id, item)
    this.emit({ namespace: this.name, kind: "upsert", id: item.id, value: item, previous, timestamp: fixedNow().toISOString() })
  }

  async remove(id: string): Promise<void> {
    const previous = this.values.get(id)
    this.values.delete(id)
    this.emit({ namespace: this.name, kind: "remove", id, previous, timestamp: fixedNow().toISOString() })
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for condition")
}
