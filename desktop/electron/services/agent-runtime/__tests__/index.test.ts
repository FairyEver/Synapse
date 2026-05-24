import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

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

import type { ProjectContext } from "../../../runtime/project-container"
import type { DataNamespace, DataRepository } from "../../../runtime/data-repo"
import { ServiceNotFoundError, ServiceNotRunningError } from "../../../runtime/service-registry"
import { configStore } from "../../config-store"
import { readKnowledgeBaseManifest } from "../../knowledge-base/manifest"
import {
  AgentRuntimeService,
  createAgentRuntimeProjectService,
  createCachedAgentProjectContributionResolver,
} from "../index"
import type { AgentProjectContribution } from "../project-contributions"
import type { AgentEvent, AgentMessage } from "../types"

const mockProjectContribution = vi.hoisted(() => ({
  value: null as AgentProjectContribution | null,
}))

vi.mock("../../knowledge-base/agent-contribution", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../knowledge-base/agent-contribution")>()
  return {
    ...original,
    createKnowledgeBaseAgentContribution: vi.fn(async (input: Parameters<typeof original.createKnowledgeBaseAgentContribution>[0]) =>
      mockProjectContribution.value ?? original.createKnowledgeBaseAgentContribution(input),
    ),
  }
})

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

describe("createCachedAgentProjectContributionResolver", () => {
  const roots: string[] = []

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-agent-runtime-index-"))
    roots.push(dir)
    return dir
  }

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
    vi.mocked(configStore.load).mockReset()
  })

  it("keeps command preflight available to afterTurn through runtime-style callback resolution", async () => {
    const projectPath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{},\"address_map\":{}}\n")
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    vi.mocked(configStore.load).mockClear()
    vi.mocked(configStore.load).mockResolvedValue({
      global: {
        projects: [knowledgeBaseProject(projectPath)],
      },
    } as never)
    const dataRepository = createMemoryDataRepository()
    const resolveContribution = createCachedAgentProjectContributionResolver("project-1", dataRepository)

    await (await resolveContribution()).commands[0]?.buildPrompt(["ingest"], baseMessage("/wiki ingest"), { turnId: "turn-1" })
    await mkdir(path.join(projectPath, "wiki", "sources"), { recursive: true })
    await writeFile(path.join(projectPath, "wiki", "sources", "note.md"), "---\ntype: source\naddress: c-000010\n---\n\n# Note\n")
    await (await resolveContribution()).afterTurn?.({
      message: baseMessage("/wiki ingest"),
      result: { conversationId: "conv-1", resultText: ingestReport([{
        source: ".raw/note.md",
        pages_created: ["wiki/sources/note.md"],
        pages_updated: [],
      }]), events: [] },
      conversationId: "conv-1",
      turnId: "turn-1",
      isNewLiveSession: false,
    })

    expect(configStore.load).toHaveBeenCalledTimes(1)
    await expect(readKnowledgeBaseManifest(projectPath)).resolves.toMatchObject({
      manifest: {
        sources: {
          ".raw/note.md": {
            pages_created: ["wiki/sources/note.md"],
            pages_updated: [],
          },
        },
        address_map: {
          "wiki/sources/note.md": "c-000010",
        },
      },
    })
  })
})

function createRunnableProjectContext(): ProjectContext {
  const dataRepository = createMemoryDataRepository()
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

function createMemoryDataRepository(): Pick<DataRepository, "namespace"> {
  const namespaces = new Map<string, MemoryNamespace<unknown>>()
  return {
    namespace<T>(name: string): DataNamespace<T> {
      let namespace = namespaces.get(name)
      if (!namespace) {
        namespace = new MemoryNamespace(name)
        namespaces.set(name, namespace)
      }
      return namespace as unknown as DataNamespace<T>
    },
  }
}

class MemoryNamespace<T> {
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

  async upsert(item: T & { id: string }): Promise<void> {
    this.values.set(item.id, item)
  }

  async remove(id: string): Promise<void> {
    this.values.delete(id)
  }

  onChange(): () => void {
    return () => undefined
  }
}

function knowledgeBaseProject(projectPath: string) {
  return {
    id: "project-1",
    name: "KB",
    path: projectPath,
    capabilities: {
      knowledgeBase: {
        enabled: true,
        schemaVersion: 1,
        templateVersion: "2026-05-21",
      },
    },
  } as const
}

function baseMessage(content: string) {
  return {
    projectId: "project-1",
    sessionKey: "s1",
    platform: "local-renderer",
    content,
  } as const
}

function ingestReport(processedSources: readonly object[]): string {
  return [
    "```json synapse_kb_ingest_report",
    JSON.stringify({
      schema: "synapse.kb.ingest.report.v1",
      processed_sources: processedSources,
      skipped_sources: [],
    }),
    "```",
  ].join("\n")
}
