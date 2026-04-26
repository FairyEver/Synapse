import { describe, expect, it, vi } from "vitest"

import type {
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
  OutboxEntryV1,
  ProviderEntryV1,
  SecretEntryV1,
} from "../../../runtime/data-repo"
import {
  createControlledProcessRunner,
  type ControlledProcessResult,
  type ControlledProcessRunRequest,
} from "../../../runtime/process"
import { InMemoryAuditSink, createPermissionGuard } from "../../../runtime/security"
import { CodexExecAdapter, type CodexProcessRunner } from "../adapters/codex-exec"
import { AgentRuntimeService, conversationId } from "../agent-runtime-service"
import { ProviderConfigService } from "../../provider-config"
import { ReplyOutboxService, type ReplyTarget } from "../../reply-target"
import type {
  AgentAdapter,
  AgentEvent,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
} from "../types"

describe("AgentRuntimeService", () => {
  it("sends a prompt through Codex exec JSONL and persists the thread id", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const outboxService = new ReplyOutboxService({
      projectId: "project-1",
      outbox,
      now: fixedNow,
    })
    const lines = [
      { type: "thread.started", thread_id: "thread-1" },
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          content: [{ type: "output_text", text: "done" }],
        },
      },
      { type: "turn.completed" },
    ].map((line) => JSON.stringify(line))
    const runner = new FakeRunner(lines)
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new CodexExecAdapter(runner),
      outbox: outboxService,
      now: fixedNow,
    })

    const result = await service.send({
      projectId: "project-1",
      sessionKey: "local:user-1",
      platform: "local",
      userId: "user-1",
      userName: "User One",
      content: "hello\nworld",
    })

    expect(result.resultText).toBe("done")
    expect(result.threadId).toBe("thread-1")
    expect(runner.requests).toHaveLength(1)
    expect(runner.requests[0]).toEqual(
      expect.objectContaining({
        action: "agent.spawn",
        command: "codex",
        cwd: "/repo",
        stdin: "hello\nworld",
      }),
    )
    expect(runner.requests[0]?.args).toEqual([
      "exec",
      "--skip-git-repo-check",
      "--json",
      "--cd",
      "/repo",
      "-",
    ])

    const saved = await conversations.get(conversationId("local", "local:user-1", "active"))
    expect(saved).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        sessionKey: "local:user-1",
        platform: "local",
        agentType: "codex",
        agentSessionId: "thread-1",
        userMeta: expect.objectContaining({
          userId: "user-1",
          userName: "User One",
          platform: "local",
        }),
      }),
    )
    expect(saved?.history).toEqual([
      expect.objectContaining({ role: "user", content: "hello\nworld" }),
      expect.objectContaining({ role: "assistant", content: "done" }),
    ])
    await outboxService.flushForTests()
    expect(await outbox.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        projectId: "project-1",
        destination: expect.objectContaining({
          platform: "local",
          sessionKey: "local:user-1",
        }),
        payload: expect.objectContaining({
          content: "done",
        }),
        status: "sent",
      }),
    ]))
  })

  it("uses saved thread id for resume turns", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    await conversations.upsert({
      id: conversationId("local", "s1"),
      schemaVersion: 1,
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      agentType: "codex",
      agentSessionId: "thread-1",
      history: [],
      active: true,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    })
    const runner = new FakeRunner([
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", content: [{ type: "output_text", text: "again" }] },
      }),
      JSON.stringify({ type: "turn.completed" }),
    ])
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new CodexExecAdapter(runner),
      now: fixedNow,
    })

    await service.send({
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      content: "next",
    })

    expect(runner.requests[0]?.args).toEqual([
      "exec",
      "resume",
      "--skip-git-repo-check",
      "thread-1",
      "--json",
      "-",
    ])
  })

  it("remembers bridge reply targets, dispatches agent events, and injects side-channel env", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const outbox = new MemoryNamespace<OutboxEntryV1>("outbox")
    const outboxService = new ReplyOutboxService({ projectId: "project-1", outbox })
    const replyTargets = new FakeReplyTargets()
    const runner = new FakeRunner([
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", content: [{ type: "output_text", text: "done" }] },
      }),
      JSON.stringify({ type: "turn.completed" }),
    ])
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new CodexExecAdapter(runner),
      outbox: outboxService,
      replyTargets,
    })

    await service.send({
      projectId: "project-1",
      sessionKey: "bridge:s1",
      platform: "bridge",
      content: "hello",
      replyCtx: {
        kind: "bridge",
        platform: "bridge",
        replyCtx: "ctx-1",
      },
    })
    await outboxService.flushForTests()

    expect(replyTargets.remembered[0]).toEqual(expect.objectContaining({
      transport: { kind: "bridge", connectorId: "bridge" },
      replyCtx: expect.objectContaining({ replyCtx: "ctx-1" }),
    }))
    expect(replyTargets.dispatched.map((item) => item.event.type)).toEqual(["text", "result"])
    expect(runner.requests[0]).toEqual(expect.objectContaining({
      env: expect.objectContaining({
        CC_PROJECT: "project-1",
        CC_SESSION_KEY: "bridge:s1",
      }),
      envAllowlist: expect.arrayContaining(["CC_PROJECT", "CC_SESSION_KEY"]),
    }))
    expect(await outbox.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        destination: expect.objectContaining({
          platform: "bridge",
          connectorId: "bridge",
          sessionKey: "bridge:s1",
        }),
      }),
    ]))
  })

  it("handles /model before the adapter and clears the current agent session id", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const providerConfig = new ProviderConfigService({ providers, secrets, now: fixedNow })
    await providerConfig.upsertGlobalProvider({
      id: "openai",
      model: "gpt-5.4",
      models: [
        { id: "gpt-5.4" },
        { id: "gpt-5.3-codex", alias: "fast" },
      ],
      agentTypes: ["codex"],
    })
    await providerConfig.setProjectProviderRefs("project-1", ["openai"])
    await providerConfig.setActiveProvider("project-1", "openai")
    await conversations.upsert({
      id: conversationId("local", "s1", "active"),
      schemaVersion: 1,
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      agentType: "codex",
      agentSessionId: "thread-1",
      history: [],
      active: true,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    })
    const adapter = new BlockingAdapter()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      agentType: "codex",
      providerConfig,
      now: fixedNow,
    })

    const result = await service.send(baseMessage("/model switch fast"))

    expect(result.resultText).toBe("Model changed: gpt-5.3-codex")
    expect(adapter.started).toEqual([])
    expect((await conversations.get(conversationId("local", "s1", "active")))).toEqual(
      expect.objectContaining({
        agentSessionId: undefined,
        pastAgentSessionIds: ["thread-1"],
      }),
    )
    expect((await providerConfig.getProjectProviderState("project-1", "codex")).activeModel)
      .toBe("gpt-5.3-codex")
  })

  it("handles /new and unknown slash commands without sending them to the adapter", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const providerConfig = new ProviderConfigService({ providers, secrets, now: fixedNow })
    await conversations.upsert({
      id: conversationId("local", "s1", "active"),
      schemaVersion: 1,
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      agentType: "codex",
      agentSessionId: "thread-1",
      history: [],
      active: true,
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    })
    const adapter = new BlockingAdapter()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      agentType: "codex",
      providerConfig,
      now: fixedNow,
    })

    const next = await service.send(baseMessage("/new"))
    const unknown = await service.send(baseMessage("/not-real"))

    expect(next.resultText).toBe("New session will start on the next message.")
    expect(unknown.error).toBe("Unsupported command: /not-real")
    expect(adapter.started).toEqual([])
    expect((await conversations.get(conversationId("local", "s1", "active")))?.agentSessionId)
      .toBeUndefined()
  })

  it("does not spawn when permission is denied and records audit", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const guard = createPermissionGuard()
    guard.registerPolicy({
      id: "deny-agent-spawn",
      decide: (request) => request.action === "agent.spawn" ? "deny" : "defer-to-next",
    })
    const auditSink = new InMemoryAuditSink()
    const spawnImpl = vi.fn()
    const runner = createControlledProcessRunner({
      permissionGuard: guard,
      auditSink,
      spawnImpl,
    })
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new CodexExecAdapter(runner),
      now: fixedNow,
    })

    const result = await service.send({
      projectId: "project-1",
      sessionKey: "local:user-1",
      platform: "local",
      content: "hello",
    })

    expect(spawnImpl).not.toHaveBeenCalled()
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "error",
        message: "denied by deny-agent-spawn",
      }),
    ])
    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "agent.spawn",
        outcome: "denied",
        resource: "codex",
      }),
    ])
  })

  it("serializes same-session turns and drains queued messages in order", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const adapter = new BlockingAdapter()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      now: fixedNow,
    })

    const first = service.send(baseMessage("one"))
    await waitFor(() => adapter.started.length === 1)
    const second = service.send(baseMessage("two"))

    expect(adapter.started).toEqual(["one"])
    adapter.resolveNext("first done", "thread-1")
    expect((await first).resultText).toBe("first done")

    await waitFor(() => adapter.started.length === 2)
    expect(adapter.started).toEqual(["one", "two"])
    adapter.resolveNext("second done", "thread-1")
    expect((await second).resultText).toBe("second done")

    const saved = await conversations.get(conversationId("local", "s1", "active"))
    expect(saved?.history.map((entry) => entry.content)).toEqual([
      "one",
      "first done",
      "two",
      "second done",
    ])
  })

  it("enforces the pending queue limit", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const adapter = new BlockingAdapter()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      pendingQueueLimit: 1,
      now: fixedNow,
    })

    const first = service.send(baseMessage("one"))
    await waitFor(() => adapter.started.length === 1)
    const second = service.send(baseMessage("two"))
    const third = await service.send(baseMessage("three"))

    expect(third.events).toEqual([
      expect.objectContaining({ type: "error", message: "Session queue is full" }),
    ])

    adapter.resolveNext("first done", "thread-1")
    await first
    await waitFor(() => adapter.started.length === 2)
    adapter.resolveNext("second done", "thread-1")
    await second
  })

  it("stores pending permissions, rejects non-user allow, and writes allow decisions with audit", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const auditSink = new InMemoryAuditSink()
    const liveSession = new FakeLiveSession()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new FakeLiveAdapter(liveSession),
      permissionGuard: createPermissionGuard(),
      auditSink,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs permission"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await expect(service.respondPermission({
      requestId: "perm-1",
      behavior: "allow",
      actor: { kind: "agent", id: "agent-1" },
    })).rejects.toThrow("Only a user actor can allow")

    await service.respondPermission({
      requestId: "perm-1",
      behavior: "allow",
      actor: { kind: "user" },
    })

    expect((await turn).resultText).toBe("permission allow")
    expect(liveSession.permissionResponses).toEqual([
      { requestId: "perm-1", decision: { behavior: "allow", updatedInput: { command: "pwd" } } },
    ])
    expect(auditSink.list()).toEqual([
      expect.objectContaining({ action: "shell.exec", outcome: "denied" }),
      expect.objectContaining({ action: "shell.exec", outcome: "allowed" }),
    ])
  })

  it("writes deny decisions and resolves the pending permission", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const auditSink = new InMemoryAuditSink()
    const liveSession = new FakeLiveSession()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new FakeLiveAdapter(liveSession),
      permissionGuard: createPermissionGuard(),
      auditSink,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("deny permission"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await service.respondPermission({
      requestId: "perm-1",
      behavior: "deny",
      message: "No",
      actor: { kind: "agent", id: "agent-1" },
    })

    expect((await turn).resultText).toBe("permission deny")
    expect(service.listPendingPermissions()).toEqual([])
    expect(liveSession.permissionResponses).toEqual([
      { requestId: "perm-1", decision: { behavior: "deny", updatedInput: { command: "pwd" }, message: "No" } },
    ])
    expect(auditSink.list()).toEqual([
      expect.objectContaining({ action: "shell.exec", outcome: "denied" }),
    ])
  })
})

