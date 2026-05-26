import { beforeEach, describe, expect, it, vi } from "vitest"

const logStoreMock = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { createInMemoryHarness, type IpcHandlerContext } from "../../../runtime/ipc"
import type { WorkflowRunStatus } from "../../../../src/types/workflow"
import { configStore } from "../../../services/config-store"
import { workflowIpcModule } from "../ipc"

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

  it("exports a workflow package through the package service", async () => {
    const packageService = {
      buildExportPackage: vi.fn(async () => ({
        format: "synapse-workflow-package-v1",
        exportedAt: "2026-05-19T10:00:00.000Z",
        workflow: workflowDefinition(),
        modelReferences: [],
      })),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:export-package-data", { workflowId: "workflow-1" })

    expect(packageService.buildExportPackage).toHaveBeenCalledWith("workflow-1")
    expect(result).toMatchObject({ format: "synapse-workflow-package-v1" })
  })

  it("previews a workflow package with mappings", async () => {
    const preview = {
      packagePath: "/tmp/workflow.synapse-workflow.json",
      workflow: { id: "workflow-1", name: "Workflow", nodeCount: 1, modelReferenceCount: 0 },
      modelReferences: [],
      providerOptions: [],
      suggestedMappings: [],
    }
    const packageService = { buildImportPreview: vi.fn(async () => preview) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:inspect-import-package-data", {
      packagePath: "/tmp/workflow.synapse-workflow.json",
      packageData: { format: "synapse-workflow-package-v1", exportedAt: "2026-05-19T10:00:00.000Z", workflow: workflowDefinition(), modelReferences: [] },
    })

    expect(packageService.buildImportPreview).toHaveBeenCalled()
    expect(result).toEqual(preview)
  })

  it("imports a workflow package through the package service", async () => {
    const packageService = { importPackage: vi.fn(async () => ({ workflowId: "workflow-imported", versionHash: "v_1" })) }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.package") return packageService as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    const result = await harness.invoke("synapse:workflow:import-package-data", {
      packageData: { format: "synapse-workflow-package-v1", exportedAt: "2026-05-19T10:00:00.000Z", workflow: workflowDefinition(), modelReferences: [] },
      mappings: [],
    })

    expect(packageService.importPackage).toHaveBeenCalled()
    expect(result).toEqual({ workflowId: "workflow-imported", versionHash: "v_1" })
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
