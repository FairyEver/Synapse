import { describe, expect, it, vi } from "vitest"

import type {
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import type { ProviderService } from "../../provider"
import { AGENT_CANCELLED_MESSAGE } from "../agent-error-messages"
import { AgentRuntimeService, conversationId } from "../agent-runtime-service"
import type { RuntimeSessionState } from "../session-lifecycle"
import type { TurnLifecycle } from "../turn-outcome"
import type {
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
} from "../types"

describe("AgentRuntimeService cancelTurn", () => {
  it("returns no-active-turn when conversation has no busy state", async () => {
    const service = createService(new NeverResolveSession())
    const result = await service.cancelTurn("nonexistent")
    expect(result).toEqual({ status: "no-active-turn" })
  })

  it("hard-kills a live session that does not support graceful cancel", async () => {
    const session = new CancellableLiveSession({ graceful: false })
    const factory = new CancellableSessionFactory(session)
    const service = createService(factory)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const cancel = await service.cancelTurn(
      conversationId("local", "s1", "active"),
    )
    expect(cancel).toEqual({ status: "hard-killed" })
    expect(session.closed).toBe(true)

    const result = await sendPromise
    expect(result.error).toBe(AGENT_CANCELLED_MESSAGE)
  })

  it("returns graceful-pending for a session that supports cancel", async () => {
    const session = new CancellableLiveSession({ graceful: true })
    const factory = new CancellableSessionFactory(session)
    const service = createService(factory)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const cancel = await service.cancelTurn(
      conversationId("local", "s1", "active"),
    )
    expect(cancel).toEqual({ status: "graceful-pending" })
    expect(session.cancelCalled).toBe(true)
    expect(session.closed).toBe(false)

    session.emitResult("stopped")
    const result = await sendPromise
    expect(result.resultText).toBe("stopped")
  })

  it("records graceful cancel intent on the active lifecycle before interrupting", async () => {
    const session = new CancellableLiveSession({ graceful: true })
    const factory = new CancellableSessionFactory(session)
    const service = createService(factory)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const convId = conversationId("local", "s1", "active")
    const state = runtimeState(service, convId)
    expect(state.activeLifecycle?.cancelIntent).toBeUndefined()

    await service.cancelTurn(convId)

    expect(state.activeLifecycle?.cancelIntent).toMatchObject({
      mode: "graceful",
      source: "user",
    })
    expect(state.activeLifecycle?.state).toBe("cancelling")

    session.emitResult("stopped")
    await sendPromise
  })

  it("upgrades lifecycle cancel intent when force killing", async () => {
    const session = new CancellableLiveSession({ graceful: true })
    const factory = new CancellableSessionFactory(session)
    const service = createService(factory)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const convId = conversationId("local", "s1", "active")
    let cancelIntentAtClose: TurnLifecycle["cancelIntent"] | undefined
    session.onClose = () => {
      cancelIntentAtClose = runtimeState(service, convId).activeLifecycle?.cancelIntent
    }

    await service.cancelTurn(convId)
    await service.forceKillTurn(convId)

    expect(cancelIntentAtClose).toMatchObject({
      mode: "force",
      source: "user",
    })

    await sendPromise
  })

  it("normalizes SDK abort error after graceful cancel to cancelled result", async () => {
    const session = new CancellableLiveSession({ graceful: true })
    session.cancelCurrentTurn = async () => {
      session.cancelCalled = true
      session.emitError("Agent 执行失败。诊断信息：Request was aborted")
      return true
    }
    const factory = new CancellableSessionFactory(session)
    const service = createService(factory)

    const turn = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const convId = conversationId("local", "s1", "active")
    await service.cancelTurn(convId)

    const result = await turn
    expect(result.error).toBe("已停止本次执行。")
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "result",
      metadata: expect.objectContaining({
        cancelled: true,
        turnOutcome: expect.objectContaining({
          status: "cancelled",
          mode: "graceful",
          reason: "user_cancelled",
        }),
      }),
    }))
    expect(JSON.stringify(result.events)).not.toContain("Agent 执行失败")
    const conversation = await service.getSession(convId)
    expect(conversation?.history.at(-1)).toMatchObject({
      role: "assistant",
      content: "",
      metadata: {
        agentEventType: "result",
        turnOutcome: {
          status: "cancelled",
          mode: "graceful",
          reason: "user_cancelled",
        },
      },
    })
  })

  it("is idempotent — second cancelTurn returns current state", async () => {
    const session = new CancellableLiveSession({ graceful: false })
    const factory = new CancellableSessionFactory(session)
    const service = createService(factory)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const convId = conversationId("local", "s1", "active")
    await service.cancelTurn(convId)
    const second = await service.cancelTurn(convId)
    expect(second.status).toBe("hard-killed")

    await sendPromise
  })

  it("forceKillTurn closes live session after graceful pending", async () => {
    const session = new CancellableLiveSession({ graceful: true })
    const factory = new CancellableSessionFactory(session)
    const service = createService(factory)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const convId = conversationId("local", "s1", "active")
    await service.cancelTurn(convId)
    expect(session.closed).toBe(false)

    const force = await service.forceKillTurn(convId)
    expect(force).toEqual({ status: "hard-killed" })
    expect(session.closed).toBe(true)

    await sendPromise
  })

  it("logs cancel and force-kill outcomes with SDK session correlation", async () => {
    const session = new CancellableLiveSession({ graceful: true })
    const factory = new CancellableSessionFactory(session)
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
    const service = createService(factory, logger)

    const sendPromise = service.send(baseMessage("hello token=sk-test"))
    await waitForBusy(service, "hello")

    const convId = conversationId("local", "s1", "active")
    await service.cancelTurn(convId)
    await service.forceKillTurn(convId)
    await sendPromise

    expect(logger.info).toHaveBeenCalledWith("Agent turn cancellation updated.", {
      boundary: "agent-runtime.turn.cancel",
      projectId: "project-1",
      conversationId: convId,
      providerId: "anthropic",
      mode: undefined,
      sdkSessionId: "test-session-1",
      status: "graceful-pending",
      busy: true,
      activeTurns: 1,
      queuedTurns: 0,
      hadLiveSession: true,
      hadTurnAbortController: true,
      hadCancelState: true,
      gracefulSent: true,
    })
    expect(logger.info).toHaveBeenCalledWith("Agent turn cancellation updated.", {
      boundary: "agent-runtime.turn.force-kill",
      projectId: "project-1",
      conversationId: convId,
      providerId: "anthropic",
      mode: undefined,
      sdkSessionId: "test-session-1",
      status: "hard-killed",
      busy: true,
      activeTurns: 1,
      queuedTurns: 0,
      hadLiveSession: true,
      hadTurnAbortController: true,
      hadCancelState: false,
    })
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("token=sk-test")
  })

  it("forceKillTurn preserves queued turns after closing the active session", async () => {
    const session = new CancellableLiveSession({ graceful: true })
    const factory = new CancellableSessionFactory(session)
    const service = createService(factory)

    const firstTurn = service.send(baseMessage("first"))
    await waitForBusy(service, "first")
    const secondTurn = service.send(baseMessage("second"))
    await waitForQueued(service)

    const convId = conversationId("local", "s1", "active")
    await service.cancelTurn(convId)

    const force = await service.forceKillTurn(convId)
    expect(force).toEqual({ status: "hard-killed" })
    expect(session.closed).toBe(true)

    const firstResult = await firstTurn
    expect(firstResult.error).toBe(AGENT_CANCELLED_MESSAGE)

    const nextSession = await waitForNewSession(factory, session)
    nextSession.emitResult("done-2")

    const secondResult = await secondTurn
    expect(secondResult.resultText).toBe("done-2")
    expect(secondResult.error).toBeUndefined()
  })

  it("queue continues after cancel — next turn executes", async () => {
    const session = new CancellableLiveSession({ graceful: false })
    const factory = new CancellableSessionFactory(session)
    const service = createService(factory)

    const send1 = service.send(baseMessage("first"))
    await waitForBusy(service, "first")
    const send2 = service.send(baseMessage("second"))

    const convId = conversationId("local", "s1", "active")
    await service.cancelTurn(convId)

    const r1 = await send1
    expect(r1.error).toBe(AGENT_CANCELLED_MESSAGE)

    const session2 = await waitForNewSession(factory, session)
    session2.emitResult("done-2")

    const r2 = await send2
    expect(r2.resultText).toBe("done-2")
  })
})

