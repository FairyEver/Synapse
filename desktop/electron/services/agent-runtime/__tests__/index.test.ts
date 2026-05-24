import { describe, expect, it, vi } from "vitest"

import type { ProjectContext } from "../../../runtime/project-container"
import { ServiceNotFoundError, ServiceNotRunningError } from "../../../runtime/service-registry"
import type { AgentProjectContribution } from "../project-contributions"
import {
  AgentRuntimeService,
  createAgentRuntimeProjectService,
} from "../index"
import type { AgentEvent, AgentMessage } from "../types"

const mockProjectContribution = vi.hoisted(() => ({
  value: null as AgentProjectContribution | null,
}))

vi.mock("../../config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({
      global: {
        projects: [{
          id: "project-1",
          name: "Project 1",
          path: "/workspace/project-1",
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "test",
            },
          },
        }],
      },
    })),
  },
}))

vi.mock("../../knowledge-base/agent-contribution", () => ({
  createKnowledgeBaseAgentContribution: vi.fn(async () => mockProjectContribution.value),
}))

vi.mock("../../provider", () => ({
  createProviderServiceFromDataRepository: vi.fn(() => ({
    getActiveProvider: vi.fn(async () => ({ id: "anthropic" })),
    buildEnv: vi.fn(async () => ({})),
  })),
}))

vi.mock("../claude-sdk-session", () => ({
  ClaudeSDKSession: class FakeClaudeSdkSession {
    readonly agentType = "claude-sdk"
    private readonly events: AgentEvent[] = [
      {
        type: "result",
        content: "done",
        done: true,
        sdkSessionId: "sdk-1",
      },
    ]
    private closed = false

    async send(_message: AgentMessage): Promise<boolean> {
      return true
    }

    async respondPermission(): Promise<void> {}

    async nextEvent(): Promise<AgentEvent | null> {
      return this.events.shift() ?? null
    }

    currentSessionId(): string | undefined {
      return "sdk-1"
    }

    alive(): boolean {
      return !this.closed && this.events.length > 0
    }

    async close(): Promise<void> {
      this.closed = true
    }
  },
}))

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
  it("does not swallow registry errors for registered optional Agent dependencies", async () => {
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createProjectContext("core.side-channel")
    let created: AgentRuntimeService | Promise<AgentRuntimeService> | undefined

    try {
      created = serviceFactory.create(ctx)
      await expect(created).rejects.toThrow(ServiceNotRunningError)
    } finally {
      if (created instanceof AgentRuntimeService) {
        created.stopIdleReclaim()
      } else if (created) {
        await created.then((service) => service.stopIdleReclaim(), () => undefined)
      }
    }
  })

  it("forwards project afterTurn events into the runtime turn result", async () => {
    const afterTurnEvent: AgentEvent = {
      type: "error",
      message: "知识库后置写入未完成：缺少 synapse_kb_ingest_report。",
      timestamp: "2026-05-24T00:00:00.000Z",
    }
    const afterTurn = vi.fn(async () => ({ events: [afterTurnEvent] }))
    mockProjectContribution.value = {
      commands: [],
      afterTurn,
    }
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createRunnableProjectContext()
    const service = await serviceFactory.create(ctx)

    try {
      const result = await service.send({
        projectId: "project-1",
        sessionKey: "s1",
        platform: "local-renderer",
        userId: "user-1",
        content: "汲取知识",
      })

      expect(afterTurn).toHaveBeenCalledOnce()
      expect(result.events).toEqual(expect.arrayContaining([afterTurnEvent]))
    } finally {
      service.stopIdleReclaim()
      mockProjectContribution.value = null
    }
  })
})

function createRunnableProjectContext(): ProjectContext {
  const namespaces = new Map<string, MemoryNamespace<{ id: string }>>()
  const dataRepository = {
    namespace: vi.fn((name: string) => {
      let namespace = namespaces.get(name)
      if (!namespace) {
        namespace = new MemoryNamespace(name)
        namespaces.set(name, namespace)
      }
      return namespace
    }),
  }
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
        throw new ServiceNotFoundError(id)
      }),
    },
  } as unknown as ProjectContext
}

class MemoryNamespace<T extends { id: string }> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  readonly name: string
  private readonly values = new Map<string, T>()

  constructor(name: string) {
    this.name = name
  }

  async getSingleton(): Promise<T | null> { return null }
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
    this.values.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.values.delete(id)
  }

  onChange(): () => void {
    return () => undefined
  }
}
