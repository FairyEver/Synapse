import { beforeEach, describe, expect, it, vi } from "vitest"
import path from "node:path"

const electronMock = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => "/user-data"),
  },
}))

const fsPromisesMock = vi.hoisted(() => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
}))

const logStoreMock = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import type { ConversationEntryV1, DataNamespace, DataRepository } from "../../../runtime/data-repo"
import type { IpcHandlerContext } from "../../../runtime/ipc"
import type { ProjectContainer, ProjectContainerRegistry } from "../../../runtime/project-container"
import type { WindowManager } from "../../../runtime/window"
import { AGENT_RUNTIME_SERVICE_ID } from "../../../services/agent-runtime"
import { AGENT_CONVERSATION_WINDOW_SERVICE_ID } from "../../../services/agent-conversation-window-service"
import { configStore } from "../../../services/config-store"
import { PROVIDER_SERVICE_ID } from "../../../services/provider"
import { sessionMethods } from "../ipc-sessions"
import { DEFAULT_AGENT_WORKSPACE_PROJECT_ID } from "../../../../src/lib/default-agent-workspace"

vi.mock("electron", () => electronMock)

vi.mock("node:fs/promises", () => fsPromisesMock)

vi.mock("../../../services/config-store", () => ({
  configStore: {
    load: vi.fn(),
  },
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: vi.fn(() => logStoreMock.logger),
}))

