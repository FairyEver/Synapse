import { describe, expect, it, vi } from "vitest"

import type {
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import { AgentSessionRepository, conversationId } from "../session-repository"

describe("AgentSessionRepository", () => {
  it("creates and restores the active session with user metadata", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })

    const created = await repository.getOrCreateActive({
      projectId: "project-1",
      sessionKey: "local:user-1",
      platform: "local",
      userId: "user-1",
      userName: "User One",
      chatName: "General",
      content: "hello",
    })

    expect(created).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        sessionKey: "local:user-1",
        active: true,
        name: "local:user-1",
        resumePolicy: "resume",
        userMeta: expect.objectContaining({
          userId: "user-1",
          userName: "User One",
          chatName: "General",
        }),
      }),
    )

    const restored = await repository.getOrCreateActive({
      projectId: "project-1",
      sessionKey: "local:user-1",
      platform: "local",
      userName: "Updated User",
      content: "again",
    })

    expect(restored.id).toBe(created.id)
    expect(restored.userMeta).toEqual(
      expect.objectContaining({
        userId: "user-1",
        userName: "Updated User",
        chatName: "General",
      }),
    )
  })

  it("tracks active sessions, history, agent ids, past ids, and resume policy", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
      idFactory: fixedIdFactory(["one", "two"]),
    })

    const first = await repository.createSession({
      sessionKey: "s1",
      platform: "local",
      name: "first",
      resumePolicy: "fresh",
    })
    await repository.appendHistory(first.id, "user", "hello", {
      attachments: [{
        kind: "image",
        mimeType: "image/png",
        name: "chart.png",
        size: 3,
        sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
        preparedForSdk: true,
      }],
    })
    await repository.saveAgentSession({
      conversationId: first.id,
      agentType: "claude-code",
      agentSessionId: "claude-1",
      resumePolicy: "resume",
    })
    const cleared = await repository.clearCurrentAgentSessionId(first.id, "claude-code")

    expect(cleared.agentSessionId).toBeUndefined()
    expect(cleared.pastAgentSessionIds).toEqual(["claude-1"])
    expect(cleared.history).toEqual([
      expect.objectContaining({
        role: "user",
        content: "hello",
        metadata: {
          attachments: [{
            kind: "image",
            mimeType: "image/png",
            name: "chart.png",
            size: 3,
            sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
            preparedForSdk: true,
          }],
        },
      }),
    ])

    const second = await repository.createSession({
      sessionKey: "s1",
      platform: "local",
      name: "second",
    })

    expect((await repository.get(first.id))?.active).toBe(false)
    expect((await repository.get(second.id))?.active).toBe(true)
    expect((await repository.getActive("s1", "local"))?.id).toBe(second.id)
  })

  it("retries the final active write when creating a session", async () => {
    const conversations = new FailingUpsertNamespace<ConversationEntryV1>("conversations", new Set([2]))
    const logger = { warn: vi.fn() }
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
      idFactory: fixedIdFactory(["one"]),
      logger,
    })

    const session = await repository.createSession({
      sessionKey: "s1",
      platform: "local",
      name: "first",
    })

    expect(session.active).toBe(true)
    expect((await conversations.get(session.id))?.active).toBe(true)
    expect(await repository.getActive("s1", "local")).toEqual(expect.objectContaining({
      id: session.id,
      active: true,
    }))
    expect(logger.warn).toHaveBeenCalledWith(
      "Failed to activate newly created Agent session. Retrying once.",
      expect.objectContaining({ conversationId: session.id }),
    )
  })

  it("removes the inactive placeholder when creating a session cannot be activated", async () => {
    const conversations = new FailingUpsertNamespace<ConversationEntryV1>("conversations", new Set([2, 3]))
    const logger = { warn: vi.fn() }
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
      idFactory: fixedIdFactory(["one"]),
      logger,
    })

    await expect(repository.createSession({
      sessionKey: "s1",
      platform: "local",
      name: "first",
    })).rejects.toThrow("upsert failed on call 3")

    expect(await conversations.get(conversationId("local", "s1", "one"))).toBeNull()
    expect(await repository.getActive("s1", "local")).toBeNull()
  })

  it("restores previously active sessions when setActiveSession cannot deactivate all others", async () => {
    const conversations = new FailingUpsertNamespace<ConversationEntryV1>("conversations", new Set([6]))
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })
    await conversations.upsert(sessionEntry({ id: "previous-1", active: true }))
    await conversations.upsert(sessionEntry({ id: "previous-2", active: true }))
    await conversations.upsert(sessionEntry({ id: "target", active: false }))

    await expect(repository.setActiveSession("s1", "target", "local")).rejects.toThrow("upsert failed on call 6")

    await expect(conversations.get("previous-1")).resolves.toMatchObject({ active: true })
    await expect(conversations.get("previous-2")).resolves.toMatchObject({ active: true })
    await expect(conversations.get("target")).resolves.toMatchObject({ active: false })
  })

  it("stores agentType when provided at creation", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })

    const session = await repository.createSession({
      sessionKey: "local:renderer",
      platform: "local-renderer",
      name: "Test Session",
      agentType: "claude-code",
    })

    expect(session.agentType).toBe("claude-code")

    const retrieved = await conversations.get(session.id)
    expect(retrieved?.agentType).toBe("claude-code")
  })

  it("stores agentType as undefined when not provided", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })

    const session = await repository.createSession({
      sessionKey: "local:renderer",
      platform: "local-renderer",
      name: "No Agent",
    })

    expect(session.agentType).toBeUndefined()
  })

  it("saves active main-thread persona on an existing conversation", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })
    const conversation = await repository.createSession({
      sessionKey: "local:renderer",
      agentType: "claude-code",
    })

    const updated = await repository.saveMainThreadPersona(conversation.id, {
      id: "builtin-zh-en-translator",
      name: "中英翻译",
      source: "builtin",
      definitionHash: "hash-translator",
    })

    expect(updated.agentConfig?.activeMainThreadPersonaId).toBe("builtin-zh-en-translator")
    expect(updated.agentConfig?.activeMainThreadPersonaSnapshot).toEqual({
      id: "builtin-zh-en-translator",
      name: "中英翻译",
      source: "builtin",
      definitionHash: "hash-translator",
    })
  })

  it("renames only automatically named conversations from generated titles", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
      idFactory: fixedIdFactory(["auto", "legacy", "custom"]),
    })
    const automatic = await repository.createSession({
      sessionKey: "local:renderer",
      name: "新会话 08:32 PM",
    })
    const legacy = await repository.createSession({
      sessionKey: "local:renderer",
      name: "新对话 15:20",
    })
    const custom = await repository.createSession({
      sessionKey: "local:renderer",
      name: "企业微信通知",
    })

    await repository.appendHistory(automatic.id, "user", "你好")
    await expect(repository.renameSessionFromFirstUserMessage(
      automatic.id,
    )).resolves.toMatchObject({ name: "你好" })
    await expect(repository.renameSessionFromGeneratedTitle(
      automatic.id,
      "  Send test message in WeCom  ",
    )).resolves.toMatchObject({ name: "Send test message in WeCom" })
    await expect(repository.renameSessionFromGeneratedTitle(
      legacy.id,
      "发送企业微信测试消息",
    )).resolves.toMatchObject({ name: "发送企业微信测试消息" })
    await expect(repository.renameSessionFromGeneratedTitle(
      custom.id,
      "Generated replacement",
    )).resolves.toBeNull()
    await expect(conversations.get(custom.id)).resolves.toMatchObject({ name: "企业微信通知" })
  })

  it("clears active main-thread persona without dropping mode or model tier", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })
    const conversation = await repository.createSession({
      sessionKey: "local:renderer",
      agentType: "claude-code",
      mode: "plan",
      modelTier: "sonnet",
    })
    await repository.saveMainThreadPersona(conversation.id, {
      id: "builtin-zh-en-translator",
      name: "中英翻译",
      source: "builtin",
      definitionHash: "hash-translator",
    })

    const updated = await repository.saveMainThreadPersona(conversation.id, null)

    expect(updated.agentConfig).toMatchObject({
      mode: "plan",
      modelTier: "sonnet",
    })
    expect(updated.agentConfig?.activeMainThreadPersonaId).toBeNull()
    expect(updated.agentConfig?.activeMainThreadPersonaSnapshot).toBeUndefined()
  })

  it("keeps active conversations isolated by workspace key", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })

    const repoA = await repository.getOrCreateActive({
      projectId: "project-1",
      sessionKey: "external:group:user",
      platform: "external",
      channelKey: "external:group",
      workspaceKey: "workspace:a",
      workspacePath: "/repo-a",
      content: "hello a",
    })
    const repoB = await repository.getOrCreateActive({
      projectId: "project-1",
      sessionKey: "external:group:user",
      platform: "external",
      channelKey: "external:group",
      workspaceKey: "workspace:b",
      workspacePath: "/repo-b",
      content: "hello b",
    })

    expect(repoA.id).not.toBe(repoB.id)
    expect((await repository.getActive("external:group:user", "external", "workspace:a"))?.id)
      .toBe(repoA.id)
    expect((await repository.getActive("external:group:user", "external", "workspace:b"))?.id)
      .toBe(repoB.id)
    expect(repoA.active).toBe(true)
    expect(repoB.active).toBe(true)
  })

  it("refreshes providerId when restoring an active session", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })

    const created = await repository.getOrCreateActive({
      projectId: "project-1",
      sessionKey: "local:renderer",
      platform: "local",
      providerId: "anthropic",
      content: "hello",
    })

    const restored = await repository.getOrCreateActive({
      projectId: "project-1",
      sessionKey: "local:renderer",
      platform: "local",
      providerId: "deepseek",
      content: "again",
    })

    expect(restored.id).toBe(created.id)
    expect(restored.providerId).toBe("deepseek")
    expect((await conversations.get(created.id))?.providerId).toBe("deepseek")
  })

  it("stores and refreshes agentType when restoring an active session", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })

    const created = await repository.getOrCreateActive({
      projectId: "project-1",
      sessionKey: "scheduled:project-1:run-1",
      platform: "scheduled",
      agentType: "claude-code",
      content: "hello",
    })

    const restored = await repository.getOrCreateActive({
      projectId: "project-1",
      sessionKey: "scheduled:project-1:run-1",
      platform: "scheduled",
      agentType: "claude-sdk",
      content: "again",
    })

    expect(created.agentType).toBe("claude-code")
    expect(restored.id).toBe(created.id)
    expect(restored.agentType).toBe("claude-sdk")
    expect((await conversations.get(created.id))?.agentType).toBe("claude-sdk")
  })
})

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

class FailingUpsertNamespace<T extends { id: string }> extends MemoryNamespace<T> {
  private upsertCount = 0

  constructor(
    name: string,
    private readonly failingCalls: ReadonlySet<number>,
  ) {
    super(name)
  }

  override async upsert(item: T): Promise<void> {
    this.upsertCount += 1
    if (this.failingCalls.has(this.upsertCount)) {
      throw new Error(`upsert failed on call ${this.upsertCount}`)
    }
    await super.upsert(item)
  }
}

function fixedNow(): Date {
  return new Date("2026-04-26T00:00:00.000Z")
}

function sessionEntry(patch: Partial<ConversationEntryV1>): ConversationEntryV1 {
  return {
    id: "conversation",
    schemaVersion: 1,
    projectId: "project-1",
    sessionKey: "s1",
    platform: "local",
    name: "session",
    active: false,
    history: [],
    createdAt: fixedNow().toISOString(),
    updatedAt: fixedNow().toISOString(),
    ...patch,
  }
}

function fixedIdFactory(ids: readonly string[]): () => string {
  let index = 0
  return () => ids[index++] ?? "fallback"
}
