import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ProjectContainerRegistry } from "../../../runtime/project-container"
import { configStore } from "../../../services/config-store"
import { collectOpsStatus, type ServiceResolver } from "../status"

const logMocks = vi.hoisted(() => ({
  logger: {
    warn: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.2.49",
    hasSingleInstanceLock: () => true,
    getAppPath: () => "/Applications/Synapse.app",
    getPath: (name: string) => `/${name}`,
  },
}))

vi.mock("../../../services/config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "system",
        projects: [{
          id: "project-1",
          name: "Project One",
          path: "/workspace/project-one",
        }],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    })),
  },
}))

vi.mock("../../../services/log-store", () => ({
  createMainLogger: () => logMocks.logger,
  logStore: {
    getLogDirectory: () => "/logs",
  },
}))

describe("collectOpsStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("keeps diagnostics available when Agent status collection fails", async () => {
    const projectContainers: Pick<ProjectContainerRegistry, "open"> = {
      open: vi.fn(async () => {
        throw new Error("SDK status failed for secret prompt token=sk-live")
      }),
    }
    const resolve: ServiceResolver = <T,>(serviceId: string): T => {
      if (serviceId === "core.project-containers") return projectContainers as T
      throw new Error(`Unknown service: ${serviceId}`)
    }

    const result = await collectOpsStatus(resolve, { projectId: "project-1" })

    expect(result).toMatchObject({
      appVersion: "0.2.49",
      logPath: "/logs",
      agent: undefined,
    })
    expect(projectContainers.open).toHaveBeenCalledWith("project-1", {
      name: "Project One",
      workspacePath: "/workspace/project-one",
    })
    expect(logMocks.logger.warn).toHaveBeenCalledWith("Ops Agent status collection failed.", {
      boundary: "agent-runtime.status",
      projectId: "project-1",
      errorName: "Error",
      errorLength: "SDK status failed for secret prompt token=sk-live".length,
    })
    expect(JSON.stringify(logMocks.logger.warn.mock.calls)).not.toContain("secret prompt")
    expect(JSON.stringify(logMocks.logger.warn.mock.calls)).not.toContain("sk-live")
  })

  it("uses the first configured project when no project is requested", async () => {
    const agent = {
      getStatus: vi.fn(() => ({
        projectId: "project-1",
        agentType: "claude-code",
        liveSessions: 1,
        busySessions: 0,
        queuedTurns: 0,
        pendingPermissions: 0,
      })),
    }
    const projectContainers: Pick<ProjectContainerRegistry, "open"> = {
      open: vi.fn(async () => ({
        get: () => agent,
      }) as never),
    }
    const resolve: ServiceResolver = <T,>(serviceId: string): T => {
      if (serviceId === "core.project-containers") return projectContainers as T
      throw new Error(`Unknown service: ${serviceId}`)
    }

    const result = await collectOpsStatus(resolve)

    expect(configStore.load).toHaveBeenCalled()
    expect(result.agent).toMatchObject({
      projectId: "project-1",
      agentType: "claude-code",
    })
  })

  it("uses Relay count APIs for diagnostics status", async () => {
    const agent = {
      getStatus: vi.fn(() => ({
        projectId: "project-1",
        agentType: "claude-code",
        liveSessions: 0,
        busySessions: 0,
        queuedTurns: 0,
        pendingPermissions: 0,
      })),
    }
    const projectContainers: Pick<ProjectContainerRegistry, "open"> = {
      open: vi.fn(async () => ({
        get: () => agent,
      }) as never),
    }
    const relay = {
      countBindings: vi.fn(async () => 2),
      countRuns: vi.fn(async () => 5),
      listBindings: vi.fn(async () => {
        throw new Error("listBindings should not be used for diagnostics counts")
      }),
      listRuns: vi.fn(async () => {
        throw new Error("listRuns should not be used for diagnostics counts")
      }),
    }
    const resolve: ServiceResolver = <T,>(serviceId: string): T => {
      if (serviceId === "core.project-containers") return projectContainers as T
      if (serviceId === "core.relay") return relay as T
      throw new Error(`Unknown service: ${serviceId}`)
    }

    const result = await collectOpsStatus(resolve, { projectId: "project-1" })

    expect(result.relay).toEqual({
      bindingCount: 2,
      recentRunCount: 5,
    })
    expect(relay.countBindings).toHaveBeenCalledTimes(1)
    expect(relay.countRuns).toHaveBeenCalledTimes(1)
    expect(relay.listBindings).not.toHaveBeenCalled()
    expect(relay.listRuns).not.toHaveBeenCalled()
  })
})