describe("agent session IPC methods", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMock.app.getPath.mockReturnValue("/user-data")
    fsPromisesMock.mkdir.mockResolvedValue(undefined)
    fsPromisesMock.stat.mockResolvedValue({
      isDirectory: () => true,
    })
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [{
        uuid: "project-1",
        name: "Project One",
        localPath: "/repo",
        contentDirs: {},
      }],
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
  })

  it("does not report switch success when the Agent runtime fails to activate the session", async () => {
    const runtimeError = new Error("SDK session closed after prompt: secret request")
    const switchSession = vi.fn().mockRejectedValue(runtimeError)
    const conversations = {
      get: vi.fn().mockResolvedValue(storedConversation()),
    }
    const ctx = createContext({
      agent: { switchSession },
      dataRepo: {
        namespace: vi.fn(() => conversations),
      } as unknown as DataRepository,
    })

    await expect(sessionMethods.switchSession.handler(ctx, {
      projectId: "project-1",
      conversationId: "conv-1",
    })).rejects.toThrow("切换 Agent 会话失败")

    expect(conversations.get).not.toHaveBeenCalled()
    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "Agent session switch failed.",
      expect.objectContaining({
        projectId: "project-1",
        conversationId: "conv-1",
        sessionKey: "local:renderer",
        boundary: "agent.ipc.switch-session",
        errorName: "Error",
        errorLength: "SDK session closed after prompt: secret request".length,
      }),
    )
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("secret request")
  })

  it("logs session creation failures with sanitized IPC context", async () => {
    const createSession = vi.fn().mockRejectedValue(new Error("failed in /Users/liyang/private/repo with token=sk-test"))
    const ctx = createContext({
      agent: { createSession },
      dataRepo: {
        namespace: vi.fn(),
      } as unknown as DataRepository,
    })

    await expect(sessionMethods.createSession.handler(ctx, {
      projectId: "project-1",
      sessionKey: " local:renderer ",
      name: "Do not log this title",
      agentType: "claude-code",
      providerId: "anthropic",
    })).rejects.toThrow("创建 Agent 会话失败")

    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "Agent session creation failed.",
      expect.objectContaining({
        projectId: "project-1",
        sessionKey: "local:renderer",
        agentType: "claude-code",
        providerId: "anthropic",
        boundary: "agent.ipc.create-session",
        errorName: "Error",
        errorLength: "failed in /Users/liyang/private/repo with token=sk-test".length,
      }),
    )
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("/Users/liyang/private/repo")
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("sk-test")
  })

  it("blocks managed knowledge base session creation during storage migration", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [],
      global: {
        themeMode: "system",
        projects: [{
          id: "kb-1",
          name: "Knowledge",
          path: "synapse-kb://kb-1",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              managed: true,
              runtimeId: "kb-1",
            },
          },
        }],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
    const createSession = vi.fn()
    const storageMigration = { isActive: vi.fn(() => true) }
    const ctx = createContext({
      agent: { createSession },
      dataRepo: {
        namespace: vi.fn(),
      } as unknown as DataRepository,
      storageMigration,
    })

    await expect(sessionMethods.createSession.handler(ctx, {
      projectId: "kb-1",
      agentType: "claude-code",
    })).rejects.toThrow("创建 Agent 会话失败")

    expect(storageMigration.isActive).toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
    expect(ctx.projectContainers.open).not.toHaveBeenCalled()
  })

  it("preserves recoverable managed knowledge base workspace errors during session creation", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [],
      global: {
        themeMode: "system",
        projects: [{
          id: "kb-1",
          name: "Knowledge",
          path: "synapse-kb://kb-1",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              managed: true,
              runtimeId: "kb-1",
            },
          },
        }],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
    fsPromisesMock.stat.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }))
    const createSession = vi.fn()
    const storageMigration = { isActive: vi.fn(() => false) }
    const ctx = createContext({
      agent: { createSession },
      dataRepo: {
        namespace: vi.fn(),
      } as unknown as DataRepository,
      storageMigration,
    })

    await expect(sessionMethods.createSession.handler(ctx, {
      projectId: "kb-1",
      agentType: "claude-code",
    })).rejects.toThrow("知识库运行目录不存在。请重新创建知识库或从备份恢复。")

    expect(createSession).not.toHaveBeenCalled()
    expect(ctx.projectContainers.open).not.toHaveBeenCalled()
  })

  it("creates sessions in the built-in local conversation workspace", async () => {
    const workspacePath = path.join("/user-data", "agent-workspaces", "default")
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [],
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
    const createSession = vi.fn().mockResolvedValue(storedConversation({
      id: "local-conv",
      projectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
    }))
    const ctx = createContext({
      agent: { createSession },
      dataRepo: {
        namespace: vi.fn(),
      } as unknown as DataRepository,
    })

    await expect(sessionMethods.createSession.handler(ctx, {
      projectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
      agentType: "claude-code",
      providerId: "anthropic",
    })).resolves.toEqual(expect.objectContaining({
      id: "local-conv",
      projectId: DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
    }))

    expect(fsPromisesMock.mkdir).toHaveBeenCalledWith(
      workspacePath,
      { recursive: true },
    )
    expect(ctx.projectContainers.open).toHaveBeenCalledWith(
      DEFAULT_AGENT_WORKSPACE_PROJECT_ID,
      {
        name: "本地对话",
        workspacePath,
        managedKnowledgeBase: undefined,
      },
    )
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      platform: "local-renderer",
      sessionKey: "local:renderer",
    }))
  })

  it("updates a conversation persona through IPC", async () => {
    const updateSessionPersona = vi.fn().mockResolvedValue(storedConversation({
      agentConfig: {
        activeMainThreadPersonaId: "builtin-zh-en-translator",
        activeMainThreadPersonaSnapshot: {
          id: "builtin-zh-en-translator",
          name: "中英翻译",
          source: "builtin",
          definitionHash: "hash-translator",
        },
      },
    }))
    const ctx = createContext({
      agent: { updateSessionPersona },
      dataRepo: {
        namespace: vi.fn(),
      } as unknown as DataRepository,
    })

    const result = await sessionMethods.updateSessionPersona.handler(ctx, {
      projectId: "project-1",
      conversationId: "conv-1",
      personaId: "builtin-zh-en-translator",
    }) as { activeMainThreadPersonaId?: string; activeMainThreadPersonaName?: string }

    expect(updateSessionPersona).toHaveBeenCalledWith({
      conversationId: "conv-1",
      personaId: "builtin-zh-en-translator",
    })
    expect(result.activeMainThreadPersonaId).toBe("builtin-zh-en-translator")
    expect(result.activeMainThreadPersonaName).toBe("中英翻译")
  })

  it("clears a conversation persona through IPC", async () => {
    const updateSessionPersona = vi.fn().mockResolvedValue(storedConversation())
    const ctx = createContext({
      agent: { updateSessionPersona },
      dataRepo: {
        namespace: vi.fn(),
      } as unknown as DataRepository,
    })

    const result = await sessionMethods.updateSessionPersona.handler(ctx, {
      projectId: "project-1",
      conversationId: "conv-1",
      personaId: null,
    }) as { activeMainThreadPersonaId?: string }

    expect(updateSessionPersona).toHaveBeenCalledWith({
      conversationId: "conv-1",
      personaId: null,
    })
    expect(result.activeMainThreadPersonaId).toBeUndefined()
  })

  it("logs session deletion failures with conversation context", async () => {
    const deleteSession = vi.fn().mockRejectedValue(new Error("repository unavailable for message body"))
    const ctx = createContext({
      agent: { deleteSession },
      dataRepo: {
        namespace: vi.fn(),
      } as unknown as DataRepository,
    })

    await expect(sessionMethods.deleteSession.handler(ctx, {
      projectId: "project-1",
      conversationId: "conv-1",
    })).rejects.toThrow("删除 Agent 会话失败")

    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "Agent session deletion failed.",
      expect.objectContaining({
        projectId: "project-1",
        conversationId: "conv-1",
        boundary: "agent.ipc.delete-session",
        errorName: "Error",
        errorLength: "repository unavailable for message body".length,
      }),
    )
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("message body")
  })

  it("closes a detached conversation window after deleting its session", async () => {
    const deleteSession = vi.fn().mockResolvedValue(true)
    const conversationWindowService = createConversationWindowServiceMock()
    const ctx = createContext({
      agent: { deleteSession },
      dataRepo: {
        namespace: vi.fn(),
      } as unknown as DataRepository,
      conversationWindowService,
    })

    await expect(sessionMethods.deleteSession.handler(ctx, {
      projectId: "project-1",
      conversationId: "conv-1",
    })).resolves.toEqual({ ok: true })

    expect(conversationWindowService.closeConversationWindow).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conv-1",
    })
  })

  it("keeps detached windows open when session deletion returns false", async () => {
    const deleteSession = vi.fn().mockResolvedValue(false)
    const conversationWindowService = createConversationWindowServiceMock()
    const ctx = createContext({
      agent: { deleteSession },
      dataRepo: {
        namespace: vi.fn(),
      } as unknown as DataRepository,
      conversationWindowService,
    })

    await expect(sessionMethods.deleteSession.handler(ctx, {
      projectId: "project-1",
      conversationId: "conv-1",
    })).resolves.toEqual({ ok: false })

    expect(conversationWindowService.closeConversationWindow).not.toHaveBeenCalled()
  })

  it("deletes an archived orphan session after its project was removed", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [],
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
    const conversations = createConversationNamespace([
      storedConversation({ id: "orphan-conv", projectId: "removed-project" }),
    ])
    const ctx = createContext({
      agent: {},
      dataRepo: {
        namespace: vi.fn(() => conversations),
      } as unknown as DataRepository,
    })

    await expect(sessionMethods.deleteSession.handler(ctx, {
      projectId: "removed-project",
      conversationId: "orphan-conv",
    })).resolves.toEqual({ ok: true })

    expect(await conversations.get("orphan-conv")).toBeNull()
  })

  it("opens an existing swarm conversation in the main Agent tab", async () => {
    const conversations = createConversationNamespace([
      storedConversation({
        id: "conv-swarm",
        platform: "swarm",
        sessionKey: "swarm:task-1:run-1",
      }),
    ])
    const windowManager = createWindowManager()
    const ctx = createContext({
      agent: {},
      dataRepo: {
        namespace: vi.fn(() => conversations),
      } as unknown as DataRepository,
      windowManager,
    })

    await expect(sessionMethods.openConversation.handler(ctx, {
      projectId: "project-1",
      conversationId: "conv-swarm",
      sessionKey: "swarm:task-1:run-1",
      platform: "swarm",
    })).resolves.toEqual({ opened: true })

    expect(windowManager.open).toHaveBeenCalledWith("main")
    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:open-agent-session",
      {
        projectId: "project-1",
        conversationId: "conv-swarm",
        sessionKey: "swarm:task-1:run-1",
        sourceFilter: "swarm",
      },
      expect.any(Function),
    )
    const filter = windowManager.broadcast.mock.calls[0]?.[2]
    expect(filter?.({ role: "main" })).toBe(true)
    expect(filter?.({ role: "detail" })).toBe(false)
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("Agent conversation opened.", {
      projectId: "project-1",
      conversationId: "conv-swarm",
      sessionKey: "swarm:task-1:run-1",
      platform: "swarm",
    })
  })

  it("opens an existing workflow conversation in the main Agent tab", async () => {
    const conversations = createConversationNamespace([
      storedConversation({
        id: "conv-workflow",
        platform: "workflow",
        sessionKey: "workflow:project-1:123",
      }),
    ])
    const windowManager = createWindowManager()
    const ctx = createContext({
      agent: {},
      dataRepo: {
        namespace: vi.fn(() => conversations),
      } as unknown as DataRepository,
      windowManager,
    })

    await expect(sessionMethods.openConversation.handler(ctx, {
      projectId: "project-1",
      conversationId: "conv-workflow",
      sessionKey: "workflow:project-1:123",
      platform: "workflow",
    })).resolves.toEqual({ opened: true })

    expect(windowManager.open).toHaveBeenCalledWith("main")
    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:open-agent-session",
      {
        projectId: "project-1",
        conversationId: "conv-workflow",
        sessionKey: "workflow:project-1:123",
        sourceFilter: "workflow",
      },
      expect.any(Function),
    )
    const filter = windowManager.broadcast.mock.calls[0]?.[2]
    expect(filter?.({ role: "main" })).toBe(true)
    expect(filter?.({ role: "detail" })).toBe(false)
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("Agent conversation opened.", {
      projectId: "project-1",
      conversationId: "conv-workflow",
      sessionKey: "workflow:project-1:123",
      platform: "workflow",
    })
  })

  it("does not open the Agent tab when the workflow conversation is gone", async () => {
    const conversations = createConversationNamespace([])
    const windowManager = createWindowManager()
    const ctx = createContext({
      agent: {},
      dataRepo: {
        namespace: vi.fn(() => conversations),
      } as unknown as DataRepository,
      windowManager,
    })

    await expect(sessionMethods.openConversation.handler(ctx, {
      projectId: "project-1",
      conversationId: "conv-workflow",
      sessionKey: "workflow:project-1:123",
      platform: "workflow",
    })).resolves.toEqual({ opened: false, reason: "not-found" })

    expect(windowManager.open).not.toHaveBeenCalled()
    expect(windowManager.broadcast).not.toHaveBeenCalled()
    expect(logStoreMock.logger.warn).toHaveBeenCalledWith("Agent conversation open skipped.", {
      projectId: "project-1",
      conversationId: "conv-workflow",
      sessionKey: "workflow:project-1:123",
      platform: "workflow",
      reason: "not-found",
    })
  })

  it("opens an agent conversation window", async () => {
    const conversationWindowService = {
      openConversationWindow: vi.fn(async () => ({ opened: true })),
      focusConversationWindow: vi.fn(),
      listDetachedConversations: vi.fn(),
      closeConversationWindow: vi.fn(),
    }
    const ctx = createContext({
      agent: {},
      dataRepo: {
        namespace: vi.fn(() => createConversationNamespace([])),
      } as unknown as DataRepository,
      conversationWindowService,
    })

    await expect(sessionMethods.openConversationWindow.handler(ctx, {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
    })).resolves.toEqual({ opened: true })

    expect(conversationWindowService.openConversationWindow).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
    })
  })

  it("focuses an agent conversation window", async () => {
    const conversationWindowService = {
      openConversationWindow: vi.fn(),
      focusConversationWindow: vi.fn(() => ({ focused: true })),
      listDetachedConversations: vi.fn(),
      closeConversationWindow: vi.fn(),
    }
    const ctx = createContext({
      agent: {},
      dataRepo: {
        namespace: vi.fn(() => createConversationNamespace([])),
      } as unknown as DataRepository,
      conversationWindowService,
    })

    await expect(sessionMethods.focusConversationWindow.handler(ctx, {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
    })).resolves.toEqual({ focused: true })
  })

  it("lists detached agent conversation windows", async () => {
    const conversationWindowService = {
      openConversationWindow: vi.fn(),
      focusConversationWindow: vi.fn(),
      listDetachedConversations: vi.fn(() => [{
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
        title: "新会话",
        windowId: 10,
        openedAt: "2026-06-17T00:00:00.000Z",
      }]),
      closeConversationWindow: vi.fn(),
    }
    const ctx = createContext({
      agent: {},
      dataRepo: {
        namespace: vi.fn(() => createConversationNamespace([])),
      } as unknown as DataRepository,
      conversationWindowService,
    })

    await expect(sessionMethods.listDetachedConversationWindows.handler(ctx, {})).resolves.toEqual([{
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
      title: "新会话",
      windowId: 10,
      openedAt: "2026-06-17T00:00:00.000Z",
    }])
  })

  it("replaces an agent conversation window target", async () => {
    const conversationWindowService = {
      openConversationWindow: vi.fn(),
      focusConversationWindow: vi.fn(),
      listDetachedConversations: vi.fn(),
      closeConversationWindow: vi.fn(),
      replaceConversationWindowTarget: vi.fn(() => ({ replaced: true })),
    }
    const ctx = createContext({
      agent: {},
      dataRepo: {
        namespace: vi.fn(() => createConversationNamespace([])),
      } as unknown as DataRepository,
      conversationWindowService,
    })

    await expect(sessionMethods.replaceConversationWindowTarget.handler(ctx, {
      from: {
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
      },
      to: {
        projectId: "project-1",
        conversationId: "conversation-2",
        sessionKey: "local:renderer",
        title: "新会话",
      },
    })).resolves.toEqual({ replaced: true })

    expect(conversationWindowService.replaceConversationWindowTarget).toHaveBeenCalledWith({
      from: {
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
      },
      to: {
        projectId: "project-1",
        conversationId: "conversation-2",
        sessionKey: "local:renderer",
        title: "新会话",
      },
    })
  })

  it("logs session rename failures without recording the requested title", async () => {
    const renameSession = vi.fn().mockRejectedValue(new Error("write failed"))
    const ctx = createContext({
      agent: { renameSession },
      dataRepo: {
        namespace: vi.fn(),
      } as unknown as DataRepository,
    })

    await expect(sessionMethods.renameSession.handler(ctx, {
      projectId: "project-1",
      conversationId: "conv-1",
      name: "Sensitive session title",
    })).rejects.toThrow("重命名 Agent 会话失败")

    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "Agent session rename failed.",
      expect.not.objectContaining({
        name: "Sensitive session title",
      }),
    )
    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "Agent session rename failed.",
      expect.objectContaining({
        projectId: "project-1",
        conversationId: "conv-1",
        boundary: "agent.ipc.rename-session",
        errorName: "Error",
        errorLength: "write failed".length,
      }),
    )
  })
})

