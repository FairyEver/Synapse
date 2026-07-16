import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"

const logStoreMock = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

const electronMock = vi.hoisted(() => ({
  app: {
    getAppPath: vi.fn(() => "/Applications/Synapse.app/Contents/Resources/app.asar"),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => undefined),
    getAllWindows: vi.fn(() => []),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  },
}))

import { createInMemoryHarness, type IpcHandlerContext } from "../../../runtime/ipc"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import type { WorkflowDefinition, WorkflowRunStatus } from "../../../../src/types/workflow"
import { configStore } from "../../../services/config-store"
import { validateWorkflowWithResourceDefaults } from "../../../services/workflow/workflow-validator"
import { WorkflowPackageService } from "../../../services/workflow/workflow-package-service"
import type { WorkflowExportDocumentResult } from "../../../services/workflow/workflow-service"
import { workflowIpcModule } from "../ipc"

vi.mock("electron", () => electronMock)

vi.mock("../../../services/log-store", () => ({
  createMainLogger: vi.fn(() => logStoreMock.logger),
}))

vi.mock("../../../services/config-store", () => ({
  configStore: {
    load: vi.fn(),
  },
}))

vi.mock("../../../services/workflow/workflow-validator", () => ({
  validateWorkflow: vi.fn(() => ({ valid: true, errors: [], warnings: [] })),
  validateWorkflowWithResourceDefaults: vi.fn(async () => ({ valid: true, errors: [], warnings: [] })),
  validateRunParams: vi.fn(() => []),
  buildEffectiveRunParams: vi.fn((_def: unknown, params: Record<string, unknown>) => params),
  configuredWorkflowProjectIdsFromConfig: vi.fn(() => ["project-1"]),
}))

