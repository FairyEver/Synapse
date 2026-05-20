import { describe, expect, it, vi } from "vitest"

import type {
  AgentCompressStateEntryV1,
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import type { ProviderService } from "../../provider"
import { AgentRuntimeService, conversationId, permissionActionForTool } from "../agent-runtime-service"
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
    expect(providerService.buildEnvCalls).toEqual([
      { providerId: "anthropic", actorId: "user-1", projectId: "project-1" },
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

  it("emits cancel escalation with conversation correlation", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new HangingSession()
    const eventBus = {
      projectId: "project-1",
      emit: vi.fn(),
      on: vi.fn(),
      underlying: {},
    }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      eventBus: eventBus as never,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("wait"))
    await waitFor(() => session.sent.length === 1)
    const id = conversationId("local", "s1", "active")

    vi.useFakeTimers()
    try {
      await expect(service.cancelTurn(id)).resolves.toEqual({ status: "graceful-pending" })
      await vi.advanceTimersByTimeAsync(5000)

      expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        domain: "agent",
        type: "phase.update",
        payload: expect.objectContaining({
          projectId: "project-1",
          conversationId: id,
          sessionKey: "s1",
          phase: "cancel_pending",
          status: "in-progress",
        }),
      }))
    } finally {
      vi.useRealTimers()
    }

    await service.forceKillTurn(id)
    await expect(turn).resolves.toMatchObject({ error: "cancelled" })
  })

  it("routes concurrent permission responses to their own SDK sessions", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const first = new PermissionSession("conversation-a-permission-1", "first allowed")
    const second = new PermissionSession("conversation-b-permission-1", "second denied")
    const sessions = [first, second]
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => {
        const session = sessions.shift()
        if (!session) throw new Error("unexpected session")
        return session
      },
      now: fixedNow,
    })

    const firstTurn = service.send({ ...baseMessage("one"), workspaceKey: "workspace-a" })
    const secondTurn = service.send({ ...baseMessage("two"), workspaceKey: "workspace-b" })
    await waitFor(() => service.listPendingPermissions().length === 2)

    await service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      actor: { kind: "user" },
    })
    await service.respondPermission({
      requestId: "conversation-b-permission-1",
      behavior: "deny",
      actor: { kind: "agent", id: "agent-1" },
    })

    await expect(firstTurn).resolves.toMatchObject({ resultText: "first allowed" })
    await expect(secondTurn).resolves.toMatchObject({ resultText: "second denied" })
    expect(first.responses).toEqual([{ requestId: "conversation-a-permission-1", behavior: "allow" }])
    expect(second.responses).toEqual([{ requestId: "conversation-b-permission-1", behavior: "deny" }])
  })

  it("settles a pending permission when the permission guard denies allow", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new PermissionSession("conversation-a-permission-1", "guard denied")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      permissionGuard: {
        check: vi.fn(async () => ({ allowed: false, reason: "blocked by policy", policyId: "policy-1" })),
      } as never,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs permission"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await expect(service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      actor: { kind: "user" },
    })).rejects.toThrow("blocked by policy")

    expect(service.listPendingPermissions()).toEqual([])
    expect(session.responses).toEqual([{ requestId: "conversation-a-permission-1", behavior: "deny" }])
    await expect(turn).resolves.toMatchObject({ resultText: "guard denied" })
  })

  it("redacts permission response failure audit metadata", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const auditSink = { record: vi.fn() }
    const rawError = "backend failed without sensitive content"
    const rawToolInput = "curl -H 'Authorization: Bearer sk-tool' /Users/liyang/private/file.ts"
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new PermissionFailureSession("conversation-a-permission-1", rawError, rawToolInput),
      auditSink: auditSink as never,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs permission"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await expect(service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      actor: { kind: "user" },
    })).rejects.toThrow(rawError)

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      metadata: expect.objectContaining({
        behavior: "allow",
        errorName: "Error",
        errorLength: rawError.length,
        projectId: "project-1",
        sessionKey: "s1",
        conversationId: conversationId("local", "s1", "active"),
        requestId: "conversation-a-permission-1",
        toolName: "Bash",
      }),
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain(rawError)
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("sk-tool")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("/Users/liyang/private")

    await service.forceKillTurn(conversationId("local", "s1", "active"))
    await expect(resolveSoon(turn)).resolves.not.toBe("timeout")
  })

  it("redacts pending permission raw tool input before listing it", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const rawToolInput = "curl -H 'Authorization: Bearer sk-tool' /Users/liyang/private/file.ts"
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new PermissionFailureSession("conversation-a-permission-1", "unused", rawToolInput),
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs permission"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    const pending = service.listPendingPermissions()[0]

    expect(pending?.toolInputRaw).toEqual({
      command: "curl -H 'Authorization: Bearer [redacted]' [path redacted]",
    })
    expect(JSON.stringify(pending)).not.toContain("sk-tool")
    expect(JSON.stringify(pending)).not.toContain("/Users/liyang/private")

    await service.forceKillTurn(conversationId("local", "s1", "active"))
    await expect(resolveSoon(turn)).resolves.not.toBe("timeout")
  })

  it("forceKillTurn settles a pending permission and resolves the send", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new PermissionSession("conversation-a-permission-1", "unused")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs permission"))
    await waitFor(() => service.listPendingPermissions().length === 1)
    const id = conversationId("local", "s1", "active")

    await expect(service.forceKillTurn(id)).resolves.toEqual({ status: "hard-killed" })

    expect(service.listPendingPermissions()).toEqual([])
    expect(session.closed).toBe(true)
    await expect(turn).resolves.toMatchObject({ error: "cancelled" })
  })

  it("resetSession settles a pending permission and resolves the send", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new PermissionSession("conversation-a-permission-1", "unused")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs permission"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await service.resetSession("s1", "local")

    expect(service.listPendingPermissions()).toEqual([])
    expect(session.closed).toBe(true)
    await expect(resolveSoon(turn)).resolves.not.toBe("timeout")
  })

  it("deleteSession settles a pending permission and resolves the send", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new PermissionSession("conversation-a-permission-1", "unused")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs permission"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await service.deleteSession(conversationId("local", "s1", "active"))

    expect(service.listPendingPermissions()).toEqual([])
    expect(session.closed).toBe(true)
    await expect(resolveSoon(turn)).resolves.not.toBe("timeout")
  })

  it("deleteSession resolves queued sends for a busy conversation", async () => {
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

    const firstTurn = service.send(baseMessage("first"))
    await waitFor(() => session.sent.length === 1)
    const secondTurn = service.send(baseMessage("second"))
    await waitFor(() => service.getStatus().queuedTurns === 1)

    await service.deleteSession(conversationId("local", "s1", "active"))

    await expect(resolveSoon(secondTurn)).resolves.toMatchObject({ error: "cancelled" })
    await expect(resolveSoon(firstTurn)).resolves.not.toBe("timeout")
  })

  it("persists permission mode when no live session exists", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      now: fixedNow,
    })
    const created = await service.createSession({
      sessionKey: "s1",
      platform: "local",
      name: "Local",
    })

    const updated = await service.setPermissionMode({
      conversationId: created.id,
      mode: "plan",
      actor: { kind: "user", id: "user-1" },
    })

    expect(updated.agentConfig?.mode).toBe("plan")
    await expect(conversations.get(created.id)).resolves.toMatchObject({
      agentConfig: { mode: "plan" },
    })
  })

  it("switches a live session before persisting permission mode", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new ModeSwitchSession()
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

    await expect(service.setPermissionMode({
      conversationId: id,
      mode: "acceptEdits",
      actor: { kind: "user", id: "user-1" },
    })).resolves.toMatchObject({
      agentConfig: { mode: "acceptEdits" },
    })

    expect(session.modeCalls).toEqual(["acceptEdits"])
    await expect(conversations.get(id)).resolves.toMatchObject({
      agentConfig: { mode: "acceptEdits" },
    })

    await service.forceKillTurn(id)
    await expect(resolveSoon(turn)).resolves.not.toBe("timeout")
  })

  it("persists permission mode before reporting a live SDK switch failure", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new ModeSwitchSession(new Error("sdk denied mode"))
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

    await expect(service.setPermissionMode({
      conversationId: id,
      mode: "acceptEdits",
      actor: { kind: "user", id: "user-1" },
    })).rejects.toThrow("sdk denied mode")

    await expect(conversations.get(id)).resolves.toMatchObject({
      agentConfig: { mode: "acceptEdits" },
    })

    await service.forceKillTurn(id)
    await expect(resolveSoon(turn)).resolves.not.toBe("timeout")
  })

  it("logs scheduled agent failures with correlation context", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "error", message: "sdk failed with sensitive prompt content", sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      logger: logger as never,
      now: fixedNow,
    })

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "plan",
      prompt: "sensitive prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
    })

    expect(result).toEqual(expect.objectContaining({
      status: "error",
      conversationId: result.conversationId,
      durationMs: expect.any(Number),
    }))
    expect(result.error).toContain("sdk failed with")
    expect(result.error).not.toContain("Agent run failed")
    expect(logger.warn).toHaveBeenCalledWith(
      "Scheduled agent send failed.",
      expect.objectContaining({
        boundary: "agent-runtime.scheduled-send",
        source: "scheduled",
        projectId: "project-1",
        sessionKey: expect.stringMatching(/^scheduled:project-1:/),
        conversationId: result.conversationId,
        sdkSessionId: "sdk-1",
        agentType: "claude-code",
        mode: "plan",
        sessionPolicy: "fresh",
        status: "error",
        errorLength: "sdk failed with sensitive prompt content".length,
        promptLength: "sensitive prompt".length,
        timeoutMs: 120_000,
        durationMs: expect.any(Number),
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sensitive prompt")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sensitive prompt content")
  })

  it("logs scheduled agent completions with SDK session correlation context", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "result", content: "done from sensitive prompt", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      logger: logger as never,
      now: fixedNow,
    })

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "plan",
      prompt: "sensitive scheduled prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
    })

    expect(result.status).toBe("success")
    expect(logger.info).toHaveBeenCalledWith(
      "Scheduled agent send completed.",
      expect.objectContaining({
        boundary: "agent-runtime.scheduled-send",
        source: "scheduled",
        projectId: "project-1",
        sessionKey: expect.stringMatching(/^scheduled:project-1:/),
        conversationId: result.conversationId,
        sdkSessionId: "sdk-1",
        agentType: "claude-code",
        mode: "plan",
        sessionPolicy: "fresh",
        status: "success",
        promptLength: "sensitive scheduled prompt".length,
        summaryLength: "done from sensitive prompt".length,
        timeoutMs: 120_000,
        durationMs: expect.any(Number),
      }),
    )
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("sensitive scheduled prompt")
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("done from sensitive prompt")
  })

  it("persists scheduled fresh-session permission mode for renderer summaries", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      now: fixedNow,
    })

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "bypassPermissions",
      prompt: "scheduled prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
    })

    const session = await conversations.get(result.conversationId)
    expect(session?.agentConfig?.mode).toBe("bypassPermissions")
  })

  it("persists scheduled resumed permission mode for renderer summaries", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      now: fixedNow,
    })
    const existing = await service.createSession({
      sessionKey: "scheduled:project-1:run-1",
      platform: "scheduled",
      name: "Existing",
      agentType: "claude-code",
      mode: "default",
    })

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "bypassPermissions",
      prompt: "scheduled prompt",
      sessionPolicy: "resume",
      lastConversationId: existing.id,
      timeoutMs: 120_000,
    })

    const session = await conversations.get(result.conversationId)
    expect(session?.agentConfig?.mode).toBe("bypassPermissions")
  })

  it("does not create a scheduled timeout when timeoutMs is non-positive", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      logger: logger as never,
      now: fixedNow,
    })

    try {
      const result = await service.sendScheduled({
        projectId: "project-1",
        agentType: "claude-code",
        mode: "plan",
        prompt: "sensitive scheduled prompt",
        sessionPolicy: "fresh",
        timeoutMs: 0,
      })

      expect(result.status).toBe("success")
      expect(timeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 0)
      expect(logger.info).toHaveBeenCalledWith(
        "Scheduled agent send completed.",
        expect.objectContaining({
          timeoutMs: 0,
          status: "success",
        }),
      )
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it("does not apply the live event timeout when scheduled timeout is disabled", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new TimeoutAwareSession([
      { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
    ], "sdk-1")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "plan",
      prompt: "scheduled prompt",
      sessionPolicy: "fresh",
      timeoutMs: 0,
    })

    expect(result).toMatchObject({
      status: "success",
      summary: "done",
    })
    expect(session.timeoutCalls).toEqual([])
  })

  it("logs scheduled resume fallback without prompt content", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      logger: logger as never,
      now: fixedNow,
    })

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "plan",
      prompt: "sensitive scheduled prompt",
      sessionPolicy: "resume",
      lastConversationId: "missing-conversation",
      timeoutMs: 120_000,
    })

    expect(result.status).toBe("success")
    expect(logger.warn).toHaveBeenCalledWith(
      "Scheduled agent resume fallback.",
      expect.objectContaining({
        boundary: "agent-runtime.scheduled-resume",
        source: "scheduled",
        projectId: "project-1",
        sessionKey: expect.stringMatching(/^scheduled:project-1:/),
        resumeConversationId: "missing-conversation",
        agentType: "claude-code",
        mode: "plan",
        sessionPolicy: "resume",
        fallback: "fresh-session",
        errorName: "Error",
        errorLength: expect.any(Number),
        promptLength: "sensitive scheduled prompt".length,
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sensitive scheduled prompt")
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
  readonly buildEnvCalls: Array<{
    readonly providerId: string
    readonly actorId?: string
    readonly projectId?: string
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
    context?: { readonly actor?: { readonly id?: string }; readonly projectId?: string },
  ): Promise<Record<string, string>> {
    this.buildEnvCalls.push({
      providerId,
      actorId: context?.actor?.id,
      projectId: context?.projectId,
    })
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

  async send(): Promise<boolean> {
    return true
  }
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

class TimeoutAwareSession extends ScriptedSession {
  readonly timeoutCalls: number[] = []

  async nextEventWithTimeout(timeoutMs: number): Promise<AgentEvent | null> {
    this.timeoutCalls.push(timeoutMs)
    return null
  }
}

class HangingSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  readonly sent: string[] = []
  readonly calls: string[] = []
  private waiter: ((event: AgentEvent | null) => void) | undefined
  private closed = false

  async send(message: AgentMessage): Promise<boolean> {
    this.sent.push(message.content)
    return true
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

class ModeSwitchSession extends HangingSession {
  readonly modeCalls: string[] = []

  constructor(private readonly failure?: Error) {
    super()
  }

  async setPermissionMode(mode: string): Promise<void> {
    this.modeCalls.push(mode)
    if (this.failure) throw this.failure
  }
}

class PermissionSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  readonly responses: Array<{ readonly requestId: string; readonly behavior: string }> = []
  closed = false
  private waiter: ((event: AgentEvent | null) => void) | undefined
  private readonly events: AgentEvent[] = []
  private sent = false

  constructor(
    private readonly requestId: string,
    private readonly resultText: string,
  ) {}

  async send(): Promise<boolean> {
    this.sent = true
    return true
  }

  async respondPermission(
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void> {
    this.responses.push({ requestId, behavior: decision.behavior })
    this.push({
      type: "result",
      content: this.resultText,
      done: true,
      sdkSessionId: requestId.replace("permission-1", "sdk-1"),
    })
  }

  nextEvent(): Promise<AgentEvent | null> {
    const event = this.events.shift()
    if (event) return Promise.resolve(event)
    if (this.closed) return Promise.resolve(null)
    if (this.sent) {
      this.sent = false
      return Promise.resolve({
        type: "permissionRequest",
        requestId: this.requestId,
        toolName: "Bash",
        toolInput: "pwd",
        toolInputRaw: { command: "pwd" },
      })
    }
    return new Promise((resolve) => {
      this.waiter = resolve
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
    this.waiter?.(null)
    this.waiter = undefined
  }

  private push(event: AgentEvent): void {
    const waiter = this.waiter
    if (waiter) {
      this.waiter = undefined
      waiter(event)
      return
    }
    this.events.push(event)
  }
}

class PermissionFailureSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  private waiter: ((event: AgentEvent | null) => void) | undefined
  private sent = false
  private closed = false

  constructor(
    private readonly requestId: string,
    private readonly failureMessage: string,
    private readonly toolInput = "pwd",
  ) {}

  async send(): Promise<boolean> {
    this.sent = true
    return true
  }

  async respondPermission(): Promise<void> {
    throw new Error(this.failureMessage)
  }

  nextEvent(): Promise<AgentEvent | null> {
    if (this.closed) return Promise.resolve(null)
    if (this.sent) {
      this.sent = false
      return Promise.resolve({
        type: "permissionRequest",
        requestId: this.requestId,
        toolName: "Bash",
        toolInput: this.toolInput,
        toolInputRaw: { command: this.toolInput },
      })
    }
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

  async close(): Promise<void> {
    this.closed = true
    this.waiter?.(null)
    this.waiter = undefined
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

function resolveSoon<T>(promise: Promise<T>): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 50)
    }),
  ])
}

describe("permissionActionForTool", () => {
  it("maps Read/Glob/Grep to fs.read.outside-userdata", () => {
    expect(permissionActionForTool("Read")).toBe("fs.read.outside-userdata")
    expect(permissionActionForTool("Glob")).toBe("fs.read.outside-userdata")
    expect(permissionActionForTool("Grep")).toBe("fs.read.outside-userdata")
  })

  it("maps Bash/Shell/run_shell_command to shell.exec", () => {
    expect(permissionActionForTool("Bash")).toBe("shell.exec")
    expect(permissionActionForTool("Shell")).toBe("shell.exec")
    expect(permissionActionForTool("run_shell_command")).toBe("shell.exec")
  })

  it("maps Write/Edit/MultiEdit/NotebookEdit to fs.write", () => {
    expect(permissionActionForTool("Write")).toBe("fs.write")
    expect(permissionActionForTool("Edit")).toBe("fs.write")
    expect(permissionActionForTool("MultiEdit")).toBe("fs.write")
    expect(permissionActionForTool("NotebookEdit")).toBe("fs.write")
  })

  it("maps WebFetch/WebSearch to network.connect", () => {
    expect(permissionActionForTool("WebFetch")).toBe("network.connect")
    expect(permissionActionForTool("WebSearch")).toBe("network.connect")
  })

  it("defaults unknown tools to agent.spawn", () => {
    expect(permissionActionForTool("UnknownTool")).toBe("agent.spawn")
    expect(permissionActionForTool("")).toBe("agent.spawn")
  })
})
