import { describe, expect, it } from "vitest"

import type {
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
  AgentCommandEntryV1,
  ProviderEntryV1,
  SecretEntryV1,
} from "../../../runtime/data-repo"
import { ProviderService } from "../../provider"
import { AgentCommandRouter, modesForAgent } from "../command-router"
import { CustomCommandRegistry } from "../command-registry"
import { SkillRegistry, type AgentSkill } from "../skill-registry"
import type { AgentMessage } from "../types"

describe("AgentCommandRouter", () => {
  it("lists and switches models by alias and index, then resets the session", async () => {
    const { providerService } = makeProviderService()
    await providerService.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      active: true,
      model: "claude-sonnet-4.5",
      haikuModel: "claude-haiku-3.5",
      sonnetModel: "claude-sonnet-4.5",
      env: {},
    })
    const resets: string[] = []
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      resetSession: async (message) => {
        resets.push(message.sessionKey)
        return { ...conversation, agentSessionId: undefined }
      },
    })
    const conversation = baseConversation()

    const list = expectRuntimeResult(await router.handle(baseMessage("/model"), conversation))
    expect(list.resultText).toContain("claude-sonnet-4.5")
    expect(list.resultText).toContain("claude-haiku-3.5 (haiku)")

    const byAlias = expectRuntimeResult(
      await router.handle(baseMessage("/model switch haiku"), conversation),
    )
    expect(byAlias.resultText).toBe("模型已切换：claude-haiku-3.5")
    await expect(providerService.getActiveProvider()).resolves.toMatchObject({
      model: "claude-haiku-3.5",
    })

    const byIndex = expectRuntimeResult(await router.handle(baseMessage("/model 2"), conversation))
    expect(byIndex.resultText).toBe("模型已切换：claude-sonnet-4.5")
    expect(resets).toEqual(["s1", "s1"])
  })

  it("switches the conversation-bound provider model instead of the active provider", async () => {
    const { providerService } = makeProviderService()
    await providerService.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      active: true,
      model: "claude-sonnet-4.5",
      env: {},
    })
    await providerService.createProvider({
      id: "deepseek",
      name: "DeepSeek",
      category: "third_party",
      apiKeyField: "ANTHROPIC_AUTH_TOKEN",
      active: false,
      model: "deepseek-chat",
      haikuModel: "deepseek-fast",
      env: {},
    })
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      resetSession: async () => baseConversation(),
    })
    const conversation = { ...baseConversation(), providerId: "deepseek" }

    const list = expectRuntimeResult(await router.handle(baseMessage("/model"), conversation))
    expect(list.resultText).toContain("deepseek-chat")
    expect(list.resultText).toContain("deepseek-fast (haiku)")

    const switched = expectRuntimeResult(await router.handle(baseMessage("/model haiku"), conversation))

    expect(switched.resultText).toBe("模型已切换：deepseek-fast")
    await expect(providerService.getProvider("deepseek")).resolves.toMatchObject({
      model: "deepseek-fast",
    })
    await expect(providerService.getActiveProvider()).resolves.toMatchObject({
      id: "anthropic",
      model: "claude-sonnet-4.5",
    })
  })

  it("rejects remote non-admin users when switching models", async () => {
    const { providerService } = makeProviderService()
    await providerService.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      active: true,
      model: "claude-sonnet-4.5",
      haikuModel: "claude-haiku-3.5",
      env: {},
    })
    const resets: string[] = []
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      resetSession: async (message) => {
        resets.push(message.sessionKey)
        return baseConversation()
      },
    })

    const list = expectRuntimeResult(
      await router.handle({
        ...baseMessage("/model"),
        platform: "relay",
        replyCtx: { isAdmin: false },
      }, baseConversation()),
    )
    expect(list.resultText).toContain("claude-sonnet-4.5")

    const result = expectRuntimeResult(
      await router.handle({
        ...baseMessage("/model haiku"),
        platform: "relay",
        replyCtx: { isAdmin: false },
      }, baseConversation()),
    )

    expect(result.error).toBe("只有管理员可以切换模型。")
    await expect(providerService.getActiveProvider()).resolves.toMatchObject({
      model: "claude-sonnet-4.5",
    })
    expect(resets).toEqual([])
  })

  it("logs conversation provider lookup failures with command context", async () => {
    const records: Array<{ readonly message: string, readonly meta?: Record<string, unknown> }> = []
    const providerService = {
      getProvider: async () => {
        throw Object.assign(new Error("provider store unavailable"), { code: "EIO" })
      },
      getActiveProvider: async () => null,
      updateProvider: async () => {
        throw new Error("unexpected update")
      },
    } as unknown as ProviderService
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      logger: {
        warn: (message, meta) => records.push({ message, meta: meta as Record<string, unknown> }),
      },
      resetSession: async () => baseConversation(),
    })

    const result = expectRuntimeResult(
      await router.handle(baseMessage("/model haiku"), { ...baseConversation(), providerId: "anthropic" }),
    )

    expect(result.error).toBe("找不到模型供应商：anthropic")
    expect(records).toEqual([{
      message: "Agent command provider lookup failed.",
      meta: expect.objectContaining({
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "s1",
        agentType: "claude-code",
        providerId: "anthropic",
        command: "/model",
        errorName: "Error",
        errorCode: "EIO",
        error: "provider store unavailable",
      }),
    }])
  })

  it("preserves Windows paths in provider lookup diagnostics", async () => {
    const records: Array<{ readonly message: string, readonly meta?: Record<string, unknown> }> = []
    const providerService = {
      getProvider: async () => {
        throw Object.assign(
          new Error("EACCES: permission denied, open C:\\Users\\liyang\\secret\\providers.json"),
          { code: "EACCES" },
        )
      },
      getActiveProvider: async () => null,
      updateProvider: async () => {
        throw new Error("unexpected update")
      },
    } as unknown as ProviderService
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      logger: {
        warn: (message, meta) => records.push({ message, meta: meta as Record<string, unknown> }),
      },
      resetSession: async () => baseConversation(),
    })

    const result = expectRuntimeResult(
      await router.handle(baseMessage("/model haiku"), { ...baseConversation(), providerId: "anthropic" }),
    )

    expect(result.error).toBe("找不到模型供应商：anthropic")
    expect(records[0]?.meta).toEqual(expect.objectContaining({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "s1",
      providerId: "anthropic",
      command: "/model",
      errorName: "Error",
      errorCode: "EACCES",
      error: "EACCES: permission denied, open C:\\Users\\liyang\\secret\\providers.json",
    }))
    expect(JSON.stringify(records)).toContain("C:\\\\Users\\\\liyang")
  })

  it("redacts secret-shaped values in provider lookup diagnostics", async () => {
    const records: Array<{ readonly message: string, readonly meta?: Record<string, unknown> }> = []
    const providerService = {
      getProvider: async () => {
        throw Object.assign(
          new Error("request failed token=sk-secret authorization=BearerSecret cookie=session-id"),
          { code: "EAUTH" },
        )
      },
      getActiveProvider: async () => null,
      updateProvider: async () => {
        throw new Error("unexpected update")
      },
    } as unknown as ProviderService
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      logger: {
        warn: (message, meta) => records.push({ message, meta: meta as Record<string, unknown> }),
      },
      resetSession: async () => baseConversation(),
    })

    const result = expectRuntimeResult(
      await router.handle(baseMessage("/status"), { ...baseConversation(), providerId: "anthropic" }),
    )

    expect(result.resultText).toContain("供应商：anthropic")
    expect(records[0]?.meta).toEqual(expect.objectContaining({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "s1",
      providerId: "anthropic",
      command: "/status",
      errorName: "Error",
      errorCode: "EAUTH",
      error: "request failed token=[redacted] authorization=[redacted] cookie=[redacted]",
    }))
    expect(JSON.stringify(records)).not.toContain("sk-secret")
    expect(JSON.stringify(records)).not.toContain("BearerSecret")
    expect(JSON.stringify(records)).not.toContain("session-id")
  })

  it("logs /show failures without exposing raw reference errors to the conversation", async () => {
    const { providerService } = makeProviderService()
    const records: Array<{ readonly message: string, readonly meta?: Record<string, unknown> }> = []
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      logger: {
        warn: (message, meta) => records.push({ message, meta: meta as Record<string, unknown> }),
      },
      resetSession: async () => baseConversation(),
      showReference: async () => {
        throw Object.assign(
          new Error("open /Users/liyang/secret/token.txt token=sk-secret authorization=BearerSecret"),
          { code: "EACCES" },
        )
      },
    })

    const result = expectRuntimeResult(
      await router.handle(baseMessage("/show token.txt"), baseConversation()),
    )

    expect(result.error).toBe("open /Users/liyang/secret/token.txt token=[redacted] authorization=[redacted]")
    expect(result.error).toContain("/Users/liyang")
    expect(result.error).not.toContain("sk-secret")
    expect(result.error).not.toContain("BearerSecret")
    expect(records).toEqual([{
      message: "Agent command show reference failed.",
      meta: expect.objectContaining({
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "s1",
        agentType: "claude-code",
        command: "/show",
        argsCount: 1,
        errorName: "Error",
        errorCode: "EACCES",
        error: "open /Users/liyang/secret/token.txt token=[redacted] authorization=[redacted]",
      }),
    }])
    expect(JSON.stringify(records)).toContain("/Users/liyang")
    expect(JSON.stringify(records)).not.toContain("sk-secret")
    expect(JSON.stringify(records)).not.toContain("BearerSecret")
  })

  it("preserves Windows backslashes for /show references", async () => {
    const { providerService } = makeProviderService()
    const shown: string[][] = []
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      resetSession: async () => baseConversation(),
      showReference: async (_message, args) => {
        shown.push([...args])
        return `show:${args.join("|")}`
      },
    })

    const result = expectRuntimeResult(
      await router.handle(baseMessage("/show C:\\repo\\docs\\note.md"), baseConversation()),
    )

    expect(result.resultText).toBe("show:C:\\repo\\docs\\note.md")
    expect(shown).toEqual([["C:\\repo\\docs\\note.md"]])
  })

  it("lists modes, switches safe modes, handles /new and /status, and routes dangerous modes to the selector", async () => {
    const { providerService } = makeProviderService()
    await providerService.createProvider({
      id: "anthropic",
      name: "Claude Official",
      category: "official",
      apiKeyField: "ANTHROPIC_API_KEY",
      active: true,
      model: "claude-sonnet-4.5",
      env: {},
    })
    const resets: string[] = []
    const modeSwitches: string[] = []
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      resetSession: async (message) => {
        resets.push(message.sessionKey)
        return { ...baseConversation(), agentSessionId: undefined }
      },
      setPermissionMode: async (_message, _conversation, mode) => {
        modeSwitches.push(mode)
        return { ...baseConversation(), agentConfig: { mode } }
      },
    })

    const list = expectRuntimeResult(await router.handle(baseMessage("/mode"), {
      ...baseConversation(),
      agentConfig: { mode: "plan" },
    }))
    expect(list.resultText).toContain("Current mode: plan")
    expect(list.resultText).toContain("acceptEdits")

    const switched = expectRuntimeResult(
      await router.handle(baseMessage("/mode acceptEdits"), baseConversation()),
    )
    expect(switched.resultText).toBe("权限模式已切换：acceptEdits")
    expect(modeSwitches).toEqual(["acceptEdits"])

    const dangerous = expectRuntimeResult(
      await router.handle(baseMessage("/mode bypassPermissions"), baseConversation()),
    )
    expect(dangerous.error).toBe("请使用权限模式选择器确认切换。")

    const next = expectRuntimeResult(await router.handle(baseMessage("/new"), baseConversation()))
    expect(next.resultText).toBe("下一条消息将开启新会话。")

    const status = expectRuntimeResult(await router.handle(baseMessage("/status"), {
      ...baseConversation(),
      agentConfig: { mode: "acceptEdits" },
    }))
    expect(status.resultText).toContain("Agent：claude-code")
    expect(status.resultText).toContain("供应商：anthropic")
    expect(status.resultText).toContain("模型：claude-sonnet-4.5")
    expect(status.resultText).toContain("权限模式：acceptEdits")
    expect(status.resultText).toContain("Agent 会话：thread-1")

    const unknown = expectRuntimeResult(await router.handle(baseMessage("/unknown"), baseConversation()))
    expect(unknown.error).toBe("不支持的命令：/unknown")
    expect(resets).toEqual(["s1"])
  })

  it("passes an absolute POSIX path through as a normal message", async () => {
    const { providerService } = makeProviderService()
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      resetSession: async () => baseConversation(),
    })

    await expect(router.handle(
      baseMessage("/Users/liyang/Documents/code/project\n这里是什么"),
      baseConversation(),
    )).resolves.toBeNull()
  })

  it("rejects remote non-admin users when switching permission modes", async () => {
    const { providerService } = makeProviderService()
    const modeSwitches: string[] = []
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      resetSession: async () => baseConversation(),
      setPermissionMode: async (_message, _conversation, mode) => {
        modeSwitches.push(mode)
        return { ...baseConversation(), agentConfig: { mode } }
      },
    })

    const list = expectRuntimeResult(
      await router.handle({
        ...baseMessage("/mode"),
        platform: "relay",
        replyCtx: { isAdmin: false },
      }, baseConversation()),
    )
    expect(list.resultText).toContain("acceptEdits")

    const result = expectRuntimeResult(
      await router.handle({
        ...baseMessage("/mode acceptEdits"),
        platform: "relay",
        replyCtx: { isAdmin: false },
      }, baseConversation()),
    )

    expect(result.error).toBe("只有管理员可以切换权限模式。")
    expect(modeSwitches).toEqual([])
  })

  it("routes registered prompt commands and explicit agent-native slash passthrough", async () => {
    const { providerService } = makeProviderService()
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      registeredPromptCommands: [{
        name: "explain",
        buildPrompt: (args) => `Explain: ${args.join(" ")}`,
      }],
      agentNativeSlashAllowlist: ["plan-status"],
      resetSession: async () => baseConversation(),
    })

    const prompt = await router.handle(baseMessage("/explain foo bar"), baseConversation())
    expect(prompt).toEqual({ kind: "prompt", content: "Explain: foo bar" })

    const passthrough = await router.handle(baseMessage("/plan-status"), baseConversation())
    expect(passthrough).toEqual({ kind: "nativeSlash", name: "plan-status" })
  })

  it("prefers registered commands and skills before native slash passthrough", async () => {
    const { providerService } = makeProviderService()
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      registeredPromptCommands: [{
        name: "wiki-ingest",
        buildPrompt: () => "registered prompt",
      }],
      skills: new StaticSkillRegistry({
        name: "wiki-ingest",
        prompt: "skill prompt",
        source: "/skills/wiki-ingest/SKILL.md",
      }),
      agentNativeSlashAllowlist: ["wiki-ingest"],
      resetSession: async () => baseConversation(),
    })

    await expect(router.handle(baseMessage("/wiki-ingest all"), baseConversation()))
      .resolves.toEqual({ kind: "prompt", content: "registered prompt" })
  })

  it("appends runtime context to skill prompts when configured", async () => {
    const { providerService } = makeProviderService()
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      skills: new StaticSkillRegistry({
        name: "wiki-lint",
        prompt: "skill prompt",
        source: "/skills/wiki-lint/SKILL.md",
      }),
      buildSkillPromptAppendix: ({ name, args, context }) =>
        `runtime appendix: ${name} ${args.join(" ")} ${context.turnId}`,
      resetSession: async () => baseConversation(),
    })

    const prompt = await router.handle(
      baseMessage("/wiki-lint --fast"),
      baseConversation(),
      { turnId: "turn-1" },
    )

    expect(prompt).toEqual({
      kind: "prompt",
      content: expect.stringContaining("skill prompt"),
    })
    expect(prompt).toEqual({
      kind: "prompt",
      content: expect.stringContaining("runtime appendix: wiki-lint --fast turn-1"),
    })
  })

  it("returns native slash routes only for explicit allowlist or callback matches", async () => {
    const { providerService } = makeProviderService()
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      agentNativeSlashAllowlist: ["wiki-ingest"],
      allowAgentNativeSlash: (name) => name === "save",
      unknownSlashBehavior: "passthrough",
      resetSession: async () => baseConversation(),
    })

    await expect(router.handle(baseMessage("/wiki-ingest all"), baseConversation()))
      .resolves.toEqual({ kind: "nativeSlash", name: "wiki-ingest" })
    await expect(router.handle(baseMessage("/save now"), baseConversation()))
      .resolves.toEqual({ kind: "nativeSlash", name: "save" })
    await expect(router.handle(baseMessage("/unknown passthrough"), baseConversation()))
      .resolves.toBeNull()
  })

  it("lists agent-native commands supplied by runtime discovery", async () => {
    const { providerService } = makeProviderService()
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      listCommands: async () => [{
        name: "wiki-ingest",
        description: "汲取资料，整理 .raw 中的新内容",
        source: "agent-native",
        kind: "agent-native",
        adminOnly: false,
      }],
      resetSession: async () => baseConversation(),
    })

    const result = expectRuntimeResult(await router.handle(baseMessage("/commands"), baseConversation()))

    expect(result.resultText).toContain("/wiki-ingest [agent-native] - 汲取资料，整理 .raw 中的新内容")
  })

  it("routes registered prompt commands that return direct command results", async () => {
    const { providerService } = makeProviderService()
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      registeredPromptCommands: [{
        name: "wiki",
        buildPrompt: () => ({
          kind: "result",
          content: "All sources are unchanged.",
        }),
      }],
      resetSession: async () => baseConversation(),
    })

    const result = expectRuntimeResult(await router.handle(baseMessage("/wiki ingest"), baseConversation()))

    expect(result.resultText).toBe("All sources are unchanged.")
    expect(result.error).toBeUndefined()
  })

  it("routes custom prompt and exec commands", async () => {
    const { providerService } = makeProviderService()
    const commands = new MemoryNamespace<AgentCommandEntryV1>("agent.commands")
    const registry = new CustomCommandRegistry({
      projectId: "project-1",
      commands,
      now: fixedNow,
    })
    await registry.addPrompt({ name: "explain", prompt: "Explain {{args}}" })
    await registry.addExec({ name: "local-build", exec: "pnpm build" })
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      customCommands: registry,
      resetSession: async () => baseConversation(),
      runCustomCommand: async (command, args) => `${command.name}:${args.join(",")}`,
    })

    expect(await router.handle(baseMessage("/explain a b"), baseConversation()))
      .toEqual({ kind: "prompt", content: "Explain a b" })
    expect(expectRuntimeResult(
      await router.handle({
        ...baseMessage("/local-build --prod"),
        platform: "local-renderer",
      }, baseConversation()),
    ).resultText).toBe("local-build:--prod")
  })

  it("rejects remote non-admin users for admin-only custom prompt commands", async () => {
    const { providerService } = makeProviderService()
    const commands = new MemoryNamespace<AgentCommandEntryV1>("agent.commands")
    const registry = new CustomCommandRegistry({
      projectId: "project-1",
      commands,
      now: fixedNow,
    })
    await registry.addPrompt({
      name: "admin-plan",
      prompt: "Use admin context",
      adminOnly: true,
    })
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      customCommands: registry,
      resetSession: async () => baseConversation(),
    })

    const result = expectRuntimeResult(
      await router.handle({
        ...baseMessage("/admin-plan"),
        platform: "relay",
        replyCtx: { isAdmin: false },
      }, baseConversation()),
    )

    expect(result.error).toBe("命令需要管理员权限：/admin-plan")
  })

  it("stores the requested shell for admin exec commands", async () => {
    const { providerService } = makeProviderService()
    const commands = new MemoryNamespace<AgentCommandEntryV1>("agent.commands")
    const registry = new CustomCommandRegistry({
      projectId: "project-1",
      commands,
      now: fixedNow,
    })
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      customCommands: registry,
      resetSession: async () => baseConversation(),
    })

    const result = expectRuntimeResult(
      await router.handle(
        baseMessage("/commands addexec --shell powershell deploy Write-Output ok"),
        baseConversation(),
      ),
    )

    expect(result.resultText).toBe("执行命令已保存：/deploy")
    expect(await registry.resolve("deploy")).toEqual(expect.objectContaining({
      exec: "Write-Output ok",
      shell: "powershell",
    }))
  })

  it("preserves quoted Windows work directories for admin exec commands", async () => {
    const { providerService } = makeProviderService()
    const commands = new MemoryNamespace<AgentCommandEntryV1>("agent.commands")
    const registry = new CustomCommandRegistry({
      projectId: "project-1",
      commands,
      now: fixedNow,
    })
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      customCommands: registry,
      resetSession: async () => baseConversation(),
    })

    const result = expectRuntimeResult(
      await router.handle(
        baseMessage('/commands addexec --work-dir "C:\\repo with spaces" build pnpm build'),
        baseConversation(),
      ),
    )

    expect(result.resultText).toBe("执行命令已保存：/build")
    expect(await registry.resolve("build")).toEqual(expect.objectContaining({
      exec: "pnpm build",
      workDir: "C:\\repo with spaces",
    }))
  })

  it("routes builtin /compact to the SDK-native slash path and rejects removed /compress", async () => {
    const { providerService } = makeProviderService()
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      resetSession: async () => baseConversation(),
    })

    const compact = await router.handle(baseMessage("/compact"), baseConversation())
    const compress = expectRuntimeResult(
      await router.handle(baseMessage("/compress"), baseConversation()),
    )

    expect(compact).toEqual({ kind: "nativeSlash", name: "compact" })
    expect(compress.error).toBe("不支持的命令：/compress")
  })

  it("redacts raw /show command failure text before returning it", async () => {
    const { providerService } = makeProviderService()
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      resetSession: async () => baseConversation(),
      showReference: async () => {
        throw new Error("read failed /Users/liyang/secret/repo token=sk-secret")
      },
    })

    const result = expectRuntimeResult(await router.handle(baseMessage("/show secret.ts"), baseConversation()))

    expect(result.error).toBe("read failed /Users/liyang/secret/repo token=[redacted]")
    expect(result.error).toContain("/Users/liyang/secret")
    expect(result.error).not.toContain("sk-secret")
  })
})

