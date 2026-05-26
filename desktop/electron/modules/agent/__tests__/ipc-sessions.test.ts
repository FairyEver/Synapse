import { beforeEach, describe, expect, it, vi } from "vitest"

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
import { configStore } from "../../../services/config-store"
import { PROVIDER_SERVICE_ID } from "../../../services/provider"
import { sessionMethods } from "../ipc-sessions"

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
  readonly windowManager?: WindowManager
}): IpcHandlerContext {
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
    resolve: <T>(serviceId: string): T => {
      if (serviceId === "core.project-containers") return projectContainers as T
      if (serviceId === "core.data-repository") return overrides.dataRepo as T
      if (serviceId === "core.window-manager" && overrides.windowManager) return overrides.windowManager as T
      throw new Error(`Unknown service: ${serviceId}`)
    },
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
