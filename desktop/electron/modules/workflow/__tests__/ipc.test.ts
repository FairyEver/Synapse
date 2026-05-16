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
      run: vi.fn(() => Promise.reject(new Error(rawError))),
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
    expect(runStatuses.get(runId)?.error).toBe(`引擎异常（Error，错误 ${rawError.length} 字）`)
    expect(JSON.stringify(logStoreMock.logger.error.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(logStoreMock.logger.error.mock.calls)).not.toContain("/Users/example/repo")
    expect(JSON.stringify(logStoreMock.logger.error.mock.calls)).not.toContain("prompt text")
    expect(JSON.stringify([...runStatuses.values()])).not.toContain("sk-secret")
    expect(JSON.stringify(eventBus.emit.mock.calls)).not.toContain("sk-secret")
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
      expect.anything(), expect.anything(), expect.anything(),
      "renderer",
    )

    // workflow:runDefinition → "editor-run-definition"
    await harness.invoke("synapse:workflow:run-definition", {
      definition: workflowDefinition(),
      params: {},
    })
    expect(engine.run).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(),
      expect.anything(), expect.anything(), expect.anything(),
      "editor-run-definition",
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
      expect.anything(), expect.anything(), expect.anything(),
      "rerun",
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
