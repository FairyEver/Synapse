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
  type ControlledProcessResult,
  type ControlledProcessRunRequest,
} from "../../../runtime/process"
import { createRecordingLogger } from "../../../runtime/lib/test-helpers"
import { InMemoryAuditSink, createPermissionGuard } from "../../../runtime/security"
import type { ScopedEventBus } from "../../../runtime/project-container"
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
  it("sends a prompt and persists the thread id", async () => {
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
      adapter: new FakeExecAdapter(runner),
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
        command: "claude",
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
        agentType: "claude-code",
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
      agentType: "claude-code",
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
      adapter: new FakeExecAdapter(runner),
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

  it("persists tool events as conversation history before the final assistant reply", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const runner = new FakeRunner([
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "item.started",
        item: { type: "command_execution", command: "pwd" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          status: "completed",
          aggregated_output: "/repo",
          exit_code: 0,
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          content: [{ type: "output_text", text: "done" }],
        },
      }),
      JSON.stringify({ type: "turn.completed" }),
    ])
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new FakeExecAdapter(runner),
      now: fixedNow,
    })

    const result = await service.send({
      projectId: "project-1",
      sessionKey: "local:user-1",
      platform: "local",
      userId: "user-1",
      userName: "User One",
      content: "where am I",
    })

    const saved = await conversations.get(result.conversationId)
    expect(saved?.history).toEqual([
      expect.objectContaining({ role: "user", content: "where am I" }),
      expect.objectContaining({
        role: "tool",
        content: "Bash\npwd",
        metadata: expect.objectContaining({
          agentEventType: "toolUse",
          toolName: "Bash",
        }),
      }),
      expect.objectContaining({
        role: "tool",
        content: "/repo",
        metadata: expect.objectContaining({
          agentEventType: "toolResult",
          toolName: "Bash",
          exitCode: 0,
          success: true,
        }),
      }),
      expect.objectContaining({ role: "assistant", content: "done" }),
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
      adapter: new FakeExecAdapter(runner),
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

  it("emits a conversation update after persisting the assistant response", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const events: Array<Parameters<ScopedEventBus["emit"]>[0]> = []
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
      adapter: new FakeExecAdapter(runner),
      eventBus: {
        projectId: "project-1",
        emit: (event) => {
          events.push(event)
        },
        on: vi.fn(),
        underlying: {} as ScopedEventBus["underlying"],
      },
      now: fixedNow,
    })

    const result = await service.send({
      projectId: "project-1",
      sessionKey: "local:user-1",
      platform: "local",
      userId: "user-1",
      userName: "User One",
      content: "hello",
    })

    const update = events.filter((e) => e.type === "conversationUpdated").at(-1)
    const saved = await conversations.get(result.conversationId)
    expect(saved?.history.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      content: "done",
    }))
    expect(events.map((event) => event.type)).toEqual([
      "conversationUpdated",
      "phase.update",
      "text",
      "result",
      "conversationUpdated",
      "phase.update",
      "phase.update",
    ])
    expect(update).toEqual(expect.objectContaining({
      domain: "agent",
      type: "conversationUpdated",
      payload: {
        projectId: "project-1",
        sessionKey: "local:user-1",
        platform: "local",
        conversationId: result.conversationId,
      },
      scope: { sessionId: result.conversationId },
    }))
  })

  it("emits conversation updates after Feishu user append and final assistant save", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const events: Array<Parameters<ScopedEventBus["emit"]>[0]> = []
    const logger = createRecordingLogger()
    const eventSnapshots: Array<{
      readonly event: Parameters<ScopedEventBus["emit"]>[0]
      readonly history: Array<{ readonly role: string; readonly content: string }>
    }> = []
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
      adapter: new FakeExecAdapter(runner),
      eventBus: {
        projectId: "project-1",
        emit: (event) => {
          const sessionId = event.scope?.sessionId
          events.push(event)
          eventSnapshots.push({
            event,
            history: sessionId ? conversations.snapshot(sessionId)?.history.map((entry) => ({
              role: entry.role,
              content: entry.content,
            })) ?? [] : [],
          })
        },
        on: vi.fn(),
        underlying: {} as ScopedEventBus["underlying"],
      },
      now: fixedNow,
      logger,
    })

    const result = await service.send({
      projectId: "project-1",
      sessionKey: "feishu:oc_group:ou_user",
      channelKey: "feishu:oc_group",
      platform: "feishu",
      userId: "ou_user",
      userName: "User One",
      chatName: "Feishu Group",
      content: "hello from Feishu",
    })

    const updates = events.filter((event) => event.type === "conversationUpdated")
    expect(updates).toEqual([
      expect.objectContaining({
        payload: {
          projectId: "project-1",
          sessionKey: "feishu:oc_group:ou_user",
          platform: "feishu",
          conversationId: result.conversationId,
        },
      }),
      expect.objectContaining({
        payload: {
          projectId: "project-1",
          sessionKey: "feishu:oc_group:ou_user",
          platform: "feishu",
          conversationId: result.conversationId,
        },
      }),
    ])
    expect(events.map((event) => event.type)).toEqual([
      "conversationUpdated",
      "phase.update",
      "text",
      "result",
      "conversationUpdated",
      "phase.update",
      "phase.update",
    ])
    expect(eventSnapshots.map((snapshot) => snapshot.event.type)).toEqual([
      "conversationUpdated",
      "phase.update",
      "text",
      "result",
      "conversationUpdated",
      "phase.update",
      "phase.update",
    ])
    const scopedSnapshots = eventSnapshots.filter((s) => s.event.type !== "phase.update")
    expect(scopedSnapshots[0]?.history).toEqual([
      { role: "user", content: "hello from Feishu" },
    ])
    expect(scopedSnapshots[1]?.history).toEqual([
      { role: "user", content: "hello from Feishu" },
    ])
    expect(scopedSnapshots[2]?.history).toEqual([
      { role: "user", content: "hello from Feishu" },
    ])
    expect(scopedSnapshots[3]?.history).toEqual([
      { role: "user", content: "hello from Feishu" },
      { role: "assistant", content: "done" },
    ])
    expect(logger.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "info",
        message: "Agent conversation updated after user message.",
        meta: expect.objectContaining({
          projectId: "project-1",
          sessionKey: "feishu:oc_group:ou_user",
          platform: "feishu",
          conversationId: result.conversationId,
          contentLength: "hello from Feishu".length,
          historyCount: 1,
        }),
      }),
      expect.objectContaining({
        level: "info",
        message: "Agent conversation update event emitted.",
        meta: expect.objectContaining({
          projectId: "project-1",
          sessionKey: "feishu:oc_group:ou_user",
          platform: "feishu",
          conversationId: result.conversationId,
          historyCount: 1,
        }),
      }),
      expect.objectContaining({
        level: "info",
        message: "Agent conversation update event emitted.",
        meta: expect.objectContaining({
          projectId: "project-1",
          sessionKey: "feishu:oc_group:ou_user",
          platform: "feishu",
          conversationId: result.conversationId,
          historyCount: 2,
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
      id: "anthropic",
      model: "claude-sonnet-4.5",
      models: [
        { id: "claude-sonnet-4.5" },
        { id: "claude-haiku-3.5", alias: "fast" },
      ],
      agentTypes: ["claude-code"],
    })
    await providerConfig.setProjectProviderRefs("project-1", ["anthropic"])
    await providerConfig.setActiveProvider("project-1", "anthropic")
    await conversations.upsert({
      id: conversationId("local", "s1", "active"),
      schemaVersion: 1,
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      agentType: "claude-code",
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
      agentType: "claude-code",
      providerConfig,
      now: fixedNow,
    })

    const result = await service.send(baseMessage("/model switch fast"))

    expect(result.resultText).toBe("Model changed: claude-haiku-3.5")
    expect(adapter.started).toEqual([])
    expect((await conversations.get(conversationId("local", "s1", "active")))).toEqual(
      expect.objectContaining({
        agentSessionId: undefined,
        pastAgentSessionIds: ["thread-1"],
      }),
    )
    expect((await providerConfig.getProjectProviderState("project-1", "claude-code")).activeModel)
      .toBe("claude-haiku-3.5")
  })

  it("routes slash commands through the active agent type", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const providerConfig = new ProviderConfigService({ providers, secrets, now: fixedNow })
    await providerConfig.setActiveMode("project-1", "plan", "claude-code")
    const adapter = new BlockingAdapter()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      agentType: "claude-code",
      providerConfig,
      now: fixedNow,
    })

    const switched = await service.send(baseMessage("/mode acceptEdits"))
    const status = await service.send(baseMessage("/status"))

    expect(switched.resultText).toBe("Mode changed: acceptEdits")
    expect(status.resultText).toContain("Agent: claude-code")
    expect(status.resultText).toContain("Mode: acceptEdits")
    expect(adapter.started).toEqual([])
    expect((await providerConfig.getProjectProviderState("project-1", "claude-code")).activeMode)
      .toBe("acceptEdits")
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
      agentType: "claude-code",
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
      agentType: "claude-code",
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
    const auditSink = new InMemoryAuditSink()
    const guard = createPermissionGuard()
    guard.registerPolicy({
      id: "deny-agent-spawn",
      decide: (request) => request.action === "agent.spawn" ? "deny" : "defer-to-next",
    })
    const adapter = new DenyingAdapter(guard, auditSink)
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      now: fixedNow,
    })

    const result = await service.send({
      projectId: "project-1",
      sessionKey: "local:user-1",
      platform: "local",
      content: "hello",
    })

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
        resource: "claude",
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

  it("isolates runtime queues and work dirs by workspace key", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const adapter = new BlockingAdapter()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      now: fixedNow,
    })

    const first = service.send({
      ...baseMessage("one"),
      workspaceKey: "workspace:a",
      workspacePath: "/repo-a",
    })
    await waitFor(() => adapter.started.length === 1)
    const second = service.send({
      ...baseMessage("two"),
      workspaceKey: "workspace:b",
      workspacePath: "/repo-b",
    })
    await waitFor(() => adapter.started.length === 2)

    expect(adapter.started).toEqual(["one", "two"])
    expect(adapter.workDirs).toEqual(["/repo-a", "/repo-b"])

    adapter.resolveNext("first done", "thread-a")
    adapter.resolveNext("second done", "thread-b")
    expect((await first).resultText).toBe("first done")
    expect((await second).resultText).toBe("second done")

    const savedA = await conversations.get(conversationId("local", "s1", "active", "workspace:a"))
    const savedB = await conversations.get(conversationId("local", "s1", "active", "workspace:b"))
    expect(savedA?.agentSessionId).toBe("thread-a")
    expect(savedB?.agentSessionId).toBe("thread-b")
    expect(savedA?.history.map((entry) => entry.content)).toEqual(["one", "first done"])
    expect(savedB?.history.map((entry) => entry.content)).toEqual(["two", "second done"])
  })

  it("does not reap active workspace turns and reaps idle workspace state", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const adapter = new BlockingAdapter()
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter,
      now: fixedNow,
    })

    const turn = service.send({
      ...baseMessage("one"),
      workspaceKey: "workspace:a",
      workspacePath: "/repo-a",
    })
    await waitFor(() => adapter.started.length === 1)

    expect(await service.reapIdleWorkspaceRuntimes(0, Date.now() + 1_000)).toEqual([])

    adapter.resolveNext("done", "thread-a")
    await turn

    expect(await service.reapIdleWorkspaceRuntimes(0, Date.now() + 1_000)).toEqual(["/repo-a"])
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

  it("pauses and resumes live turns through pending permissions", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const liveSession = new FakeLiveSession("claude-code", "claude-1")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      adapter: new FakeLiveAdapter(liveSession),
      now: fixedNow,
    })

    const turn = service.send(baseMessage("codex permission"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    expect(service.listPendingPermissions()).toEqual([
      expect.objectContaining({
        requestId: "perm-1",
        toolName: "Bash",
        toolInput: "pwd",
      }),
    ])

    await service.respondPermission({
      requestId: "perm-1",
      behavior: "allow",
      actor: { kind: "user" },
    })

    expect((await turn).resultText).toBe("permission allow")
    expect(liveSession.permissionResponses).toEqual([
      { requestId: "perm-1", decision: { behavior: "allow", updatedInput: { command: "pwd" } } },
    ])
    expect((await conversations.get(conversationId("local", "s1", "active")))).toEqual(
      expect.objectContaining({ agentType: "claude-code", agentSessionId: "claude-1" }),
    )
  })
})

