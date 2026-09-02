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

  it("persists the experimental tool router snapshot only when creating a conversation", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })
    const message = {
      projectId: "project-1",
      sessionKey: "local:user-1",
      platform: "local",
      content: "hello",
    }

    const created = await repository.getOrCreateActive(message, {
      experimentalSynapseToolRouterEnabled: true,
    })
    const restored = await repository.getOrCreateActive(message, {
      experimentalSynapseToolRouterEnabled: false,
    })

    expect(created.agentConfig?.experimentalSynapseToolRouterEnabled).toBe(true)
    expect(restored.agentConfig?.experimentalSynapseToolRouterEnabled).toBe(true)
  })

  it("persists the Figma Desktop MCP snapshot only when creating a conversation", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })
    const message = {
      projectId: "project-1",
      sessionKey: "local:user-1",
      platform: "local",
      content: "hello",
    }

    const created = await repository.getOrCreateActive(message, { figmaDesktopMcpEnabled: true })
    const restored = await repository.getOrCreateActive(message, { figmaDesktopMcpEnabled: false })

    expect(created.agentConfig?.figmaDesktopMcpEnabled).toBe(true)
    expect(restored.agentConfig?.figmaDesktopMcpEnabled).toBe(true)
  })

  it("keeps active conversations isolated by platform", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })

    const local = await repository.getOrCreateActive({
      projectId: "project-1",
      sessionKey: "shared-session",
      platform: "local",
      workspaceKey: "workspace:a",
      content: "local message",
    })

    expect(await repository.getActive("shared-session", "external", "workspace:a")).toBeNull()

    const external = await repository.getOrCreateActive({
      projectId: "project-1",
      sessionKey: "shared-session",
      platform: "external",
      workspaceKey: "workspace:a",
      content: "external message",
    })

    expect(external.id).not.toBe(local.id)
    expect((await repository.get(local.id))?.platform).toBe("local")
    expect((await repository.getActive("shared-session", "local", "workspace:a"))?.id).toBe(local.id)
    expect((await repository.getActive("shared-session", "external", "workspace:a"))?.id).toBe(external.id)
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

  it("resolves only the matching user question history entry once", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })
    const session = await repository.createSession({
      sessionKey: "s1",
      platform: "local",
      name: "questions",
    })
    await repository.appendHistory(session.id, "system", "AskUserQuestion", {
      agentEventType: "permissionRequest",
      requestId: "request-1",
    })
    await repository.appendHistory(session.id, "system", "status", {
      agentEventType: "sdkEvent",
    })
    await repository.appendHistory(session.id, "system", "AskUserQuestion", {
      agentEventType: "permissionRequest",
      requestId: "request-2",
    })

    await repository.resolveUserQuestion(session.id, "request-1", {
      status: "answered",
      resolvedAt: "2026-05-14T00:01:00.000Z",
      answers: [{ questionIndex: 0, values: ["确认发送"] }],
    })
    await repository.resolveUserQuestion(session.id, "request-1", {
      status: "cancelled",
      resolvedAt: "2026-05-14T00:02:00.000Z",
    })

    const history = (await conversations.get(session.id))?.history ?? []
    expect(history[0]?.metadata?.userQuestionResolution).toEqual({
      status: "answered",
      resolvedAt: "2026-05-14T00:01:00.000Z",
      answers: [{ questionIndex: 0, values: ["确认发送"] }],
    })
    expect(history[1]?.metadata?.userQuestionResolution).toBeUndefined()
    expect(history[2]?.metadata?.userQuestionResolution).toBeUndefined()
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

  it("stores the fixed main-thread persona atomically with conversation creation", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })
    const conversation = await repository.createSession({
      sessionKey: "local:renderer",
      agentType: "claude-code",
      providerId: "anthropic",
      modelTier: "sonnet",
      mainThreadPersonaSnapshot: {
        id: "builtin-zh-en-translator",
        name: "中英翻译",
        source: "builtin",
        definitionHash: "hash-translator",
      },
    })

    expect(conversation).toMatchObject({
      providerId: "anthropic",
      agentConfig: {
      modelTier: "sonnet",
      activeMainThreadPersonaId: "builtin-zh-en-translator",
      },
    })
    expect(conversation.agentConfig?.activeMainThreadPersonaSnapshot).toEqual({
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
    )).resolves.toMatchObject({ name: "你好", titleSource: "fallback" })
    await expect(repository.renameSessionFromGeneratedTitle(
      automatic.id,
      "  Send test message in WeCom  ",
    )).resolves.toMatchObject({ name: "Send test message in WeCom", titleSource: "generated" })
    await expect(repository.renameSessionFromGeneratedTitle(
      legacy.id,
      "发送企业微信测试消息",
    )).resolves.toMatchObject({ name: "发送企业微信测试消息", titleSource: "generated" })
    await expect(repository.renameSessionFromGeneratedTitle(
      custom.id,
      "Generated replacement",
    )).resolves.toBeNull()
    await expect(conversations.get(custom.id)).resolves.toMatchObject({
      name: "企业微信通知",
      titleSource: "manual",
    })
  })

  it("persists manual title intent even when the title looks automatic", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
      idFactory: fixedIdFactory(["fallback", "automatic"]),
    })
    const fallback = await repository.createSession({
      sessionKey: "local:renderer",
      name: "新会话 08:32 PM",
    })
    const automatic = await repository.createSession({
      sessionKey: "local:renderer",
      name: "新对话 15:20",
    })

    await repository.appendHistory(fallback.id, "user", "保留这个标题")
    await repository.renameSessionFromFirstUserMessage(fallback.id)
    await expect(repository.renameSession(fallback.id, "保留这个标题"))
      .resolves.toMatchObject({ titleSource: "manual" })
    await expect(repository.renameSession(automatic.id, "新会话"))
      .resolves.toMatchObject({ titleSource: "manual" })

    const restoredRepository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
    })
    await expect(restoredRepository.renameSessionFromGeneratedTitle(
      fallback.id,
      "迟到的自动标题",
    )).resolves.toBeNull()
    await expect(restoredRepository.renameSessionFromGeneratedTitle(
      automatic.id,
      "另一个迟到标题",
    )).resolves.toBeNull()
    await expect(conversations.get(fallback.id)).resolves.toMatchObject({
      name: "保留这个标题",
      titleSource: "manual",
    })
    await expect(conversations.get(automatic.id)).resolves.toMatchObject({
      name: "新会话",
      titleSource: "manual",
    })
  })

  it("does not let a concurrent generated title overwrite a manual rename", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
      idFactory: fixedIdFactory(["concurrent-title"]),
    })
    const conversation = await repository.createSession({
      sessionKey: "local:renderer",
      name: "新对话 15:20",
    })
    const originalGet = conversations.get.bind(conversations)
    let releaseGeneratedRead: () => void = () => {}
    let generatedReadStarted: () => void = () => {}
    const generatedRead = new Promise<void>((resolve) => { generatedReadStarted = resolve })
    const generatedReadBlock = new Promise<void>((resolve) => { releaseGeneratedRead = resolve })
    let blockNextRead = true
    vi.spyOn(conversations, "get").mockImplementation(async (id) => {
      if (blockNextRead) {
        blockNextRead = false
        generatedReadStarted()
        await generatedReadBlock
      }
      return originalGet(id)
    })

    const generatedRename = repository.renameSessionFromGeneratedTitle(conversation.id, "自动标题")
    await generatedRead
    const manualRename = repository.renameSession(conversation.id, "手动标题")
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    releaseGeneratedRead()
    await Promise.all([generatedRename, manualRename])

    await expect(conversations.get(conversation.id)).resolves.toMatchObject({
      name: "手动标题",
      titleSource: "manual",
    })
  })

  it("does not let a stale non-title write roll back a manual rename", async () => {
    const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
    const repository = new AgentSessionRepository({
      projectId: "project-1",
      conversations,
      now: fixedNow,
      idFactory: fixedIdFactory(["concurrent-history-title"]),
    })
    const conversation = await repository.createSession({
      sessionKey: "local:renderer",
      name: "新对话 15:20",
    })
    const originalGet = conversations.get.bind(conversations)
    let releaseStaleRead: () => void = () => {}
    let staleReadStarted: () => void = () => {}
    const staleRead = new Promise<void>((resolve) => { staleReadStarted = resolve })
    const staleReadBlock = new Promise<void>((resolve) => { releaseStaleRead = resolve })
    let blockNextRead = true
    vi.spyOn(conversations, "get").mockImplementation(async (id) => {
      const snapshot = await originalGet(id)
      if (blockNextRead) {
        blockNextRead = false
        staleReadStarted()
        await staleReadBlock
      }
      return snapshot
    })

    const append = repository.appendHistory(conversation.id, "user", "hello")
    await staleRead
    await repository.renameSession(conversation.id, "手动标题")
    releaseStaleRead()
    await append

    await expect(conversations.get(conversation.id)).resolves.toMatchObject({
      name: "手动标题",
      titleSource: "manual",
      history: [expect.objectContaining({ role: "user", content: "hello" })],
    })
  })

  it("keeps mode and model tier alongside a fixed main-thread persona", async () => {
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
      mainThreadPersonaSnapshot: {
        id: "builtin-zh-en-translator",
        name: "中英翻译",
        source: "builtin",
        definitionHash: "hash-translator",
      },
    })

    expect(conversation.agentConfig).toMatchObject({
      mode: "plan",
      modelTier: "sonnet",
      activeMainThreadPersonaId: "builtin-zh-en-translator",
    })
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
