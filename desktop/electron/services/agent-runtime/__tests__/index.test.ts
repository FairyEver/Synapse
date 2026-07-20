import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it, vi } from "vitest"

import type { ProjectContext } from "../../../runtime/project-container"
import type { DataNamespace, DataRepository } from "../../../runtime/data-repo"
import { ServiceNotFoundError, ServiceNotRunningError } from "../../../runtime/service-registry"
import { AGENT_CONVERSATION_WINDOW_SERVICE_ID } from "../../agent-conversation-window-service"
import {
  AgentRuntimeService,
  createAgentRuntimeProjectService,
  MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS,
  MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_PUBLISHED_COMMANDS,
} from "../index"
import { KNOWLEDGE_BASE_AGENT_CAPABILITIES } from "../../../../src/modules/agent/knowledge-base-commands"
import type { AgentEvent, AgentMessage } from "../types"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/tmp/synapse-app",
    getPath: (name: string) => `/tmp/synapse-${name}`,
  },
}))

const createdSessionInputs = vi.hoisted(() => ({
  values: [] as unknown[],
}))
const sentMessages = vi.hoisted(() => ({
  values: [] as AgentMessage[],
}))

vi.mock("../../provider", () => ({
  createProviderServiceFromDataRepository: vi.fn(() => ({
    getActiveProvider: vi.fn(async () => ({ id: "anthropic" })),
    buildEnv: vi.fn(async () => ({})),
  })),
}))

vi.mock("../../usage-analysis", () => ({
  getUsageAnalysisDb: vi.fn(() => ({})),
}))

vi.mock("../../model-price", () => ({
  listModelPriceRules: vi.fn(() => []),
  estimateSynapseUsageCostSnapshot: vi.fn(() => undefined),
}))