/**
 * FakeExecAdapter replaces the deleted CodexExecAdapter for testing.
 * It parses JSONL event lines and produces AgentExecutionResult with the same
 * event structure the service expects.
 */
class FakeExecAdapter implements AgentAdapter {
  readonly agentType = "claude-code"
  readonly requests: ControlledProcessRunRequest[] = []
  private readonly runner: FakeRunner

  constructor(runner: FakeRunner) {
    this.runner = runner
  }

  async execute(message: AgentMessage, context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const args = context.agentSessionId
      ? ["exec", "resume", "--skip-git-repo-check", context.agentSessionId, "--json", "-"]
      : ["exec", "--skip-git-repo-check", "--json", "--cd", context.workDir, "-"]
    const request: ControlledProcessRunRequest = {
      actor: context.actor,
      action: "agent.spawn",
      command: "claude",
      args,
      cwd: context.workDir,
      stdin: message.content,
      env: context.sessionEnv,
      envAllowlist: context.sessionEnv ? Object.keys(context.sessionEnv) : undefined,
    }
    const result = await this.runner.run(request)
    if (result.exitCode !== 0 && result.exitCode !== null) {
      return {
        events: [{ type: "error", message: `denied by ${result.stderr || "unknown"}` }],
        resultText: "",
      }
    }
    return this.parseJsonlEvents(this.runner.lastLines)
  }

