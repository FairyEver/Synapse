import { describe, expect, it } from "vitest"

import type {
  AgentCompressStateEntryV1,
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import type { ProviderService } from "../../provider"
import { AgentRuntimeService, conversationId } from "../agent-runtime-service"
import type {
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
} from "../types"

describe("AgentRuntimeService", () => {
  it("routes sends through SDK sessions and persists the sdk session id", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new ScriptedSession([
      { type: "text", content: "hello" },
      {
        type: "result",
        content: "done",
        done: true,
        sdkSessionId: "sdk-1",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        costUsd: 0.12,
      },
    ], "sdk-1")
    const factoryCalls: Array<{ providerId: string; env: Record<string, string> }> = []
    const providerService = new FakeProviderService("anthropic", { ANTHROPIC_API_KEY: "sk-test" })
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: providerService as unknown as ProviderService,
      createSession: (input) => {
        factoryCalls.push({ providerId: input.providerId, env: input.env })
        return session
      },
      now: fixedNow,
    })

    const result = await service.send(baseMessage("hello"))

    expect(result).toEqual(expect.objectContaining({
      conversationId: conversationId("local", "s1", "active"),
      resultText: "done",
      agentSessionId: "sdk-1",
      threadId: "sdk-1",
    }))
    expect(factoryCalls).toEqual([
      { providerId: "anthropic", env: { ANTHROPIC_API_KEY: "sk-test" } },
    ])
    await expect(conversations.get(result.conversationId)).resolves.toMatchObject({
      providerId: "anthropic",
      sdkSessionId: "sdk-1",
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      costUsd: 0.12,
      history: [
        expect.objectContaining({ role: "user", content: "hello" }),
        expect.objectContaining({ role: "assistant", content: "done" }),
      ],
    })
  })

  it("cancelTurn interrupts before forceKillTurn hard closes the session", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new HangingSession()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("wait"))
    await waitFor(() => session.sent.length === 1)
    const id = conversationId("local", "s1", "active")

    await expect(service.cancelTurn(id)).resolves.toEqual({ status: "graceful-pending" })
    expect(session.calls).toEqual(["interrupt"])

    await expect(service.forceKillTurn(id)).resolves.toEqual({ status: "hard-killed" })
    expect(session.calls).toEqual(["interrupt", "close"])
    await expect(turn).resolves.toMatchObject({ error: "cancelled" })
  })
})

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
  readonly buildEnvCalls: string[] = []

  constructor(
    private readonly activeProviderId: string,
    private readonly env: Record<string, string>,
  ) {}

  async getActiveProvider(): Promise<{ id: string }> {
    return { id: this.activeProviderId }
  }

  async buildEnv(providerId: string): Promise<Record<string, string>> {
    this.buildEnvCalls.push(providerId)
    return this.env
  }
}

class ScriptedSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  private readonly events: AgentEvent[]
  private closed = false

  constructor(events: readonly AgentEvent[], private readonly sessionId?: string) {
    this.events = [...events]
  }

  async send(): Promise<void> {}
  async respondPermission(): Promise<void> {}

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

class HangingSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  readonly sent: string[] = []
  readonly calls: string[] = []
  private waiter: ((event: AgentEvent | null) => void) | undefined
  private closed = false

  async send(message: AgentMessage): Promise<void> {
    this.sent.push(message.content)
  }

  async respondPermission(
    _requestId: string,
    _decision: AgentPermissionDecision,
  ): Promise<void> {}

  nextEvent(): Promise<AgentEvent | null> {
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.waiter = resolve
    })
  }

  currentSessionId(): string | undefined {
    return "sdk-1"
  }

  alive(): boolean {
    return !this.closed
  }

  async cancelCurrentTurn(): Promise<boolean> {
    this.calls.push("interrupt")
    return true
  }

  async close(): Promise<void> {
    this.calls.push("close")
    this.closed = true
    this.waiter?.(null)
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
