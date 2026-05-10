import { describe, expect, it, vi } from "vitest"

import type {
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import type { ScopedEventBus } from "../../../runtime/project-container"
import { AgentRuntimeService, conversationId } from "../agent-runtime-service"
import type {
  AgentAdapter,
  AgentEvent,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
} from "../types"

describe("AgentRuntimeService cancelTurn", () => {
  it("returns no-active-turn when conversation has no busy state", async () => {
    const service = createService(new NeverResolveAdapter())
    const result = await service.cancelTurn("nonexistent")
    expect(result).toEqual({ status: "no-active-turn" })
  })

  it("hard-kills a live session that does not support graceful cancel", async () => {
    const session = new CancellableLiveSession({ graceful: false })
    const adapter = new CancellableLiveAdapter(session)
    const service = createService(adapter)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const cancel = await service.cancelTurn(
      conversationId("local", "s1", "active"),
    )
    expect(cancel).toEqual({ status: "hard-killed" })
    expect(session.closed).toBe(true)

    const result = await sendPromise
    expect(result.error).toBe("cancelled")
  })

  it("returns graceful-pending for a session that supports cancel", async () => {
    const session = new CancellableLiveSession({ graceful: true })
    const adapter = new CancellableLiveAdapter(session)
    const service = createService(adapter)

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

  it("is idempotent — second cancelTurn returns current state", async () => {
    const session = new CancellableLiveSession({ graceful: false })
    const adapter = new CancellableLiveAdapter(session)
    const service = createService(adapter)

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
    const adapter = new CancellableLiveAdapter(session)
    const service = createService(adapter)

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

  it("cancel during exec mode aborts via AbortController", async () => {
    const adapter = new SlowExecAdapter()
    const service = createService(adapter)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const convId = conversationId("local", "s1", "active")
    const cancel = await service.cancelTurn(convId)
    expect(cancel).toEqual({ status: "hard-killed" })

    adapter.resolveExec()
    const result = await sendPromise
    expect(result.error).toBe("cancelled")
  })

  it("queue continues after cancel — next turn executes", async () => {
    const session = new CancellableLiveSession({ graceful: false })
    const adapter = new CancellableLiveAdapter(session)
    const service = createService(adapter)

    const send1 = service.send(baseMessage("first"))
    await waitForBusy(service, "first")
    const send2 = service.send(baseMessage("second"))

    const convId = conversationId("local", "s1", "active")
    await service.cancelTurn(convId)

    const r1 = await send1
    expect(r1.error).toBe("cancelled")

    const session2 = await waitForNewSession(adapter, session)
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

function createService(adapter: AgentAdapter): AgentRuntimeService {
  const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
  return new AgentRuntimeService({
    projectId: "project-1",
    workDir: "/repo",
    conversations,
    adapter,
    now: fixedNow,
  })
}

async function waitForNewSession(
  adapter: CancellableLiveAdapter,
  oldSession: CancellableLiveSession,
): Promise<CancellableLiveSession> {
  for (let i = 0; i < 100; i++) {
    if (adapter.lastCreatedSession && adapter.lastCreatedSession !== oldSession) {
      return adapter.lastCreatedSession
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

class CancellableLiveSession implements AgentLiveSession {
  readonly agentType = "claude-code"
  closed = false
  cancelCalled = false
  cancelCurrentTurn?: () => Promise<boolean>
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

  async send(): Promise<void> {}

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
}

class CancellableLiveAdapter implements AgentAdapter {
  readonly agentType = "claude-code"
  lastCreatedSession: CancellableLiveSession | undefined
  private readonly initialSession: CancellableLiveSession

  constructor(session: CancellableLiveSession) {
    this.initialSession = session
  }

  async execute(): Promise<AgentExecutionResult> {
    throw new Error("not used")
  }

  async startSession(): Promise<AgentLiveSession> {
    if (!this.lastCreatedSession || this.initialSession.closed) {
      this.lastCreatedSession = this.initialSession.closed
        ? new CancellableLiveSession({ graceful: false })
        : this.initialSession
    }
    return this.lastCreatedSession
  }
}

class SlowExecAdapter implements AgentAdapter {
  readonly agentType = "hermes"
  private execResolve?: (result: AgentExecutionResult) => void

  async execute(
    _message: AgentMessage,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    return new Promise<AgentExecutionResult>((resolve, reject) => {
      this.execResolve = resolve
      context.abortSignal?.addEventListener("abort", () => {
        reject(new Error("aborted"))
      }, { once: true })
    })
  }

  resolveExec(): void {
    this.execResolve?.({
      events: [],
      resultText: "late-result",
    })
  }
}

class NeverResolveAdapter implements AgentAdapter {
  readonly agentType = "hermes"

  async execute(): Promise<AgentExecutionResult> {
    return new Promise(() => {})
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