describe("workflowIpcModule", () => {
  beforeEach(() => {
    logStoreMock.logger.error.mockClear()
    logStoreMock.logger.info.mockClear()
    logStoreMock.logger.warn.mockClear()
    electronMock.dialog.showOpenDialog.mockReset()
    electronMock.dialog.showSaveDialog.mockReset()
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [{
        uuid: "project-1",
        name: "Project One",
        localPath: "/repo",
        contentDirs: {},
      }],
      activeRepoUuid: "project-1",
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
  })

  function createExportPackageService(
    exportDocument: WorkflowExportDocumentResult,
    permissionGuard: { check: Mock<PermissionGuard["check"]> },
    auditSink: { record: Mock<AuditSink["record"]> },
  ): WorkflowPackageService {
    return new WorkflowPackageService({
      workflowService: {
        getExportDocument: vi.fn(async () => exportDocument),
        save: vi.fn(),
      },
      providerService: { listProviders: vi.fn(async () => []) },
      permissionGuard,
      auditSink,
    })
  }

  it("opens native pickers for workflow file and directory params", async () => {
    electronMock.dialog.showOpenDialog
      .mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/input.txt"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/work"] })
    const harness = createInMemoryHarness()
    harness.registry.register(workflowIpcModule, {
      moduleId: "workflow",
      resolve: <T,>(): T => {
        throw new Error("No services expected")
      },
    })

    await expect(harness.invoke("synapse:workflow:param-file:choose", undefined)).resolves.toBe("/tmp/input.txt")
    await expect(harness.invoke("synapse:workflow:param-directory:choose", undefined)).resolves.toBe("/tmp/work")

    expect(electronMock.dialog.showOpenDialog).toHaveBeenNthCalledWith(1, {
      title: "选择文件",
      properties: ["openFile"],
    })
    expect(electronMock.dialog.showOpenDialog).toHaveBeenNthCalledWith(2, {
      title: "选择文件夹",
      properties: ["openDirectory"],
    })
  })

  it("returns null when workflow param picker is cancelled", async () => {
    electronMock.dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const harness = createInMemoryHarness()
    harness.registry.register(workflowIpcModule, {
      moduleId: "workflow",
      resolve: <T,>(): T => {
        throw new Error("No services expected")
      },
    })

    await expect(harness.invoke("synapse:workflow:param-file:choose", undefined)).resolves.toBeNull()
  })

  it("opens multi-select native pickers for workflow resource params", async () => {
    electronMock.dialog.showOpenDialog
      .mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/a.txt", "/tmp/b.txt"] })
      .mockResolvedValueOnce({ canceled: false, filePaths: ["/tmp/a", "/tmp/b"] })
    const harness = createInMemoryHarness()
    harness.registry.register(workflowIpcModule, {
      moduleId: "workflow",
      resolve: <T,>(): T => { throw new Error("No services expected") },
    })

    await expect(harness.invoke("synapse:workflow:param-files:choose", undefined))
      .resolves.toEqual(["/tmp/a.txt", "/tmp/b.txt"])
    await expect(harness.invoke("synapse:workflow:param-directories:choose", undefined))
      .resolves.toEqual(["/tmp/a", "/tmp/b"])
    expect(electronMock.dialog.showOpenDialog).toHaveBeenNthCalledWith(1, {
      title: "选择文件",
      properties: ["openFile", "multiSelections"],
    })
    expect(electronMock.dialog.showOpenDialog).toHaveBeenNthCalledWith(2, {
      title: "选择文件夹",
      properties: ["openDirectory", "multiSelections"],
    })
  })

  it("accepts option params when saving workflow definitions", async () => {
    const workflow = { save: vi.fn(async () => ({ versionHash: "v-option" })) }
    const eventBus = { emit: vi.fn() }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.event-bus") return eventBus as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })
    const definition = {
      ...workflowDefinition(),
      params: [{
        name: "report_type",
        type: "option",
        default: "周报",
        options: ["日报", "周报"],
        allowCustomOption: false,
      }],
    }

    await expect(harness.invoke("synapse:workflow:save", definition)).resolves.toEqual({ versionHash: "v-option" })
    expect(workflow.save).toHaveBeenCalledWith(definition)
  })

  it("sanitizes workflow engine rejection diagnostics and visible failure state", async () => {
    const rawError = "engine failed token=sk-secret at /Users/example/repo with prompt text"
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const eventBus = { emit: vi.fn() }
    const snapshots = { save: vi.fn(async () => undefined) }
    const definition = {
      ...workflowDefinition(),
      params: [
        { name: "apiToken", type: "text", default: null },
        { name: "note", type: "text", default: null },
      ],
    }
    const workflow = { get: vi.fn(async () => definition) }
    const engine = {
      run: vi.fn((_def: unknown, _params: unknown, runId: string, emit: (event: unknown) => void) => {
        emit({
          type: "node:completed",
          runId,
          nodeId: "prompt-1",
          result: {
            nodeId: "prompt-1",
            status: "success",
            input: {
              variables: { secret: "token=sk-secret" },
              prompt: "prompt token=sk-secret at /Users/example/repo",
            },
          },
        })
        return Promise.reject(new Error(rawError))
      }),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return eventBus as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:run", {
      id: "workflow-1",
      params: {
        apiToken: "sk-param-secret",
        note: "Authorization: Bearer raw-token at /Users/example/params",
      },
    })
    await Promise.resolve()

    expect(result).toEqual({ runId: expect.any(String) })
    const runId = (result as { runId: string }).runId
    expect(logStoreMock.logger.error).toHaveBeenCalledWith("workflow engine rejected unexpectedly", {
      workflowId: "workflow-1",
      runId,
      errorName: "Error",
      errorLength: rawError.length,
      stackLength: expect.any(Number),
    })
    expect(runStatuses.get(runId)?.error).toBe(`引擎异常（Error）：engine failed token=[redacted] at [path] with prompt text`)
    expect(runStatuses.get(runId)?.nodeResults["prompt-1"]?.input).toEqual({
      variables: { secret: "token=[redacted]" },
      prompt: "prompt token=[redacted] at [path]",
    })
    expect(JSON.stringify(logStoreMock.logger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(logStoreMock.logger.error.mock.calls)).not.toContain("/Users/example/repo")
    expect(JSON.stringify(logStoreMock.logger.error.mock.calls)).not.toContain("prompt text")
    expect(JSON.stringify(eventBus.emit.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(eventBus.emit.mock.calls)).not.toContain("/Users/example/repo")
    expect(JSON.stringify(runStatuses.get(runId))).not.toContain("sk-secret")
    expect(JSON.stringify(runStatuses.get(runId))).not.toContain("/Users/example/repo")
    expect(snapshots.save).toHaveBeenCalledWith(expect.objectContaining({
      params: {
        apiToken: "[redacted]",
        note: "Authorization=[redacted] [redacted] at [path]",
      },
      nodeResults: {
        "prompt-1": expect.objectContaining({
          input: {
            variables: { secret: "token=[redacted]" },
            prompt: "prompt token=[redacted] at [path]",
          },
        }),
      },
    }))
    expect(JSON.stringify(snapshots.save.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(snapshots.save.mock.calls)).not.toContain("sk-param-secret")
    expect(JSON.stringify(snapshots.save.mock.calls)).not.toContain("raw-token")
    expect(JSON.stringify(snapshots.save.mock.calls)).not.toContain("/Users/example/repo")
    expect(JSON.stringify(snapshots.save.mock.calls)).not.toContain("/Users/example/params")
  })

  it("sanitizes workflow live events and memory run status before renderer exposure", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const eventBus = { emit: vi.fn() }
    const snapshots = { save: vi.fn(async () => undefined) }
    const definition = {
      ...workflowDefinition(),
      params: [
        { name: "apiKey", type: "text", default: null },
        { name: "note", type: "text", default: null },
      ],
    }
    const workflow = { get: vi.fn(async () => definition) }
    const engine = {
      run: vi.fn((_def: unknown, _params: unknown, runId: string, emit: (event: unknown) => void) => {
        const nodeResult = {
          nodeId: "codex-1",
          status: "success" as const,
          input: {
            variables: {
              apiToken: "sk-live-secret",
              note: "Authorization: Bearer live-token at /Users/example/live",
            },
            prompt: "prompt password=live-password at /Users/example/prompt",
          },
          output: "stdout token=sk-live-secret at /Users/example/stdout",
          outputs: {
            finalMessage: "Cookie: session=live-cookie",
            codexDebug: {
              promptPreview: "Bearer live-token",
              stdoutPath: "/Users/example/stdout.txt",
            },
          },
        }
        emit({ type: "node:completed", runId, nodeId: "codex-1", output: nodeResult.output, result: nodeResult })
        emit({
          type: "workflow:completed",
          runId,
          workflowId: "workflow-1",
          result: {
            status: "completed",
            nodeResults: { "codex-1": nodeResult },
            durationMs: 5,
            output: "Authorization: Bearer live-token",
          },
        })
        return Promise.resolve()
      }),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return eventBus as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:run", {
      id: "workflow-1",
      params: {
        apiKey: "sk-param-secret",
        note: "Bearer param-token at /Users/example/params",
      },
    })
    await Promise.resolve()

    const runId = (result as { runId: string }).runId
    const liveStatus = await harness.invoke("synapse:workflow:run-status", { runId })
    const serializedEvents = JSON.stringify(eventBus.emit.mock.calls)
    const serializedStatus = JSON.stringify(liveStatus)
    const serializedMemory = JSON.stringify(runStatuses.get(runId))

    for (const serialized of [serializedEvents, serializedStatus, serializedMemory]) {
      expect(serialized).not.toContain("sk-live-secret")
      expect(serialized).not.toContain("live-token")
      expect(serialized).not.toContain("live-password")
      expect(serialized).not.toContain("live-cookie")
      expect(serialized).not.toContain("sk-param-secret")
      expect(serialized).not.toContain("/Users/example/live")
      expect(serialized).not.toContain("/Users/example/prompt")
      expect(serialized).not.toContain("/Users/example/params")
    }
    expect(liveStatus).toEqual(expect.objectContaining({
      params: {
        apiKey: "[redacted]",
        note: "Bearer [redacted] at [path]",
      },
      nodeResults: {
        "codex-1": expect.objectContaining({
          input: {
            variables: {
              apiToken: "[key]",
              note: "Authorization=[redacted] [redacted] at [path]",
            },
            prompt: "prompt password=[redacted] at [path]",
          },
          output: "stdout token=[redacted] at [path]",
          outputs: expect.objectContaining({
            finalMessage: "Cookie=[redacted]",
            codexDebug: expect.objectContaining({
              promptPreview: "Bearer [redacted]",
              stdoutPath: "/Users/example/stdout.txt",
            }),
          }),
        }),
      },
    }))
    expect(snapshots.save).toHaveBeenCalledWith(expect.objectContaining({
      nodeResults: expect.objectContaining({
        "codex-1": expect.objectContaining({
          output: "stdout token=[redacted] at [path]",
        }),
      }),
    }))
  })

  it("passes triggerSource to engine.run for each IPC entry point", async () => {
    const eventBus = { emit: vi.fn() }
    const snapshots = { save: vi.fn(async () => undefined) }
    const workflow = { get: vi.fn(async () => workflowDefinition()) }
    const engine = { run: vi.fn(async () => undefined) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return eventBus as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return new Map<string, WorkflowRunStatus>() as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    // workflow:run → "renderer"
    await harness.invoke("synapse:workflow:run", { id: "workflow-1", params: {} })
    expect(engine.run).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), undefined,
      "renderer", expect.anything(),
    )

    // workflow:runDefinition → "editor-run-definition"
    await harness.invoke("synapse:workflow:run-definition", {
      definition: workflowDefinition(),
      params: {},
    })
    expect(engine.run).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), undefined,
      "editor-run-definition", expect.anything(),
    )

    // workflow:rerun → "rerun"
    const runStatuses = new Map<string, WorkflowRunStatus>()
    runStatuses.set("previous-run", {
      runId: "previous-run",
      workflowId: "workflow-1",
      status: "completed",
      nodeResults: {},
      startedAt: 1,
      endedAt: 2,
      definition: workflowDefinition(),
    })
    const harness2 = createInMemoryHarness()
    const resolve2: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return eventBus as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness2.registry.register(workflowIpcModule, { moduleId: "workflow", resolve: resolve2 })
    await harness2.invoke("synapse:workflow:rerun", { previousRunId: "previous-run", params: {} })
    expect(engine.run).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), undefined,
      "rerun", expect.anything(),
    )
  })

  it("blocks force runDefinition when the active run does not finish after abort timeout", async () => {
    vi.useFakeTimers()
    let finishActiveRun: (() => void) | undefined
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const abortMap = new Map<string, AbortController>()
    const eventBus = { emit: vi.fn() }
    const snapshots = { save: vi.fn(async () => undefined) }
    const workflow = { get: vi.fn(async () => workflowDefinition()) }
    const engine = {
      run: vi.fn(() => new Promise<void>((resolve) => {
        finishActiveRun = resolve
      })),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return eventBus as T
      if (serviceId === "core.workflow.run-aborts") return abortMap as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      const firstRun = await harness.invoke("synapse:workflow:run", { id: "workflow-1", params: {} })
      const forceRun = harness.invoke("synapse:workflow:run-definition", {
        definition: workflowDefinition(),
        params: {},
        force: true,
      })

      await vi.advanceTimersByTimeAsync(5_000)

      expect(firstRun).toEqual({ runId: expect.any(String) })
      await expect(forceRun).resolves.toEqual({
        errors: [{ type: "invalid_config", message: "旧运行仍在后台执行，请等待取消完成后再重新运行" }],
      })
      expect(engine.run).toHaveBeenCalledTimes(1)
    } finally {
      finishActiveRun?.()
      await Promise.resolve()
      vi.useRealTimers()
    }
  })

  it("blocks force rerun when the active run does not finish after abort timeout", async () => {
    vi.useFakeTimers()
    let finishActiveRun: (() => void) | undefined
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const abortMap = new Map<string, AbortController>()
    const eventBus = { emit: vi.fn() }
    const snapshots = { save: vi.fn(async () => undefined), findByRunId: vi.fn(async () => null) }
    const workflow = { get: vi.fn(async () => workflowDefinition()) }
    const engine = {
      run: vi.fn(() => new Promise<void>((resolve) => {
        finishActiveRun = resolve
      })),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return eventBus as T
      if (serviceId === "core.workflow.run-aborts") return abortMap as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      const firstRun = await harness.invoke("synapse:workflow:run", { id: "workflow-1", params: {} })
      const previousRunId = (firstRun as { runId: string }).runId
      const forceRerun = harness.invoke("synapse:workflow:rerun", {
        previousRunId,
        params: {},
        force: true,
      })

      await vi.advanceTimersByTimeAsync(5_000)

      await expect(forceRerun).resolves.toEqual({
        errors: [{ type: "invalid_config", message: "旧运行仍在后台执行，请等待取消完成后再重新运行" }],
      })
      expect(engine.run).toHaveBeenCalledTimes(1)
    } finally {
      finishActiveRun?.()
      await Promise.resolve()
      vi.useRealTimers()
    }
  })

  it("logs rerun conflicts and successful rerun starts", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const rerunDefinition: WorkflowDefinition = {
      ...workflowDefinition(),
      params: [{ name: "q", type: "text", default: null }],
    }
    runStatuses.set("previous-run", {
      runId: "previous-run",
      workflowId: "workflow-1",
      status: "completed",
      nodeResults: {},
      startedAt: 1,
      endedAt: 2,
      params: { q: "previous" },
      definition: rerunDefinition,
    })
    runStatuses.set("active-run", {
      runId: "active-run",
      workflowId: "workflow-1",
      status: "running",
      nodeResults: {},
      startedAt: 3,
      definition: rerunDefinition,
    })
    const eventBus = { emit: vi.fn() }
    const snapshots = { save: vi.fn(async () => undefined), findByRunId: vi.fn(async () => null) }
    const engine = { run: vi.fn(async () => undefined) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return eventBus as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const conflict = await harness.invoke("synapse:workflow:rerun", {
      previousRunId: "previous-run",
      params: {},
    })
    expect(conflict).toEqual({ conflict: true, activeRunId: "active-run" })
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("workflow:rerun conflict", {
      workflowId: "workflow-1",
      activeRunId: "active-run",
    })

    runStatuses.delete("active-run")
    const started = await harness.invoke("synapse:workflow:rerun", {
      previousRunId: "previous-run",
      params: {},
    })
    const runId = (started as { runId: string }).runId

    expect(started).toEqual({ runId })
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("workflow:rerun started", {
      previousRunId: "previous-run",
      workflowId: "workflow-1",
      runId,
      nodeCount: 0,
    })
  })

  it("uses the current workflow definition when rerun history has redacted Code X config overrides", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const snapshotDefinition = {
      ...codexWorkflowDefinition("[redacted]"),
      params: [{ name: "topic", type: "text", default: null }],
    }
    const currentDefinition = {
      ...codexWorkflowDefinition("reasoning.effort=high"),
      params: [{ name: "topic", type: "text", default: null }],
    }
    const snapshots = {
      save: vi.fn(async () => undefined),
      findByRunId: vi.fn(async () => ({
        runId: "previous-run",
        workflowId: "workflow-1",
        version: "v1",
        status: "completed" as const,
        startedAt: 1,
        endedAt: 2,
        params: { topic: "from-history" },
        nodeResults: {},
        definition: snapshotDefinition,
      })),
    }
    const workflow = { get: vi.fn(async () => currentDefinition) }
    const engine = { run: vi.fn(async () => undefined) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return { emit: vi.fn() } as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:rerun", { previousRunId: "previous-run", params: {} })

    expect(result).toEqual({ runId: expect.any(String) })
    expect(workflow.get).toHaveBeenCalledWith("workflow-1")
    const executedDefinition = (engine.run.mock.calls[0] as unknown[] | undefined)?.[0] as ReturnType<typeof codexWorkflowDefinition> | undefined
    expect(executedDefinition).toBeDefined()
    expect(executedDefinition!.nodes[0].config.configOverrides).toEqual([
      { key: "model_reasoning_effort", value: "reasoning.effort=high" },
    ])
    expect(engine.run).toHaveBeenCalledWith(
      currentDefinition,
      { topic: "from-history" },
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      "rerun",
      expect.anything(),
    )
  })

  it("blocks rerun when only a redacted Code X history definition is available", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const snapshots = {
      save: vi.fn(async () => undefined),
      findByRunId: vi.fn(async () => ({
        runId: "previous-run",
        workflowId: "workflow-1",
        version: "v1",
        status: "completed" as const,
        startedAt: 1,
        endedAt: 2,
        params: {},
        nodeResults: {},
        definition: codexWorkflowDefinition("[redacted]"),
      })),
    }
    const workflow = { get: vi.fn(async () => null) }
    const engine = { run: vi.fn(async () => undefined) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return { emit: vi.fn() } as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:rerun", { previousRunId: "previous-run", params: {} })

    expect(result).toEqual({
      errors: [{
        type: "invalid_config",
        message: "历史运行记录中的 Code X 配置已脱敏，无法直接重新运行。请从当前工作流重新运行，或恢复原始配置后再试。",
      }],
    })
    expect(workflow.get).toHaveBeenCalledWith("workflow-1")
    expect(engine.run).not.toHaveBeenCalled()
  })

  it("blocks rerun when the history definition cannot be migrated", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const snapshots = {
      findByRunId: vi.fn(async () => ({
        runId: "previous-run",
        workflowId: "workflow-1",
        version: "v2",
        status: "completed" as const,
        startedAt: 1,
        endedAt: 2,
        params: {},
        nodeResults: {},
        definitionMigration: {
          kind: "unsupported_future" as const,
          sourceVersion: "2.0.0",
          targetVersion: "1.0.0",
        },
      })),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:rerun", { previousRunId: "previous-run", params: {} })

    expect(result).toEqual({
      errors: [{
        type: "invalid_config",
        message: "该运行记录由较新版本创建，当前版本无法重新运行",
      }],
    })
  })

  it("blocks rerun when only a redacted HTTP or script history definition is available", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const snapshots = {
      save: vi.fn(async () => undefined),
      findByRunId: vi.fn(async () => ({
        runId: "previous-run",
        workflowId: "workflow-1",
        version: "v1",
        status: "completed" as const,
        startedAt: 1,
        endedAt: 2,
        params: {},
        nodeResults: {},
        definition: redactedHttpAndScriptWorkflowDefinition(),
      })),
    }
    const workflow = { get: vi.fn(async () => null) }
    const engine = { run: vi.fn(async () => undefined) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return { emit: vi.fn() } as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:rerun", { previousRunId: "previous-run", params: {} })

    expect(result).toEqual({
      errors: [{
        type: "invalid_config",
        message: "历史运行记录中的工作流配置已脱敏，无法直接重新运行。请从当前工作流重新运行，或恢复原始配置后再试。",
      }],
    })
    expect(workflow.get).toHaveBeenCalledWith("workflow-1")
    expect(engine.run).not.toHaveBeenCalled()
  })

  it("uses the current workflow definition when rerun history has redacted HTTP or script config", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const currentDefinition = httpAndScriptWorkflowDefinition("raw-bearer-token", "raw-script-token")
    const snapshots = {
      save: vi.fn(async () => undefined),
      findByRunId: vi.fn(async () => ({
        runId: "previous-run",
        workflowId: "workflow-1",
        version: "v1",
        status: "completed" as const,
        startedAt: 1,
        endedAt: 2,
        params: {},
        nodeResults: {},
        definition: redactedHttpAndScriptWorkflowDefinition(),
      })),
    }
    const workflow = { get: vi.fn(async () => currentDefinition) }
    const engine = { run: vi.fn(async () => undefined) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return { emit: vi.fn() } as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:rerun", { previousRunId: "previous-run", params: {} })

    expect(result).toEqual({ runId: expect.any(String) })
    expect(workflow.get).toHaveBeenCalledWith("workflow-1")
    expect(engine.run).toHaveBeenCalledWith(
      currentDefinition,
      {},
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      "rerun",
      expect.anything(),
    )
  })

  it("blocks workflow delete when the active run does not finish after abort timeout", async () => {
    vi.useFakeTimers()
    let finishActiveRun: (() => void) | undefined
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const abortMap = new Map<string, AbortController>()
    const eventBus = { emit: vi.fn() }
    const snapshots = { save: vi.fn(async () => undefined), deleteWorkflow: vi.fn(async () => undefined) }
    const windowManager = { forceCloseAll: vi.fn() }
    const workflow = {
      get: vi.fn(async () => workflowDefinition()),
      delete: vi.fn(async () => undefined),
    }
    const engine = {
      run: vi.fn(() => new Promise<void>((resolve) => {
        finishActiveRun = resolve
      })),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.workflow.window-manager") return windowManager as T
      if (serviceId === "core.event-bus") return eventBus as T
      if (serviceId === "core.workflow.run-aborts") return abortMap as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      await harness.invoke("synapse:workflow:run", { id: "workflow-1", params: {} })
      const deleteRequest = harness.invoke("synapse:workflow:delete", { id: "workflow-1" })
      const deleteExpectation = expect(deleteRequest).rejects.toThrow("旧运行仍在后台执行，请等待取消完成后再删除工作流")

      await vi.advanceTimersByTimeAsync(5_000)

      await deleteExpectation
      expect(workflow.delete).not.toHaveBeenCalled()
      expect(snapshots.deleteWorkflow).not.toHaveBeenCalled()
      expect(windowManager.forceCloseAll).not.toHaveBeenCalled()
      expect(engine.run).toHaveBeenCalledTimes(1)
    } finally {
      finishActiveRun?.()
      await Promise.resolve()
      vi.useRealTimers()
    }
  })

  it("does not infer a run project from configured projects when workflow has no default project", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [{
        uuid: "repo-1",
        name: "Content Repo",
        localPath: "/repo",
        contentDirs: {},
      }],
      activeRepoUuid: "repo-1",
      global: {
        themeMode: "system",
        projects: [{
          id: "agent-project-1",
          name: "Agent Project",
          path: "/agent-project",
        }],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
    } as never)
    const eventBus = { emit: vi.fn() }
    const snapshots = { save: vi.fn(async () => undefined) }
    const engine = { run: vi.fn(async () => undefined) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.event-bus") return eventBus as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return new Map<string, WorkflowRunStatus>() as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    await harness.invoke("synapse:workflow:run-definition", {
      definition: workflowDefinition(),
      params: {},
    })

    expect(engine.run).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), undefined,
      "editor-run-definition",
      expect.anything(),
    )
  })

  it("prefills new workflows with the first configured Agent project", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [{
        uuid: "repo-1",
        name: "Content Repo",
        localPath: "/repo",
        contentDirs: {},
      }],
      activeRepoUuid: "repo-1",
      global: {
        themeMode: "system",
        projects: [{
          id: "agent-project-1",
          name: "Agent Project",
          path: "/agent-project",
        }],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
      agent: {
        defaultPermissionMode: "default",
        defaultProviderModel: null,
      },
    } as never)
    const workflow = { create: vi.fn(async () => ({ id: "workflow-1", versionHash: "v_1" })) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    await harness.invoke("synapse:workflow:create", undefined)

    expect(workflow.create).toHaveBeenCalledWith("agent-project-1", undefined)
  })

  it("prefills new workflows with the configured default provider model", async () => {
    vi.mocked(configStore.load).mockResolvedValue({
      repositories: [{
        uuid: "repo-1",
        name: "Content Repo",
        localPath: "/repo",
        contentDirs: {},
      }],
      activeRepoUuid: "repo-1",
      global: {
        themeMode: "system",
        projects: [],
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
      },
      agent: {
        defaultPermissionMode: "default",
        defaultProviderModel: { providerId: "provider-1", modelTier: "sonnet" },
      },
    } as never)
    const workflow = { create: vi.fn(async () => ({ id: "workflow-1", versionHash: "v_1" })) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    await harness.invoke("synapse:workflow:create", undefined)

    expect(workflow.create).toHaveBeenCalledWith(undefined, { providerId: "provider-1", modelTier: "sonnet" })
  })

  it("preserves full validation error fields through workflow IPC responses", async () => {
    const workflow = {
      create: vi.fn(async () => ({
        errors: [{
          type: "invalid_config",
          nodeId: "node-1",
          nodeName: "Prompt node",
          edgeId: "edge-1",
          field: "config.prompt",
          message: "Prompt is required",
          retryable: true,
          details: { minimumLength: 1 },
        }],
      })),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:create", undefined)

    expect(result).toEqual({
      errors: [{
        type: "invalid_config",
        nodeId: "node-1",
        nodeName: "Prompt node",
        edgeId: "edge-1",
        field: "config.prompt",
        message: "Prompt is required",
        retryable: true,
        details: { minimumLength: 1 },
      }],
    })
  })

  it("returns resource-default errors from workflow validation", async () => {
    const validationResult = {
      valid: false,
      errors: [{ type: "invalid_config" as const, message: "参数「inputs」第 2 项与前面的资源重复" }],
      warnings: [],
    }
    vi.mocked(validateWorkflowWithResourceDefaults).mockResolvedValueOnce(validationResult)
    const workflow = { list: vi.fn(async () => []) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })
    const definition = workflowDefinition()

    const result = await harness.invoke("synapse:workflow:validate", definition)

    expect(result).toEqual(validationResult)
    expect(validateWorkflowWithResourceDefaults).toHaveBeenCalledWith(
      definition,
      expect.objectContaining({ configuredProjectIds: ["project-1"] }),
    )
  })

  it("logs cancel signal only when an active AbortController exists, warns otherwise", async () => {
    const abortMap = new Map<string, AbortController>()
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.run-aborts") return abortMap as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    // Case 1: cancel a run that has no active AbortController
    await harness.invoke("synapse:workflow:cancel", { runId: "no-such-run" })
    expect(logStoreMock.logger.warn).toHaveBeenCalledWith(
      "workflow:cancel — no active run to cancel",
      { runId: "no-such-run" },
    )
    expect(logStoreMock.logger.info).not.toHaveBeenCalledWith(
      "workflow:cancel signal sent",
      expect.anything(),
    )

    // Case 2: cancel a run that has an active AbortController
    const ac = new AbortController()
    abortMap.set("active-run", ac)
    await harness.invoke("synapse:workflow:cancel", { runId: "active-run" })
    expect(logStoreMock.logger.info).toHaveBeenCalledWith(
      "workflow:cancel signal sent",
      { runId: "active-run" },
    )
    expect(ac.signal.aborted).toBe(true)
  })

  it("rejects unsafe run ids before cancelling workflow runs", async () => {
    const abortMap = new Map<string, AbortController>()
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.run-aborts") return abortMap as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    await expect(harness.invoke("synapse:workflow:cancel", { runId: "../escaped-run" }))
      .rejects
      .toThrow()
    expect(abortMap.size).toBe(0)
  })

  it("uses the packaged renderer file URL when opening workflow windows outside dev mode", async () => {
    const previousDevServerUrl = process.env.VITE_DEV_SERVER_URL
    delete process.env.VITE_DEV_SERVER_URL
    const expectedBaseUrl = pathToFileURL(path.join(electronMock.app.getAppPath(), "dist/index.html")).toString()
    const windowManager = {
      open: vi.fn(async () => undefined),
      openRunner: vi.fn(async () => undefined),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.window-manager") return windowManager as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      await harness.invoke("synapse:workflow:open-editor", { id: "workflow-1" })
      await harness.invoke("synapse:workflow:open-runner", { workflowId: "workflow-1", runId: "run-1" })

      expect(windowManager.open).toHaveBeenCalledWith("workflow-1", expectedBaseUrl, undefined)
      expect(windowManager.openRunner).toHaveBeenCalledWith("workflow-1", "run-1", expectedBaseUrl)
    } finally {
      if (previousDevServerUrl === undefined) {
        delete process.env.VITE_DEV_SERVER_URL
      } else {
        process.env.VITE_DEV_SERVER_URL = previousDevServerUrl
      }
    }
  })

  it("logs workflow package imports at the IPC boundary", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workflow-import-test-"))
    const packagePath = path.join(tempRoot, "shared.synapse-workflow.json")
    const packageData = {
      format: "synapse-workflow-package-v1",
      exportedAt: "2026-05-26T00:00:00.000Z",
      workflow: workflowDefinition(),
      modelReferences: [],
    }
    await writeFile(packagePath, `${JSON.stringify(packageData)}\n`, "utf8")
    const packageService = { importPackage: vi.fn(async () => ({ workflowId: "workflow-imported", versionHash: "v-imported" })) }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      const result = await harness.invoke("synapse:workflow:import-package", { packagePath, mappings: [] })

      expect(result).toEqual({ workflowId: "workflow-imported", versionHash: "v-imported" })
      expect(logStoreMock.logger.info).toHaveBeenCalledWith("workflow:importPackage requested", {
        fileBase: "shared.synapse-workflow.json",
        mappingCount: 0,
      })
      expect(logStoreMock.logger.info).toHaveBeenCalledWith("workflow:importPackage succeeded", {
        fileBase: "shared.synapse-workflow.json",
        workflowId: "workflow-imported",
        versionHash: "v-imported",
      })
      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "workflow.mutate",
        outcome: "allowed",
        resource: "workflow-imported",
        metadata: {
          fileBase: "shared.synapse-workflow.json",
          source: "workflow.importPackage",
          versionHash: "v-imported",
        },
      }))
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("rejects workflow package import when the confirmed file differs from the inspected package", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workflow-import-digest-test-"))
    const packagePath = path.join(tempRoot, "shared.synapse-workflow.json")
    const inspectedPackage = {
      format: "synapse-workflow-package-v1",
      exportedAt: "2026-05-26T00:00:00.000Z",
      workflow: { ...workflowDefinition(), id: "workflow-inspected", name: "Inspected workflow" },
      modelReferences: [],
    }
    const replacementPackage = {
      format: "synapse-workflow-package-v1",
      exportedAt: "2026-05-26T00:01:00.000Z",
      workflow: { ...workflowDefinition(), id: "workflow-replacement", name: "Replacement workflow" },
      modelReferences: [],
    }
    const inspectedRaw = `${JSON.stringify(inspectedPackage)}\n`
    const inspectedDigest = `sha256:${createHash("sha256").update(inspectedRaw).digest("hex")}`
    await writeFile(packagePath, inspectedRaw, "utf8")
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [packagePath] })
    const packageService = {
      buildImportPreview: vi.fn(async (selectedPath: string, pkg: typeof inspectedPackage, packageDigest: string) => ({
        packagePath: selectedPath,
        packageDigest,
        workflow: {
          id: pkg.workflow.id,
          name: pkg.workflow.name,
          nodeCount: pkg.workflow.nodes.length,
          modelReferenceCount: pkg.modelReferences.length,
          requiresProjectMapping: false,
        },
        modelReferences: pkg.modelReferences,
        providerOptions: [],
        suggestedMappings: [],
      })),
      importPackage: vi.fn(async () => ({ workflowId: "workflow-imported", versionHash: "v-imported" })),
    }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      const preview = await harness.invoke("synapse:workflow:inspect-import-package", undefined)
      expect(preview).toEqual(expect.objectContaining({ packageDigest: inspectedDigest }))

      await writeFile(packagePath, `${JSON.stringify(replacementPackage)}\n`, "utf8")

      await expect(harness.invoke("synapse:workflow:import-package", {
        packagePath,
        packageDigest: inspectedDigest,
        mappings: [],
      })).rejects.toThrow("工作流包已变化，请重新选择文件。")

      expect(packageService.importPackage).not.toHaveBeenCalled()
      expect(logStoreMock.logger.warn).toHaveBeenCalledWith("workflow:importPackage digest mismatch", {
        fileBase: "shared.synapse-workflow.json",
        mappingCount: 0,
      })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("audits invalid workflow package schema failures during inspect", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workflow-inspect-invalid-test-"))
    const packagePath = path.join(tempRoot, "invalid.synapse-workflow.json")
    await writeFile(packagePath, `${JSON.stringify({ format: "not-a-workflow-package", secret: "package-secret" })}\n`, "utf8")
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [packagePath] })
    const packageService = { buildImportPreview: vi.fn() }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      await expect(harness.invoke("synapse:workflow:inspect-import-package", undefined))
        .rejects
        .toThrow("工作流包格式无效。")

      expect(packageService.buildImportPreview).not.toHaveBeenCalled()
      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.read.outside-userdata",
        outcome: "failed",
        resource: packagePath,
        metadata: expect.objectContaining({
          source: "workflow.inspectImportPackage",
          errorName: "ZodError",
          errorLength: expect.any(Number),
        }),
      }))
      expect(logStoreMock.logger.warn).toHaveBeenCalledWith("workflow:inspectImportPackage schema validation failed", {
        fileBase: "invalid.synapse-workflow.json",
        errorName: "ZodError",
        errorLength: expect.any(Number),
      })
      expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("package-secret")
      expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("package-secret")
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("validates the workflow payload before reading its id during import preview", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workflow-inspect-invalid-payload-test-"))
    const packagePath = path.join(tempRoot, "invalid-workflow.synapse-workflow.json")
    const packageData = {
      format: "synapse-workflow-package-v1",
      exportedAt: "2026-05-26T00:00:00.000Z",
      workflow: null,
      modelReferences: [],
    }
    await writeFile(packagePath, `${JSON.stringify(packageData)}\n`, "utf8")
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [packagePath] })
    const packageError = new Error("Invalid workflow package workflow")
    const packageService = { buildImportPreview: vi.fn(async () => { throw packageError }) }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      await expect(harness.invoke("synapse:workflow:inspect-import-package", undefined))
        .rejects
        .toThrow("Invalid workflow package workflow")

      expect(packageService.buildImportPreview).toHaveBeenCalledWith(
        packagePath,
        expect.objectContaining({ workflow: null }),
        expect.stringMatching(/^sha256:/),
      )
      expect(logStoreMock.logger.info).toHaveBeenCalledWith("workflow:inspectImportPackage requested", {
        fileBase: "invalid-workflow.synapse-workflow.json",
        modelReferenceCount: 0,
      })
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("audits invalid workflow package schema failures during import", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workflow-import-invalid-test-"))
    const packagePath = path.join(tempRoot, "invalid.synapse-workflow.json")
    await writeFile(packagePath, `${JSON.stringify({ format: "not-a-workflow-package", secret: "package-secret" })}\n`, "utf8")
    const packageService = { importPackage: vi.fn() }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      await expect(harness.invoke("synapse:workflow:import-package", { packagePath, mappings: [] }))
        .rejects
        .toThrow("工作流包格式无效。")

      expect(packageService.importPackage).not.toHaveBeenCalled()
      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.read.outside-userdata",
        outcome: "failed",
        resource: packagePath,
        metadata: expect.objectContaining({
          source: "workflow.importPackage",
          errorName: "ZodError",
          errorLength: expect.any(Number),
        }),
      }))
      expect(logStoreMock.logger.warn).toHaveBeenCalledWith("workflow:importPackage schema validation failed", {
        fileBase: "invalid.synapse-workflow.json",
        mappingCount: 0,
        errorName: "ZodError",
        errorLength: expect.any(Number),
      })
      expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("package-secret")
      expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("package-secret")
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("rejects oversized workflow package files during inspect before preview", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workflow-inspect-huge-test-"))
    const packagePath = path.join(tempRoot, "huge.synapse-workflow.json")
    await writeFile(packagePath, " ".repeat(1024 * 1024 + 1), "utf8")
    electronMock.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [packagePath] })
    const packageService = { buildImportPreview: vi.fn() }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      await expect(harness.invoke("synapse:workflow:inspect-import-package", undefined))
        .rejects
        .toThrow("工作流包文件过大。")

      expect(packageService.buildImportPreview).not.toHaveBeenCalled()
      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.read.outside-userdata",
        outcome: "failed",
        resource: packagePath,
        metadata: expect.objectContaining({
          source: "workflow.inspectImportPackage",
          errorName: "Error",
        }),
      }))
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("rejects oversized workflow package files during import before package import", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workflow-import-huge-test-"))
    const packagePath = path.join(tempRoot, "huge.synapse-workflow.json")
    await writeFile(packagePath, " ".repeat(1024 * 1024 + 1), "utf8")
    const packageService = { importPackage: vi.fn() }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      if (serviceId === "core.permission-guard") return permissionGuard as T
      if (serviceId === "core.audit-sink") return auditSink as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      await expect(harness.invoke("synapse:workflow:import-package", { packagePath, mappings: [] }))
        .rejects
        .toThrow("工作流包文件过大。")

      expect(packageService.importPackage).not.toHaveBeenCalled()
      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.read.outside-userdata",
        outcome: "failed",
        resource: packagePath,
        metadata: expect.objectContaining({
          source: "workflow.importPackage",
          errorName: "Error",
        }),
      }))
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("records audit after workflow package export writes the selected file", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workflow-export-test-"))
    const targetPath = path.join(tempRoot, "workflow.synapse-workflow.json")
    electronMock.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: targetPath })
    const permissionGuard = { check: vi.fn<PermissionGuard["check"]>(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn<AuditSink["record"]>() }
    const packageService = createExportPackageService(
      { kind: "current", document: workflowDefinition() },
      permissionGuard,
      auditSink,
    )
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      const result = await harness.invoke("synapse:workflow:export-package", {
        workflowId: "workflow-1",
        workflowName: "Workflow",
      })

      expect(result).toEqual({ path: targetPath, kind: "package" })
      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.write",
        outcome: "allowed",
        resource: targetPath,
        metadata: {
          source: "workflow.exportPackage.write",
          workflowId: "workflow-1",
          exportKind: "package",
        },
      }))
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("writes future workflows as protected raw documents instead of packages", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workflow-future-export-test-"))
    const targetPath = path.join(tempRoot, "future.synapse-workflow-future.json")
    const futureDocument = {
      id: "workflow-future",
      name: "Future Workflow",
      meta: { schemaVersion: "9.0.0" },
      futureOnly: { preserve: true },
    }
    electronMock.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: targetPath })
    const permissionGuard = { check: vi.fn<PermissionGuard["check"]>(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn<AuditSink["record"]>() }
    const packageService = createExportPackageService(
      {
        kind: "future",
        document: futureDocument,
        sourceVersion: "9.0.0",
      },
      permissionGuard,
      auditSink,
    )
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    try {
      const result = await harness.invoke("synapse:workflow:export-package", {
        workflowId: futureDocument.id,
        workflowName: futureDocument.name,
      })

      expect(result).toEqual({ path: targetPath, kind: "future-raw" })
      expect(JSON.parse(await readFile(targetPath, "utf8"))).toEqual(futureDocument)
      expect(await readFile(targetPath, "utf8")).not.toContain("synapse-workflow-package")
      expect(electronMock.dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
        title: "导出未来版本工作流原文",
        defaultPath: "Future Workflow.synapse-workflow-future.json",
      }))
      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.write",
        outcome: "allowed",
        resource: targetPath,
        metadata: {
          source: "workflow.exportRawDocument.write",
          workflowId: futureDocument.id,
          exportKind: "future-raw",
          sourceVersion: "9.0.0",
        },
      }))
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it("uses a Windows-safe default file name for workflow package export", async () => {
    electronMock.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    const packageService = createExportPackageService(
      { kind: "current", document: { ...workflowDefinition(), name: "CON" } },
      { check: vi.fn<PermissionGuard["check"]>(async () => ({ allowed: true })) },
      { record: vi.fn<AuditSink["record"]>() },
    )
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:export-package", {
      workflowId: "workflow-1",
      workflowName: "CON",
    })

    expect(result).toBeNull()
    expect(electronMock.dialog.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "_CON.synapse-workflow.json",
    }))
  })

  it("blocks workflow:run when the workflow already has an active run", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    runStatuses.set("active-run", {
      runId: "active-run",
      workflowId: "workflow-1",
      status: "running",
      nodeResults: {},
      startedAt: 1,
      definition: workflowDefinition(),
    })
    const workflow = { get: vi.fn(async () => workflowDefinition()) }
    const engine = { run: vi.fn() }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return { save: vi.fn() } as T
      if (serviceId === "core.event-bus") return { emit: vi.fn() } as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:run", { id: "workflow-1", params: {} })

    expect(result).toEqual({ errors: [{ type: "invalid_config", message: "已有运行中的实例，请先取消或等待完成" }] })
    expect(engine.run).not.toHaveBeenCalled()
  })

  it("preserves node usage through workflow run-status IPC validation", async () => {
    const usage = {
      input_tokens: 10,
      output_tokens: 2,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 4,
    }
    const usageCost = {
      modelName: "claude-sonnet-4",
      costCny: 0.08,
      costBreakdownCny: {
        input: 0.01,
        output: 0.02,
        cacheRead: 0.03,
        cacheWrite: 0.01,
        reasoning: 0.01,
      },
      costCurrency: "CNY" as const,
      priceKnown: true,
      estimatedCost: true,
    }
    const runStatuses = new Map<string, WorkflowRunStatus>()
    runStatuses.set("run-usage", {
      runId: "run-usage",
      workflowId: "workflow-1",
      status: "completed",
      nodeResults: {
        "node-1": {
          nodeId: "node-1",
          status: "success",
          input: { variables: {} },
          output: "done",
          usage,
          usageCost,
          costUsd: 0.01,
        },
      },
      startedAt: 1,
      endedAt: 2,
      definition: workflowDefinition(),
    })
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      if (serviceId === "core.workflow.snapshots") return { findByRunId: vi.fn(async () => null) } as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const status = await harness.invoke("synapse:workflow:run-status", { runId: "run-usage" })

    expect(status).toEqual(expect.objectContaining({
      nodeResults: {
        "node-1": expect.objectContaining({ usage, usageCost, costUsd: 0.01 }),
      },
    }))
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("run-status served from memory", {
      runId: "run-usage",
      workflowId: "workflow-1",
      status: "completed",
    })
  })

  it("hydrates snapshot definition migration diagnostics through run-status", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const snapshots = {
      findByRunId: vi.fn(async () => ({
        runId: "run-future",
        workflowId: "workflow-1",
        version: "v2",
        status: "completed" as const,
        startedAt: 1,
        endedAt: 2,
        params: {},
        nodeResults: {},
        definitionMigration: {
          kind: "unsupported_future" as const,
          sourceVersion: "2.0.0",
          targetVersion: "1.0.0",
        },
      })),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const status = await harness.invoke("synapse:workflow:run-status", { runId: "run-future" })

    expect(status).toEqual(expect.objectContaining({
      definition: undefined,
      definitionMigration: {
        kind: "unsupported_future",
        sourceVersion: "2.0.0",
        targetVersion: "1.0.0",
      },
    }))
  })

  it("stores node progress labels in live run status", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const eventBus = { emit: vi.fn() }
    const workflow = { get: vi.fn(async () => workflowDefinition()) }
    const engine = {
      run: vi.fn((_def, _params, runId, emit) => {
        emit({ type: "node:started", runId, nodeId: "node-1", startedAt: 10, result: { nodeId: "node-1", status: "running", input: { variables: {} }, startedAt: 10 } })
        emit({ type: "node:progress", runId, nodeId: "node-1", phase: "work", label: "Working" })
        return new Promise(() => undefined)
      }),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.engine") return engine as T
      if (serviceId === "core.workflow.snapshots") return { save: vi.fn() } as T
      if (serviceId === "core.event-bus") return eventBus as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:run", { id: "workflow-1", params: {} })
    const runId = (result as { runId: string }).runId

    expect(runStatuses.get(runId)?.nodeResults["node-1"]?.progressLabel).toBe("Working")
  })

  it("returns active workflow runs before terminal history snapshots", async () => {
    const activeDefinition = workflowDefinition()
    const runStatuses = new Map<string, WorkflowRunStatus>()
    runStatuses.set("active-run", {
      runId: "active-run",
      workflowId: "workflow-1",
      status: "running",
      nodeResults: {
        "node-1": {
          nodeId: "node-1",
          status: "running",
          input: { variables: {} },
          startedAt: 30,
        },
      },
      startedAt: 30,
      params: { query: "hello" },
      definition: activeDefinition,
    })
    runStatuses.set("other-active-run", {
      runId: "other-active-run",
      workflowId: "workflow-2",
      status: "running",
      nodeResults: {},
      startedAt: 40,
      definition: { ...workflowDefinition(), id: "workflow-2" },
    })
    const snapshots = {
      list: vi.fn(async () => [{
        runId: "terminal-run",
        workflowId: "workflow-1",
        version: "v1",
        status: "completed",
        startedAt: 10,
        endedAt: 20,
        params: {},
        nodeResults: {},
        definitionMigration: { kind: "failed" as const, sourceVersion: "0.9.0" },
      }]),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const history = await harness.invoke("synapse:workflow:run-history", { workflowId: "workflow-1" })

    expect(history).toEqual([
      expect.objectContaining({
        runId: "active-run",
        workflowId: "workflow-1",
        status: "running",
        startedAt: 30,
        params: { query: "hello" },
        definition: activeDefinition,
      }),
      expect.objectContaining({
        runId: "terminal-run",
        workflowId: "workflow-1",
        status: "completed",
        startedAt: 10,
        endedAt: 20,
        definitionMigration: { kind: "failed", sourceVersion: "0.9.0" },
      }),
    ])
    expect(JSON.stringify(history)).not.toContain("other-active-run")
    expect(snapshots.list).toHaveBeenCalledWith("workflow-1", 20)
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("workflow:runHistory", {
      workflowId: "workflow-1",
      count: 2,
      activeCount: 1,
      snapshotCount: 1,
    })
  })

  it("keeps terminal in-memory workflow runs in history until snapshots are available", async () => {
    const definition = workflowDefinition()
    const runStatuses = new Map<string, WorkflowRunStatus>()
    runStatuses.set("completed-run", {
      runId: "completed-run",
      workflowId: "workflow-1",
      status: "completed",
      nodeResults: {},
      startedAt: 10,
      endedAt: 25,
      durationMs: 15,
      params: { query: "done" },
      definition,
    })
    const snapshots = { list: vi.fn(async () => []) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const history = await harness.invoke("synapse:workflow:run-history", { workflowId: "workflow-1" })

    expect(history).toEqual([
      expect.objectContaining({
        runId: "completed-run",
        status: "completed",
        startedAt: 10,
        endedAt: 25,
        durationMs: 15,
        params: { query: "done" },
        definition,
      }),
    ])
  })

  it("rejects unsafe workflow ids before reading run history snapshots", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const snapshots = { list: vi.fn(async () => []) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    await expect(harness.invoke("synapse:workflow:run-history", { workflowId: "../escaped-workflow" }))
      .rejects
      .toThrow()
    expect(snapshots.list).not.toHaveBeenCalled()
  })

  it("rejects unsafe run ids before reading run status snapshots", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const snapshots = { findByRunId: vi.fn(async () => null) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    await expect(harness.invoke("synapse:workflow:run-status", { runId: "../escaped-run" }))
      .rejects
      .toThrow()
    expect(snapshots.findByRunId).not.toHaveBeenCalled()
  })

  it("lists all active workflow runs and excludes terminal in-memory statuses", async () => {
    const runStatuses = new Map<string, WorkflowRunStatus>()
    runStatuses.set("active-run", {
      runId: "active-run",
      workflowId: "workflow-1",
      status: "running",
      nodeResults: {},
      startedAt: 30,
      definition: workflowDefinition(),
    })
    runStatuses.set("completed-run", {
      runId: "completed-run",
      workflowId: "workflow-1",
      status: "completed",
      nodeResults: {},
      startedAt: 10,
      endedAt: 20,
      definition: workflowDefinition(),
    })
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.run-statuses") return runStatuses as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const activeRuns = await harness.invoke("synapse:workflow:active-runs", undefined)

    expect(activeRuns).toEqual([
      expect.objectContaining({
        runId: "active-run",
        workflowId: "workflow-1",
        status: "running",
      }),
    ])
    expect(JSON.stringify(activeRuns)).not.toContain("completed-run")
  })

  it("emits a workflow-delete source after deleting a definition", async () => {
    const eventBus = { emit: vi.fn() }
    const workflow = { delete: vi.fn(async () => undefined) }
    const snapshots = { deleteWorkflow: vi.fn(async () => undefined) }
    const windowManager = { forceCloseAll: vi.fn() }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.snapshots") return snapshots as T
      if (serviceId === "core.workflow.window-manager") return windowManager as T
      if (serviceId === "core.event-bus") return eventBus as T
      if (serviceId === "core.workflow.run-aborts") return new Map<string, AbortController>() as T
      if (serviceId === "core.workflow.run-statuses") return new Map<string, WorkflowRunStatus>() as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    await harness.invoke("synapse:workflow:delete", { id: "workflow-1" })

    expect(workflow.delete).toHaveBeenCalledWith("workflow-1")
    expect(snapshots.deleteWorkflow).toHaveBeenCalledWith("workflow-1")
    expect(windowManager.forceCloseAll).toHaveBeenCalledWith("workflow-1")
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
      domain: "workflow",
      type: "workflow:definition-updated",
      payload: { workflowId: "workflow-1", source: "workflow-delete" },
    }))
  })

  it("exposes workflow parameter preset IPC without logging values", async () => {
    const presets = {
      list: vi.fn(async () => [{ id: "preset-1", workflowId: "workflow-1", name: "课程", values: { topic: "secret text" }, resourceEntryTypes: {}, createdAt: 1, updatedAt: 2 }]),
      save: vi.fn(async (input: unknown) => ({ id: "preset-2", workflowId: "workflow-1", name: "新预设", values: (input as { values: Record<string, string> }).values, resourceEntryTypes: {}, createdAt: 3, updatedAt: 3 })),
      delete: vi.fn(async () => undefined),
    }
    const workflow = {
      get: vi.fn(async () => ({
        ...workflowDefinition(),
        params: [{ name: "topic", type: "text", default: "" }],
      })),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.param-presets") return presets as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    await expect(harness.invoke("synapse:workflow:param-presets:list", { workflowId: "workflow-1" }))
      .resolves.toEqual([expect.objectContaining({ id: "preset-1", values: { topic: "secret text" } })])
    await expect(harness.invoke("synapse:workflow:param-presets:save", {
      workflowId: "workflow-1",
      name: "新预设",
      values: { topic: "secret text" },
    })).resolves.toEqual(expect.objectContaining({ id: "preset-2" }))
    await expect(harness.invoke("synapse:workflow:param-presets:delete", { id: "preset-2" }))
      .resolves.toBeUndefined()

    expect(presets.list).toHaveBeenCalledWith("workflow-1")
    expect(presets.save).toHaveBeenCalledWith({ workflowId: "workflow-1", name: "新预设", values: { topic: "secret text" } })
    expect(presets.delete).toHaveBeenCalledWith("preset-2")
    expect(JSON.stringify(logStoreMock.logger.info.mock.calls)).not.toContain("secret text")
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("secret text")
  })

  it("rejects invalid resource params before saving a workflow preset", async () => {
    const missingDirectory = path.join(tmpdir(), `synapse-missing-preset-${Date.now()}`)
    const workflow = {
      get: vi.fn(async () => ({
        ...workflowDefinition(),
        params: [{ name: "workspace", type: "directory", default: null }],
      })),
    }
    const presets = { save: vi.fn() }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow") return workflow as T
      if (serviceId === "core.workflow.param-presets") return presets as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    await expect(harness.invoke("synapse:workflow:param-presets:save", {
      workflowId: "workflow-1",
      name: "无效目录",
      values: { workspace: missingDirectory },
    })).rejects.toThrow("参数「workspace」路径不存在或不可访问")
    expect(presets.save).not.toHaveBeenCalled()
  })

})

