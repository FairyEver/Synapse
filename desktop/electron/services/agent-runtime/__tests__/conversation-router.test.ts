import { describe, expect, it, vi } from "vitest"

import type {
  AgentEventEntryV1,
  AgentUsageEntryV1,
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import type { EventBusEmitOptions } from "../../../runtime/event-bus/types"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import type { ProviderService } from "../../provider"
import { AgentCommandRouter } from "../command-router"
import { ConversationRouter } from "../conversation-router"
import type { ConversationRouterDeps } from "../conversation-router"
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

type RecordedAgentEvent = {
  readonly type: string
  readonly payload?: Record<string, unknown>
  readonly scope?: { readonly sessionId?: string }
}

type RecordedAgentEmit = {
  readonly event: RecordedAgentEvent
  readonly options?: EventBusEmitOptions
}

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

  it("does not dispatch reply targets when the outbox record fails", async () => {
    const outbox = {
      recordAgentEvent: vi.fn(async () => {
        throw new Error("outbox unavailable")
      }),
      updateRecordStatus: vi.fn(),
    } as unknown as NonNullable<ConversationRouterDeps["outbox"]>
    const replyTargets = {
      rememberReplyTarget: vi.fn(),
      dispatchAgentEvent: vi.fn(async () => {}),
    }
    const { router } = createRouter({
      outbox,
      replyTargets,
      session: new ScriptedSession([
        { type: "result", content: "done", done: true },
      ]),
    })

    await router.send(baseMessage("hello"))
    await flushAsync()

    expect(outbox.recordAgentEvent).toHaveBeenCalled()
    expect(replyTargets.dispatchAgentEvent).not.toHaveBeenCalled()
    expect(outbox.updateRecordStatus).not.toHaveBeenCalled()
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

  it("annotates allowed native slash passthrough after SDK send accepts the original message", async () => {
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const commandRouter = {
      handle: vi.fn(async () => ({ kind: "nativeSlash", name: "wiki-ingest" })),
    } as unknown as AgentCommandRouter
    const session = new ScriptedSession([
      { type: "toolUse", toolName: "Skill", toolInput: "wiki-ingest", sdkSessionId: "sdk-1" },
      { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
    ], "sdk-1")
    const { conversations, router } = createRouter({ agentEvents, commandRouter, session })

    const result = await router.send(baseMessage("/wiki-ingest ingest all of these .raw sources"))
    const persisted = await agentEvents.list()
    const saved = await conversations.get(result.conversationId)

    expect(session.sent).toEqual(["/wiki-ingest ingest all of these .raw sources"])
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "sdkEvent",
        sdkType: "nativeSlashPassthrough",
        sdkSubtype: "/wiki-ingest",
        payload: { command: "/wiki-ingest" },
      }),
      expect.objectContaining({ type: "toolUse" }),
      expect.objectContaining({ type: "result" }),
    ])
    expect(persisted.map((entry) => entry.eventType)).toEqual(["sdkEvent", "toolUse", "result"])
    expect(persisted[0]).toEqual(expect.objectContaining({
      payload: expect.objectContaining({
        sdkType: "nativeSlashPassthrough",
        sdkSubtype: "/wiki-ingest",
        payload: { command: "/wiki-ingest" },
      }),
    }))
    expect(JSON.stringify(persisted[0]?.payload)).not.toContain("ingest all")
    expect(saved?.history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: "/wiki-ingest ingest all of these .raw sources",
      }),
      expect.objectContaining({
        role: "system",
        content: "SDK nativeSlashPassthrough /wiki-ingest",
        metadata: expect.objectContaining({
          agentEventType: "sdkEvent",
          sdkType: "nativeSlashPassthrough",
          sdkSubtype: "/wiki-ingest",
        }),
      }),
    ]))
  })

  it("does not annotate native slash passthrough when SDK send fails", async () => {
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const commandRouter = {
      handle: vi.fn(async () => ({ kind: "nativeSlash", name: "wiki-ingest" })),
    } as unknown as AgentCommandRouter
    const { conversations, router } = createRouter({
      agentEvents,
      commandRouter,
      session: new ThrowingSendSession("SDK send failed"),
    })

    const result = await router.send(baseMessage("/wiki-ingest ingest all"))
    const persisted = await agentEvents.list()
    const saved = await conversations.get(result.conversationId)

    expect(result.error).toBe("SDK send failed")
    expect(persisted.map((entry) => entry.payload)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sdkType: "nativeSlashPassthrough" }),
    ]))
    expect(saved?.history.map((entry) => entry.content)).not.toContain("SDK nativeSlashPassthrough /wiki-ingest")
  })

  it("does not annotate native slash passthrough when renderer spawn permission fails", async () => {
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const commandRouter = {
      handle: vi.fn(async () => ({ kind: "nativeSlash", name: "wiki-ingest" })),
    } as unknown as AgentCommandRouter
    const session = new ScriptedSession([
      { type: "result", content: "should not run", done: true },
    ])
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: false, reason: "blocked" })),
    } as unknown as PermissionGuard
    const auditSink = {
      record: vi.fn(),
    } as unknown as AuditSink
    const { conversations, router } = createRouter({
      agentEvents,
      commandRouter,
      session,
      permissionGuard,
      auditSink,
    })

    const result = await router.send({
      ...baseMessage("/wiki-ingest ingest all"),
      platform: "local-renderer",
    })
    const persisted = await agentEvents.list()
    const saved = await conversations.get(result.conversationId)

    expect(result.error).toBe("Agent spawn denied by permission policy.")
    expect(session.sent).toEqual([])
    expect(persisted.map((entry) => entry.payload)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sdkType: "nativeSlashPassthrough" }),
    ]))
    expect(saved?.history.map((entry) => entry.content)).not.toContain("SDK nativeSlashPassthrough /wiki-ingest")
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

  it("emits stream events without coalescing so token deltas are not dropped", async () => {
    const { eventBus, emits } = createEventBusRecorder()
    const { router } = createRouter({
      eventBus,
      session: new ScriptedSession([
        { type: "stream", text: "hel", deltaType: "text_delta", sdkSessionId: "sdk-1", event: {} },
        { type: "stream", text: "lo", deltaType: "text_delta", sdkSessionId: "sdk-1", event: {} },
        { type: "result", content: "hello", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
    })

    await router.send(baseMessage("hello"))

    const streamEmits = emits.filter(({ event }) => event.type === "stream")
    expect(streamEmits).toHaveLength(2)
    expect(streamEmits.map(({ event }) => event.payload?.event)).toEqual([
      expect.objectContaining({ text: "hel" }),
      expect.objectContaining({ text: "lo" }),
    ])
    expect(streamEmits.map(({ options }) => options)).toEqual([
      { backpressure: "block" },
      { backpressure: "block" },
    ])
  })

  it("persists a terminal error when the SDK session ends without result or error", async () => {
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const { eventBus, events } = createEventBusRecorder()
    const { conversations, router } = createRouter({
      agentEvents,
      eventBus,
      session: new EndedWithoutTerminalSession("sdk-ended"),
    })

    const result = await router.send(baseMessage("hello"))
    const persisted = await agentEvents.list()
    const saved = await conversations.get(result.conversationId)

    expect(result).toMatchObject({
      error: "Agent session ended",
      events: [expect.objectContaining({ type: "error", message: "Agent session ended" })],
    })
    expect(events.filter((event) => event.type === "error")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          event: expect.objectContaining({
            type: "error",
            message: "Agent session ended",
          }),
        }),
      }),
    ])
    expect(persisted).toEqual([
      expect.objectContaining({
        conversationId: result.conversationId,
        eventType: "error",
        payload: expect.objectContaining({
          type: "error",
          message: "Agent session ended",
          sdkSessionId: "sdk-ended",
        }),
      }),
    ])
    expect(saved?.history).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
      expect.objectContaining({
        role: "system",
        content: "Agent session ended",
        metadata: expect.objectContaining({
          agentEventType: "error",
          sdkSessionId: "sdk-ended",
        }),
      }),
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

  it("uses string SDK assistant content when no content blocks were emitted", async () => {
    const { conversations, router } = createRouter({
      session: new ScriptedSession([
        {
          type: "assistant",
          content: "string assistant answer",
          message: { role: "assistant" },
          sdkSessionId: "sdk-1",
        },
        {
          type: "result",
          content: "",
          done: true,
          sdkSessionId: "sdk-1",
        },
      ], "sdk-1"),
    })

    const result = await router.send(baseMessage("hello"))
    const savedConversation = await conversations.get(result.conversationId)

    expect(result.resultText).toBe("string assistant answer")
    expect(savedConversation?.history.filter((entry) => entry.role === "assistant")).toEqual([
      expect.objectContaining({ content: "string assistant answer" }),
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

  it("persists result usage on the assistant history entry", async () => {
    const agentUsage = new MemoryNamespace<AgentUsageEntryV1>("agent.usage")
    const { conversations, router, repository } = createRouter({
      agentUsage,
      session: new ScriptedSession([
        {
          type: "result",
          content: "usage answer",
          done: true,
          sdkResultUuid: "result-1",
          sdkSessionId: "sdk-1",
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 4,
          },
          costUsd: 0.01,
        },
      ], "sdk-1"),
    })

    const result = await router.send(baseMessage("hello"))
    const savedConversation = await conversations.get(result.conversationId)
    const usageRows = await agentUsage.list()

    expect(result).toMatchObject({
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 4,
      },
      costUsd: 0.01,
    })
    expect(savedConversation?.history.filter((entry) => entry.role === "assistant")).toEqual([
      expect.objectContaining({
        content: "usage answer",
        metadata: expect.objectContaining({
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            cacheReadInputTokens: 30,
            cacheCreationInputTokens: 4,
            totalTokens: 46,
          },
          costUsd: 0.01,
        }),
      }),
    ])
    expect(usageRows).toEqual([
      expect.objectContaining({
        id: "result-1",
        schemaVersion: 1,
        projectId: "project-1",
        conversationId: result.conversationId,
        turnId: expect.any(String),
        sdkResultUuid: "result-1",
        sdkSessionId: "sdk-1",
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 4,
        },
        usageSummary: {
          inputTokens: 10,
          outputTokens: 2,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 4,
          totalTokens: 46,
        },
      }),
    ])
    await expect(repository.getUsageSummary(result.conversationId)).resolves.toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cacheReadInputTokens: 30,
      cacheCreationInputTokens: 4,
      totalTokens: 46,
    })
  })

  it("persists cumulative usage snapshots on assistant history entries", async () => {
    const agentUsage = new MemoryNamespace<AgentUsageEntryV1>("agent.usage")
    const session = new ScriptedSession([
      {
        type: "result",
        content: "first usage answer",
        done: true,
        sdkResultUuid: "result-1",
        sdkSessionId: "sdk-1",
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 4,
          reasoning_output_tokens: 1,
        },
      },
      {
        type: "result",
        content: "second usage answer",
        done: true,
        sdkResultUuid: "result-2",
        sdkSessionId: "sdk-1",
        usage: {
          input_tokens: 5,
          output_tokens: 3,
          cache_read_input_tokens: 70,
          cache_creation_input_tokens: 6,
          reasoning_output_tokens: 2,
        },
      },
    ], "sdk-1")
    const { conversations, router } = createRouter({ agentUsage, session })

    const first = await router.send(baseMessage("hello"))
    const second = await router.send(baseMessage("again"))
    const savedConversation = await conversations.get(second.conversationId)
    const assistantEntries = savedConversation?.history.filter((entry) => entry.role === "assistant")
    const usageRows = await agentUsage.list()

    expect(first.conversationId).toBe(second.conversationId)
    expect(assistantEntries).toEqual([
      expect.objectContaining({
        content: "first usage answer",
        metadata: expect.objectContaining({
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            cacheReadInputTokens: 30,
            cacheCreationInputTokens: 4,
            reasoningOutputTokens: 1,
            totalTokens: 47,
          },
        }),
      }),
      expect.objectContaining({
        content: "second usage answer",
        metadata: expect.objectContaining({
          usage: {
            inputTokens: 15,
            outputTokens: 5,
            cacheReadInputTokens: 100,
            cacheCreationInputTokens: 10,
            reasoningOutputTokens: 3,
            totalTokens: 133,
          },
        }),
      }),
    ])
    expect(usageRows).toEqual([
      expect.objectContaining({
        id: "result-1",
        conversationId: first.conversationId,
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 4,
          reasoning_output_tokens: 1,
        },
        usageSummary: {
          inputTokens: 10,
          outputTokens: 2,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 4,
          reasoningOutputTokens: 1,
          totalTokens: 47,
        },
      }),
      expect.objectContaining({
        id: "result-2",
        conversationId: second.conversationId,
        usage: {
          input_tokens: 5,
          output_tokens: 3,
          cache_read_input_tokens: 70,
          cache_creation_input_tokens: 6,
          reasoning_output_tokens: 2,
        },
        usageSummary: {
          inputTokens: 5,
          outputTokens: 3,
          cacheReadInputTokens: 70,
          cacheCreationInputTokens: 6,
          reasoningOutputTokens: 2,
          totalTokens: 86,
        },
      }),
    ])
  })

  it("deduplicates SDK result usage by result uuid when aggregating a conversation", async () => {
    const agentUsage = new MemoryNamespace<AgentUsageEntryV1>("agent.usage")
    const { router, repository } = createRouter({
      agentUsage,
      session: new ScriptedSession([
        {
          type: "result",
          content: "first",
          done: true,
          sdkResultUuid: "result-duplicate",
          sdkSessionId: "sdk-1",
          usage: {
            input_tokens: 10,
            output_tokens: 2,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 4,
          },
        },
      ], "sdk-1"),
    })

    const first = await router.send(baseMessage("hello"))
    await agentUsage.upsert({
      ...(await agentUsage.get("result-duplicate"))!,
      turnId: "replayed-turn",
    })

    await expect(repository.getUsageSummary(first.conversationId)).resolves.toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cacheReadInputTokens: 30,
      cacheCreationInputTokens: 4,
      totalTokens: 46,
    })
  })

  it("records SDK result usage when the SDK result is an error event", async () => {
    const agentUsage = new MemoryNamespace<AgentUsageEntryV1>("agent.usage")
    const { router, repository } = createRouter({
      agentUsage,
      session: new ScriptedSession([
        {
          type: "error",
          message: "failed",
          sdkResultUuid: "result-error",
          sdkSessionId: "sdk-1",
          usage: {
            input_tokens: 5,
            output_tokens: 1,
            cache_read_input_tokens: 2,
            cache_creation_input_tokens: 3,
          },
        },
      ], "sdk-1"),
    })

    const result = await router.send(baseMessage("hello"))

    expect(result.error).toBe("failed")
    await expect(repository.getUsageSummary(result.conversationId)).resolves.toEqual({
      inputTokens: 5,
      outputTokens: 1,
      cacheReadInputTokens: 2,
      cacheCreationInputTokens: 3,
      totalTokens: 11,
    })
  })

  it("records workflow run ids for SDK result usage aggregation", async () => {
    const agentUsage = new MemoryNamespace<AgentUsageEntryV1>("agent.usage")
    const { router, repository } = createRouter({
      agentUsage,
      session: new ScriptedSession([
        {
          type: "result",
          content: "workflow answer",
          done: true,
          sdkResultUuid: "workflow-result",
          sdkSessionId: "sdk-1",
          usage: {
            input_tokens: 6,
            output_tokens: 7,
            cache_read_input_tokens: 8,
            cache_creation_input_tokens: 9,
          },
        },
      ], "sdk-1"),
    })

    await router.send({
      ...baseMessage("hello"),
      userMeta: {
        source: "workflow",
        workflowRunId: "workflow-run-1",
        workflowNodeId: "node-1",
      },
    })

    await expect(repository.getWorkflowRunUsageSummary("workflow-run-1")).resolves.toEqual({
      inputTokens: 6,
      outputTokens: 7,
      cacheReadInputTokens: 8,
      cacheCreationInputTokens: 9,
      totalTokens: 30,
    })
    await expect(agentUsage.get("workflow-result")).resolves.toMatchObject({
      source: "workflow",
      workflowRunId: "workflow-run-1",
      workflowNodeId: "node-1",
    })
  })

  it("uses streamed SDK text as the turn result when the final result has no content", async () => {
    const { conversations, router } = createRouter({
      session: new ScriptedSession([
        { type: "stream", text: "streamed ", deltaType: "text_delta", sdkSessionId: "sdk-1", event: {} },
        { type: "stream", text: "answer", deltaType: "text_delta", sdkSessionId: "sdk-1", event: {} },
        { type: "result", content: "", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
    })

    const result = await router.send(baseMessage("hello"))
    const savedConversation = await conversations.get(result.conversationId)

    expect(result.resultText).toBe("streamed answer")
    expect(savedConversation?.history.filter((entry) => entry.role === "assistant")).toEqual([
      expect.objectContaining({ content: "streamed answer" }),
    ])
  })

  it("prepares only live session messages while preserving original user history", async () => {
    const session = new ScriptedSession([
      { type: "result", content: "first", done: true, sdkSessionId: "sdk-1" },
      { type: "result", content: "second", done: true, sdkSessionId: "sdk-1" },
    ], "sdk-1")
    const prepareMessage = vi.fn((message: AgentMessage, context: { readonly isNewLiveSession: boolean }) => ({
      ...message,
      content: `${context.isNewLiveSession ? "new" : "reused"}:${message.content}`,
    }))
    const { conversations, router } = createRouter({ session, prepareMessage })

    const first = await router.send(baseMessage("hello"))
    const second = await router.send(baseMessage("again"))
    const savedConversation = await conversations.get(second.conversationId)

    expect(first.resultText).toBe("first")
    expect(second.resultText).toBe("second")
    expect(session.sent).toEqual(["new:hello", "reused:again"])
    expect(savedConversation?.history.filter((entry) => entry.role === "user")).toEqual([
      expect.objectContaining({ content: "hello" }),
      expect.objectContaining({ content: "again" }),
    ])
  })

  it("calls afterTurn after a live turn completes", async () => {
    const afterTurn = vi.fn()
    const session = new ScriptedSession([
      { type: "result", content: "reply", done: true, sdkSessionId: "sdk-1" },
    ], "sdk-1")
    const { router } = createRouter({ session, afterTurn })

    await router.send(baseMessage("hello"))

    expect(afterTurn).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({ content: "hello" }),
      result: expect.objectContaining({ resultText: "reply" }),
    }))
  })

  it("calls afterTurn after a successful side session relay completes", async () => {
    const afterTurn = vi.fn()
    const { router } = createRouter({
      afterTurn,
      session: new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
    })

    await router.sendSideSessionWithTimeout(baseMessage("relay"), "Relay", 100)

    expect(afterTurn).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({ content: "relay" }),
      result: expect.objectContaining({ resultText: "done" }),
    }))
  })

  it("emits and persists afterTurn events after a live turn", async () => {
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const eventRecorder = createEventBusRecorder()
    const { conversations, router } = createRouter({
      agentEvents,
      eventBus: eventRecorder.eventBus,
      afterTurn: () => ({
        events: [{ type: "error", message: "Knowledge base finalization failed." }],
      }),
      session: new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
    })

    const result = await router.send(baseMessage("hello"))
    const saved = await conversations.get(result.conversationId)
    const persisted = await agentEvents.list()

    expect(result.events).toContainEqual(expect.objectContaining({
      type: "error",
      message: "Knowledge base finalization failed.",
    }))
    expect(eventRecorder.events).toContainEqual(expect.objectContaining({ type: "error" }))
    expect(saved?.history).toContainEqual(expect.objectContaining({
      role: "system",
      content: "Knowledge base finalization failed.",
    }))
    expect(persisted).toContainEqual(expect.objectContaining({ eventType: "error" }))
  })

  it("stores original prompt command content while sending the expanded prompt", async () => {
    const commandRouter = {
      handle: vi.fn(async () => ({
        kind: "prompt",
        content: "expanded knowledge base status prompt",
      })),
    } as unknown as AgentCommandRouter
    const session = new ScriptedSession([
      { type: "result", content: "status", done: true, sdkSessionId: "sdk-1" },
    ], "sdk-1")
    const { conversations, router } = createRouter({ commandRouter, session })

    const result = await router.send(baseMessage("/wiki status"))
    const savedConversation = await conversations.get(result.conversationId)

    expect(session.sent).toEqual(["expanded knowledge base status prompt"])
    expect(savedConversation?.history.filter((entry) => entry.role === "user")).toEqual([
      expect.objectContaining({ content: "/wiki status" }),
    ])
  })

  it("returns streamed SDK text as side session partial text when the relay times out", async () => {
    const session = new ControlledSession("sdk-1")
    const { router } = createRouter({ session })

    const pending = router.sendSideSessionWithTimeout(baseMessage("relay"), "Relay", 1)
    await waitFor(() => session.sent.includes("relay"))
    session.emitStreamText("partial")
    const result = await pending

    expect(result).toMatchObject({
      timedOut: true,
      partialText: "partial",
      resultText: "partial",
    })
  })

  it("uses a one-hour default live event timeout for foreground turns", async () => {
    const session = new TrackingTimeoutSession()
    const { router } = createRouter({ session })

    const pending = router.send(baseMessage("long task"))
    await waitFor(() => session.timeoutCalls.length > 0)
    await pending

    expect(session.timeoutCalls).toEqual([60 * 60 * 1000])
  })

  it("uses a one-hour default permission wait before auto-denying", async () => {
    vi.useFakeTimers()
    try {
      const session = new ScriptedSession([
        {
          type: "permissionRequest",
          requestId: "permission-1",
          toolName: "Bash",
          toolInput: "pwd",
          toolInputRaw: { command: "pwd" },
          sdkSessionId: "sdk-1",
        },
      ], "sdk-1")
      const { router } = createRouter({ session })

      const pending = router.send(baseMessage("needs permission"))
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 1)

      expect(session.responses).toEqual([])

      await vi.advanceTimersByTimeAsync(1)
      await pending

      expect(session.responses).toEqual([
        {
          requestId: "permission-1",
          decision: {
            behavior: "deny",
            message: "Permission request timed out waiting for user response.",
          },
        },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("prepares new side live session messages while preserving relay history", async () => {
    const session = new ControlledSession("sdk-side")
    const prepareMessage = vi.fn((message: AgentMessage, context: { readonly isNewLiveSession: boolean }) => ({
      ...message,
      content: `${context.isNewLiveSession ? "new" : "reused"}:${message.content}`,
    }))
    const { conversations, router } = createRouter({ session, prepareMessage })

    const pending = router.sendSideSessionWithTimeout(baseMessage("relay"), "Relay", 100)
    await waitFor(() => session.sent.length > 0)
    session.emitResult("done")
    const result = await pending
    const savedConversation = await conversations.get(result.conversationId)

    expect(prepareMessage).toHaveBeenCalledWith(expect.objectContaining({ content: "relay" }), {
      isNewLiveSession: true,
      conversationId: expect.any(String),
      turnId: expect.any(String),
    })
    expect(session.sent).toEqual(["new:relay"])
    expect(savedConversation?.history.filter((entry) => entry.role === "user")).toEqual([
      expect.objectContaining({ content: "relay" }),
    ])
  })

  it("persists a terminal error when a side session relay times out", async () => {
    const session = new ControlledSession("sdk-timeout")
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const { eventBus, events } = createEventBusRecorder()
    const { conversations, router } = createRouter({
      agentEvents,
      eventBus,
      session,
    })

    const pending = router.sendSideSessionWithTimeout(baseMessage("relay"), "Relay", 1)
    await waitFor(() => session.sent.includes("relay"))
    session.emitStreamText("partial")
    const result = await pending
    const persisted = await agentEvents.list()
    const saved = await conversations.get(result.conversationId)

    expect(result).toMatchObject({
      timedOut: true,
      error: "Agent relay timed out.",
      partialText: "partial",
      resultText: "partial",
    })
    expect(events.filter((event) => event.type === "error")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          event: expect.objectContaining({
            type: "error",
            message: "Agent relay timed out.",
            sdkSessionId: "sdk-timeout",
          }),
        }),
      }),
    ])
    expect(persisted.map((entry) => entry.eventType)).toEqual(["stream", "error"])
    expect(saved?.history).toEqual([
      expect.objectContaining({ role: "user", content: "relay" }),
      expect.objectContaining({
        role: "system",
        content: "Agent relay timed out.",
        metadata: expect.objectContaining({
          agentEventType: "error",
          sdkSessionId: "sdk-timeout",
        }),
      }),
    ])
  })

  it("persists the Claude SDK agent type for timeout side sessions", async () => {
    const { conversations, router } = createRouter({
      session: new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
    })

    const result = await router.sendSideSessionWithTimeout(baseMessage("relay"), "Relay", 100)
    const conversation = await conversations.get(result.conversationId)

    expect(conversation).toMatchObject({
      agentType: "claude-sdk",
      providerId: "anthropic",
      sdkSessionId: "sdk-1",
      resumePolicy: "fresh",
      active: false,
    })
  })

  it("emits background phase events with conversation scope", async () => {
    const { eventBus, events } = createEventBusRecorder()
    const { router } = createRouter({
      eventBus,
      session: new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
    })

    const result = await router.send({
      ...baseMessage("hello"),
      platform: "external",
      sessionKey: "external:chat:user",
    })
    const phaseEvents = events.filter((event) => event.type === "phase.update")

    expect(phaseEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({ conversationId: result.conversationId }),
        scope: { sessionId: result.conversationId },
      }),
    ]))
  })

  it("emits a failed background phase when the SDK turn throws", async () => {
    const { eventBus, events } = createEventBusRecorder()
    const { router } = createRouter({
      eventBus,
      session: new ThrowingSendSession("SDK send failed"),
    })

    const result = await router.send({
      ...baseMessage("hello"),
      platform: "external",
      sessionKey: "external:chat:user",
    })
    const phaseEvents = events.filter((event) => event.type === "phase.update")

    expect(result.error).toBe("SDK send failed")
    expect(phaseEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: expect.objectContaining({
          conversationId: result.conversationId,
          phase: "received",
          status: "done",
        }),
        scope: { sessionId: result.conversationId },
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          conversationId: result.conversationId,
          phase: "failed",
          status: "failed",
          errorMessage: "Agent turn failed",
        }),
        scope: { sessionId: result.conversationId },
      }),
    ]))
    expect(JSON.stringify(phaseEvents)).not.toContain("SDK send failed")
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

  it("returns queued turn failures without raw SDK error text", async () => {
    const warn = vi.fn()
    const logger = {
      warn,
    } as unknown as NonNullable<ConversationRouterDeps["logger"]>
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const { eventBus, events } = createEventBusRecorder()
    const { conversations, router } = createRouter({
      agentEvents,
      eventBus,
      logger,
      session: new ThrowingSendSession("SDK failed token=sk-secret at /Users/liyang/private/repo"),
    })

    const result = await router.send(baseMessage("hello"))
    const errorEvents = events.filter((event) => event.type === "error")
    const persisted = await agentEvents.list()
    const saved = await conversations.get(result.conversationId)

    expect(result.error).toContain("token=[redacted]")
    expect(result.error).toContain("/Users/liyang/private/repo")
    expect(result.error).not.toContain("sk-secret")
    expect(errorEvents).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          event: expect.objectContaining({
            message: result.error,
          }),
        }),
      }),
    ])
    expect(persisted).toEqual([
      expect.objectContaining({
        conversationId: result.conversationId,
        eventType: "error",
        payload: expect.objectContaining({
          type: "error",
          message: result.error,
        }),
      }),
    ])
    expect(saved?.history).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
      expect.objectContaining({
        role: "system",
        content: result.error,
        metadata: expect.objectContaining({ agentEventType: "error" }),
      }),
    ])
    expect(warn).toHaveBeenCalledWith(
      "AgentRuntime queued turn failed.",
      expect.objectContaining({
        boundary: "agent-runtime.queued-turn",
        projectId: "project-1",
        sessionKey: "s1",
        conversationId: conversationId("local", "s1", "active"),
        errorName: "Error",
        errorLength: "SDK failed token=sk-secret at /Users/liyang/private/repo".length,
      }),
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(persisted)).not.toContain("sk-secret")
    expect(JSON.stringify(saved?.history)).toContain("/Users/liyang/private/repo")
  })

  it("persists side session failures without raw SDK error text", async () => {
    const warn = vi.fn()
    const logger = {
      warn,
    } as unknown as NonNullable<ConversationRouterDeps["logger"]>
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const { eventBus, events } = createEventBusRecorder()
    const { conversations, router } = createRouter({
      agentEvents,
      eventBus,
      logger,
      session: new ThrowingSendSession("Side session failed token=sk-secret at /Users/liyang/private/repo"),
    })

    const result = await router.sendSideSessionWithTimeout(baseMessage("relay"), "Relay", 100)
    const errorEvents = events.filter((event) => event.type === "error")
    const persisted = await agentEvents.list()
    const saved = await conversations.get(result.conversationId)

    expect(result.error).toContain("token=[redacted]")
    expect(result.error).toContain("/Users/liyang/private/repo")
    expect(result.error).not.toContain("sk-secret")
    expect(errorEvents).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          event: expect.objectContaining({
            message: result.error,
          }),
        }),
      }),
    ])
    expect(persisted).toEqual([
      expect.objectContaining({
        conversationId: result.conversationId,
        eventType: "error",
        payload: expect.objectContaining({
          type: "error",
          message: result.error,
        }),
      }),
    ])
    expect(saved?.history).toEqual([
      expect.objectContaining({ role: "user", content: "relay" }),
      expect.objectContaining({
        role: "system",
        content: result.error,
        metadata: expect.objectContaining({ agentEventType: "error" }),
      }),
    ])
    expect(warn).toHaveBeenCalledWith(
      "AgentRuntime side session failed.",
      expect.objectContaining({
        boundary: "agent-runtime.side-session",
        projectId: "project-1",
        sessionKey: "s1",
        platform: "local",
        conversationId: result.conversationId,
        providerId: "anthropic",
        timeoutMs: 100,
        errorName: "Error",
        errorLength: "Side session failed token=sk-secret at /Users/liyang/private/repo".length,
      }),
    )
    expect(JSON.stringify(persisted)).not.toContain("sk-secret")
    expect(JSON.stringify(saved?.history)).toContain("/Users/liyang/private/repo")
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(warn.mock.calls)).not.toContain("/Users/liyang/private/repo")
  })

  it("persists a terminal error when a side session cannot approve SDK permissions", async () => {
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const { eventBus, events } = createEventBusRecorder()
    const { conversations, router } = createRouter({
      agentEvents,
      eventBus,
      session: new ScriptedSession([
        {
          type: "permissionRequest",
          requestId: "permission-1",
          toolName: "Bash",
          toolInput: "pwd",
          toolInputRaw: { command: "pwd" },
          sdkSessionId: "sdk-1",
        },
      ], "sdk-1"),
    })

    const result = await router.sendSideSessionWithTimeout(baseMessage("relay"), "Relay", 100)
    const persisted = await agentEvents.list()
    const saved = await conversations.get(result.conversationId)

    expect(result).toMatchObject({
      timedOut: false,
      error: "Relay requested permission.",
    })
    expect(result.events.map((event) => event.type)).toEqual(["permissionRequest", "error"])
    expect(events.filter((event) => event.type === "error")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          event: expect.objectContaining({
            type: "error",
            message: "Relay requested permission.",
          }),
        }),
      }),
    ])
    expect(persisted.map((entry) => entry.eventType)).toEqual(["permissionRequest", "error"])
    expect(saved?.history).toEqual([
      expect.objectContaining({ role: "user", content: "relay" }),
      expect.objectContaining({
        role: "system",
        content: "Bash\npwd",
        metadata: expect.objectContaining({ agentEventType: "permissionRequest" }),
      }),
      expect.objectContaining({
        role: "system",
        content: "Relay requested permission.",
        metadata: expect.objectContaining({ agentEventType: "error" }),
      }),
    ])
  })

  it("uses answer wording when a side session receives AskUserQuestion", async () => {
    const agentEvents = new MemoryNamespace<AgentEventEntryV1>("agent.events")
    const { router } = createRouter({
      agentEvents,
      session: new ScriptedSession([
        {
          type: "permissionRequest",
          requestId: "question-1",
          toolName: "AskUserQuestion",
          toolInput: "处理方式",
          toolInputRaw: {
            questions: [{
              question: "该怎么处理？",
              options: [{ label: "跳过" }, { label: "重试" }],
              multiSelect: false,
            }],
          },
          questions: [{
            question: "该怎么处理？",
            options: [{ label: "跳过" }, { label: "重试" }],
            multiSelect: false,
          }],
          sdkSessionId: "sdk-1",
        },
      ], "sdk-1"),
    })

    const result = await router.sendSideSessionWithTimeout(baseMessage("relay"), "Relay", 100)
    const persisted = await agentEvents.list()

    expect(result).toMatchObject({
      timedOut: false,
      error: "Relay requested a user answer.",
    })
    expect(persisted.map((entry) => entry.eventType)).toEqual(["permissionRequest", "error"])
    expect(persisted[1]?.payload).toEqual(expect.objectContaining({
      message: "Relay requested a user answer.",
    }))
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
        {
          type: "sdkEvent",
          sdkType: "future_message",
          payload: {
            authorization: "Bearer sk-auth",
            headers: { cookie: "sid=secret-cookie" },
            credential: "private-credential",
            workspacePath: "/Users/liyang/private/repo",
            artifact: "C:\\Users\\liyang\\secret\\out.txt",
          },
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
    const persistedPayload = JSON.stringify(persisted.map((entry) => entry.payload))
    expect(persistedPayload).not.toContain("sk-secret")
    expect(persistedPayload).not.toContain("Bearer sk-auth")
    expect(persistedPayload).not.toContain("sid=secret-cookie")
    expect(persistedPayload).not.toContain("private-credential")
    expect(persistedPayload).toContain("/Users/liyang/private/repo")
    expect(persistedPayload).toContain("C:\\\\Users\\\\liyang\\\\secret\\\\out.txt")
    expect(JSON.stringify(persisted[0]?.payload).length).toBeLessThan(12_000)
  })
})

