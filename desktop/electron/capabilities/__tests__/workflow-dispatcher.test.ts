import { describe, expect, it, vi } from "vitest"
import { createWorkflowDispatcher, type WorkflowDispatchDeps } from "../workflow-dispatcher"

function makeDeps(overrides: Partial<WorkflowDispatchDeps> = {}): WorkflowDispatchDeps {
  return {
    workflowService: {
      list: vi.fn(async () => [{ id: "wf-1", name: "Test", version: "v1", nodeCount: 2, createdAt: 1, updatedAt: 2 }]),
      get: vi.fn(async (id: string) => {
        if (id === "wf-1") return {
          id: "wf-1", name: "Test", description: "", version: "v1",
          createdAt: 1, updatedAt: 2, params: [],
          nodes: [{ id: "n1", name: "End", type: "end", position: { x: 600, y: 200 }, config: {} }],
          edges: [],
        }
        return null
      }),
      save: vi.fn(async () => ({ versionHash: "v_123" })),
      create: vi.fn(async () => ({ id: "wf-new", versionHash: "v_new" })),
      delete: vi.fn(async () => {}),
    } as unknown as WorkflowDispatchDeps["workflowService"],
    snapshotService: {
      list: vi.fn(async () => []),
      findByRunId: vi.fn(async () => null),
      deleteWorkflow: vi.fn(async () => {}),
    } as unknown as WorkflowDispatchDeps["snapshotService"],
    nodeTypeRegistry: {
      listTypes: vi.fn(() => ["prompt", "end"]),
      getManifest: vi.fn((type: string) => ({
        type,
        title: type === "prompt" ? "AI 对话" : "End",
        color: "#000",
        ports: { inputs: [], outputs: [] },
        configFields: [],
        configSchema: { _def: {} },
        cardSummary: () => ({ title: "AI 对话", subtitle: "" }),
      })),
    } as unknown as WorkflowDispatchDeps["nodeTypeRegistry"],
    eventBus: { emit: vi.fn() } as unknown as WorkflowDispatchDeps["eventBus"],
    runWorkflow: vi.fn(async () => ({ runId: "run-1" })),
    cancelRun: vi.fn(),
    getRunStatus: vi.fn(async () => null),
    ...overrides,
  }
}

describe("createWorkflowDispatcher", () => {
  it("workflow.definition.list dispatches correctly", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.definition.list", {}, { source: "api" })
    expect(result.ok).toBe(true)
    expect(result.data).toEqual([{ id: "wf-1", name: "Test", version: "v1", nodeCount: 2, createdAt: 1, updatedAt: 2 }])
    expect(deps.workflowService.list).toHaveBeenCalled()
  })

  it("workflow.definition.create returns id + versionHash", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.definition.create", {}, { source: "api" })
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ id: "wf-new", versionHash: "v_new" })
  })

  it("workflow.definition.get returns null for missing", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.definition.get", { workflowId: "nonexistent" }, { source: "api" })
    expect(result.ok).toBe(true)
    expect(result.data).toBeNull()
  })

  it("workflow.node_type.list returns array", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.node_type.list", {}, { source: "api" })
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
    const data = result.data as Array<{ type: string; title: string }>
    expect(data.length).toBe(2)
    expect(data[0].type).toBe("prompt")
    expect(data[0].title).toBe("AI 对话")
  })

  it("workflow.run.execute calls runWorkflow", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.run.execute", { workflowId: "wf-1", params: { key: "val" } }, { source: "api" })
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ runId: "run-1" })
    expect(deps.runWorkflow).toHaveBeenCalledWith("wf-1", { key: "val" })
  })

  it("workflow.run.disable calls cancelRun", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.run.disable", { runId: "run-1" }, { source: "api" })
    expect(result.ok).toBe(true)
    expect(deps.cancelRun).toHaveBeenCalledWith("run-1")
  })

  it("workflow.node.create with auto-position", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch(
      "workflow.node.create",
      { workflowId: "wf-1", node: { name: "New Node", type: "prompt" } },
      { source: "api" },
    )
    expect(result.ok).toBe(true)
    const savedDef = (deps.workflowService.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const newNode = savedDef.nodes[savedDef.nodes.length - 1]
    expect(newNode.position).toEqual({ x: 850, y: 200 })
    expect(newNode.type).toBe("prompt")
    expect(newNode.name).toBe("New Node")
  })

  it("throws on unknown action", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    await expect(dispatcher.dispatch("workflow.unknown.action", {}, { source: "api" }))
      .rejects.toThrow(/Unknown workflow action/)
  })
})
