/**
 * Phase 0.1 — Bootstrap descriptor smoke tests.
 *
 * These tests do not boot Electron. They mock the `electron` module so we can
 * exercise the descriptor wrappers in isolation. The goal is to prove that:
 *   1. Both descriptors compile and expose the SPEC §4 mapping table values.
 *   2. `coreConfigDescriptor.create` triggers `configStore.load()` exactly once.
 *
 * Real lifecycle wiring is verified in Phase 0.1's T1.9 integration test.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

vi.mock("electron-updater", () => ({
  autoUpdater: {
    on: () => {},
    once: () => {},
    setFeedURL: () => {},
    checkForUpdates: () => Promise.resolve(null),
    downloadUpdate: () => Promise.resolve([]),
    quitAndInstall: () => {},
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    fullChangelog: false,
    forceDevUpdateConfig: false,
    logger: null,
  },
  CancellationToken: class {},
}))
vi.mock("@synapse/shared", () => ({}))
const deploymentConfigModule = {
  SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG: {
    apiBaseUrl: "https://api.example.test",
    publicAppUrl: "https://app.example.test",
  },
}
vi.mock("../generated/deployment-config.generated", () => deploymentConfigModule)
vi.mock("../../generated/deployment-config.generated", () => deploymentConfigModule)
const tmpUserData = "/tmp/synapse-test-userdata-" + Date.now()
const bootstrapImportTimeoutMs = process.platform === "win32" ? 120_000 : 30_000
vi.mock("electron", () => {
  const Notification = class {
    static isSupported() {
      return false
    }
    on() {}
  }
  return {
    app: {
      getPath: (which: string) =>
        which === "userData" ? tmpUserData : `/tmp/synapse-test-${which}`,
      getName: () => "synapse-test",
      getVersion: () => "0.0.0-test",
      getAppPath: () => "/tmp/synapse-test-app",
      isPackaged: false,
      on: () => {},
      once: () => {},
    },
    BrowserWindow: class {
      static getAllWindows() {
        return []
      }
    },
    dialog: {},
    ipcMain: { handle: () => {}, on: () => {} },
    shell: {},
    Tray: class {},
    Menu: { buildFromTemplate: () => ({}) },
    Notification,
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
    safeStorage: { isEncryptionAvailable: () => false },
    webContents: {},
  }
})

// Lazy import after the mock.
async function importBootstrap() {
  return await import("../descriptors")
}

describe("bootstrap descriptors (T1.5)", () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("coreLoggingDescriptor has fatal criticality and id 'core.logging'", { timeout: bootstrapImportTimeoutMs }, async () => {
    const { coreLoggingDescriptor } = await importBootstrap()
    expect(coreLoggingDescriptor.id).toBe("core.logging")
    expect(coreLoggingDescriptor.criticality).toBe("fatal")
    expect(coreLoggingDescriptor.dependsOn).toBeUndefined()
  })

  it("coreLoggingDescriptor.create returns the singleton synchronously", { timeout: bootstrapImportTimeoutMs }, async () => {
    const { coreLoggingDescriptor } = await importBootstrap()
    const fakeCtx = makeFakeContext()
    const instance = coreLoggingDescriptor.create(fakeCtx)
    expect(instance).toBeDefined()
    // Calling create twice returns the same singleton reference.
    expect(coreLoggingDescriptor.create(fakeCtx)).toBe(instance)
  })

  it("coreConfigDescriptor has fatal criticality and id 'core.config'", async () => {
    const { coreConfigDescriptor } = await importBootstrap()
    expect(coreConfigDescriptor.id).toBe("core.config")
    expect(coreConfigDescriptor.criticality).toBe("fatal")
  })

  it("coreAppIconDescriptor is degraded with id 'core.app-icon' and no deps", async () => {
    const { coreAppIconDescriptor } = await importBootstrap()
    expect(coreAppIconDescriptor.id).toBe("core.app-icon")
    expect(coreAppIconDescriptor.criticality).toBe("degraded")
    expect(coreAppIconDescriptor.dependsOn).toBeUndefined()
  })

  it("coreDatabaseDescriptor is degraded, depends on config, event bus, automation, and action runtime, has stop", async () => {
    const { coreDatabaseDescriptor } = await importBootstrap()
    expect(coreDatabaseDescriptor.id).toBe("core.database")
    expect(coreDatabaseDescriptor.criticality).toBe("degraded")
    expect(coreDatabaseDescriptor.dependsOn).toEqual([
      "core.config",
      "core.event-bus",
      "core.automation",
      "core.action-runtime",
      "core.workflow",
      "core.workflow.snapshots",
      "core.workflow.run-aborts",
      "core.workflow.run-statuses",
      "core.workflow.engine",
      "core.permission-guard",
      "core.audit-sink",
      "core.terminal",
      "core.sound-notifier",
      "core.swarm-task",
      "provider",
    ])
    expect(coreDatabaseDescriptor.stop).toBeTypeOf("function")
  })

  it("coreActionRuntimeDescriptor creates the shared action registry", async () => {
    const { coreActionRuntimeDescriptor } = await importBootstrap()
    expect(coreActionRuntimeDescriptor.id).toBe("core.action-runtime")
    expect(coreActionRuntimeDescriptor.criticality).toBe("fatal")
    expect(coreActionRuntimeDescriptor.dependsOn).toEqual([
      "core.process-environment",
      "core.permission-guard",
      "core.audit-sink",
      "core.event-bus",
      "core.workflow",
      "core.workflow.engine",
      "core.workflow.snapshots",
      "core.workflow.run-aborts",
      "core.workflow.run-statuses",
    ])
    expect(coreActionRuntimeDescriptor.create).toBeTypeOf("function")
  })

  it("coreWorkflowEngineDescriptor exposes service resolver to workflow nodes", async () => {
    vi.doMock("../../services/log-store", () => ({
      logStore: {},
      createMainLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }))
    const swarmTaskService = { startRun: vi.fn(), getRun: vi.fn() }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.permission-guard") return { check: vi.fn() }
          if (id === "core.audit-sink") return { record: vi.fn() }
          if (id === "core.swarm-task") return swarmTaskService
          throw new Error(`unexpected service ${id}`)
        }),
      },
    }
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      runtimeDeps?: {
        resolveService?: <T>(serviceId: string) => T
      }
    }

    expect(engine.runtimeDeps?.resolveService?.("core.swarm-task")).toBe(swarmTaskService)
  })

  it("gitAccessServiceDescriptor is degraded and depends on Git access foundations", async () => {
    const { gitAccessServiceDescriptor } = await importBootstrap()
    expect(gitAccessServiceDescriptor.id).toBe("git.access-service")
    expect(gitAccessServiceDescriptor.criticality).toBe("degraded")
    expect(gitAccessServiceDescriptor.dependsOn).toEqual([
      "git.command-runner",
      "core.process-environment",
      "core.permission-guard",
      "core.audit-sink",
    ])
    expect(gitAccessServiceDescriptor.create).toBeTypeOf("function")
  })

  it("coreAutomationDescriptor is degraded and depends on automation runtime infrastructure", async () => {
    const { coreAutomationDescriptor } = await importBootstrap()
    expect(coreAutomationDescriptor.id).toBe("core.automation")
    expect(coreAutomationDescriptor.criticality).toBe("degraded")
    expect(coreAutomationDescriptor.dependsOn).toEqual([
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
      "core.action-runtime",
      "core.event-bus",
    ])
    expect(coreAutomationDescriptor.create).toBeTypeOf("function")
    expect(coreAutomationDescriptor.start).toBeTypeOf("function")
    expect(coreAutomationDescriptor.stop).toBeTypeOf("function")
  })

  it("coreSwarmTaskDescriptor is degraded and depends on data repository, events, and project containers", async () => {
    const { coreSwarmTaskDescriptor } = await importBootstrap()
    expect(coreSwarmTaskDescriptor.id).toBe("core.swarm-task")
    expect(coreSwarmTaskDescriptor.criticality).toBe("degraded")
    expect(coreSwarmTaskDescriptor.dependsOn).toEqual([
      "core.data-repository",
      "core.event-bus",
      "core.project-containers",
    ])
    expect(coreSwarmTaskDescriptor.create).toBeTypeOf("function")
  })

  it("coreWorkflowEngineDescriptor redacts infrastructure errors from Agent dependency logs and result", async () => {
    const logger = {
      error: vi.fn(),
    }
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: "repo-1",
          repositories: [{
            uuid: "repo-1",
            name: "Repo",
            localPath: "/repo",
          }],
        })),
      },
    }))
    vi.doMock("../../services/log-store", () => ({
      logStore: {},
      createMainLogger: () => logger,
    }))
    const rawError = new Error("container failed token=sk-test at /Users/liyang/private prompt")
    rawError.stack = "stack with token=sk-test at /Users/liyang/private prompt"
    const containers = {
      open: vi.fn(async () => {
        throw rawError
      }),
    }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn(() => containers),
      },
    }
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      agentDeps: {
        sendToAgent(input: { providerId?: string; modelTier?: string; prompt: string; projectId?: string; abortSignal: AbortSignal }): Promise<{
          status: "success" | "failed"
          response: string
          error?: string
          durationMs: number
        }>
      }
    }

    const result = await engine.agentDeps.sendToAgent({
      providerId: "test-provider",
      modelTier: "fast",
      prompt: "secret prompt",
      projectId: "repo-1",
      abortSignal: new AbortController().signal,
    })

    expect(result).toEqual({
      status: "failed",
      response: "",
      error: `Agent call failed (Error, ${rawError.message.length} chars)`,
      durationMs: 0,
    })
    expect(logger.error).toHaveBeenCalledWith(
      "engine agent call failed (infrastructure)",
      expect.objectContaining({
        boundary: "workflow-engine.agent-deps",
        providerId: "test-provider",
        modelTier: "fast",
        errorName: "Error",
        errorLength: rawError.message.length,
        stackLength: rawError.stack!.length,
      }),
    )
    const serialized = JSON.stringify([result, logger.error.mock.calls])
    expect(serialized).not.toContain("sk-test")
    expect(serialized).not.toContain("/Users/liyang/private")
    expect(serialized).not.toContain("secret prompt")
  })

  it("workflow Agent dependency fails instead of falling back when project is missing", async () => {
    const logger = { error: vi.fn() }
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: "repo-1",
          repositories: [{ uuid: "repo-1", name: "Repo", localPath: "/repo" }],
          global: {
            projects: [{ id: "agent-project-1", name: "Agent Project", path: "/agent-project" }],
          },
        })),
      },
    }))
    vi.doMock("../../services/log-store", () => ({
      logStore: {},
      createMainLogger: () => logger,
    }))
    const containers = { open: vi.fn() }
    const permissionGuard = { check: vi.fn() }
    const auditSink = { record: vi.fn() }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.project-containers") return containers
          if (id === "core.permission-guard") return permissionGuard
          if (id === "core.audit-sink") return auditSink
          throw new Error(`unexpected service ${id}`)
        }),
      },
    }
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      agentDeps: {
        sendToAgent(input: { providerId?: string; modelTier?: string; prompt: string; projectId?: string; abortSignal: AbortSignal }): Promise<{
          status: "success" | "failed"
          response: string
          error?: string
          durationMs: number
        }>
      }
    }

    const result = await engine.agentDeps.sendToAgent({
      providerId: "test-provider",
      modelTier: "fast",
      prompt: "secret prompt",
      abortSignal: new AbortController().signal,
    })

    expect(result.status).toBe("failed")
    expect(containers.open).not.toHaveBeenCalled()
  })

  it("workflow Agent dependency opens managed knowledge base projects at their backing directory", async () => {
    const managedProject = {
      id: "kb-1",
      name: "Knowledge Base",
      path: "synapse-kb://kb-1",
      capabilities: {
        knowledgeBase: {
          enabled: true,
          schemaVersion: 1,
          templateVersion: "2026-05-24",
          managed: true,
          runtimeId: "kb-1",
        },
      },
    }
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: null,
          repositories: [],
          global: {
            knowledgeBaseStorage: { mode: "custom", rootPath: "/kb-root" },
            projects: [managedProject],
          },
        })),
      },
    }))

    const agentRuntime = {
      sendScheduled: vi.fn(async () => ({
        status: "success",
        summary: "ok",
        durationMs: 5,
      })),
    }
    const container = { get: vi.fn(() => agentRuntime) }
    const containers = { open: vi.fn(async () => container) }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.project-containers") return containers
          if (id === "knowledge-base.storage-migration-service") return { isActive: vi.fn(() => false) }
          if (id === "core.permission-guard") return { check: vi.fn() }
          if (id === "core.audit-sink") return { record: vi.fn() }
          throw new Error(`unexpected service ${id}`)
        }),
      },
    }
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      agentDeps: {
        sendToAgent(input: { providerId?: string; modelTier?: string; prompt: string; projectId?: string; abortSignal: AbortSignal }): Promise<{
          status: "success" | "failed"
          response: string
          error?: string
          durationMs: number
        }>
      }
    }

    await engine.agentDeps.sendToAgent({
      providerId: "test-provider",
      modelTier: "fast",
      prompt: "use kb",
      projectId: "kb-1",
      abortSignal: new AbortController().signal,
    })

    expect(containers.open).toHaveBeenCalledWith("kb-1", expect.objectContaining({
      workspacePath: "/kb-root/knowledge-bases/kb-1",
      managedKnowledgeBase: true,
    }))
  })

  it("global Agent project list resolves managed knowledge base backing directory", async () => {
    const managedProject = {
      id: "kb-1",
      name: "Knowledge Base",
      path: "synapse-kb://kb-1",
      capabilities: {
        knowledgeBase: {
          enabled: true,
          schemaVersion: 1,
          templateVersion: "2026-05-24",
          managed: true,
          runtimeId: "kb-1",
        },
      },
    }
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: null,
          repositories: [],
          global: {
            knowledgeBaseStorage: { mode: "custom", rootPath: "/kb-root" },
            projects: [managedProject],
          },
        })),
      },
    }))

    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.project-containers") return { open: vi.fn() }
          if (id === "core.network-registry") return {}
          if (id === "core.side-channel") return {}
          if (id === "core.permission-guard") return { check: vi.fn() }
          if (id === "core.audit-sink") return { record: vi.fn() }
          throw new Error(`unexpected service ${id}`)
        }),
      },
    }
    const { coreBridgeAdapterDescriptor } = await importBootstrap()
    const bridge = coreBridgeAdapterDescriptor.create(ctx as never) as unknown as {
      deps: {
        listProjects(): Promise<ReadonlyArray<{
          projectId: string
          name?: string
          workspacePath?: string
          managedKnowledgeBase?: boolean
        }>>
      }
    }

    await expect(bridge.deps.listProjects()).resolves.toEqual([{
      projectId: "kb-1",
      name: "Knowledge Base",
      workspacePath: "/kb-root/knowledge-bases/kb-1",
      managedKnowledgeBase: true,
    }])
  })

  it("workflow Agent dependency rejects managed knowledge base projects during storage migration", async () => {
    const managedProject = {
      id: "kb-1",
      name: "Knowledge Base",
      path: "synapse-kb://kb-1",
      capabilities: {
        knowledgeBase: {
          enabled: true,
          schemaVersion: 1,
          templateVersion: "2026-05-24",
          managed: true,
          runtimeId: "kb-1",
        },
      },
    }
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: null,
          repositories: [],
          global: {
            knowledgeBaseStorage: { mode: "custom", rootPath: "/kb-root" },
            projects: [managedProject],
          },
        })),
      },
    }))

    const containers = { open: vi.fn() }
    const storageMigration = { isActive: vi.fn(() => true) }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.project-containers") return containers
          if (id === "knowledge-base.storage-migration-service") return storageMigration
          if (id === "core.permission-guard") return { check: vi.fn() }
          if (id === "core.audit-sink") return { record: vi.fn() }
          throw new Error(`unexpected service ${id}`)
        }),
      },
    }
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      agentDeps: {
        sendToAgent(input: { prompt: string; projectId?: string; abortSignal: AbortSignal }): Promise<{
          status: "success" | "failed"
          response: string
          error?: string
          durationMs: number
        }>
      }
    }

    const result = await engine.agentDeps.sendToAgent({
      prompt: "use kb",
      projectId: "kb-1",
      abortSignal: new AbortController().signal,
    })

    expect(result).toMatchObject({
      status: "failed",
      error: "知识库存储迁移正在进行，请稍后再试。",
    })
    expect(containers.open).not.toHaveBeenCalled()
  })

  it("coreWorkflowEngineDescriptor resolves repository workspace paths for Codex nodes", async () => {
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: "repo-1",
          repositories: [{ uuid: "repo-1", name: "Repo", localPath: "/repo-path" }],
          global: { projects: [] },
        })),
      },
    }))

    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create({
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.project-containers") return { open: vi.fn() }
          if (id === "core.permission-guard") return { check: vi.fn() }
          if (id === "core.audit-sink") return { record: vi.fn() }
          throw new Error(`unexpected service ${id}`)
        }),
      },
    } as never) as unknown as {
      runtimeDeps: {
        resolveProjectWorkspacePath?: (projectId: string) => Promise<string | null>
      }
    }

    await expect(engine.runtimeDeps.resolveProjectWorkspacePath?.("repo-1")).resolves.toBe("/repo-path")
  })

  it("coreWorkflowEngineDescriptor resolves global project workspace paths for Codex nodes", async () => {
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: "repo-1",
          repositories: [],
          global: {
            projects: [{ id: "project-1", name: "Project One", path: "/global-project-path" }],
          },
        })),
      },
    }))

    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create({
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.project-containers") return { open: vi.fn() }
          if (id === "core.permission-guard") return { check: vi.fn() }
          if (id === "core.audit-sink") return { record: vi.fn() }
          throw new Error(`unexpected service ${id}`)
        }),
      },
    } as never) as unknown as {
      runtimeDeps: {
        resolveProjectWorkspacePath?: (projectId: string) => Promise<string | null>
      }
    }

    await expect(engine.runtimeDeps.resolveProjectWorkspacePath?.("project-1")).resolves.toBe("/global-project-path")
  })

  it("coreWorkflowEngineDescriptor resolves managed knowledge base workspace paths for Codex nodes", async () => {
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: null,
          repositories: [],
          global: {
            knowledgeBaseStorage: { mode: "custom", rootPath: "/kb-root" },
            projects: [{
              id: "kb-1",
              name: "Knowledge Base",
              path: "synapse-kb://kb-1",
              capabilities: {
                knowledgeBase: {
                  enabled: true,
                  schemaVersion: 1,
                  templateVersion: "2026-05-24",
                  managed: true,
                  runtimeId: "kb-1",
                },
              },
            }],
          },
        })),
      },
    }))

    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create({
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.project-containers") return { open: vi.fn() }
          if (id === "core.permission-guard") return { check: vi.fn() }
          if (id === "core.audit-sink") return { record: vi.fn() }
          throw new Error(`unexpected service ${id}`)
        }),
      },
    } as never) as unknown as {
      runtimeDeps: {
        resolveProjectWorkspacePath?: (projectId: string) => Promise<string | null>
      }
    }

    await expect(engine.runtimeDeps.resolveProjectWorkspacePath?.("kb-1"))
      .resolves.toBe("/kb-root/knowledge-bases/kb-1")
  })

  it("coreWorkflowEngineDescriptor returns null when the Codex project cannot be resolved", async () => {
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: "repo-1",
          repositories: [],
          global: { projects: [] },
        })),
      },
    }))

    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create({
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.project-containers") return { open: vi.fn() }
          if (id === "core.permission-guard") return { check: vi.fn() }
          if (id === "core.audit-sink") return { record: vi.fn() }
          throw new Error(`unexpected service ${id}`)
        }),
      },
    } as never) as unknown as {
      runtimeDeps: {
        resolveProjectWorkspacePath?: (projectId: string) => Promise<string | null>
      }
    }

    await expect(engine.runtimeDeps.resolveProjectWorkspacePath?.("missing-project")).resolves.toBeNull()
  })

  it("coreWorkflowEngineDescriptor injects workflow call runtime dependency", async () => {
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const workflowService = { get: vi.fn().mockResolvedValue(null) }
    const snapshotService = { save: vi.fn() }
    const containers = { open: vi.fn() }
    const permissionGuard = { check: vi.fn() }
    const auditSink = { record: vi.fn() }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((serviceId: string) => {
          if (serviceId === "core.workflow") return workflowService
          if (serviceId === "core.workflow.snapshots") return snapshotService
          if (serviceId === "core.project-containers") return containers
          if (serviceId === "core.permission-guard") return permissionGuard
          if (serviceId === "core.audit-sink") return auditSink
          throw new Error(`Unexpected service id: ${serviceId}`)
        }),
      },
    }

    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      runtimeDeps: {
        workflowCall?: {
          getWorkflowDefinition: (id: string) => Promise<unknown>
        }
      }
    }

    await expect(engine.runtimeDeps.workflowCall?.getWorkflowDefinition("child-1")).resolves.toBeNull()
    expect(workflowService.get).toHaveBeenCalledWith("child-1")
  })

  it("coreWorkflowEngineDescriptor persists nested workflow call snapshots", async () => {
    vi.doMock("../../services/log-store", () => ({
      logStore: {},
      createMainLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
    }))
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const workflowService = { get: vi.fn(), list: vi.fn(async () => []) }
    const snapshotService = { save: vi.fn(async () => undefined) }
    const containers = { open: vi.fn() }
    const permissionGuard = { check: vi.fn() }
    const auditSink = { record: vi.fn() }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((serviceId: string) => {
          if (serviceId === "core.workflow") return workflowService
          if (serviceId === "core.workflow.snapshots") return snapshotService
          if (serviceId === "core.project-containers") return containers
          if (serviceId === "core.permission-guard") return permissionGuard
          if (serviceId === "core.audit-sink") return auditSink
          throw new Error(`Unexpected service id: ${serviceId}`)
        }),
      },
    }
    const childDefinition = {
      id: "child-workflow",
      name: "Child Workflow",
      version: "v1",
      params: [
        { name: "apiToken", type: "text" as const, default: null },
        { name: "note", type: "text" as const, default: null },
      ],
      nodes: [
        {
          id: "end",
          name: "结束",
          type: "end",
          position: { x: 0, y: 0 },
          config: { outputType: "text", template: "child-output", variables: [] },
        },
      ],
      edges: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      runtimeDeps: {
        workflowCall?: {
          runWorkflow: (input: {
            definition: typeof childDefinition
            params: Record<string, unknown>
            projectId?: string
            triggerSource: string
            abortSignal: AbortSignal
            parentRunId: string
            callStack: Array<{ workflowId: string; workflowName?: string }>
          }) => Promise<{ runId: string; result: { status: string; output?: string } }>
        }
      }
    }

    const result = await engine.runtimeDeps.workflowCall?.runWorkflow({
      definition: childDefinition,
      params: {
        apiToken: "sk-child-param-secret",
        note: "Authorization: Bearer child-raw-token at /Users/example/child-params",
      },
      projectId: "repo-1",
      triggerSource: "workflow-call",
      abortSignal: new AbortController().signal,
      parentRunId: "parent-run",
      callStack: [{ workflowId: "parent", workflowName: "Parent" }, { workflowId: "child-workflow", workflowName: "Child Workflow" }],
    })

    expect(result?.result).toMatchObject({ status: "completed", output: "child-output" })
    expect(snapshotService.save).toHaveBeenCalledWith(expect.objectContaining({
      runId: result?.runId,
      workflowId: "child-workflow",
      status: "completed",
      params: {
        apiToken: "[redacted]",
        note: "Authorization=[redacted] [redacted] at [path]",
      },
      definition: childDefinition,
      nodeResults: expect.objectContaining({
        end: expect.objectContaining({
          nodeId: "end",
          status: "success",
          output: "child-output",
        }),
      }),
    }))
    expect(JSON.stringify(snapshotService.save.mock.calls)).not.toContain("sk-child-param-secret")
    expect(JSON.stringify(snapshotService.save.mock.calls)).not.toContain("child-raw-token")
    expect(JSON.stringify(snapshotService.save.mock.calls)).not.toContain("/Users/example/child-params")
  })

  it("nested workflow calls reject invalid params and definitions before engine run", async () => {
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const workflowService = { get: vi.fn(), list: vi.fn(async () => []) }
    const snapshotService = { save: vi.fn(async () => undefined) }
    const containers = { open: vi.fn() }
    const permissionGuard = { check: vi.fn() }
    const auditSink = { record: vi.fn() }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((serviceId: string) => {
          if (serviceId === "core.workflow") return workflowService
          if (serviceId === "core.workflow.snapshots") return snapshotService
          if (serviceId === "core.project-containers") return containers
          if (serviceId === "core.permission-guard") return permissionGuard
          if (serviceId === "core.audit-sink") return auditSink
          throw new Error(`Unexpected service id: ${serviceId}`)
        }),
      },
    }
    const childDefinition = {
      id: "child-workflow",
      name: "Child Workflow",
      version: "v1",
      params: [
        { name: "report_type", type: "option" as const, default: null, options: ["日报", "周报"], allowCustomOption: false },
      ],
      nodes: [
        {
          id: "end",
          name: "结束",
          type: "end",
          position: { x: 0, y: 0 },
          config: { outputType: "text", template: "child-output", variables: [] },
        },
      ],
      edges: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      run: ReturnType<typeof vi.fn>
      runtimeDeps: {
        workflowCall?: {
          runWorkflow: (input: {
            definition: Record<string, unknown>
            params: Record<string, unknown>
            projectId?: string
            triggerSource: string
            abortSignal: AbortSignal
            parentRunId: string
            callStack: Array<{ workflowId: string; workflowName?: string }>
          }) => Promise<{ runId: string; result: { status: string; nodeResults: Record<string, unknown>; durationMs: number; error?: string } }>
        }
      }
    }
    engine.run = vi.fn()

    const result = await engine.runtimeDeps.workflowCall?.runWorkflow({
      definition: childDefinition,
      params: { report_type: "月报" },
      projectId: "repo-1",
      triggerSource: "workflow-call",
      abortSignal: new AbortController().signal,
      parentRunId: "parent-run",
      callStack: [{ workflowId: "parent", workflowName: "Parent" }, { workflowId: "child-workflow", workflowName: "Child Workflow" }],
    })

    expect(result?.result.status).toBe("failed")
    expect(result?.result.error).toContain("参数「report_type」必须是预设选项之一")
    expect(result?.result.nodeResults).toEqual({})
    expect(engine.run).not.toHaveBeenCalled()
    expect(snapshotService.save).toHaveBeenCalledWith(expect.objectContaining({
      runId: result?.runId,
      workflowId: "child-workflow",
      status: "failed",
      params: { report_type: "月报" },
      nodeResults: {},
      error: "参数「report_type」必须是预设选项之一",
    }))

    const unknownParamResult = await engine.runtimeDeps.workflowCall?.runWorkflow({
      definition: childDefinition,
      params: { report_type: "周报", stale_param: "unused" },
      projectId: "repo-1",
      triggerSource: "workflow-call",
      abortSignal: new AbortController().signal,
      parentRunId: "parent-run",
      callStack: [{ workflowId: "parent", workflowName: "Parent" }, { workflowId: "child-workflow", workflowName: "Child Workflow" }],
    })

    expect(unknownParamResult?.result.status).toBe("failed")
    expect(unknownParamResult?.result.error).toContain("运行参数「stale_param」未在 Workflow 中定义")
    expect(engine.run).not.toHaveBeenCalled()
    expect(snapshotService.save).toHaveBeenLastCalledWith(expect.objectContaining({
      runId: unknownParamResult?.runId,
      workflowId: "child-workflow",
      status: "failed",
      params: { report_type: "周报" },
      nodeResults: {},
      error: "运行参数「stale_param」未在 Workflow 中定义",
    }))

    const missingProjectDefinition = {
      ...childDefinition,
      id: "child-missing-project",
      params: [],
      nodes: [
        {
          id: "script",
          name: "Script",
          type: "script",
          position: { x: 0, y: 0 },
          config: { shell: "posix", script: "pwd", variables: [] },
        },
        {
          id: "end",
          name: "结束",
          type: "end",
          position: { x: 200, y: 0 },
          config: { outputType: "text", template: "", variables: [] },
        },
      ],
      edges: [{ id: "script-end", from: "script", to: "end" }],
    }
    const invalidDefinitionResult = await engine.runtimeDeps.workflowCall?.runWorkflow({
      definition: missingProjectDefinition,
      params: {},
      projectId: "parent-repo",
      triggerSource: "workflow-call",
      abortSignal: new AbortController().signal,
      parentRunId: "parent-run",
      callStack: [{ workflowId: "parent", workflowName: "Parent" }, { workflowId: "child-missing-project", workflowName: "Child Workflow" }],
    })

    expect(invalidDefinitionResult?.result.status).toBe("failed")
    expect(invalidDefinitionResult?.result.error).toContain("项目")
    expect(invalidDefinitionResult?.result.nodeResults).toEqual({})
    expect(engine.run).not.toHaveBeenCalled()
    expect(snapshotService.save).toHaveBeenLastCalledWith(expect.objectContaining({
      runId: invalidDefinitionResult?.runId,
      workflowId: "child-missing-project",
      status: "failed",
      params: {},
      nodeResults: {},
      error: expect.stringContaining("项目"),
    }))
  })

  it("nested workflow calls pass normalized option params into engine", async () => {
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const workflowService = { get: vi.fn(), list: vi.fn(async () => []) }
    const snapshotService = { save: vi.fn(async () => undefined) }
    const containers = { open: vi.fn() }
    const permissionGuard = { check: vi.fn() }
    const auditSink = { record: vi.fn() }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((serviceId: string) => {
          if (serviceId === "core.workflow") return workflowService
          if (serviceId === "core.workflow.snapshots") return snapshotService
          if (serviceId === "core.project-containers") return containers
          if (serviceId === "core.permission-guard") return permissionGuard
          if (serviceId === "core.audit-sink") return auditSink
          throw new Error(`Unexpected service id: ${serviceId}`)
        }),
      },
    }
    const childDefinition = {
      id: "child-workflow",
      name: "Child Workflow",
      version: "v1",
      params: [
        { name: "report_type", type: "option" as const, default: null, options: ["日报", "周报"], allowCustomOption: false },
      ],
      nodes: [
        {
          id: "end",
          name: "结束",
          type: "end",
          position: { x: 0, y: 0 },
          config: { outputType: "text", template: "child-output", variables: [] },
        },
      ],
      edges: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      run: ReturnType<typeof vi.fn>
      runtimeDeps: {
        workflowCall?: {
          runWorkflow: (input: {
            definition: typeof childDefinition
            params: Record<string, unknown>
            projectId?: string
            triggerSource: string
            abortSignal: AbortSignal
            parentRunId: string
            callStack: Array<{ workflowId: string; workflowName?: string }>
          }) => Promise<{ runId: string; result: { status: string; nodeResults: Record<string, unknown>; durationMs: number } }>
        }
      }
    }
    engine.run = vi.fn(async () => ({ status: "completed", nodeResults: {}, durationMs: 1 }))

    await engine.runtimeDeps.workflowCall?.runWorkflow({
      definition: childDefinition,
      params: { report_type: " 周报 " },
      projectId: "repo-1",
      triggerSource: "workflow-call",
      abortSignal: new AbortController().signal,
      parentRunId: "parent-run",
      callStack: [{ workflowId: "parent", workflowName: "Parent" }, { workflowId: "child-workflow", workflowName: "Child Workflow" }],
    })

    expect(engine.run).toHaveBeenCalledWith(
      childDefinition,
      { report_type: "周报" },
      expect.any(String),
      expect.any(Function),
      expect.any(AbortSignal),
      "repo-1",
      "workflow-call",
      undefined,
      [{ workflowId: "parent", workflowName: "Parent" }, { workflowId: "child-workflow", workflowName: "Child Workflow" }],
      undefined,
    )
    expect(snapshotService.save).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: "child-workflow",
      status: "completed",
      params: { report_type: "周报" },
    }))
  })

  it("nested workflow calls return run-level workflow failed errors", async () => {
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const workflowService = { get: vi.fn(), list: vi.fn(async () => []) }
    const snapshotService = { save: vi.fn(async () => undefined) }
    const containers = { open: vi.fn() }
    const permissionGuard = { check: vi.fn() }
    const auditSink = { record: vi.fn() }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((serviceId: string) => {
          if (serviceId === "core.workflow") return workflowService
          if (serviceId === "core.workflow.snapshots") return snapshotService
          if (serviceId === "core.project-containers") return containers
          if (serviceId === "core.permission-guard") return permissionGuard
          if (serviceId === "core.audit-sink") return auditSink
          throw new Error(`Unexpected service id: ${serviceId}`)
        }),
      },
    }
    const childDefinition = {
      id: "child-workflow",
      name: "Child Workflow",
      version: "v1",
      params: [],
      nodes: [
        {
          id: "end",
          name: "结束",
          type: "end",
          position: { x: 0, y: 0 },
          config: { outputType: "text", template: "child-output", variables: [] },
        },
      ],
      edges: [],
      createdAt: 1,
      updatedAt: 1,
    }
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      run: ReturnType<typeof vi.fn>
      runtimeDeps: {
        workflowCall?: {
          runWorkflow: (input: {
            definition: typeof childDefinition
            params: Record<string, unknown>
            projectId?: string
            triggerSource: string
            abortSignal: AbortSignal
            parentRunId: string
            callStack: Array<{ workflowId: string; workflowName?: string }>
          }) => Promise<{ runId: string; result: { status: string; nodeResults: Record<string, unknown>; durationMs: number; error?: string } }>
        }
      }
    }
    engine.run = vi.fn(async (_definition, _params, runId: string, emit: (event: unknown) => void) => {
      emit({ type: "workflow:failed", runId, workflowId: childDefinition.id, error: "子工作流准备失败" })
      return { status: "failed", nodeResults: {}, durationMs: 1 }
    })

    const result = await engine.runtimeDeps.workflowCall?.runWorkflow({
      definition: childDefinition,
      params: {},
      projectId: "repo-1",
      triggerSource: "workflow-call",
      abortSignal: new AbortController().signal,
      parentRunId: "parent-run",
      callStack: [{ workflowId: "parent", workflowName: "Parent" }, { workflowId: "child-workflow", workflowName: "Child Workflow" }],
    })

    expect(result?.result.error).toBe("子工作流准备失败")
    expect(snapshotService.save).toHaveBeenCalledWith(expect.objectContaining({
      runId: result?.runId,
      workflowId: "child-workflow",
      status: "failed",
      error: "子工作流准备失败",
    }))
  })

  it("workflow Agent dependency converts node timeout minutes to milliseconds", async () => {
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: "repo-1",
          repositories: [{ uuid: "repo-1", name: "Repo", localPath: "/repo" }],
          global: { projects: [] },
        })),
      },
    }))
    vi.doMock("../../services/log-store", () => ({
      logStore: {},
      createMainLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    }))
    const sendScheduled = vi.fn().mockResolvedValue({
      status: "success",
      summary: "ok",
      durationMs: 5,
      modelName: "glm-5.1",
      costCny: 0.014,
      costBreakdownCny: {
        input: 0.01,
        output: 0.004,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
      },
      costCurrency: "CNY",
    })
    const containers = {
      open: vi.fn(async () => ({
        get: vi.fn(() => ({ sendScheduled })),
      })),
    }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.project-containers") return containers
          if (id === "core.permission-guard") return { check: vi.fn() }
          if (id === "core.audit-sink") return { record: vi.fn() }
          throw new Error(`unexpected service ${id}`)
        }),
      },
    }
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      agentDeps: {
        sendToAgent(input: {
          providerId?: string
          modelTier?: string
          prompt: string
          projectId?: string
          abortSignal: AbortSignal
          timeoutMins?: number
          workflowId?: string
          workflowName?: string
          workflowRunId?: string
          workflowNodeId?: string
          workflowNodeName?: string
        }): Promise<{
          status: "success" | "failed"
          response: string
          error?: string
          durationMs: number
          modelName?: string
          costBreakdownCny?: Record<string, number>
        }>
      }
    }

    const result = await engine.agentDeps.sendToAgent({
      providerId: "test-provider",
      modelTier: "sonnet",
      prompt: "test",
      projectId: "repo-1",
      abortSignal: new AbortController().signal,
      timeoutMins: 45,
      workflowId: "wf-1",
      workflowName: "Workflow One",
      workflowRunId: "run-1",
      workflowNodeId: "node-1",
      workflowNodeName: "Prompt",
    })

    expect(result).toMatchObject({
      status: "success",
      modelName: "glm-5.1",
      costBreakdownCny: {
        input: 0.01,
        output: 0.004,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
      },
    })

    expect(sendScheduled).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 45 * 60_000,
      sourcePlatform: "workflow",
      userMeta: {
        source: "workflow",
        workflowId: "wf-1",
        workflowName: "Workflow One",
        workflowRunId: "run-1",
        workflowNodeId: "node-1",
        workflowNodeName: "Prompt",
      },
    }))

    sendScheduled.mockClear()

    await engine.agentDeps.sendToAgent({
      providerId: "test-provider",
      modelTier: "sonnet",
      prompt: "test",
      projectId: "repo-1",
      abortSignal: new AbortController().signal,
    })

    expect(sendScheduled).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 60 * 60_000,
      sourcePlatform: "workflow",
    }))
  })

  it("workflow Agent dependency treats provider error summaries as failures", async () => {
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: "repo-1",
          repositories: [{ uuid: "repo-1", name: "Repo", localPath: "/repo" }],
          global: { projects: [] },
        })),
      },
    }))
    vi.doMock("../../services/log-store", () => ({
      logStore: {},
      createMainLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    }))
    const sendScheduled = vi.fn().mockResolvedValue({
      conversationId: "conversation-1",
      sessionKey: "workflow-session-1",
      status: "success",
      summary: "Failed to authenticate. API Error: 401 User account is not active",
      durationMs: 5,
    })
    const containers = {
      open: vi.fn(async () => ({
        get: vi.fn(() => ({ sendScheduled })),
      })),
    }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.project-containers") return containers
          if (id === "core.permission-guard") return { check: vi.fn() }
          if (id === "core.audit-sink") return { record: vi.fn() }
          throw new Error(`unexpected service ${id}`)
        }),
      },
    }
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      agentDeps: {
        sendToAgent(input: {
          providerId?: string
          modelTier?: string
          prompt: string
          projectId?: string
          abortSignal: AbortSignal
        }): Promise<{
          status: "success" | "failed"
          response: string
          error?: string
          durationMs: number
        }>
      }
    }

    const result = await engine.agentDeps.sendToAgent({
      providerId: "test-provider",
      modelTier: "sonnet",
      prompt: "test",
      projectId: "repo-1",
      abortSignal: new AbortController().signal,
    })

    expect(result).toMatchObject({
      status: "failed",
      response: "",
      error: "Failed to authenticate. API Error: 401 User account is not active",
      durationMs: 5,
    })
  })

  it("workflow HTTP dependency records denied audits with a sanitized resource", async () => {
    const auditSink = { record: vi.fn() }
    const permissionGuard = {
      check: vi.fn().mockResolvedValue({
        allowed: false,
        reason: "blocked by policy",
        policyId: "policy-deny",
      }),
    }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.permission-guard") return permissionGuard
          if (id === "core.audit-sink") return auditSink
          throw new Error(`unexpected service ${id}`)
        }),
      },
    }
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      runtimeDeps: {
        sendHttpRequest(request: { method: string; url: string; fetchImpl?: typeof fetch }): Promise<unknown>
      }
    }

    await expect(engine.runtimeDeps.sendHttpRequest({
      method: "GET",
      url: "https://user:pass@example.test/hook?client_secret=secret&refresh_token=refresh-secret&id_token=id-secret&ok=1",
      fetchImpl: vi.fn(),
    })).rejects.toThrow("HTTP request denied by workflow engine: blocked by policy")

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      resource: "https://example.test/hook?client_secret=%5Bredacted%5D&refresh_token=%5Bredacted%5D&id_token=%5Bredacted%5D&ok=1",
    }))
    expect(auditSink.record).toHaveBeenCalledWith({
      action: "network.connect",
      actor: { kind: "system" },
      resource: "https://example.test/hook?client_secret=%5Bredacted%5D&refresh_token=%5Bredacted%5D&id_token=%5Bredacted%5D&ok=1",
      outcome: "denied",
      metadata: {
        source: "workflow",
        reason: "blocked by policy",
        policyId: "policy-deny",
      },
    })
    const serialized = JSON.stringify(auditSink.record.mock.calls)
    expect(serialized).not.toContain("=secret")
    expect(serialized).not.toContain("refresh-secret")
    expect(serialized).not.toContain("id-secret")
    expect(serialized).not.toContain("user:pass")
  })

  it("workflow HTTP dependency records allowed audits with a sanitized resource", async () => {
    const auditSink = { record: vi.fn() }
    const permissionGuard = {
      check: vi.fn().mockResolvedValue({ allowed: true }),
    }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.permission-guard") return permissionGuard
          if (id === "core.audit-sink") return auditSink
          throw new Error(`unexpected service ${id}`)
        }),
      },
    }
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      runtimeDeps: {
        sendHttpRequest(request: { method: string; url: string; fetchImpl?: typeof fetch }): Promise<unknown>
      }
    }

    await engine.runtimeDeps.sendHttpRequest({
      method: "POST",
      url: "https://user:pass@example.test/hook?api_key=secret&ok=1",
      fetchImpl: vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
    })

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      resource: "https://example.test/hook?api_key=%5Bredacted%5D&ok=1",
      outcome: "allowed",
      metadata: { source: "workflow", status: 200 },
    }))
    const serialized = JSON.stringify(auditSink.record.mock.calls)
    expect(serialized).not.toContain("secret")
    expect(serialized).not.toContain("user:pass")
  })

  it("workflow HTTP dependency records failed audits with a sanitized resource", async () => {
    const auditSink = { record: vi.fn() }
    const permissionGuard = {
      check: vi.fn().mockResolvedValue({ allowed: true }),
    }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((id: string) => {
          if (id === "core.permission-guard") return permissionGuard
          if (id === "core.audit-sink") return auditSink
          throw new Error(`unexpected service ${id}`)
        }),
      },
    }
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
      runtimeDeps: {
        sendHttpRequest(request: { method: string; url: string; fetchImpl?: typeof fetch }): Promise<unknown>
      }
    }

    await expect(engine.runtimeDeps.sendHttpRequest({
      method: "GET",
      url: "https://user:pass@example.test/hook?access_token=secret&ok=1",
      fetchImpl: vi.fn().mockRejectedValue(new Error("request failed")),
    })).rejects.toThrow("request failed")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      resource: "https://example.test/hook?access_token=%5Bredacted%5D&ok=1",
      outcome: "failed",
      metadata: { source: "workflow", error: "request failed" },
    }))
    const serialized = JSON.stringify(auditSink.record.mock.calls)
    expect(serialized).not.toContain("secret")
    expect(serialized).not.toContain("user:pass")
  })

  it("diagnostics MCP HTTP probe passes a timeout signal to fetch", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: {} }), { status: 200 }))
    const { restoreFetch, service } = await createDiagnosticsServiceWithFetch(fetchImpl as typeof fetch)

    try {
      await service.deps.probeMcpHttp("http://127.0.0.1:51234/mcp")
    } finally {
      restoreFetch()
    }

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:51234/mcp",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it("diagnostics MCP HTTP probe reports timeout errors without throwing", async () => {
    const timeoutError = Object.assign(new Error("The operation timed out."), { name: "TimeoutError" })
    const { restoreFetch, service } = await createDiagnosticsServiceWithFetch(vi.fn(async () => {
      throw timeoutError
    }) as typeof fetch)

    try {
      await expect(service.deps.probeMcpHttp("http://127.0.0.1:51234/mcp")).resolves.toEqual({
        ok: false,
        method: "ping",
        error: "MCP 服务响应超时",
      })
    } finally {
      restoreFetch()
    }
  })

  it("createRunWorkflowHandler catch handler handles engine rejection without leaking raw error text", async () => {
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: "repo-1",
          repositories: [{ uuid: "repo-1", name: "Test", localPath: "/test" }],
        })),
      },
    }))

    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    vi.doMock("../../services/log-store", () => ({
      logStore: {},
      createMainLogger: () => logger,
    }))

    const { createRunWorkflowHandler } = await importBootstrap()

    const workflowDef = {
      id: "wf-1",
      name: "Test",
      version: "",
      nodes: [
        { id: "end-1", type: "end" as const, name: "End", position: { x: 400, y: 200 }, config: { outputType: "text" as const, template: "", variables: [] } },
      ],
      edges: [],
      params: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const workflowService = { get: vi.fn().mockResolvedValue(workflowDef) }
    const runAborts = new Map<string, AbortController>()
    const runStatuses = new Map<string, { runId: string; workflowId: string; status: string; nodeResults: Record<string, unknown>; startedAt: number; error?: string; params?: Record<string, unknown>; definition?: unknown }>()
    const runCompletions = new Map<string, Promise<unknown>>()
    const eventBus = { emit: vi.fn() }
    const snapshotService = { save: vi.fn() }
    const capabilityLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const engineError = new Error("engine crashed token=sk-secret at /Users/example")
    const workflowEngine = {
      run: vi.fn(async (_def: unknown, _params: unknown, runId: string, emit: (event: unknown) => void) => {
        emit({
          type: "node:completed",
          runId,
          nodeId: "end-1",
          result: {
            nodeId: "end-1",
            status: "success",
            input: {
              variables: { apiToken: "token=sk-secret" },
              prompt: "resolved prompt token=sk-secret at /Users/example/repo",
            },
          },
        })
        throw engineError
      }),
    }

    const handler = createRunWorkflowHandler({
      workflowService: workflowService as never,
      workflowEngine: workflowEngine as never,
      snapshotService: snapshotService as never,
      eventBus: eventBus as never,
      runAborts: runAborts as never,
      runStatuses: runStatuses as never,
      runCompletions,
      capabilityLogger: capabilityLogger as never,
    })

    const result = await handler("wf-1", {})
    expect(result).toHaveProperty("runId")
    const runId = (result as { runId: string }).runId

    await vi.waitFor(() => {
      expect(runAborts.has(runId)).toBe(false)
    })

    const status = runStatuses.get(runId)
    expect(status?.status).toBe("failed")
    expect(status?.error).toBe("工作流引擎异常")
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "workflow",
        type: "workflow:failed",
        payload: expect.objectContaining({ runId, error: "工作流引擎异常" }),
      }),
      expect.objectContaining({ backpressure: "block" }),
    )
    expect(snapshotService.save).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        status: "failed",
        nodeResults: {
          "end-1": expect.objectContaining({
            input: {
              variables: { apiToken: "token=[redacted]" },
              prompt: "resolved prompt token=[redacted] at [path]",
            },
          }),
        },
      }),
    )
    expect(capabilityLogger.error).toHaveBeenCalledWith(
      "workflow engine rejected (mcp dispatch)",
      expect.objectContaining({
        workflowId: "wf-1",
        runId,
        errorName: "Error",
        errorLength: "engine crashed token=sk-secret at /Users/example".length,
      }),
    )

    const terminalEvents = eventBus.emit.mock.calls.filter(([event]) => event?.type === "workflow:failed")
    const serialized = JSON.stringify([runStatuses.get(runId), terminalEvents, snapshotService.save.mock.calls, capabilityLogger.error.mock.calls])
    expect(serialized).not.toContain("sk-secret")
    expect(serialized).not.toContain("/Users/example")
  })

  it("createRunWorkflowHandler sanitizes node results before persisting snapshots", async () => {
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: "repo-1",
          repositories: [{ uuid: "repo-1", name: "Test", localPath: "/test" }],
        })),
      },
    }))

    const { createRunWorkflowHandler } = await importBootstrap()
    const workflowDef = {
      id: "wf-1",
      name: "Test",
      version: "",
      nodes: [
        { id: "end-1", type: "end" as const, name: "End", position: { x: 400, y: 200 }, config: { outputType: "text" as const, template: "", variables: [] } },
      ],
      edges: [],
      params: [
        { name: "apiToken", type: "text" as const, default: null },
        { name: "note", type: "text" as const, default: null },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const rawNodeResults = {
      "end-1": {
        nodeId: "end-1",
        status: "success" as const,
        input: {
          variables: { apiToken: "token=sk-secret" },
          prompt: "resolved prompt token=sk-secret at /Users/example/repo",
        },
      },
    }
    const workflowService = { get: vi.fn().mockResolvedValue(workflowDef) }
    const runAborts = new Map<string, AbortController>()
    const runStatuses = new Map<string, { runId: string; workflowId: string; status: string; nodeResults: Record<string, unknown>; startedAt: number; params?: Record<string, unknown>; definition?: unknown }>()
    const runCompletions = new Map<string, Promise<unknown>>()
    const eventBus = { emit: vi.fn() }
    const snapshotService = { save: vi.fn() }
    const capabilityLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const workflowEngine = {
      run: vi.fn(async (_def: unknown, _params: unknown, runId: string, emit: (event: unknown) => void) => {
        emit({ type: "node:completed", runId, nodeId: "end-1", result: rawNodeResults["end-1"] })
        emit({ type: "workflow:completed", runId, workflowId: "wf-1", result: { status: "completed", nodeResults: rawNodeResults, durationMs: 1 } })
      }),
    }

    const handler = createRunWorkflowHandler({
      workflowService: workflowService as never,
      workflowEngine: workflowEngine as never,
      snapshotService: snapshotService as never,
      eventBus: eventBus as never,
      runAborts: runAborts as never,
      runStatuses: runStatuses as never,
      runCompletions,
      capabilityLogger: capabilityLogger as never,
    })

    await handler("wf-1", {
      apiToken: "sk-param-secret",
      note: "Authorization: Bearer raw-token at /Users/example/params",
    })

    await vi.waitFor(() => {
      expect(snapshotService.save).toHaveBeenCalled()
    })
    expect(snapshotService.save).toHaveBeenCalledWith(expect.objectContaining({
      params: {
        apiToken: "[redacted]",
        note: "Authorization=[redacted] [redacted] at [path]",
      },
      nodeResults: {
        "end-1": expect.objectContaining({
          input: {
            variables: { apiToken: "token=[redacted]" },
            prompt: "resolved prompt token=[redacted] at [path]",
          },
        }),
      },
    }))
    expect(JSON.stringify(snapshotService.save.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(snapshotService.save.mock.calls)).not.toContain("sk-param-secret")
    expect(JSON.stringify(snapshotService.save.mock.calls)).not.toContain("raw-token")
    expect(JSON.stringify(snapshotService.save.mock.calls)).not.toContain("/Users/example/repo")
    expect(JSON.stringify(snapshotService.save.mock.calls)).not.toContain("/Users/example/params")
    expect(JSON.stringify(eventBus.emit.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(eventBus.emit.mock.calls)).not.toContain("/Users/example/repo")
    expect(JSON.stringify([...runStatuses.values()])).not.toContain("sk-secret")
    expect(JSON.stringify([...runStatuses.values()])).not.toContain("/Users/example/repo")
  })

  it("createRunWorkflowHandler keeps resolved node input and progress in live run status", async () => {
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: "repo-1",
          repositories: [{ uuid: "repo-1", name: "Test", localPath: "/test" }],
        })),
      },
    }))

    const { createRunWorkflowHandler } = await importBootstrap()
    const workflowDef = {
      id: "wf-1",
      name: "Test",
      version: "",
      defaultProjectId: "repo-1",
      defaultProviderId: "provider-1",
      defaultModelTier: "default" as const,
      nodes: [
        { id: "node-1", type: "prompt" as const, name: "Prompt", position: { x: 0, y: 0 }, config: { prompt: "Hi {{topic}}", variables: [{ name: "topic", source: { type: "static" as const, value: "release notes" } }] } },
        { id: "end-1", type: "end" as const, name: "End", position: { x: 400, y: 200 }, config: { outputType: "text" as const, template: "", variables: [] } },
      ],
      edges: [{ id: "edge-node-end", from: "node-1", to: "end-1" }],
      params: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const workflowService = { get: vi.fn().mockResolvedValue(workflowDef) }
    const runAborts = new Map<string, AbortController>()
    const runStatuses = new Map<string, { runId: string; workflowId: string; status: string; nodeResults: Record<string, { input?: unknown; progressLabel?: string; status?: string }>; startedAt: number; params?: Record<string, unknown>; definition?: unknown }>()
    const runCompletions = new Map<string, Promise<unknown>>()
    const eventBus = { emit: vi.fn() }
    const snapshotService = { save: vi.fn() }
    const capabilityLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const liveResult = {
      nodeId: "node-1",
      status: "running" as const,
      input: {
        variables: { topic: "release notes" },
        prompt: "Hi release notes",
      },
      startedAt: 10,
    }
    const workflowEngine = {
      run: vi.fn((_def: unknown, _params: unknown, runId: string, emit: (event: unknown) => void) => {
        emit({ type: "node:started", runId, nodeId: "node-1", startedAt: 10, result: liveResult })
        emit({ type: "node:progress", runId, nodeId: "node-1", phase: "awaiting_response", label: "等待响应…" })
        return new Promise(() => undefined)
      }),
    }

    const handler = createRunWorkflowHandler({
      workflowService: workflowService as never,
      workflowEngine: workflowEngine as never,
      snapshotService: snapshotService as never,
      eventBus: eventBus as never,
      runAborts: runAborts as never,
      runStatuses: runStatuses as never,
      runCompletions,
      capabilityLogger: capabilityLogger as never,
    })

    const result = await handler("wf-1", {})
    const runId = (result as { runId: string }).runId

    expect(runStatuses.get(runId)?.nodeResults["node-1"]).toMatchObject({
      status: "running",
      input: {
        variables: { topic: "release notes" },
        prompt: "Hi release notes",
      },
      progressLabel: "等待响应…",
    })
  })

  it("createRunWorkflowHandler passes the dispatch actor into workflow engine runs", async () => {
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn().mockResolvedValue({
          repositories: [{ uuid: "repo-1", localPath: "/tmp/repo" }],
          activeRepoUuid: "repo-1",
        }),
      },
    }))

    const { createRunWorkflowHandler } = await importBootstrap()
    const workflowDef = {
      id: "wf-1",
      name: "Test",
      version: "v1",
      nodes: [
        { id: "end-1", type: "end" as const, name: "End", position: { x: 400, y: 200 }, config: { outputType: "text" as const, template: "", variables: [] } },
      ],
      edges: [],
      params: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const actor = { kind: "user" as const, id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" }
    const workflowEngine = {
      run: vi.fn((_def: unknown, _params: unknown, runId: string, emit: (event: unknown) => void) => {
        emit({ type: "workflow:completed", runId, workflowId: "wf-1", result: { status: "completed", nodeResults: {}, durationMs: 1 } })
        return Promise.resolve({ status: "completed", nodeResults: {}, durationMs: 1 })
      }),
    }

    const handler = createRunWorkflowHandler({
      workflowService: { get: vi.fn().mockResolvedValue(workflowDef) } as never,
      workflowEngine: workflowEngine as never,
      snapshotService: { save: vi.fn() } as never,
      eventBus: { emit: vi.fn() } as never,
      runAborts: new Map(),
      runStatuses: new Map() as never,
      runCompletions: new Map(),
      capabilityLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as never,
    })

    await handler("wf-1", {}, { triggerSource: "mcp", actor })

    expect(workflowEngine.run).toHaveBeenCalledWith(
      expect.anything(),
      {},
      expect.any(String),
      expect.any(Function),
      expect.any(AbortSignal),
      "repo-1",
      "mcp",
      actor,
      undefined,
      undefined,
    )
  })

  it("createRunWorkflowHandler skips snapshots after workflow deletion tombstone", async () => {
    vi.doMock("../../services/config-store", () => ({
      configStore: {
        load: vi.fn(async () => ({
          activeRepoUuid: "repo-1",
          repositories: [{ uuid: "repo-1", name: "Test", localPath: "/test" }],
        })),
      },
    }))

    const { createRunWorkflowHandler } = await importBootstrap()
    const workflowDef = {
      id: "wf-1",
      name: "Test",
      version: "",
      nodes: [
        { id: "end-1", type: "end" as const, name: "End", position: { x: 400, y: 200 }, config: { outputType: "text" as const, template: "", variables: [] } },
      ],
      edges: [],
      params: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    const workflowService = { get: vi.fn().mockResolvedValue(workflowDef) }
    const runAborts = new Map<string, AbortController>()
    const runStatuses = new Map<string, { runId: string; workflowId: string; status: string; nodeResults: Record<string, unknown>; startedAt: number; params?: Record<string, unknown>; definition?: unknown }>()
    const runCompletions = new Map<string, Promise<unknown>>()
    const eventBus = { emit: vi.fn() }
    const snapshotService = { save: vi.fn() }
    const capabilityLogger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const workflowEngine = {
      run: vi.fn(async (_def: unknown, _params: unknown, runId: string, emit: (event: unknown) => void) => {
        emit({ type: "workflow:completed", runId, workflowId: "wf-1", result: { status: "completed", nodeResults: {}, durationMs: 1 } })
      }),
    }

    const handler = createRunWorkflowHandler({
      workflowService: workflowService as never,
      workflowEngine: workflowEngine as never,
      snapshotService: snapshotService as never,
      eventBus: eventBus as never,
      runAborts: runAborts as never,
      runStatuses: runStatuses as never,
      runCompletions,
      capabilityLogger: capabilityLogger as never,
      isWorkflowDeleted: () => true,
    })

    const result = await handler("wf-1", {})
    expect(result).toHaveProperty("runId")
    await Promise.resolve()

    expect(snapshotService.save).not.toHaveBeenCalled()
  })

  it("providerServiceDescriptor registers global provider storage", async () => {
    const { providerServiceDescriptor } = await importBootstrap()
    expect(providerServiceDescriptor.id).toBe("provider")
    expect(providerServiceDescriptor.criticality).toBe("fatal")
    expect(providerServiceDescriptor.dependsOn).toEqual([
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
      "core.workflow",
    ])
  })

  it("coreWorkflowPackageDescriptor depends on workflow and provider services", async () => {
    const { coreWorkflowPackageDescriptor } = await importBootstrap()
    expect(coreWorkflowPackageDescriptor.id).toBe("core.workflow.package")
    expect(coreWorkflowPackageDescriptor.dependsOn).toEqual(["core.workflow", "provider"])
  })

  it("coreUpdateDescriptor is degraded and depends on core.config + core.window-manager", async () => {
    const { coreUpdateDescriptor } = await importBootstrap()
    expect(coreUpdateDescriptor.id).toBe("core.update")
    expect(coreUpdateDescriptor.criticality).toBe("degraded")
    expect(coreUpdateDescriptor.dependsOn).toEqual(["core.config", "core.window-manager"])
  })

  it("coreDriveSyncDescriptor restores local watching during startup", async () => {
    const { coreDriveSyncDescriptor } = await importBootstrap()
    const calls: string[] = []
    const service = {
      startLocalWatcher: vi.fn(async () => { calls.push("local") }),
      startRemotePolling: vi.fn(() => { calls.push("remote") }),
      stopRemotePolling: vi.fn(async () => { calls.push("stop-remote") }),
      stopLocalWatcher: vi.fn(async () => { calls.push("stop-local") }),
    }

    await coreDriveSyncDescriptor.start?.(service as never, {} as never)
    expect(service.startLocalWatcher).toHaveBeenCalledTimes(1)
    expect(service.startRemotePolling).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(["local", "remote"])

    await coreDriveSyncDescriptor.stop?.(service as never, {} as never, 1000)
    expect(service.stopRemotePolling).toHaveBeenCalledTimes(1)
    expect(service.stopLocalWatcher).toHaveBeenCalledTimes(1)
  })

  it("repoWatchDescriptor depends on core.config and exposes stop", async () => {
    const { repoWatchDescriptor } = await importBootstrap()
    expect(repoWatchDescriptor.id).toBe("repo.watch")
    expect(repoWatchDescriptor.criticality).toBe("degraded")
    expect(repoWatchDescriptor.dependsOn).toEqual(["core.config", "core.event-bus"])
    expect(repoWatchDescriptor.stop).toBeTypeOf("function")
  })

  it("repoMaintenanceDescriptor depends on repo.watch and pending pushes", async () => {
    const { repoMaintenanceDescriptor } = await importBootstrap()
    expect(repoMaintenanceDescriptor.id).toBe("repo.maintenance")
    expect(repoMaintenanceDescriptor.criticality).toBe("degraded")
    expect(repoMaintenanceDescriptor.dependsOn).toEqual(["repo.watch", "repo.pending-pushes"])
  })

  it("repoPendingPushesDescriptor depends on core.database", async () => {
    const { repoPendingPushesDescriptor } = await importBootstrap()
    expect(repoPendingPushesDescriptor.id).toBe("repo.pending-pushes")
    expect(repoPendingPushesDescriptor.criticality).toBe("degraded")
    expect(repoPendingPushesDescriptor.dependsOn).toEqual(["core.database"])
  })

  it("coreSideChannelDescriptor is degraded and depends on network/project foundations", async () => {
    const { coreSideChannelDescriptor } = await importBootstrap()
    expect(coreSideChannelDescriptor.id).toBe("core.side-channel")
    expect(coreSideChannelDescriptor.criticality).toBe("degraded")
    expect(coreSideChannelDescriptor.dependsOn).toEqual([
      "core.network-registry",
      "core.project-containers",
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
      "core.execution-isolation",
    ])
    expect(coreSideChannelDescriptor.start).toBeTypeOf("function")
    expect(coreSideChannelDescriptor.stop).toBeTypeOf("function")
  })

  it("coreBridgeAdapterDescriptor is degraded and depends on side-channel", async () => {
    const { coreBridgeAdapterDescriptor } = await importBootstrap()
    expect(coreBridgeAdapterDescriptor.id).toBe("core.bridge-adapter")
    expect(coreBridgeAdapterDescriptor.criticality).toBe("degraded")
    expect(coreBridgeAdapterDescriptor.dependsOn).toEqual([
      "core.network-registry",
      "core.project-containers",
      "core.side-channel",
      "core.permission-guard",
      "core.audit-sink",
    ])
    expect(coreBridgeAdapterDescriptor.start).toBeTypeOf("function")
    expect(coreBridgeAdapterDescriptor.stop).toBeTypeOf("function")
  })

  it("createUiTrayDescriptor produces a degraded descriptor depending on core.app-icon", async () => {
    const { createUiTrayDescriptor } = await importBootstrap()
    const cb = vi.fn()
    const desc = createUiTrayDescriptor(cb)
    expect(desc.id).toBe("ui.tray")
    expect(desc.criticality).toBe("degraded")
    expect(desc.dependsOn).toEqual(["core.app-icon"])
    expect(desc.stop).toBeTypeOf("function")
  })
})

function makeFakeContext() {
  const noop = () => {}
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  }
  return {
    logger,
    dataRepo: {} as never,
    eventBus: {} as never,
    registry: {} as never,
    metrics: {} as never,
    tracer: {} as never,
    permissionGuard: {} as never,
    auditSink: {} as never,
    processRuntime: {} as never,
  }
}

async function createDiagnosticsServiceWithFetch(fetchImpl: typeof fetch) {
  const originalFetch = globalThis.fetch
  vi.stubGlobal("fetch", fetchImpl)
  const { coreDiagnosticsDescriptor } = await importBootstrap()
  const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
  const auditSink = { record: vi.fn() }
  const registry = {
    get: vi.fn((id: string) => {
      if (id === "core.permission-guard") return permissionGuard
      if (id === "core.audit-sink") return auditSink
      if (id === "core.data-repository") return {}
      throw new Error(`unexpected service ${id}`)
    }),
  }
  const service = coreDiagnosticsDescriptor.create({
    ...makeFakeContext(),
    registry,
  } as never) as unknown as {
    deps: {
      probeMcpHttp(url: string): Promise<unknown>
    }
  }
  return {
    service,
    restoreFetch: () => {
      globalThis.fetch = originalFetch
    },
  }
}