vi.mock("../claude-sdk-session", () => ({
  DEFAULT_CLAUDE_SDK_MAX_TURNS: 200,
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

    constructor(options: unknown) {
      createdSessionInputs.values.push(options)
    }

    async send(message: AgentMessage): Promise<boolean> {
      sentMessages.values.push(message)
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

function createPermissionGuard() {
  return {
    registerPolicy: vi.fn(() => () => {}),
    check: vi.fn(async () => ({ allowed: true })),
  }
}

function createAuditSink() {
  return {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
}

function createProjectContext(failingServiceId: string): ProjectContext {
  const namespace = vi.fn(() => ({}))
  const dataRepository = { namespace }
  const permissionGuard = createPermissionGuard()
  const auditSink = createAuditSink()
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

  it("closes live sessions when the project-scoped service stops", async () => {
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createRunnableProjectContext()
    const service = await serviceFactory.create(ctx)
    const close = vi.fn(async () => undefined)
    const states = (service as unknown as {
      states: Map<string, {
        activeTurns: number
        busy: boolean
        lastActivity: number
        liveSession?: {
          alive: () => boolean
          close: () => Promise<void>
          currentSessionId: () => string
        }
        queue: unknown[]
      }>
    }).states
    states.set("conversation-1", {
      activeTurns: 0,
      busy: false,
      lastActivity: Date.now(),
      liveSession: {
        alive: () => true,
        close,
        currentSessionId: () => "sdk-1",
      },
      queue: [],
    })

    await serviceFactory.stop?.(service, ctx)

    expect(close).toHaveBeenCalledOnce()
    expect(states.has("conversation-1")).toBe(false)
  })

  it("connects manual session renames to the detached conversation window service", async () => {
    const renameConversationWindow = vi.fn(() => true)
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createRunnableProjectContext({ renameConversationWindow })
    const service = await serviceFactory.create(ctx)

    try {
      const conversation = await service.createSession({
        sessionKey: "s1",
        platform: "local",
        name: "旧标题",
        agentType: "claude-code",
      })

      await service.renameSession(conversation.id, "新标题")

      expect(renameConversationWindow).toHaveBeenCalledWith({
        projectId: "project-1",
        conversationId: conversation.id,
      }, "新标题")
    } finally {
      service.stopIdleReclaim()
    }
  })

  it("keeps ordinary project sessions isolated from knowledge base plugin runtime", async () => {
    createdSessionInputs.values = []
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createRunnableProjectContext()
    const workspacePath = ctx.projectMeta.workspacePath
    const service = await serviceFactory.create(ctx)

    try {
      const result = await service.send({
        projectId: "project-1",
        sessionKey: "s1",
        platform: "local-renderer",
        userId: "user-1",
        content: "汲取知识",
      })

      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "result", content: "done" }),
      ]))
      expect(createdSessionInputs.values.at(-1)).toEqual(expect.objectContaining({
        cwd: workspacePath,
        plugins: [],
        allowPluginHooks: false,
        agents: {},
        subagentToolPolicies: {},
      }))
    } finally {
      service.stopIdleReclaim()
    }
  })

  it("loads managed knowledge base backing directory as a local plugin for renderer sessions", async () => {
    createdSessionInputs.values = []
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createRunnableProjectContext({
      managedKnowledgeBase: true,
    })
    const workspacePath = ctx.projectMeta.workspacePath
    const service = await serviceFactory.create(ctx)

    try {
      const result = await service.send({
        projectId: "project-1",
        sessionKey: "s1",
        platform: "local-renderer",
        userId: "user-1",
        content: "hello",
      })

      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "result", content: "done" }),
      ]))
      expect(createdSessionInputs.values.at(-1)).toEqual(expect.objectContaining({
        cwd: workspacePath,
        plugins: [{ type: "local", path: workspacePath }],
        allowPluginHooks: true,
      }))
    } finally {
      service.stopIdleReclaim()
    }
  })

  it("does not load knowledge base plugin runtime for scheduled sends", async () => {
    createdSessionInputs.values = []
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createRunnableProjectContext({
      managedKnowledgeBase: true,
    })
    const service = await serviceFactory.create(ctx)

    try {
      const result = await service.send({
        projectId: "project-1",
        sessionKey: "s1",
        platform: "scheduled",
        userId: "user-1",
        content: "hello",
      })

      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "result", content: "done" }),
      ]))
      expect(createdSessionInputs.values.at(-1)).toEqual(expect.objectContaining({
        plugins: [],
        allowPluginHooks: false,
      }))
    } finally {
      service.stopIdleReclaim()
    }
  })

  it("loads managed knowledge base runtime for workflow sends that target a knowledge base project", async () => {
    createdSessionInputs.values = []
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createRunnableProjectContext({
      managedKnowledgeBase: true,
    })
    const workspacePath = ctx.projectMeta.workspacePath
    const service = await serviceFactory.create(ctx)

    try {
      const result = await service.send({
        projectId: "project-1",
        sessionKey: "workflow-run-1",
        platform: "workflow",
        userId: "workflow",
        content: "/wiki-query design notes",
      })

      expect(result.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "result", content: "done" }),
      ]))
      expect(createdSessionInputs.values.at(-1)).toEqual(expect.objectContaining({
        cwd: workspacePath,
        plugins: [{ type: "local", path: workspacePath }],
        allowPluginHooks: true,
      }))
    } finally {
      service.stopIdleReclaim()
    }
  })

  it("runs managed knowledge base ingest preflight for workflow wiki-ingest sends", async () => {
    createdSessionInputs.values = []
    sentMessages.values = []
    const workspacePath = createKnowledgeBaseWorkspace()
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createRunnableProjectContext({
      managedKnowledgeBase: true,
      workspacePath,
    })
    const service = await serviceFactory.create(ctx)

    try {
      await service.send({
        projectId: "project-1",
        sessionKey: "workflow-run-1",
        platform: "workflow",
        userId: "workflow",
        content: "/wiki-ingest ingest all",
      })

      expect(sentMessages.values.at(-1)?.content).toContain("Synapse ingest preflight:")
      expect(sentMessages.values.at(-1)?.content).toContain(".raw/source.md")
    } finally {
      service.stopIdleReclaim()
    }
  })

  it("passes managed knowledge base slash commands through to the SDK for renderer sessions", async () => {
    createdSessionInputs.values = []
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createRunnableProjectContext({
      managedKnowledgeBase: true,
    })
    const service = await serviceFactory.create(ctx)

    try {
      for (const content of ["/wiki", "/save summarize this", "/canvas", "/autoresearch topic"]) {
        const result = await service.send({
          projectId: "project-1",
          sessionKey: content,
          platform: "local-renderer",
          userId: "user-1",
          content,
        })

        expect(result.events).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: "result", content: "done" }),
        ]))
      }
      expect(createdSessionInputs.values).toHaveLength(4)
    } finally {
      service.stopIdleReclaim()
    }
  })

  it("publishes managed knowledge base native slash commands for runtime discovery", async () => {
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createRunnableProjectContext({
      managedKnowledgeBase: true,
    })
    const service = await serviceFactory.create(ctx)

    try {
      await expect(service.listPublishedCommands("local-renderer")).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "wiki-ingest",
            source: "agent-native",
            kind: "agent-native",
          }),
          expect.objectContaining({
            name: "save",
            source: "agent-native",
            kind: "agent-native",
          }),
        ]),
      )
      await expect(service.listPublishedCommands("scheduled")).resolves.not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "wiki-ingest" }),
          expect.objectContaining({ name: "save" }),
        ]),
      )
    } finally {
      service.stopIdleReclaim()
    }
  })

  it("does not publish knowledge base native slash commands for ordinary projects", async () => {
    const serviceFactory = createAgentRuntimeProjectService()
    const ctx = createRunnableProjectContext()
    const service = await serviceFactory.create(ctx)

    try {
      await expect(service.listPublishedCommands("local-renderer")).resolves.not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "wiki-ingest" }),
          expect.objectContaining({ name: "save" }),
        ]),
      )
    } finally {
      service.stopIdleReclaim()
    }
  })

  it("covers every knowledge base UI catalog item in native slash passthrough", () => {
    expect(KNOWLEDGE_BASE_AGENT_CAPABILITIES.map((item) => item.name).sort())
      .toEqual([...MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS].sort())
    expect(MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_PUBLISHED_COMMANDS.map((item) => item.name).sort())
      .toEqual([...MANAGED_KNOWLEDGE_BASE_NATIVE_SLASH_COMMANDS].sort())
  })
})