function workflowDefinition() {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    params: [],
    nodes: [],
    edges: [],
  }
}

function codexWorkflowDefinition(configOverrideValue: string) {
  return {
    ...workflowDefinition(),
    nodes: [{
      id: "codex-1",
      name: "Code X",
      type: "codex",
      position: { x: 100, y: 100 },
      config: {
        prompt: "Run task",
        configOverrides: [{ key: "model_reasoning_effort", value: configOverrideValue }],
      },
    }],
  }
}

function redactedHttpAndScriptWorkflowDefinition() {
  return httpAndScriptWorkflowDefinition("[redacted]", "[redacted]")
}

function httpAndScriptWorkflowDefinition(bearerToken: string, scriptToken: string) {
  return {
    ...workflowDefinition(),
    nodes: [
      {
        id: "http-1",
        name: "HTTP",
        type: "http_request",
        position: { x: 100, y: 100 },
        config: {
          method: "GET",
          url: "https://example.com",
          auth: {
            type: "bearer",
            bearerToken,
          },
          variables: [],
        },
      },
      {
        id: "script-1",
        name: "Script",
        type: "script",
        position: { x: 200, y: 100 },
        config: {
          shell: "posix",
          script: "echo ok",
          env: {
            API_TOKEN: scriptToken,
          },
          variables: [],
        },
      },
    ],
  }
}
