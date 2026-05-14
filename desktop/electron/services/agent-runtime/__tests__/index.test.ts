import { describe, expect, it, vi } from "vitest"

import type { ProjectContext } from "../../../runtime/project-container"
import { ServiceNotFoundError, ServiceNotRunningError } from "../../../runtime/service-registry"
import {
  AgentRuntimeService,
  createAgentRuntimeProjectService,
} from "../index"

function createLogger() {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return logger
}

function createProjectContext(failingServiceId: string): ProjectContext {
  const namespace = vi.fn(() => ({}))
  const dataRepository = { namespace }
  const permissionGuard = {}
  const auditSink = {}
  const logger = createLogger()

  return {
    projectId: "project-1",
    projectMeta: {
      id: "project-1",
      name: "Project 1",
      workspacePath: "/workspace/project-1",
      createdAt: "2026-05-13T00:00:00.000Z",
    },
    logger,
    dataRepo: dataRepository,
    eventBus: {
      projectId: "project-1",
      emit: vi.fn(),
      on: vi.fn(),
      underlying: {},
    },
    globalRegistry: {
      register: vi.fn(),
      startAll: vi.fn(),
      stopAll: vi.fn(),
      reload: vi.fn(),
      inspect: vi.fn(),
      get: vi.fn(<T>(id: string): T => {
        if (id === "core.permission-guard") return permissionGuard as T
        if (id === "core.audit-sink") return auditSink as T
        if (id === "core.data-repository") return dataRepository as T
        if (id === failingServiceId) {
          throw new ServiceNotRunningError(id, "pending")
        }
        throw new ServiceNotFoundError(id)
      }),
    },
  } as unknown as ProjectContext
}

describe("createAgentRuntimeProjectService", () => {
  it("does not swallow registry errors for registered optional Agent dependencies", () => {
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createProjectContext("core.side-channel")
    let created: AgentRuntimeService | Promise<AgentRuntimeService> | undefined

    try {
      expect(() => {
        created = serviceFactory.create(ctx)
      }).toThrow(ServiceNotRunningError)
    } finally {
      if (created instanceof AgentRuntimeService) {
        created.stopIdleReclaim()
      }
    }
  })
})
