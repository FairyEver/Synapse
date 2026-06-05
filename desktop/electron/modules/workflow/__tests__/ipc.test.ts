import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"

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
import type { WorkflowRunStatus } from "../../../../src/types/workflow"
import { configStore } from "../../../services/config-store"
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
  validateRunParams: vi.fn(() => []),
  buildEffectiveRunParams: vi.fn((_def: unknown, params: Record<string, unknown>) => params),
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

  it("sanitizes workflow engine rejection diagnostics and visible failure state", async () => {
    const rawError = "engine failed token=sk-secret at /Users/example/repo with prompt text"
    const runStatuses = new Map<string, WorkflowRunStatus>()
    const eventBus = { emit: vi.fn() }
    const snapshots = { save: vi.fn(async () => undefined) }
    const workflow = { get: vi.fn(async () => workflowDefinition()) }
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
      params: {},
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
    expect(JSON.stringify(logStoreMock.logger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(logStoreMock.logger.error.mock.calls)).not.toContain("/Users/example/repo")
    expect(JSON.stringify(logStoreMock.logger.error.mock.calls)).not.toContain("prompt text")
    expect(snapshots.save).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(JSON.stringify(snapshots.save.mock.calls)).not.toContain("/Users/example/repo")
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

  it("records audit after workflow package export writes the selected file", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "workflow-export-test-"))
    const targetPath = path.join(tempRoot, "workflow.synapse-workflow.json")
    electronMock.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: targetPath })
    const packageService = {
      buildExportPackage: vi.fn(async () => ({
        format: "synapse-workflow-package-v1",
        exportedAt: "2026-05-26T00:00:00.000Z",
        workflow: workflowDefinition(),
        modelReferences: [],
      })),
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
      const result = await harness.invoke("synapse:workflow:export-package", {
        workflowId: "workflow-1",
        workflowName: "Workflow",
      })

      expect(result).toEqual({ path: targetPath })
      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "fs.write",
        outcome: "allowed",
        resource: targetPath,
        metadata: {
          source: "workflow.exportPackage.write",
          workflowId: "workflow-1",
        },
      }))
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
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
        "node-1": expect.objectContaining({ usage, costUsd: 0.01 }),
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
        definition: activeDefinition,
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
      }),
    ])
    expect(JSON.stringify(history)).not.toContain("other-active-run")
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