function createContext(overrides: {
  readonly agent: Record<string, unknown>
  readonly dataRepo: DataRepository
  readonly storageMigration?: { isActive: ReturnType<typeof vi.fn> }
  readonly windowManager?: WindowManager
  readonly conversationWindowService?: {
    readonly openConversationWindow: ReturnType<typeof vi.fn>
    readonly focusConversationWindow: ReturnType<typeof vi.fn>
    readonly listDetachedConversations: ReturnType<typeof vi.fn>
    readonly closeConversationWindow: ReturnType<typeof vi.fn>
    readonly replaceConversationWindowTarget?: ReturnType<typeof vi.fn>
  }
}): IpcHandlerContext & {
  readonly projectContainers: Pick<ProjectContainerRegistry, "open">
} {
  const providerService = {}
  const container: ProjectContainer = {
    projectId: "project-1",
    get: <T>(id: string): T => {
      if (id === AGENT_RUNTIME_SERVICE_ID) return overrides.agent as T
      if (id === PROVIDER_SERVICE_ID) return providerService as T
      throw new Error(`Unknown service: ${id}`)
    },
    inspect: () => [],
    dispose: vi.fn().mockResolvedValue(undefined),
  }
  const projectContainers: Pick<ProjectContainerRegistry, "open"> = {
    open: vi.fn().mockResolvedValue(container),
  }
  return {
    moduleId: "agent",
    projectContainers,
    resolve: <T>(serviceId: string): T => {
      if (serviceId === "core.project-containers") return projectContainers as T
      if (serviceId === "core.data-repository") return overrides.dataRepo as T
      if (serviceId === "core.window-manager" && overrides.windowManager) return overrides.windowManager as T
      if (serviceId === AGENT_CONVERSATION_WINDOW_SERVICE_ID) {
        return (overrides.conversationWindowService ?? createConversationWindowServiceMock()) as T
      }
      if (serviceId === "knowledge-base.storage-migration-service" && overrides.storageMigration) return overrides.storageMigration as T
      throw new Error(`Unknown service: ${serviceId}`)
    },
  }
}