// ─── Test helpers ─────────────────────────────────────────────────────────────

function fixedNow(): Date {
  return new Date("2026-05-10T00:00:00.000Z")
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

function createService(
  factory: CancellableSessionFactory | AgentLiveSession,
  logger?: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> },
): AgentRuntimeService {
  const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
  return new AgentRuntimeService({
    projectId: "project-1",
    workDir: "/repo",
    conversations,
    providerService: new FakeProviderService() as unknown as ProviderService,
    createSession: () => factory instanceof CancellableSessionFactory ? factory.create() : factory,
    now: fixedNow,
    logger: logger as never,
  })
}

async function waitForNewSession(
  factory: CancellableSessionFactory,
  oldSession: CancellableLiveSession,
): Promise<CancellableLiveSession> {
  for (let i = 0; i < 100; i++) {
    if (factory.lastCreatedSession && factory.lastCreatedSession !== oldSession) {
      return factory.lastCreatedSession
    }
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error("Timed out waiting for new session")
}

async function waitForBusy(service: AgentRuntimeService, _hint: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const status = service.getStatus()
    if (status.busySessions > 0) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error("Timed out waiting for busy state")
}

async function waitForQueued(service: AgentRuntimeService): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (service.getStatus().queuedTurns > 0) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error("Timed out waiting for queued turn")
}

