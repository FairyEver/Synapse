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
    expect(byAlias.resultText).toBe("Model changed: claude-haiku-3.5")
    await expect(providerService.getActiveProvider()).resolves.toMatchObject({
      model: "claude-haiku-3.5",
    })

    const byIndex = expectRuntimeResult(await router.handle(baseMessage("/model 2"), conversation))
    expect(byIndex.resultText).toBe("Model changed: claude-sonnet-4.5")
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

    expect(switched.resultText).toBe("Model changed: deepseek-fast")
    await expect(providerService.getProvider("deepseek")).resolves.toMatchObject({
      model: "deepseek-fast",
    })
    await expect(providerService.getActiveProvider()).resolves.toMatchObject({
      id: "anthropic",
      model: "claude-sonnet-4.5",
    })
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

    expect(result.error).toBe("Provider not found: anthropic")
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

  it("redacts Windows paths in provider lookup diagnostics", async () => {
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

    expect(result.error).toBe("Provider not found: anthropic")
    expect(records[0]?.meta).toEqual(expect.objectContaining({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "s1",
      providerId: "anthropic",
      command: "/model",
      errorName: "Error",
      errorCode: "EACCES",
      error: "EACCES: permission denied, open [path redacted]",
    }))
    expect(JSON.stringify(records)).not.toContain("C:\\Users\\liyang")
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

    expect(result.resultText).toContain("Provider: anthropic")
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

  it("lists modes, handles /new and /status, and rejects mode switches and unknown commands", async () => {
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
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      resetSession: async (message) => {
        resets.push(message.sessionKey)
        return { ...baseConversation(), agentSessionId: undefined }
      },
    })

    const list = expectRuntimeResult(await router.handle(baseMessage("/mode"), baseConversation()))
    expect(list.resultText).toContain("acceptEdits")

    const rejected = expectRuntimeResult(
      await router.handle(baseMessage("/mode acceptEdits"), baseConversation()),
    )
    expect(rejected.error).toBe("Mode switching is unavailable in SDK sessions.")

    const next = expectRuntimeResult(await router.handle(baseMessage("/new"), baseConversation()))
    expect(next.resultText).toBe("New session will start on the next message.")

    const status = expectRuntimeResult(await router.handle(baseMessage("/status"), baseConversation()))
    expect(status.resultText).toContain("Agent: claude-code")
    expect(status.resultText).toContain("Provider: anthropic")
    expect(status.resultText).toContain("Model: claude-sonnet-4.5")
    expect(status.resultText).toContain("Agent session: thread-1")

    const unknown = expectRuntimeResult(await router.handle(baseMessage("/unknown"), baseConversation()))
    expect(unknown.error).toBe("Unsupported command: /unknown")
    expect(resets).toEqual(["s1"])
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
    expect(passthrough).toBeNull()
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

    expect(result.resultText).toBe("Exec command saved: /deploy")
    expect(await registry.resolve("deploy")).toEqual(expect.objectContaining({
      exec: "Write-Output ok",
      shell: "powershell",
    }))
  })

  it("routes builtin /compress to the runtime callback", async () => {
    const { providerService } = makeProviderService()
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerService,
      resetSession: async () => baseConversation(),
      compressSession: async (_message, conversation) => ({
        conversationId: conversation.id,
        events: [{ type: "result", content: "Context compressed.", done: true }],
        resultText: "Context compressed.",
      }),
    })

    const result = expectRuntimeResult(await router.handle(baseMessage("/compress"), baseConversation()))

    expect(result.resultText).toBe("Context compressed.")
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