function createRouter(input: {
  readonly conversations?: MemoryNamespace<ConversationEntryV1>
  readonly agentEvents?: MemoryNamespace<AgentEventEntryV1>
  readonly agentUsage?: MemoryNamespace<AgentUsageEntryV1>
  readonly activeProviderId?: string
  readonly env?: Record<string, string>
  readonly session?: AgentLiveSession
  readonly sessions?: readonly AgentLiveSession[]
  readonly message?: AgentLiveSession
  readonly governance?: AgentGovernanceService
  readonly commandRouter?: AgentCommandRouter
  readonly eventBus?: ConversationRouterDeps["eventBus"]
  readonly logger?: ConversationRouterDeps["logger"]
  readonly outbox?: ConversationRouterDeps["outbox"]
  readonly replyTargets?: ConversationRouterDeps["replyTargets"]
  readonly prepareMessage?: ConversationRouterDeps["prepareMessage"]
  readonly afterTurn?: ConversationRouterDeps["afterTurn"]
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
} = {}) {
  const conversations = input.conversations ?? new MemoryNamespace<ConversationEntryV1>("conversations")
  const providerService = new FakeProviderService(input.activeProviderId ?? "anthropic", input.env ?? {})
  const repository = new AgentSessionRepository({
    projectId: "project-1",
    conversations,
    agentUsage: input.agentUsage,
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
      eventBus: input.eventBus,
      logger: input.logger,
      outbox: input.outbox,
      replyTargets: input.replyTargets,
      now: fixedNow,
      permissionGuard: input.permissionGuard,
      auditSink: input.auditSink,
      prepareMessage: input.prepareMessage,
      afterTurn: input.afterTurn,
    },
    repository,
    sessionManager,
    commandRouter: input.commandRouter,
    pendingPermissions,
  })

  return { conversations, router, repository, providerService, factoryCalls }
}