function runtimeState(service: AgentRuntimeService, conversationIdValue: string): RuntimeSessionState {
  const states = (service as unknown as { readonly states: Map<string, RuntimeSessionState> }).states
  const state = states.get(conversationIdValue)
  if (!state) throw new Error(`Missing runtime state for ${conversationIdValue}`)
  return state
}

class CancellableLiveSession implements AgentLiveSession {
  readonly agentType = "claude-code"
  closed = false
  cancelCalled = false
  cancelCurrentTurn?: () => Promise<boolean>
  onClose?: () => void
  private readonly queue: Array<(v: AgentEvent | null) => void> = []
  private readonly events: AgentEvent[] = []

  constructor(opts: { graceful: boolean }) {
    if (opts.graceful) {
      this.cancelCurrentTurn = async (): Promise<boolean> => {
        this.cancelCalled = true
        return true
      }
    }
  }

  async send(): Promise<boolean> {
    return true
  }

  async respondPermission(): Promise<void> {}

  nextEvent(): Promise<AgentEvent | null> {
    const buffered = this.events.shift()
    if (buffered) return Promise.resolve(buffered)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.queue.push(resolve)
    })
  }

  currentSessionId(): string | undefined {
    return "test-session-1"
  }

  alive(): boolean {
    return !this.closed
  }

  async close(): Promise<void> {
    this.closed = true
    this.onClose?.()
    for (const waiter of this.queue) waiter(null)
    this.queue.length = 0
  }

  emitResult(text: string): void {
    const event: AgentEvent = {
      type: "result",
      content: text,
      done: true,
      agentSessionId: "test-session-1",
      threadId: "test-session-1",
    }
    const waiter = this.queue.shift()
    if (waiter) {
      waiter(event)
    } else {
      this.events.push(event)
    }
  }

  emitError(message: string): void {
    const event: AgentEvent = {
      type: "error",
      message,
      conversationId: "conversation-a",
      providerId: "anthropic",
      timestamp: "2026-05-10T00:00:00.000Z",
    }
    const waiter = this.queue.shift()
    if (waiter) {
      waiter(event)
    } else {
      this.events.push(event)
    }
  }
}

class CancellableSessionFactory {
  lastCreatedSession: CancellableLiveSession | undefined
  private readonly initialSession: CancellableLiveSession

  constructor(session: CancellableLiveSession) {
    this.initialSession = session
  }

  create(): AgentLiveSession {
    if (!this.lastCreatedSession || this.initialSession.closed) {
      this.lastCreatedSession = this.initialSession.closed
        ? new CancellableLiveSession({ graceful: false })
        : this.initialSession
    }
    return this.lastCreatedSession
  }
}

class NeverResolveSession extends CancellableLiveSession {
  constructor() {
    super({ graceful: false })
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
    return values.filter((v) =>
      Object.entries(filter).every(([k, e]) =>
        (v as Record<string, unknown>)[k] === e,
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
    this.emit({ namespace: this.name, kind: "upsert", id: item.id, value: item, previous, timestamp: new Date().toISOString() })
  }

  async remove(id: string): Promise<void> {
    const previous = this.values.get(id)
    this.values.delete(id)
    this.emit({ namespace: this.name, kind: "remove", id, previous, timestamp: new Date().toISOString() })
  }

  onChange(listener: DataChangeListener<T>): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  private emit(event: DataChangeEvent<T>): void {
    for (const l of this.listeners) l(event)
  }
}
