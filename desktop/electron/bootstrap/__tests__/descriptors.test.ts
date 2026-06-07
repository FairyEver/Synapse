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
const tmpUserData = "/tmp/synapse-test-userdata-" + Date.now()
const bootstrapImportTimeoutMs = process.platform === "win32" ? 120_000 : 15_000
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

  it("coreDatabaseDescriptor is degraded, depends on config, event bus, scheduler, and action runtime, has stop", async () => {
    const { coreDatabaseDescriptor } = await importBootstrap()
    expect(coreDatabaseDescriptor.id).toBe("core.database")
    expect(coreDatabaseDescriptor.criticality).toBe("degraded")
    expect(coreDatabaseDescriptor.dependsOn).toEqual([
      "core.config",
      "core.event-bus",
      "core.task-scheduler",
      "core.automation",
      "core.action-runtime",
      "core.workflow",
      "core.workflow.snapshots",
      "core.workflow.run-aborts",
      "core.workflow.run-statuses",
      "core.workflow.engine",
      "core.permission-guard",
      "core.audit-sink",
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
    ])
    expect(coreActionRuntimeDescriptor.create).toBeTypeOf("function")
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

  it("coreWorkflowEngineDescriptor injects workflow call runtime dependency", async () => {
    const { coreWorkflowEngineDescriptor } = await importBootstrap()
    const workflowService = { get: vi.fn().mockResolvedValue(null) }
    const containers = { open: vi.fn() }
    const permissionGuard = { check: vi.fn() }
    const auditSink = { record: vi.fn() }
    const ctx = {
      ...makeFakeContext(),
      registry: {
        get: vi.fn((serviceId: string) => {
          if (serviceId === "core.workflow") return workflowService
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
      resource: "https://%5Bredacted%5D:%5Bredacted%5D@example.test/hook?client_secret=%5Bredacted%5D&refresh_token=%5Bredacted%5D&id_token=%5Bredacted%5D&ok=1",
    }))
    expect(auditSink.record).toHaveBeenCalledWith({
      action: "network.connect",
      actor: { kind: "system" },
      resource: "https://%5Bredacted%5D:%5Bredacted%5D@example.test/hook?client_secret=%5Bredacted%5D&refresh_token=%5Bredacted%5D&id_token=%5Bredacted%5D&ok=1",
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
      resource: "https://%5Bredacted%5D:%5Bredacted%5D@example.test/hook?api_key=%5Bredacted%5D&ok=1",
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
      resource: "https://%5Bredacted%5D:%5Bredacted%5D@example.test/hook?access_token=%5Bredacted%5D&ok=1",
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
      params: [],
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

    await handler("wf-1", {})

    await vi.waitFor(() => {
      expect(snapshotService.save).toHaveBeenCalled()
    })
    expect(snapshotService.save).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(JSON.stringify(snapshotService.save.mock.calls)).not.toContain("/Users/example/repo")
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

  it("coreTaskSchedulerDescriptor depends on action runtime", async () => {
    const { coreTaskSchedulerDescriptor } = await importBootstrap()
    expect(coreTaskSchedulerDescriptor.dependsOn).toEqual([
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
      "core.action-runtime",
      "core.event-bus",
    ])
  })

  it("providerServiceDescriptor registers global provider storage", async () => {
    const { providerServiceDescriptor } = await importBootstrap()
    expect(providerServiceDescriptor.id).toBe("provider")
    expect(providerServiceDescriptor.criticality).toBe("fatal")
    expect(providerServiceDescriptor.dependsOn).toEqual([
      "core.data-repository",
      "core.permission-guard",
      "core.audit-sink",
      "core.task-scheduler",
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