function createEventBusRecorder(): {
  readonly eventBus: ConversationRouterDeps["eventBus"]
  readonly events: RecordedAgentEvent[]
  readonly emits: RecordedAgentEmit[]
} {
  const events: RecordedAgentEvent[] = []
  const emits: RecordedAgentEmit[] = []
  return {
    events,
    emits,
    eventBus: {
      projectId: "project-1",
      emit(event, options) {
        const recorded = event as RecordedAgentEvent
        events.push(recorded)
        emits.push({ event: recorded, options })
      },
      on() {
        return () => {}
      },
      underlying: {} as NonNullable<ConversationRouterDeps["eventBus"]>["underlying"],
    },
  }
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

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
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
  readonly responses: Array<{
    readonly requestId: string
    readonly decision: AgentPermissionDecision
  }> = []
  private readonly events: AgentEvent[]
  private closed = false

  constructor(events: readonly AgentEvent[], private readonly sessionId?: string) {
    this.events = [...events]
  }

  async send(message: AgentMessage): Promise<boolean> {
    this.sent.push(message.content)
    return true
  }

  async respondPermission(
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void> {
    this.responses.push({ requestId, decision })
  }

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

class EndedWithoutTerminalSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  private read = false

  constructor(private readonly sessionId: string) {}

  async send(): Promise<boolean> {
    return true
  }

  async respondPermission(): Promise<void> {}

  async nextEvent(): Promise<AgentEvent | null> {
    this.read = true
    return null
  }

  currentSessionId(): string | undefined {
    return this.sessionId
  }

  alive(): boolean {
    return !this.read
  }

  async close(): Promise<void> {}
}

class ThrowingSendSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"

  constructor(private readonly message: string) {}

  async send(): Promise<boolean> {
    throw new Error(this.message)
  }

  async respondPermission(): Promise<void> {}

  async nextEvent(): Promise<AgentEvent | null> {
    return null
  }

  currentSessionId(): string | undefined {
    return "throwing-sdk"
  }

  alive(): boolean {
    return false
  }

  async close(): Promise<void> {}
}

class TimeoutSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  closed = false

  async send(): Promise<boolean> {
    return true
  }
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

class TrackingTimeoutSession extends TimeoutSession {
  readonly timeoutCalls: number[] = []

  nextEventWithTimeout(timeoutMs: number): Promise<AgentEvent | null> {
    this.timeoutCalls.push(timeoutMs)
    return Promise.resolve(null)
  }
}

class ControlledSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  readonly sent: string[] = []
  private readonly events: AgentEvent[] = []
  private readonly waiters: Array<(event: AgentEvent | null) => void> = []
  private closed = false

  constructor(private readonly sessionId: string) {}

  async send(message: AgentMessage): Promise<boolean> {
    this.sent.push(message.content)
    return true
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

  emitStreamText(content: string): void {
    this.push({ type: "stream", text: content, deltaType: "text_delta", sdkSessionId: this.sessionId, event: {} })
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