  private parseJsonlEvents(lines: readonly string[]): AgentExecutionResult {
    const events: AgentEvent[] = []
    let threadId: string | undefined
    let resultText = ""

    for (const line of lines) {
      const parsed = JSON.parse(line)
      if (parsed.type === "thread.started") {
        threadId = parsed.thread_id
      } else if (parsed.type === "item.started" && parsed.item?.type === "command_execution") {
        events.push({
          type: "toolUse",
          toolName: "Bash",
          toolInput: parsed.item.command,
          agentSessionId: threadId,
          threadId,
        })
      } else if (parsed.type === "item.completed" && parsed.item?.type === "command_execution") {
        events.push({
          type: "toolResult",
          toolName: "Bash",
          content: parsed.item.aggregated_output ?? "",
          exitCode: parsed.item.exit_code,
          success: parsed.item.exit_code === 0,
          agentSessionId: threadId,
          threadId,
        })
      } else if (parsed.type === "item.completed" && parsed.item?.type === "agent_message") {
        const text = parsed.item.content
          ?.filter((c: { type: string }) => c.type === "output_text")
          .map((c: { text: string }) => c.text)
          .join("") ?? ""
        resultText = text
        events.push({ type: "text", content: text, agentSessionId: threadId, threadId })
        events.push({ type: "result", content: text, done: true, agentSessionId: threadId, threadId })
      }
    }

    return { events, resultText, agentSessionId: threadId, threadId }
  }
}

