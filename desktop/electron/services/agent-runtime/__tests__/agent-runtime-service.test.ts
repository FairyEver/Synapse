import { describe, expect, it, vi } from "vitest"

import type {
  AgentCommandEntryV1,
  AgentCompressStateEntryV1,
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import type { ProviderService } from "../../provider"
import { AgentRuntimeService, conversationId, permissionActionForTool } from "../agent-runtime-service"
import {
  AGENT_PERMISSION_NOT_PENDING_MESSAGE,
  AGENT_PERMISSION_UPDATED_INPUT_UNSUPPORTED_MESSAGE,
  AGENT_USER_QUESTION_PERSISTENCE_FAILED_MESSAGE,
} from "../agent-error-messages"
import { CustomCommandRegistry } from "../command-registry"
import { SkillRegistry, type AgentSkill } from "../skill-registry"
import type {
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
  AgentUserQuestion,
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

  it("renames an automatically named conversation from an SDK transcript title", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const eventBus = { emit: vi.fn() }
    const session = new ScriptedSession([{
      type: "result",
      content: "done",
      done: true,
      sdkSessionId: "sdk-1",
    }], "sdk-1")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService(
        "anthropic",
        { ANTHROPIC_API_KEY: "sk-test" },
      ) as unknown as ProviderService,
      createSession: async (input) => {
        await input.onConversationTitle?.("Send test message in WeCom")
        return session
      },
      eventBus: eventBus as never,
      now: fixedNow,
    })
    const conversation = await service.createSession({
      sessionKey: "s1",
      platform: "local",
      name: "新会话 15:20",
      agentType: "claude-code",
    })

    await service.sendToConversation(baseMessage("hello"), conversation.id)

    await expect(conversations.get(conversation.id)).resolves.toMatchObject({
      name: "Send test message in WeCom",
    })
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "agent",
      type: "conversationUpdated",
      payload: expect.objectContaining({ conversationId: conversation.id }),
    }))
  })

  it("keeps the Agent turn running when generated title persistence fails", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
    const session = new ScriptedSession([{
      type: "result",
      content: "done",
      done: true,
      sdkSessionId: "sdk-1",
    }], "sdk-1")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService(
        "anthropic",
        { ANTHROPIC_API_KEY: "sk-test" },
      ) as unknown as ProviderService,
      createSession: async (input) => {
        await input.onConversationTitle?.("Private quarterly plan")
        return session
      },
      logger: logger as never,
      now: fixedNow,
    })
    const repository = (service as unknown as {
      repository: { renameSessionFromGeneratedTitle(conversationId: string, title: string): Promise<unknown> }
    }).repository
    const rawError = new Error("title write failed for Private quarterly plan token=sk-secret at /Users/example")
    vi.spyOn(repository, "renameSessionFromGeneratedTitle").mockRejectedValue(rawError)
    const conversation = await service.createSession({
      sessionKey: "s1",
      platform: "local",
      name: "新会话 15:20",
      agentType: "claude-code",
    })

    await expect(service.sendToConversation(baseMessage("hello"), conversation.id)).resolves.toMatchObject({
      resultText: "done",
    })

    expect(logger.warn).toHaveBeenCalledWith(
      "Agent generated conversation title persistence failed.",
      {
        boundary: "agent-runtime.conversation-title.generated",
        projectId: "project-1",
        conversationId: conversation.id,
        errorName: "Error",
        errorLength: rawError.message.length,
      },
    )
    const serializedLogs = JSON.stringify(logger.warn.mock.calls)
    expect(serializedLogs).not.toContain("Private quarterly plan")
    expect(serializedLogs).not.toContain("sk-secret")
    expect(serializedLogs).not.toContain("/Users/example")
  })

  it("falls back to the first user message when the SDK emits no transcript title", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const eventBus = { emit: vi.fn() }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService(
        "anthropic",
        { ANTHROPIC_API_KEY: "sk-test" },
      ) as unknown as ProviderService,
      createSession: () => new ScriptedSession([{
        type: "result",
        content: "你好！有什么可以帮你的吗？",
        done: true,
        sdkSessionId: "sdk-1",
      }], "sdk-1"),
      eventBus: eventBus as never,
      now: fixedNow,
    })
    const conversation = await service.createSession({
      sessionKey: "s1",
      platform: "local-renderer",
      name: "新对话 15:54",
      agentType: "claude-code",
    })

    await service.sendToConversation({
      ...baseMessage("你好"),
      platform: "local-renderer",
    }, conversation.id)

    await expect(conversations.get(conversation.id)).resolves.toMatchObject({ name: "你好" })
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "agent",
      type: "conversationUpdated",
      payload: expect.objectContaining({ conversationId: conversation.id }),
    }))
  })

  it("reports active sessions only for managed knowledge base runtimes", () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const managedService = new AgentRuntimeService({
      projectId: "kb-1",
      workDir: "/kb",
      conversations,
      managedKnowledgeBase: true,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
    })
    const regularService = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
    })

    ;(managedService as unknown as {
      states: Map<string, { busy: boolean; activeTurns: number; queue: unknown[] }>
    }).states.set("conversation-1", { busy: true, activeTurns: 1, queue: [] })
    ;(regularService as unknown as {
      states: Map<string, { busy: boolean; activeTurns: number; queue: unknown[] }>
    }).states.set("conversation-1", { busy: true, activeTurns: 1, queue: [] })

    expect(managedService.hasActiveKnowledgeBaseSession()).toBe(true)
    expect(regularService.hasActiveKnowledgeBaseSession()).toBe(false)
  })

  it("reports idle alive sessions for managed knowledge base runtimes", () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const managedService = new AgentRuntimeService({
      projectId: "kb-1",
      workDir: "/kb",
      conversations,
      managedKnowledgeBase: true,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
    })

    ;(managedService as unknown as {
      states: Map<string, {
        busy: boolean
        activeTurns: number
        queue: unknown[]
        liveSession: { alive: () => boolean }
      }>
    }).states.set("conversation-1", {
      busy: false,
      activeTurns: 0,
      queue: [],
      liveSession: { alive: () => true },
    })

    expect(managedService.hasActiveKnowledgeBaseSession()).toBe(true)
  })

  it("adds deterministic knowledge base lint preflight to managed wiki-lint skills", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new ScriptedSession([
      { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
    ], "sdk-1")
    const preflight = {
      run: vi.fn(async () => ({
        generatedDate: "2026-04-26",
        pagesScanned: 3,
        issues: [],
        address: {
          counter: 4,
          highestCAddress: "c-000003",
          postRolloutPagesChecked: 3,
          legacyPagesPendingBackfill: 0,
          issues: [],
        },
        tiling: {
          status: "ok" as const,
          reportPath: "wiki/meta/tiling-report-2026-04-26.md",
          errors: 0,
          reviews: 1,
          calibrated: true,
        },
      })),
    }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/kb",
      conversations,
      managedKnowledgeBase: true,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      skills: new StaticSkillRegistry({
        name: "wiki-lint",
        prompt: "Use the Synapse preflight appendix.",
        source: "/kb/skills/wiki-lint/SKILL.md",
      }),
      knowledgeBaseLintPreflight: preflight,
      now: fixedNow,
    })

    await service.send(baseMessage("/wiki-lint"))

    expect(preflight.run).toHaveBeenCalledWith("/kb")
    expect(session.sent[0]).toContain("Use the Synapse preflight appendix.")
    expect(session.sent[0]).toContain("## Synapse 确定性预检")
    expect(session.sent[0]).toContain("不要重新运行 DragonScale 脚本")
    expect(session.sent[0]).toContain("Report: wiki/meta/tiling-report-2026-04-26.md")
  })

  it("passes side-channel reply environment into live SDK sessions", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new ScriptedSession([
      { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
    ], "sdk-1")
    const replyTargets = replyTargetsMock({
      CC_PROJECT: "side-project",
      CC_SESSION_KEY: "s1",
      SYNAPSE_SIDE_CHANNEL_URL: "http://127.0.0.1:10000/send",
      SYNAPSE_SIDE_CHANNEL_TOKEN: "side-token",
    })
    const factoryCalls: Array<{ env: Record<string, string> }> = []
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {
        ANTHROPIC_API_KEY: "sk-test",
        CC_PROJECT: "provider-project",
      }) as unknown as ProviderService,
      createSession: (input) => {
        factoryCalls.push({ env: input.env })
        return session
      },
      replyTargets,
      now: fixedNow,
    })

    await service.send(baseMessage("hello"))

    expect(replyTargets.getAgentEnv).toHaveBeenCalledWith("project-1", "s1")
    expect(factoryCalls[0]?.env).toEqual({
      CC_PROJECT: "provider-project",
      CC_SESSION_KEY: "s1",
      SYNAPSE_SIDE_CHANNEL_URL: "http://127.0.0.1:10000/send",
      SYNAPSE_SIDE_CHANNEL_TOKEN: "side-token",
      ANTHROPIC_API_KEY: "sk-test",
    })
  })

  it("checks agent.spawn before creating a renderer session and audits denial", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: false, reason: "blocked by policy", policyId: "policy-1" })),
    }
    const auditSink = { record: vi.fn() }
    const createSession = vi.fn(() => new ScriptedSession([
      { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
    ], "sdk-1"))
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession,
      permissionGuard: permissionGuard as never,
      auditSink: auditSink as never,
      now: fixedNow,
    })

    const result = await service.send({ ...baseMessage("hello"), platform: "local-renderer" })

    expect(result.error).toBe("Agent 启动被权限策略拒绝。")
    expect(createSession).not.toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "agent.spawn",
      actor: { kind: "user", id: "user-1" },
      resource: "local-renderer:project-1:s1",
      context: expect.objectContaining({
        projectId: "project-1",
        sessionKey: "s1",
        conversationId: conversationId("local-renderer", "s1", "active"),
        platform: "local-renderer",
        providerId: "anthropic",
      }),
    })
    expect(auditSink.record).toHaveBeenCalledWith({
      action: "agent.spawn",
      actor: { kind: "user", id: "user-1" },
      resource: "local-renderer:project-1:s1",
      outcome: "denied",
      metadata: expect.objectContaining({
        projectId: "project-1",
        sessionKey: "s1",
        conversationId: conversationId("local-renderer", "s1", "active"),
        platform: "local-renderer",
        providerId: "anthropic",
        reason: "blocked by policy",
        policyId: "policy-1",
      }),
    })
  })

  it("resolves registered prompt commands dynamically for listing and routing", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new ScriptedSession([
      { type: "result", content: "wiki done", done: true, sdkSessionId: "sdk-1" },
    ], "sdk-1")
    let wikiEnabled = false
    const registeredPromptCommands = vi.fn(async () =>
      wikiEnabled
        ? [{
          name: "wiki",
          buildPrompt: () => "expanded wiki prompt",
        }]
        : [])
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      registeredPromptCommands,
      now: fixedNow,
    })

    await expect(service.listPublishedCommands()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "wiki" })]),
    )
    wikiEnabled = true
    await expect(service.listPublishedCommands()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "wiki", source: "custom", kind: "prompt" })]),
    )
    const result = await service.send(baseMessage("/wiki status"))

    expect(result.resultText).toBe("wiki done")
    expect(session.sent).toEqual(["expanded wiki prompt"])
  })

  it("includes registered contribution UI commands in published commands", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const registeredPromptCommands = vi.fn(async () => [
      {
        name: "wiki",
        description: "Knowledge base command",
        buildPrompt: () => "expanded wiki prompt",
      },
    ])
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      registeredPromptCommands,
      publishedProjectCommands: async () => [{
        name: "wiki ingest",
        description: "扫描 .raw/ 变更来源并导入到 wiki。",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        ui: {
          group: "knowledge-base",
          label: "汲取来源",
          action: "send",
          insertText: "/wiki ingest",
        },
      }],
    })

    await expect(service.listPublishedCommands()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "wiki" }),
        expect.objectContaining({
          name: "wiki ingest",
          ui: {
            group: "knowledge-base",
            label: "汲取来源",
            action: "send",
            insertText: "/wiki ingest",
          },
        }),
      ]),
    )
  })

  it("filters platform-limited registered and project commands from published commands", async () => {
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations: new MemoryNamespace<ConversationEntryV1>("conversations"),
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      registeredPromptCommands: async () => [{
        name: "wiki",
        description: "Knowledge base command",
        allowedPlatforms: ["local-renderer"],
        buildPrompt: () => "expanded wiki prompt",
      }],
      publishedProjectCommands: async () => [{
        name: "wiki ingest",
        description: "扫描 .raw/ 变更来源并导入到 wiki。",
        source: "custom",
        kind: "prompt",
        adminOnly: false,
        allowedPlatforms: ["local-renderer"],
      }],
    })

    await expect(service.listPublishedCommands("scheduled")).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "wiki" }),
        expect.objectContaining({ name: "wiki ingest" }),
      ]),
    )
  })

  it("uses the Windows default shell before escaping custom exec command args", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    })

    try {
      const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
      const commands = new MemoryNamespace<AgentCommandEntryV1>("agent.commands")
      const customCommands = new CustomCommandRegistry({
        projectId: "project-1",
        commands,
        now: fixedNow,
      })
      await customCommands.addExec({
        name: "echo-user",
        exec: "Write-Output",
        createdBy: "user-1",
      })
      const run = vi.fn(async () => ({
        exitCode: 0,
        signal: null,
        stdout: "ok",
        stderr: "",
        timedOut: false,
        durationMs: 1,
      }))
      const service = new AgentRuntimeService({
        projectId: "project-1",
        workDir: "C:\\repo",
        conversations,
        providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
        customCommands,
        commandRunner: { run },
        now: fixedNow,
      })

      await service.send({ ...baseMessage('/echo-user "hello world"'), platform: "local-renderer" })

      expect(run).toHaveBeenCalledWith(expect.objectContaining({
        command: "powershell.exe",
        args: [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Write-Output 'hello world'",
        ],
      }))
    } finally {
      if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor)
    }
  })

  it("escapes embedded double quotes for explicit cmd custom commands", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const commands = new MemoryNamespace<AgentCommandEntryV1>("agent.commands")
    const customCommands = new CustomCommandRegistry({
      projectId: "project-1",
      commands,
      now: fixedNow,
    })
    await customCommands.addExec({
      name: "echo-user",
      exec: "echo",
      shell: "cmd",
      createdBy: "user-1",
    })
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }))
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "C:\\repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      customCommands,
      commandRunner: { run },
      now: fixedNow,
    })

    await service.send({
      ...baseMessage('/echo-user "quoted \\"value\\" & still one arg"'),
      platform: "local-renderer",
    })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        'echo "quoted ""value"" & still one arg"',
      ],
    }))
  })

  it("passes side-channel reply environment into custom command execution", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const commands = new MemoryNamespace<AgentCommandEntryV1>("agent.commands")
    const customCommands = new CustomCommandRegistry({
      projectId: "project-1",
      commands,
      now: fixedNow,
    })
    await customCommands.addExec({
      name: "reply-env",
      exec: "env",
      createdBy: "user-1",
    })
    const sessionEnv = {
      CC_PROJECT: "project-1",
      CC_SESSION_KEY: "s1",
      SYNAPSE_SIDE_CHANNEL_URL: "http://127.0.0.1:10000/send",
      SYNAPSE_SIDE_CHANNEL_TOKEN: "side-token",
    }
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "ok",
      stderr: "",
      timedOut: false,
      durationMs: 1,
    }))
    const executionIsolation = {
      resolveProcessIsolation: vi.fn(async (_projectId: string, envKeys: readonly string[]) => ({
        kind: "run_as_user" as const,
        user: "agent-user",
        envAllowlist: envKeys,
      })),
    }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      customCommands,
      commandRunner: { run },
      executionIsolation,
      replyTargets: replyTargetsMock(sessionEnv),
      now: fixedNow,
    })

    await service.send({ ...baseMessage("/reply-env"), platform: "local-renderer" })

    expect(executionIsolation.resolveProcessIsolation).toHaveBeenCalledWith("project-1", Object.keys(sessionEnv))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      env: sessionEnv,
      envAllowlist: Object.keys(sessionEnv),
      isolation: {
        kind: "run_as_user",
        user: "agent-user",
        envAllowlist: Object.keys(sessionEnv),
      },
    }))
  })

  it("redacts sensitive custom command output before persisting it", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const commands = new MemoryNamespace<AgentCommandEntryV1>("agent.commands")
    const customCommands = new CustomCommandRegistry({
      projectId: "project-1",
      commands,
      now: fixedNow,
    })
    await customCommands.addExec({
      name: "leaky-env",
      exec: "env",
      createdBy: "user-1",
    })
    const run = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: [
        "SYNAPSE_SIDE_CHANNEL_TOKEN=side-token",
        "Authorization: Bearer bearer-token",
        "Cookie: sid=cookie-token",
        "read /Users/liyang/project/file.ts",
      ].join("\n"),
      stderr: "token=stderr-token",
      timedOut: false,
      durationMs: 1,
    }))
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      customCommands,
      commandRunner: { run },
      now: fixedNow,
    })

    const result = await service.send({ ...baseMessage("/leaky-env"), platform: "local-renderer" })
    const conversation = await conversations.get(result.conversationId)
    const serialized = JSON.stringify([result, conversation])

    expect(serialized).toContain("[redacted]")
    expect(serialized).toContain("/Users/liyang/project/file.ts")
    expect(serialized).not.toContain("side-token")
    expect(serialized).not.toContain("bearer-token")
    expect(serialized).not.toContain("cookie-token")
    expect(serialized).not.toContain("stderr-token")
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
    await expect(turn).resolves.toMatchObject({ error: "已停止本次执行。" })
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
    await expect(turn).resolves.toMatchObject({ error: "已停止本次执行。" })
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

  it("does not echo sanitized pending tool input when allowing a write permission", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new PermissionSession("conversation-a-permission-1", "write allowed", {
      toolName: "Write",
      toolInput: JSON.stringify({
        file_path: "/repo/output.md",
        content: "# Title\n\nLong body...[truncated]",
      }),
      toolInputRaw: {
        file_path: "/repo/output.md",
        content: "# Title\n\nLong body...[truncated]",
      },
    })
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs write"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      actor: { kind: "user" },
    })

    expect(session.responses).toEqual([{
      requestId: "conversation-a-permission-1",
      behavior: "allow",
    }])
    expect(JSON.stringify(session.responses)).not.toContain("[truncated]")
    await expect(turn).resolves.toMatchObject({ resultText: "write allowed" })
  })

  it("rejects updated input on regular tool permission responses", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const session = new PermissionSession("conversation-a-permission-1", "write allowed", {
      toolName: "Write",
      toolInput: JSON.stringify({
        file_path: "/repo/output.md",
        content: "# Title",
      }),
      toolInputRaw: {
        file_path: "/repo/output.md",
        content: "# Title",
      },
    })
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      permissionGuard: permissionGuard as never,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs write"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await expect(service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      updatedInput: {
        file_path: "/repo/other.md",
        content: "# Changed",
      },
      actor: { kind: "user" },
    })).rejects.toThrow(AGENT_PERMISSION_UPDATED_INPUT_UNSUPPORTED_MESSAGE)

    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(session.responses).toEqual([])
    expect(service.listPendingPermissions()).toHaveLength(1)

    await service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      actor: { kind: "user" },
    })

    expect(session.responses).toEqual([{
      requestId: "conversation-a-permission-1",
      behavior: "allow",
    }])
    await expect(turn).resolves.toMatchObject({ resultText: "write allowed" })
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

  it("answers AskUserQuestion without running permission guard", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const eventBus = { emit: vi.fn() }
    const questions = [{
      question: "该怎么处理？",
      header: "处理方式",
      options: [
        { label: "跳过", description: "保持现状" },
        { label: "重试", description: "重新处理" },
      ],
      multiSelect: false,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "question answered")
    const permissionGuard = { check: vi.fn(async () => ({ allowed: false, reason: "should not run" })) }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      permissionGuard: permissionGuard as never,
      eventBus: eventBus as never,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs choice"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    expect(service.listPendingPermissions()[0]?.questions).toEqual(questions)
    await service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      updatedInput: { answers: { "question-0": "重试" } },
      actor: { kind: "user" },
    })

    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(session.responses).toEqual([{
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      updatedInput: {
        questions,
        answers: { "该怎么处理？": "重试" },
      },
    }])
    const result = await turn
    expect(result).toMatchObject({ resultText: "question answered" })
    const stored = await conversations.get(result.conversationId)
    expect(stored?.history.find((entry) => entry.metadata?.requestId === "conversation-a-permission-1")?.metadata)
      .toMatchObject({
        userQuestionResolution: {
          status: "answered",
          resolvedAt: "2026-04-26T00:00:00.000Z",
          answers: [{ questionIndex: 0, values: ["重试"] }],
        },
      })
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "conversationUpdated",
      payload: expect.objectContaining({ conversationId: result.conversationId }),
    }))
  })

  it("persists an AskUserQuestion answer before continuing with later events", async () => {
    const conversations = new BlockingQuestionResolutionNamespace()
    const questions = [{
      question: "继续吗？",
      options: [{ label: "继续" }],
      multiSelect: false,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "continued after answer")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs answer"))
    await waitFor(() => service.listPendingPermissions().length === 1)
    const response = service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      updatedInput: { answers: { "question-0": "继续" } },
      actor: { kind: "user" },
    })

    await conversations.waitForResolutionWrite()
    expect(session.responses).toEqual([])
    await expect(resolveSoon(turn)).resolves.toBe("timeout")
    conversations.releaseResolutionWrite()

    await response
    const result = await turn
    const stored = await conversations.get(result.conversationId)
    expect(stored?.history.find((entry) => entry.metadata?.requestId === "conversation-a-permission-1")?.metadata)
      .toMatchObject({ userQuestionResolution: { status: "answered" } })
    expect(stored?.history).toContainEqual(expect.objectContaining({
      content: "continued after answer",
    }))
  })

  it("lets a claimed AskUserQuestion answer win when its timeout fires during persistence", async () => {
    const conversations = new BlockingQuestionResolutionNamespace()
    const questions = [{
      question: "继续吗？",
      options: [{ label: "继续" }],
      multiSelect: false,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "continued after answer")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      permissionTimeoutMs: 25,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs answer"))
    await waitFor(() => service.listPendingPermissions().length === 1)
    const response = service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      updatedInput: { answers: { "question-0": "继续" } },
      actor: { kind: "user" },
    })

    await conversations.waitForResolutionWrite()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(session.responses).toEqual([])
    conversations.releaseResolutionWrite()

    await response
    const result = await turn
    expect(session.responses).toEqual([{
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      updatedInput: {
        questions,
        answers: { "继续吗？": "继续" },
      },
    }])
    const stored = await conversations.get(result.conversationId)
    expect(stored?.history.find((entry) => entry.metadata?.requestId === "conversation-a-permission-1")?.metadata)
      .toMatchObject({ userQuestionResolution: { status: "answered" } })
  })

  it("keeps AskUserQuestion pending when its answer cannot be persisted", async () => {
    const conversations = new FailingQuestionResolutionNamespace()
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }
    const questions = [{
      question: "继续吗？",
      options: [{ label: "继续" }],
      multiSelect: false,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "continued after retry")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      logger: logger as never,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs answer"))
    await waitFor(() => service.listPendingPermissions().length === 1)
    const request = {
      requestId: "conversation-a-permission-1",
      behavior: "allow" as const,
      updatedInput: { answers: { "question-0": "继续" } },
      actor: { kind: "user" as const },
    }

    await expect(service.respondPermission(request))
      .rejects.toThrow(AGENT_USER_QUESTION_PERSISTENCE_FAILED_MESSAGE)
    expect(session.responses).toEqual([])
    expect(service.listPendingPermissions()).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(
      "Agent user question response attempt persistence failed.",
      expect.objectContaining({
        boundary: "agent-runtime.user-question-response-attempt",
        requestId: "conversation-a-permission-1",
        status: "answered",
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("继续")

    await service.respondPermission(request)
    expect(session.responses).toHaveLength(1)
    await expect(turn).resolves.toMatchObject({ resultText: "continued after retry" })
  })

  it("does not mark AskUserQuestion answered when the SDK response fails", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }
    const questions = [{
      question: "继续吗？",
      options: [{ label: "继续" }],
      multiSelect: false,
    }]
    const session = new FailingQuestionResponseSession(
      "conversation-a-permission-1",
      questions,
      "continued after retry",
    )
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      logger: logger as never,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs answer"))
    await waitFor(() => service.listPendingPermissions().length === 1)
    const request = {
      requestId: "conversation-a-permission-1",
      behavior: "allow" as const,
      updatedInput: { answers: { "question-0": "继续" } },
      actor: { kind: "user" as const },
    }

    await expect(service.respondPermission(request)).rejects.toThrow("SDK response unavailable")
    expect(service.listPendingPermissions()).toHaveLength(1)
    const pendingHistory = (await conversations.list())[0]?.history.find(
      (entry) => entry.metadata?.requestId === request.requestId,
    )
    expect(pendingHistory?.metadata?.userQuestionResolution).toBeUndefined()
    expect(pendingHistory?.metadata?.userQuestionResolutionAttempt).toMatchObject({
      status: "answered",
    })
    expect(logger.warn).toHaveBeenCalledWith(
      "Agent user question SDK response failed.",
      expect.objectContaining({
        boundary: "agent-runtime.user-question-sdk-response",
        requestId: request.requestId,
        behavior: "allow",
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("继续")

    await service.respondPermission(request)
    const result = await turn
    const stored = await conversations.get(result.conversationId)
    const resolvedHistory = stored?.history.find(
      (entry) => entry.metadata?.requestId === request.requestId,
    )
    expect(resolvedHistory?.metadata?.userQuestionResolution).toMatchObject({ status: "answered" })
    expect(resolvedHistory?.metadata?.userQuestionResolutionAttempt).toBeUndefined()
  })

  it("cancels AskUserQuestion when the SDK no longer has the pending request", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const questions = [{
      question: "继续吗？",
      options: [{ label: "继续" }],
      multiSelect: false,
    }]
    const session = new StaleQuestionResponseSession(
      "conversation-a-permission-1",
      questions,
      "unused",
    )
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs answer"))
    await waitFor(() => service.listPendingPermissions().length === 1)
    const requestId = "conversation-a-permission-1"

    await expect(service.respondPermission({
      requestId,
      behavior: "allow",
      updatedInput: { answers: { "question-0": "继续" } },
      actor: { kind: "user" },
    })).rejects.toThrow(AGENT_PERMISSION_NOT_PENDING_MESSAGE)

    expect(service.listPendingPermissions()).toEqual([])
    await expect(turn).resolves.toBeDefined()
    const stored = (await conversations.list())[0]
    const resolvedHistory = stored?.history.find(
      (entry) => entry.metadata?.requestId === requestId,
    )
    expect(resolvedHistory?.metadata?.userQuestionResolution).toMatchObject({ status: "cancelled" })
    expect(resolvedHistory?.metadata?.userQuestionResolutionAttempt).toBeUndefined()
  })

  it("does not wait for an AskUserQuestion whose history entry failed to persist", async () => {
    const conversations = new FailingQuestionHistoryNamespace()
    const questions = [{
      question: "继续吗？",
      options: [{ label: "继续" }],
      multiSelect: false,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "unused")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const result = await service.send(baseMessage("needs answer"))

    expect(result.error).toBe(AGENT_USER_QUESTION_PERSISTENCE_FAILED_MESSAGE)
    expect(service.listPendingPermissions()).toEqual([])
    expect(session.responses).toEqual([])
  })

  it("normalizes multi-select arrays for the SDK and stored resolution", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const questions = [{
      question: "选择处理范围",
      options: [
        { label: "文档, 图片" },
        { label: "音频" },
      ],
      multiSelect: true,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "question answered")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs choices"))
    await waitFor(() => service.listPendingPermissions().length === 1)
    await service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      updatedInput: { answers: { "question-0": ["  文档, 图片  ", "", "音频"] } },
      actor: { kind: "user" },
    })

    expect(session.responses[0]?.updatedInput).toEqual({
      questions,
      answers: { "选择处理范围": "文档, 图片, 音频" },
    })
    const result = await turn
    const stored = await conversations.get(result.conversationId)
    expect(stored?.history.find((entry) => entry.metadata?.requestId === "conversation-a-permission-1")?.metadata)
      .toMatchObject({
        userQuestionResolution: {
          status: "answered",
          answers: [{ questionIndex: 0, values: ["文档, 图片", "音频"] }],
        },
      })
  })

  it("passes through AskUserQuestion answers already keyed by question text", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const questions = [{
      question: "是否将 L1/L2 问题上传为 Gitee 缺陷？（当前默认项目: 22）",
      header: "Gitee 缺陷",
      options: [
        { label: "仅本次上传" },
        { label: "本次不上传" },
        { label: "以后都上传" },
      ],
      multiSelect: false,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "question answered")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs choice"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      updatedInput: {
        answers: {
          "是否将 L1/L2 问题上传为 Gitee 缺陷？（当前默认项目: 22）": "以后都上传",
        },
      },
      actor: { kind: "user" },
    })

    expect(session.responses[0]?.updatedInput).toEqual({
      questions,
      answers: {
        "是否将 L1/L2 问题上传为 Gitee 缺陷？（当前默认项目: 22）": "以后都上传",
      },
    })
    await expect(turn).resolves.toMatchObject({ resultText: "question answered" })
  })

  it("uses a numbered response fallback for duplicate AskUserQuestion text", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const questions = [
      {
        question: "请选择处理方式",
        header: "当前文件",
        options: [
          { label: "保留当前" },
          { label: "覆盖当前" },
        ],
        multiSelect: false,
      },
      {
        question: "请选择处理方式",
        header: "目标文件",
        options: [
          { label: "保留目标" },
          { label: "覆盖目标" },
        ],
        multiSelect: false,
      },
    ]
    const session = new QuestionSession("conversation-a-permission-1", questions, "question answered")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs choices"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      updatedInput: {
        answers: {
          "question-0": "覆盖当前",
          "question-1": "保留目标",
        },
      },
      actor: { kind: "user" },
    })

    expect(session.responses[0]?.updatedInput).toEqual({
      questions,
      response: [
        "1. 当前文件: 请选择处理方式: 覆盖当前",
        "2. 目标文件: 请选择处理方式: 保留目标",
      ].join("\n"),
    })
    await expect(turn).resolves.toMatchObject({ resultText: "question answered" })
  })

  it("rejects AskUserQuestion allow responses without answers", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const questions = [{
      question: "该怎么处理？",
      header: "处理方式",
      options: [
        { label: "跳过" },
        { label: "重试" },
      ],
      multiSelect: false,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "unused")
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      permissionGuard: permissionGuard as never,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs choice"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await expect(service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      actor: { kind: "user" },
    })).rejects.toThrow("继续前需要先提供用户回复。")

    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(session.responses).toEqual([{
      requestId: "conversation-a-permission-1",
      behavior: "deny",
      message: "未收到选择，已停止操作。",
    }])
    await expect(resolveSoon(turn)).resolves.not.toBe("timeout")
  })

  it("rejects AskUserQuestion allow responses with only blank array answers", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const questions = [{
      question: "选择处理范围",
      options: [{ label: "文档" }, { label: "图片" }],
      multiSelect: true,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "question skipped")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs choices"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await expect(service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      updatedInput: { answers: { "question-0": ["", "   "] } },
      actor: { kind: "user" },
    })).rejects.toThrow("继续前需要回答所有问题。")

    expect(session.responses).toEqual([{
      requestId: "conversation-a-permission-1",
      behavior: "deny",
      message: "未收到选择，已停止操作。",
    }])
    const result = await turn
    const stored = await conversations.get(result.conversationId)
    expect(stored?.history.find((entry) => entry.metadata?.requestId === "conversation-a-permission-1")?.metadata)
      .toMatchObject({ userQuestionResolution: { status: "skipped" } })
  })

  it("rejects AskUserQuestion allow responses that do not cover every question", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const questions = [
      {
        question: "请选择处理方式",
        header: "当前文件",
        options: [{ label: "保留当前" }, { label: "覆盖当前" }],
        multiSelect: false,
      },
      {
        question: "请选择处理方式",
        header: "目标文件",
        options: [{ label: "保留目标" }, { label: "覆盖目标" }],
        multiSelect: false,
      },
    ]
    const session = new QuestionSession("conversation-a-permission-1", questions, "unused")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs choices"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await expect(service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "allow",
      updatedInput: { answers: { "请选择处理方式": "保留目标" } },
      actor: { kind: "user" },
    })).rejects.toThrow("继续前需要回答所有问题。")

    expect(session.responses).toEqual([{
      requestId: "conversation-a-permission-1",
      behavior: "deny",
      message: "未收到选择，已停止操作。",
    }])
    await expect(resolveSoon(turn)).resolves.not.toBe("timeout")
  })

  it("uses empty answer stop wording for AskUserQuestion deny responses without answers", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const questions = [{
      question: "该怎么处理？",
      header: "处理方式",
      options: [
        { label: "跳过" },
        { label: "重试" },
      ],
      multiSelect: false,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "question skipped")
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      permissionGuard: permissionGuard as never,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs choice"))
    await waitFor(() => service.listPendingPermissions().length === 1)

    await service.respondPermission({
      requestId: "conversation-a-permission-1",
      behavior: "deny",
      message: "User skipped the question.",
      actor: { kind: "user" },
    })

    expect(permissionGuard.check).not.toHaveBeenCalled()
    expect(session.responses).toEqual([{
      requestId: "conversation-a-permission-1",
      behavior: "deny",
      message: "未收到选择，已停止操作。",
    }])
    const result = await turn
    expect(result).toMatchObject({ resultText: "question skipped" })
    const stored = await conversations.get(result.conversationId)
    expect(stored?.history.find((entry) => entry.metadata?.requestId === "conversation-a-permission-1")?.metadata)
      .toMatchObject({ userQuestionResolution: { status: "skipped" } })
  })

  it("uses answer timeout wording for AskUserQuestion pending requests", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const questions = [{
      question: "该怎么处理？",
      header: "处理方式",
      options: [
        { label: "跳过" },
        { label: "重试" },
      ],
      multiSelect: false,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "question timed out")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      permissionTimeoutMs: 1,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs choice"))
    await waitFor(() => service.listPendingPermissions().length === 1)
    await waitFor(() => session.responses.length === 1)

    expect(session.responses).toEqual([{
      requestId: "conversation-a-permission-1",
      behavior: "deny",
      message: "等待用户回复超时，已停止本次操作。",
    }])
    const result = await turn
    expect(result).toMatchObject({ resultText: "question timed out" })
    const stored = await conversations.get(result.conversationId)
    expect(stored?.history.find((entry) => entry.metadata?.requestId === "conversation-a-permission-1")?.metadata)
      .toMatchObject({ userQuestionResolution: { status: "timed_out" } })
  })

  it("records a pending AskUserQuestion as cancelled when the turn stops", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const questions = [{
      question: "继续吗？",
      options: [{ label: "继续" }, { label: "停止" }],
      multiSelect: false,
    }]
    const session = new QuestionSession("conversation-a-permission-1", questions, "unused")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => session,
      now: fixedNow,
    })

    const turn = service.send(baseMessage("needs choice"))
    await waitFor(() => service.listPendingPermissions().length === 1)
    const pending = service.listPendingPermissions()[0]
    await expect(service.cancelTurn(pending!.conversationId)).resolves.toEqual({ status: "hard-killed" })
    await turn

    const stored = await conversations.get(pending!.conversationId)
    expect(stored?.history.find((entry) => entry.metadata?.requestId === "conversation-a-permission-1")?.metadata)
      .toMatchObject({ userQuestionResolution: { status: "cancelled" } })
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
      command: "curl -H 'Authorization: Bearer [redacted]' /Users/liyang/private/file.ts",
    })
    expect(JSON.stringify(pending)).not.toContain("sk-tool")
    expect(JSON.stringify(pending)).toContain("/Users/liyang/private")

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
    await expect(turn).resolves.toMatchObject({ error: "已停止本次执行。" })
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

  it("clears cached SDK session ids when resetting or deleting sessions", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const id = conversationId("local", "s1", "active")
    await conversations.upsert({
      id,
      schemaVersion: 1,
      projectId: "project-1",
      sessionKey: "s1",
      platform: "local",
      name: "s1",
      active: true,
      history: [],
      createdAt: fixedNow().toISOString(),
      updatedAt: fixedNow().toISOString(),
    })
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      now: fixedNow,
    })
    const router = (service as unknown as {
      conversationRouter: { forgetSavedSdkSession?: (conversationIdValue: string) => void }
    }).conversationRouter
    router.forgetSavedSdkSession = vi.fn()

    await service.resetSession("s1", "local")
    await service.deleteSession(id)

    expect(router.forgetSavedSdkSession).toHaveBeenCalledWith(id)
    expect(router.forgetSavedSdkSession).toHaveBeenCalledTimes(2)
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

    await expect(resolveSoon(secondTurn)).resolves.toMatchObject({ error: "已停止本次执行。" })
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
        source: "workflow",
        projectId: "project-1",
        sessionKey: expect.stringMatching(/^workflow:project-1:/),
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
        source: "workflow",
        projectId: "project-1",
        sessionKey: expect.stringMatching(/^workflow:project-1:/),
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

  it("returns automated agent sessionKey with the conversation id", async () => {
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
      mode: "plan",
      prompt: "automated prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
    })

    expect(result.status).toBe("success")
    expect(result.conversationId).toBeTruthy()
    expect(result.sessionKey).toMatch(/^workflow:project-1:/)
    const session = await conversations.get(result.conversationId)
    expect(session?.sessionKey).toBe(result.sessionKey)
  })

  it("notifies workflow conversation targets when the conversation is created", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const onConversationCreated = vi.fn()
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
      prompt: "workflow prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
      sourcePlatform: "workflow",
      userMeta: {
        source: "workflow",
        workflowId: "wf-1",
        workflowRunId: "run-1",
        workflowNodeId: "node-1",
      },
      onConversationCreated,
    })

    expect(result.status).toBe("success")
    expect(onConversationCreated).toHaveBeenCalledTimes(1)
    expect(onConversationCreated).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: result.conversationId,
      sessionKey: result.sessionKey,
      platform: "workflow",
    })
  })

  it("returns scheduled agent usage and cost from the terminal SDK result", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        {
          type: "result",
          content: "done",
          done: true,
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
      now: fixedNow,
    })

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "plan",
      prompt: "scheduled prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
    })

    expect(result).toMatchObject({
      status: "success",
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 4,
      },
      costUsd: 0.01,
    })
  })

  it("returns scheduled agent effective model and local CNY breakdown", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", { ANTHROPIC_MODEL: "glm-5.1" }) as unknown as ProviderService,
      getUsagePriceRules: () => [{
        id: "glm-5.1",
        modelPattern: "glm-5.1",
        inputPer1M: 1000,
        outputPer1M: 2000,
        cacheReadPer1M: 10,
        cacheWritePer1M: 100,
        reasoningPer1M: 3000,
        currency: "CNY",
        enabled: true,
        source: "user",
        sortIndex: 0,
        updatedAt: "2026-06-03T00:00:00.000Z",
      }],
      createSession: () => new ScriptedSession([
        {
          type: "result",
          content: "done",
          done: true,
          sdkSessionId: "sdk-1",
          metadata: { model: "glm-5.1" },
          usage: { input_tokens: 10, output_tokens: 2 },
          costCny: 99,
        },
      ], "sdk-1"),
      now: fixedNow,
    })

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "plan",
      prompt: "scheduled prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
    })

    expect(result).toMatchObject({
      status: "success",
      modelName: "glm-5.1",
      costCny: 0.014,
      costBreakdownCny: {
        input: 0.01,
        output: 0.004,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
      },
      costCurrency: "CNY",
    })
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

  it("persists workflow scheduled sends with workflow source metadata", async () => {
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
      mode: "bypassPermissions",
      prompt: "workflow prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
      sourcePlatform: "workflow",
      userMeta: {
        source: "workflow",
        workflowId: "wf-1",
        workflowName: "Workflow One",
        workflowRunId: "run-1",
        workflowNodeId: "node-1",
        workflowNodeName: "Prompt",
      },
    })

    const session = await conversations.get(result.conversationId)
    expect(result.status).toBe("success")
    expect(session).toMatchObject({
      platform: "workflow",
      sessionKey: expect.stringMatching(/^workflow:project-1:/),
      userMeta: expect.objectContaining({
        platform: "workflow",
        source: "workflow",
        workflowId: "wf-1",
        workflowName: "Workflow One",
        workflowRunId: "run-1",
        workflowNodeId: "node-1",
        workflowNodeName: "Prompt",
      }),
    })
    expect(logger.info).toHaveBeenCalledWith(
      "Scheduled agent send completed.",
      expect.objectContaining({
        source: "workflow",
        sourcePlatform: "workflow",
        sessionKey: expect.stringMatching(/^workflow:project-1:/),
      }),
    )
  })

  it("names workflow scheduled conversations from workflow context", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      now: fixedLocalNameNow,
    })

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "bypassPermissions",
      prompt: "workflow prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
      sourcePlatform: "workflow",
      userMeta: {
        source: "workflow",
        workflowName: "Workflow One",
        workflowNodeName: "Prompt",
      },
    })

    const session = await conversations.get(result.conversationId)
    expect(session?.name).toBe("Workflow One / Prompt · 04-26 08:00")
  })

  it("names automation conversations from automation context", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const service = new AgentRuntimeService({
      projectId: "project-1",
      workDir: "/repo",
      conversations,
      providerService: new FakeProviderService("anthropic", {}) as unknown as ProviderService,
      createSession: () => new ScriptedSession([
        { type: "result", content: "done", done: true, sdkSessionId: "sdk-1" },
      ], "sdk-1"),
      now: fixedLocalNameNow,
    })

    const result = await service.sendScheduled({
      projectId: "project-1",
      agentType: "claude-code",
      mode: "bypassPermissions",
      prompt: "automation prompt",
      sessionPolicy: "fresh",
      timeoutMs: 120_000,
      sourcePlatform: "automation",
      userMeta: {
        source: "automation",
        automationName: "Daily Summary",
      },
    })

    const session = await conversations.get(result.conversationId)
    expect(session?.name).toBe("Daily Summary · 04-26 08:00")
  })

  it("persists legacy scheduled resumed permission mode for renderer summaries", async () => {
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
      sourcePlatform: "scheduled",
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
        source: "workflow",
        projectId: "project-1",
        sessionKey: expect.stringMatching(/^workflow:project-1:/),
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

function fixedLocalNameNow(): Date {
  return new Date(2026, 3, 26, 8, 0, 0, 0)
}

function replyTargetsMock(
  env: Record<string, string>,
): NonNullable<ConstructorParameters<typeof AgentRuntimeService>[0]["replyTargets"]> {
  return {
    rememberReplyTarget: vi.fn(),
    dispatchAgentEvent: vi.fn(async () => undefined),
    getAgentEnv: vi.fn(() => env),
  }
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
  readonly sent: string[] = []
  private readonly events: AgentEvent[]
  private closed = false

  constructor(events: readonly AgentEvent[], private readonly sessionId?: string) {
    this.events = [...events]
  }

  async send(message: AgentMessage): Promise<boolean> {
    this.sent.push(message.content)
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

class StaticSkillRegistry extends SkillRegistry {
  constructor(private readonly skill: AgentSkill) {
    super({})
  }

  override async resolve(name: string): Promise<AgentSkill | null> {
    return name === this.skill.name ? this.skill : null
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
  readonly responses: Array<{
    readonly requestId: string
    readonly behavior: string
    readonly updatedInput?: Record<string, unknown>
  }> = []
  closed = false
  private waiter: ((event: AgentEvent | null) => void) | undefined
  private readonly events: AgentEvent[] = []
  private sent = false

  constructor(
    private readonly requestId: string,
    private readonly resultText: string,
    private readonly permissionRequest: {
      readonly toolName: string
      readonly toolInput?: string
      readonly toolInputRaw?: Record<string, unknown>
    } = {
      toolName: "Bash",
      toolInput: "pwd",
      toolInputRaw: { command: "pwd" },
    },
  ) {}

  async send(): Promise<boolean> {
    this.sent = true
    return true
  }

  async respondPermission(
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void> {
    this.responses.push({
      requestId,
      behavior: decision.behavior,
      ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
    })
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
        ...this.permissionRequest,
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

class QuestionSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  readonly responses: Array<{
    readonly requestId: string
    readonly behavior: string
    readonly updatedInput?: Record<string, unknown>
    readonly message?: string
  }> = []
  closed = false
  private waiter: ((event: AgentEvent | null) => void) | undefined
  private readonly events: AgentEvent[] = []
  private sent = false

  constructor(
    private readonly requestId: string,
    private readonly questions: readonly AgentUserQuestion[],
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
    this.responses.push({
      requestId,
      behavior: decision.behavior,
      ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
      ...(decision.message ? { message: decision.message } : {}),
    })
    this.push({
      type: "result",
      content: this.resultText,
      done: true,
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
        toolName: "AskUserQuestion",
        toolInput: JSON.stringify({ questions: this.questions }),
        toolInputRaw: { questions: this.questions },
        questions: this.questions,
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

class FailingQuestionResponseSession extends QuestionSession {
  private shouldFail = true

  override async respondPermission(
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false
      throw new Error("SDK response unavailable")
    }
    await super.respondPermission(requestId, decision)
  }
}

class StaleQuestionResponseSession extends QuestionSession {
  override async respondPermission(): Promise<void> {
    await this.close()
    throw new Error(AGENT_PERMISSION_NOT_PENDING_MESSAGE)
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

class BlockingQuestionResolutionNamespace extends MemoryNamespace<ConversationEntryV1> {
  private resolutionWriteStarted: (() => void) | undefined
  private releaseResolution: (() => void) | undefined
  private readonly resolutionStarted = new Promise<void>((resolve) => {
    this.resolutionWriteStarted = resolve
  })
  private readonly resolutionReleased = new Promise<void>((resolve) => {
    this.releaseResolution = resolve
  })
  private blocked = false

  constructor() {
    super("conversations")
  }

  override async upsert(item: ConversationEntryV1): Promise<void> {
    const containsResolution = item.history.some((entry) => (
      entry.metadata?.userQuestionResolution !== undefined
      || entry.metadata?.userQuestionResolutionAttempt !== undefined
    ))
    if (containsResolution && !this.blocked) {
      this.blocked = true
      this.resolutionWriteStarted?.()
      await this.resolutionReleased
    }
    await super.upsert(item)
  }

  async waitForResolutionWrite(): Promise<void> {
    await this.resolutionStarted
  }

  releaseResolutionWrite(): void {
    this.releaseResolution?.()
  }
}

class FailingQuestionResolutionNamespace extends MemoryNamespace<ConversationEntryV1> {
  private failed = false

  constructor() {
    super("conversations")
  }

  override async upsert(item: ConversationEntryV1): Promise<void> {
    const containsResolution = item.history.some((entry) => (
      entry.metadata?.userQuestionResolution !== undefined
      || entry.metadata?.userQuestionResolutionAttempt !== undefined
    ))
    if (containsResolution && !this.failed) {
      this.failed = true
      throw new Error("resolution storage unavailable")
    }
    await super.upsert(item)
  }
}

class FailingQuestionHistoryNamespace extends MemoryNamespace<ConversationEntryV1> {
  private failed = false

  constructor() {
    super("conversations")
  }

  override async upsert(item: ConversationEntryV1): Promise<void> {
    const containsQuestion = item.history.some((entry) => (
      entry.metadata?.agentEventType === "permissionRequest"
      && entry.metadata.requestId !== undefined
    ))
    if (containsQuestion && !this.failed) {
      this.failed = true
      throw new Error("question history storage unavailable")
    }
    await super.upsert(item)
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
