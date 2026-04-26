import { beforeEach, describe, expect, it, vi } from "vitest"

import { createInMemoryHarness } from "../../../runtime/ipc"
import type { IpcHandlerContext } from "../../../runtime/ipc"
import type { ProjectContainer, ProjectContainerRegistry } from "../../../runtime/project-container"
import { AGENT_RUNTIME_SERVICE_ID } from "../../../services/agent-runtime"
import { PROVIDER_CONFIG_SERVICE_ID } from "../../../services/provider-config"
import { agentIpcModule } from "../ipc"
import { configStore } from "../../../services/config-store"

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
    const harness = createHarness({
      providerConfig: {
        getProjectProviderState: vi.fn().mockResolvedValue({
          projectId: "project-1",
          agentType: "codex",
          activeProviderId: "openai",
          activeModel: "gpt-5.4",
          activeMode: "suggest",
          providers: [{
            id: "openai",
            display: "OpenAI",
            model: "gpt-5.4",
            baseUrl: "https://api.example.test",
            secretRef: "secret:openai",
            scope: "global",
          }],
        }),
      },
    })

    const result = await harness.invoke("synapse:agent:get-providers", {
      projectId: "project-1",
    })

    expect(result).toEqual({
      projectId: "project-1",
      agentType: "codex",
      activeProviderId: "openai",
      activeModel: "gpt-5.4",
      activeMode: "suggest",
      providers: [{
        id: "openai",
        display: "OpenAI",
        active: true,
        model: "gpt-5.4",
        baseUrl: "https://api.example.test",
        scope: "global",
      }],
    })
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
  return harness
}