describe("modesForAgent", () => {
  it("reads Claude Code modes from Agent definitions", () => {
    expect(modesForAgent("claude-code").map((mode) => mode.key)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "bypassPermissions",
      "dontAsk",
    ])
  })

  it("normalizes underscore variant to claude-code", () => {
    expect(modesForAgent("claude_code").map((mode) => mode.key)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "auto",
      "bypassPermissions",
      "dontAsk",
    ])
  })

  it("throws a readable error for unknown Agent modes", () => {
    expect(() => modesForAgent("unknown-agent")).toThrow("Unknown agent runtime: unknown-agent")
  })
})

function expectRuntimeResult(
  result: Awaited<ReturnType<AgentCommandRouter["handle"]>>,
) {
  if (!result || "kind" in result) {
    throw new Error("Expected runtime command result")
  }
  return result
}

function baseMessage(content: string): AgentMessage {
  return {
    projectId: "project-1",
    sessionKey: "s1",
    platform: "local",
    content,
  }
}

function baseConversation(): ConversationEntryV1 {
  return {
    id: "conversation-1",
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
  }
}

function makeProviderService(): { providerService: ProviderService } {
  const providers = new MemoryNamespace<ProviderEntryV1>("providers")
  const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
  return {
    providerService: new ProviderService({ providers, secrets, now: fixedNow }),
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