class FakeRunner implements CodexProcessRunner {
  readonly requests: ControlledProcessRunRequest[] = []
  private readonly lines: readonly string[]

  constructor(lines: readonly string[]) {
    this.lines = lines
  }

  async run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult> {
    this.requests.push(request)
    for (const line of this.lines) {
      request.onStdoutLine?.(line)
    }
    return {
      exitCode: 0,
      signal: null,
      stdout: `${this.lines.join("\n")}\n`,
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }
  }
}

class BlockingAdapter implements AgentAdapter {
  readonly agentType = "blocking"
  readonly started: string[] = []
  private readonly pending: Array<(result: AgentExecutionResult) => void> = []

  execute(message: AgentMessage): Promise<AgentExecutionResult> {
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

class FakeLiveAdapter implements AgentAdapter {
  readonly agentType = "claude-code"
  private readonly liveSession: FakeLiveSession

  constructor(liveSession: FakeLiveSession) {
    this.liveSession = liveSession
  }

  async execute(): Promise<AgentExecutionResult> {
    throw new Error("not used")
  }

  async startSession(_context: AgentExecutionContext): Promise<AgentLiveSession> {
    return this.liveSession
  }
}

class FakeLiveSession implements AgentLiveSession {
  readonly agentType = "claude-code"
  readonly permissionResponses: Array<{
    readonly requestId: string
    readonly decision: AgentPermissionDecision
  }> = []
  private readonly queue = new AsyncQueue<AgentEvent>()

  async send(): Promise<void> {
    this.queue.push({
      type: "permissionRequest",
      requestId: "perm-1",
      toolName: "Bash",
      toolInput: "pwd",
      toolInputRaw: { command: "pwd" },
      agentSessionId: "claude-1",
      threadId: "claude-1",
    })
  }

  async respondPermission(
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void> {
    this.permissionResponses.push({ requestId, decision })
    this.queue.push({
      type: "result",
      content: `permission ${decision.behavior}`,
      done: true,
      agentSessionId: "claude-1",
      threadId: "claude-1",
    })
  }

  nextEvent(): Promise<AgentEvent | null> {
    return this.queue.next()
  }

  currentSessionId(): string | undefined {
    return "claude-1"
  }

  alive(): boolean {
    return true
  }

  async close(): Promise<void> {}
}

class FakeReplyTargets {
  readonly remembered: ReplyTarget[] = []
  readonly dispatched: Array<{ readonly target: ReplyTarget; readonly event: AgentEvent }> = []

  rememberReplyTarget(target: ReplyTarget): void {
    this.remembered.push(target)
  }

  dispatchAgentEvent(target: ReplyTarget, event: AgentEvent): void {
    this.dispatched.push({ target, event })
  }

  getAgentEnv(projectId: string, sessionKey: string): Record<string, string> {
    return {
      CC_PROJECT: projectId,
      CC_SESSION_KEY: sessionKey,
    }
  }
}

class AsyncQueue<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(value: T | null) => void> = []

  push(value: T): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter(value)
      return
    }
    this.values.push(value)
  }

  next(): Promise<T | null> {
    const value = this.values.shift()
    if (value) return Promise.resolve(value)
    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
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

function fixedNow(): Date {
  return new Date("2026-04-26T00:00:00.000Z")
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("Timed out waiting for condition")
}