function createRunnableProjectContext(options: {
  readonly workspacePath?: string
  readonly managedKnowledgeBase?: boolean
  readonly renameConversationWindow?: ReturnType<typeof vi.fn>
} = {}): ProjectContext {
  const dataRepository = createMemoryDataRepository()
  const permissionGuard = createPermissionGuard()
  const auditSink = createAuditSink()
  const logger = createLogger()

  return {
    projectId: "project-1",
    projectMeta: {
      id: "project-1",
      name: "Project 1",
      workspacePath: options.workspacePath ?? createTestWorkspace(),
      managedKnowledgeBase: options.managedKnowledgeBase,
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
        if (id === AGENT_CONVERSATION_WINDOW_SERVICE_ID && options.renameConversationWindow) {
          return { renameConversationWindow: options.renameConversationWindow } as T
        }
        throw new ServiceNotFoundError(id)
      }),
    },
  } as unknown as ProjectContext
}

function createTestWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "synapse-agent-runtime-"))
}

function createKnowledgeBaseWorkspace(): string {
  const workspace = createTestWorkspace()
  mkdirSync(join(workspace, ".raw"), { recursive: true })
  mkdirSync(join(workspace, ".vault-meta"), { recursive: true })
  mkdirSync(join(workspace, "wiki"), { recursive: true })
  writeFileSync(join(workspace, ".raw", "source.md"), "# Source\n", "utf8")
  writeFileSync(join(workspace, ".raw", ".manifest.json"), JSON.stringify({
    version: 1,
    sources: {},
    address_map: {},
  }), "utf8")
  writeFileSync(join(workspace, ".vault-meta", "address-counter.txt"), "1\n", "utf8")
  writeFileSync(join(workspace, "wiki", "index.md"), "# Index\n", "utf8")
  return workspace
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
