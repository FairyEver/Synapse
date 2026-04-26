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
import { ProviderConfigService } from "../../provider-config"
import { AgentCommandRouter } from "../command-router"
import { CustomCommandRegistry } from "../command-registry"
import type { AgentMessage } from "../types"

describe("AgentCommandRouter", () => {
  it("lists and switches models by alias and index, then resets the session", async () => {
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const providerConfig = new ProviderConfigService({ providers, secrets, now: fixedNow })
    await providerConfig.upsertGlobalProvider({
      id: "openai",
      model: "gpt-5.4",
      models: [
        { id: "gpt-5.4", alias: "main" },
        { id: "gpt-5.3-codex", alias: "codex" },
      ],
      agentTypes: ["codex"],
    })
    await providerConfig.setProjectProviderRefs("project-1", ["openai"])
    await providerConfig.setActiveProvider("project-1", "openai")
    const resets: string[] = []
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "codex",
      providerConfig,
      resetSession: async (message) => {
        resets.push(message.sessionKey)
        return { ...conversation, agentSessionId: undefined }
      },
    })
    const conversation = baseConversation()

    const list = expectRuntimeResult(await router.handle(baseMessage("/model"), conversation))
    expect(list.resultText).toContain("gpt-5.4")
    expect(list.resultText).toContain("gpt-5.3-codex (codex)")

    const byAlias = expectRuntimeResult(
      await router.handle(baseMessage("/model switch codex"), conversation),
    )
    expect(byAlias.resultText).toBe("Model changed: gpt-5.3-codex")
    expect((await providerConfig.getProjectProviderState("project-1", "codex")).activeModel)
      .toBe("gpt-5.3-codex")

    const byIndex = expectRuntimeResult(await router.handle(baseMessage("/model 1"), conversation))
    expect(byIndex.resultText).toBe("Model changed: gpt-5.4")
    expect(resets).toEqual(["s1", "s1"])
  })

  it("lists and switches modes, handles /new and /status, and rejects unknown commands", async () => {
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const providerConfig = new ProviderConfigService({ providers, secrets, now: fixedNow })
    const resets: string[] = []
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerConfig,
      resetSession: async (message) => {
        resets.push(message.sessionKey)
        return { ...baseConversation(), agentSessionId: undefined }
      },
    })

    const list = expectRuntimeResult(await router.handle(baseMessage("/mode"), baseConversation()))
    expect(list.resultText).toContain("acceptEdits")

    const switched = expectRuntimeResult(
      await router.handle(baseMessage("/mode acceptEdits"), baseConversation()),
    )
    expect(switched.resultText).toBe("Mode changed: acceptEdits")
    expect((await providerConfig.getProjectProviderState("project-1", "claude-code")).activeMode)
      .toBe("acceptEdits")

    const next = expectRuntimeResult(await router.handle(baseMessage("/new"), baseConversation()))
    expect(next.resultText).toBe("New session will start on the next message.")

    const status = expectRuntimeResult(await router.handle(baseMessage("/status"), baseConversation()))
    expect(status.resultText).toContain("Agent: claude-code")
    expect(status.resultText).toContain("Agent session: thread-1")

    const unknown = expectRuntimeResult(await router.handle(baseMessage("/unknown"), baseConversation()))
    expect(unknown.error).toBe("Unsupported command: /unknown")
    expect(resets).toEqual(["s1", "s1"])
  })

  it("routes registered prompt commands and explicit agent-native slash passthrough", async () => {
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const providerConfig = new ProviderConfigService({ providers, secrets, now: fixedNow })
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "codex",
      providerConfig,
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
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const providerConfig = new ProviderConfigService({ providers, secrets, now: fixedNow })
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
      agentType: "codex",
      providerConfig,
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

  it("routes builtin /compress to the runtime callback", async () => {
    const providers = new MemoryNamespace<ProviderEntryV1>("providers")
    const secrets = new MemoryNamespace<SecretEntryV1>("secrets")
    const providerConfig = new ProviderConfigService({ providers, secrets, now: fixedNow })
    const router = new AgentCommandRouter({
      projectId: "project-1",
      agentType: "claude-code",
      providerConfig,
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
    agentType: "codex",
    agentSessionId: "thread-1",
    history: [],
    active: true,
    createdAt: "2026-04-26T00:00:00.000Z",
    updatedAt: "2026-04-26T00:00:00.000Z",
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