function createConversationWindowServiceMock() {
  return {
    openConversationWindow: vi.fn(async () => ({ opened: true })),
    focusConversationWindow: vi.fn(() => ({ focused: true })),
    listDetachedConversations: vi.fn(() => []),
    closeConversationWindow: vi.fn(() => ({ closed: true })),
  }
}

function createWindowManager(): WindowManager & {
  open: ReturnType<typeof vi.fn>
  broadcast: ReturnType<typeof vi.fn>
} {
  return {
    register: vi.fn(),
    attach: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    list: vi.fn(() => []),
    getAllWindows: vi.fn(() => []),
    broadcast: vi.fn(() => 1),
  } as unknown as WindowManager & {
    open: ReturnType<typeof vi.fn>
    broadcast: ReturnType<typeof vi.fn>
  }
}

function storedConversation(overrides: Partial<ConversationEntryV1> = {}): ConversationEntryV1 {
  return {
    id: "conv-1",
    schemaVersion: 1,
    projectId: "project-1",
    sessionKey: "local:renderer",
    platform: "local-renderer",
    agentType: "claude-code",
    active: true,
    history: [],
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  }
}

function createConversationNamespace(items: ConversationEntryV1[]): DataNamespace<ConversationEntryV1> {
  const store = new Map(items.map((item) => [item.id, item]))
  return {
    name: "conversations",
    schemaVersion: 1,
    backend: "sqlite",
    getSingleton: vi.fn().mockResolvedValue(null),
    setSingleton: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(async () => Array.from(store.values())),
    get: vi.fn(async (id: string) => store.get(id) ?? null),
    upsert: vi.fn(async (item: ConversationEntryV1) => {
      store.set(item.id, item)
    }),
    remove: vi.fn(async (id: string) => {
      store.delete(id)
    }),
    onChange: vi.fn(() => () => undefined),
  }
}
