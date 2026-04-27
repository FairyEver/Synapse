import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"
import type { IpcHandlerContext } from "../../../runtime/ipc"
import type { ProjectContainer, ProjectContainerRegistry } from "../../../runtime/project-container"
import { AGENT_RUNTIME_SERVICE_ID } from "../../../services/agent-runtime"
import { PROVIDER_CONFIG_SERVICE_ID } from "../../../services/provider-config"
import { agentIpcModule } from "../ipc"
import { configStore } from "../../../services/config-store"

vi.mock("../../../services/cli/cli-detect-service", () => ({
  whichBin: vi.fn().mockResolvedValue(null),
}))

vi.mock("../../../services/config-store", () => ({
  configStore: {
    load: vi.fn(),
  },
}))

describe("agentIpcModule", () => {
  beforeEach(() => {
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

  it("opens the project container and sends local renderer messages through AgentRuntime", async () => {
    const send = vi.fn().mockResolvedValue({
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
      agentSessionId: "thread-1",
      threadId: "thread-1",
    })
    const harness = createHarness({
      agent: {
        send,
      },
    })

    const result = await harness.invoke("synapse:agent:send", {
      projectId: "project-1",
      content: "hello",
    })

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      sessionKey: "local:renderer",
      platform: "local-renderer",
      content: "hello",
      replyCtx: {
        kind: "local-renderer",
        projectId: "project-1",
        sessionKey: "local:renderer",
      },
    }))
    expect(result).toEqual({
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conv-1",
      resultText: "done",
      events: [{ type: "result", content: "done", done: true }],
      agentSessionId: "thread-1",
      threadId: "thread-1",
      error: undefined,
    })
  })

  it("returns provider summaries without secrets", async () => {
    const getProjectProviderState = vi.fn().mockResolvedValue({
      projectId: "project-1",
      agentType: "claude-code",
      activeProviderId: "anthropic",
      activeModel: "claude-sonnet-4.5",
      activeMode: "plan",
      providers: [{
        id: "anthropic",
        display: "Anthropic",
        model: "claude-sonnet-4.5",
        baseUrl: "https://api.anthropic.example.test",
        secretRef: "secret:anthropic",
        scope: "global",
      }],
    })
    const harness = createHarness({
      providerConfig: {
        getActiveAgentType: vi.fn().mockResolvedValue("claude-code"),
        getProjectProviderState,
      },
    })

    const result = await harness.invoke("synapse:agent:get-providers", {
      projectId: "project-1",
    })

    expect(result).toEqual({
      projectId: "project-1",
      agentType: "claude-code",
      activeProviderId: "anthropic",
      activeModel: "claude-sonnet-4.5",
      activeMode: "plan",
      providers: [{
        id: "anthropic",
        display: "Anthropic",
        active: true,
        model: "claude-sonnet-4.5",
        baseUrl: "https://api.anthropic.example.test",
        scope: "global",
      }],
    })
    expect(getProjectProviderState).toHaveBeenCalledWith("project-1", "claude-code")
  })

  it("returns Agent runtime readiness without exposing secrets", async () => {
    const harness = createHarness({
      providerConfig: {
        getProjectProviderState: vi.fn().mockImplementation(async (_projectId: string, agentType: string) => ({
          projectId: "project-1",
          agentType,
          activeProviderId: agentType === "codex" ? "openai" : undefined,
          activeModel: agentType === "codex" ? "gpt-5.4" : undefined,
          providers: agentType === "codex"
            ? [{
                id: "openai",
                display: "OpenAI",
                model: "gpt-5.4",
                baseUrl: "https://api.example.test",
                secretRef: "secret:openai",
                scope: "global",
              }]
            : [],
        })),
      },
    })

    const result = await harness.invoke("synapse:agent:get-runtime-status", {
      projectId: "project-1",
    }) as {
      readonly agents: readonly {
        readonly id: string
        readonly ready: boolean
        readonly issues: readonly string[]
        readonly provider?: { readonly activeProviderId?: string; readonly activeModel?: string }
      }[]
    }

    expect(result.agents.map((agent) => agent.id)).toEqual(["claude-code", "codex"])
    expect(result.agents.find((agent) => agent.id === "codex")).toEqual(expect.objectContaining({
      ready: expect.any(Boolean),
      provider: {
        activeProviderId: "openai",
        activeModel: "gpt-5.4",
        configured: true,
        projectId: "project-1",
      },
    }))
    expect(result.agents.find((agent) => agent.id === "claude-code")?.issues).toContain("provider-not-configured")
  })

  it("returns the full conversation timeline when no limit is requested", async () => {
    const history = Array.from({ length: 101 }, (_, index) => ({
      role: "user" as const,
      content: `message ${String(index + 1)}`,
      timestamp: `2026-04-27T03:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }))
    const getSession = vi.fn().mockResolvedValue({
      projectId: "project-1",
      id: "conv-1",
      sessionKey: "local:renderer",
      active: true,
      history,
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
    })
    const harness = createHarness({
      agent: {
        getSession,
      },
    })

    const result = await harness.invoke("synapse:agent:get-timeline", {
      projectId: "project-1",
      conversationId: "conv-1",
    }) as { readonly entries: readonly { readonly content: string }[] }

    expect(result.entries).toHaveLength(101)
    expect(result.entries[0]).toEqual(expect.objectContaining({
      content: "message 1",
    }))
  })

  it("returns readable source labels for Feishu sessions", async () => {
    const listSessions = vi.fn().mockResolvedValue([{
      projectId: "project-1",
      id: "feishu-conv",
      sessionKey: "feishu:oc_group:ou_user",
      platform: "feishu",
      channelKey: "feishu:oc_group",
      active: true,
      history: [],
      userMeta: {
        userName: "User One",
        chatName: "Dev Group",
      },
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T01:00:00.000Z",
    }])
    const harness = createHarness({
      agent: { listSessions },
    })

    await expect(harness.invoke("synapse:agent:list-sessions", {
      projectId: "project-1",
    })).resolves.toEqual([
      expect.objectContaining({
        projectId: "project-1",
        id: "feishu-conv",
        platform: "feishu",
        sourceLabel: "Dev Group / User One",
      }),
    ])
  })

  it("opens AgentRuntime for configured project ids used by Feishu connectors", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [{
        uuid: "repo-1",
        name: "Repository One",
        localPath: "/repo",
        contentDirs: {},
      }],
      global: {
        themeMode: "system",
        projects: [{
          id: "project-1",
          name: "Project One",
          path: "/repo",
        }],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
    const listSessions = vi.fn().mockResolvedValue([{
      projectId: "project-1",
      id: "feishu-conv",
      sessionKey: "feishu:oc_group:ou_user",
      platform: "feishu",
      active: true,
      history: [],
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T01:00:00.000Z",
    }])
    const harness = createHarness({
      agent: { listSessions },
    })

    await expect(harness.invoke("synapse:agent:list-sessions", {
      projectId: "project-1",
    })).resolves.toEqual([
      expect.objectContaining({
        projectId: "project-1",
        id: "feishu-conv",
        platform: "feishu",
      }),
    ])
    expect(harness.projectContainers.open).toHaveBeenCalledWith("project-1", {
      name: "Project One",
      workspacePath: "/repo",
    })
  })

  it("creates and switches local renderer sessions", async () => {
    const created = {
      projectId: "project-1",
      id: "conv-2",
      sessionKey: "local:renderer",
      name: "新会话",
      platform: "local-renderer",
      active: true,
      history: [],
      createdAt: "2026-04-26T00:00:00.000Z",
      updatedAt: "2026-04-26T00:00:00.000Z",
    }
    const createSession = vi.fn().mockResolvedValue(created)
    const switchSession = vi.fn().mockResolvedValue({
      ...created,
      id: "conv-1",
      name: "旧会话",
    })
    const deleteSession = vi.fn().mockResolvedValue(true)
    const harness = createHarness({
      agent: {
        createSession,
        switchSession,
        deleteSession,
      },
    })

    expect(await harness.invoke("synapse:agent:create-session", {
      projectId: "project-1",
      name: "新会话",
    })).toEqual(expect.objectContaining({
      projectId: "project-1",
      id: "conv-2",
      sessionKey: "local:renderer",
      name: "新会话",
      active: true,
      historyCount: 0,
    }))
    expect(createSession).toHaveBeenCalledWith({
      sessionKey: "local:renderer",
      platform: "local-renderer",
      name: "新会话",
    })

    expect(await harness.invoke("synapse:agent:switch-session", {
      projectId: "project-1",
      conversationId: "conv-1",
    })).toEqual(expect.objectContaining({
      projectId: "project-1",
      id: "conv-1",
      sessionKey: "local:renderer",
      name: "旧会话",
      active: true,
      historyCount: 0,
    }))
    expect(switchSession).toHaveBeenCalledWith(
      "local:renderer",
      "conv-1",
      "local-renderer",
    )

    expect(await harness.invoke("synapse:agent:delete-session", {
      projectId: "project-1",
      conversationId: "conv-1",
    })).toEqual({ ok: true })
    expect(deleteSession).toHaveBeenCalledWith("conv-1")
  })
})

function createHarness(overrides: {
  readonly agent?: Record<string, unknown>
  readonly providerConfig?: Record<string, unknown>
}) {
  const agent = {
    getStatus: () => ({
      projectId: "project-1",
      agentType: "codex",
      liveSessions: 0,
      busySessions: 0,
      queuedTurns: 0,
      pendingPermissions: 0,
    }),
    listSessions: vi.fn().mockResolvedValue([]),
    getSession: vi.fn().mockResolvedValue(null),
    createSession: vi.fn(),
    switchSession: vi.fn(),
    deleteSession: vi.fn(),
    send: vi.fn(),
    listPendingPermissions: vi.fn().mockReturnValue([]),
    respondPermission: vi.fn().mockResolvedValue(undefined),
    ...overrides.agent,
  }
  const providerConfig = {
    getProjectProviderState: vi.fn().mockResolvedValue({
      projectId: "project-1",
      agentType: "codex",
      providers: [],
    }),
    ...overrides.providerConfig,
  }
  const container: ProjectContainer = {
    projectId: "project-1",
    get: <T>(id: string): T => {
      if (id === AGENT_RUNTIME_SERVICE_ID) return agent as T
      if (id === PROVIDER_CONFIG_SERVICE_ID) return providerConfig as T
      throw new Error(`Unknown service: ${id}`)
    },
    inspect: () => [],
    dispose: vi.fn().mockResolvedValue(undefined),
  }
  const projectContainers: Pick<ProjectContainerRegistry, "open"> = {
    open: vi.fn().mockResolvedValue(container),
  }
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T>(serviceId: string): T => {
    if (serviceId === "core.project-containers") return projectContainers as T
    throw new Error(`Unknown service: ${serviceId}`)
  }
  harness.registry.register(agentIpcModule, {
    moduleId: "agent",
    resolve,
  })
  return Object.assign(harness, { projectContainers })
}