class FakeRunner {
  readonly requests: ControlledProcessRunRequest[] = []
  lastLines: readonly string[] = []
  private readonly lines: readonly string[]

  constructor(lines: readonly string[]) {
    this.lines = lines
  }

  async run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult> {
    this.requests.push(request)
    this.lastLines = this.lines
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
  readonly workDirs: string[] = []
  private readonly pending: Array<(result: AgentExecutionResult) => void> = []

  execute(message: AgentMessage, context: AgentExecutionContext): Promise<AgentExecutionResult> {
    this.started.push(message.content)
    this.workDirs.push(context.workDir)
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

class BrokenLiveAdapter implements AgentAdapter {
  readonly agentType = "claude-code"
  readonly execStarted: string[] = []
  liveStarts = 0

  async execute(message: AgentMessage): Promise<AgentExecutionResult> {
    this.execStarted.push(message.content)
    return {
      events: [
        { type: "text", content: "fallback done", agentSessionId: "thread-1", threadId: "thread-1" },
        { type: "result", content: "fallback done", done: true, agentSessionId: "thread-1", threadId: "thread-1" },
      ],
      resultText: "fallback done",
      agentSessionId: "thread-1",
      threadId: "thread-1",
    }
  }

  async startSession(): Promise<AgentLiveSession> {
    this.liveStarts += 1
    throw new Error("write EPIPE")
  }
}

class DenyingAdapter implements AgentAdapter {
  readonly agentType = "claude-code"
  private readonly guard: ReturnType<typeof createPermissionGuard>
  private readonly auditSink: InstanceType<typeof InMemoryAuditSink>

  constructor(
    guard: ReturnType<typeof createPermissionGuard>,
    auditSink: InstanceType<typeof InMemoryAuditSink>,
  ) {
    this.guard = guard
    this.auditSink = auditSink
  }

  async execute(_message: AgentMessage, context: AgentExecutionContext): Promise<AgentExecutionResult> {
    const permission = await this.guard.check({
      action: "agent.spawn",
      actor: context.actor ?? { kind: "user" },
      resource: "claude",
      context: {},
    })
    if (!permission.allowed) {
      this.auditSink.record({
        action: "agent.spawn",
        actor: context.actor ?? { kind: "user" },
        resource: "claude",
        outcome: "denied",
        metadata: { policyId: permission.policyId },
      })
      return {
        events: [{ type: "error", message: `denied by ${permission.policyId}` }],
        resultText: "",
      }
    }
    return { events: [], resultText: "" }
  }
}

class FakeLiveAdapter implements AgentAdapter {
  readonly agentType: string
  private readonly liveSession: FakeLiveSession

  constructor(liveSession: FakeLiveSession) {
    this.liveSession = liveSession
    this.agentType = liveSession.agentType
  }

  async execute(): Promise<AgentExecutionResult> {
    throw new Error("not used")
  }

  async startSession(_context: AgentExecutionContext): Promise<AgentLiveSession> {
    return this.liveSession
  }
}

class FakeLiveSession implements AgentLiveSession {
  readonly agentType: string
  readonly permissionResponses: Array<{
    readonly requestId: string
    readonly decision: AgentPermissionDecision
  }> = []
  private readonly queue = new AsyncQueue<AgentEvent>()

  constructor(
    agentType = "claude-code",
    private readonly sessionId = "claude-1",
  ) {
    this.agentType = agentType
  }

  async send(): Promise<void> {
    this.queue.push({
      type: "permissionRequest",
      requestId: "perm-1",
      toolName: "Bash",
      toolInput: "pwd",
      toolInputRaw: { command: "pwd" },
      agentSessionId: this.sessionId,
      threadId: this.sessionId,
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
      agentSessionId: this.sessionId,
      threadId: this.sessionId,
    })
  }

  nextEvent(): Promise<AgentEvent | null> {
    return this.queue.next()
  }

  currentSessionId(): string | undefined {
    return this.sessionId
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
