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
    cancelRunsForWorkflow: vi.fn(),
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

  it("checks permission and audits allowed workflow mutations", async () => {
    const auditSink = {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    }
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const deps = makeDeps({ permissionGuard, auditSink })
    const dispatcher = createWorkflowDispatcher(deps)

    const result = await dispatcher.dispatch("workflow.definition.create", {}, { source: "mcp-http" })

    expect(result.ok).toBe(true)
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "workflow.mutate",
      actor: { kind: "user", id: "workflow-dispatch:mcp-http" },
      resource: "workflow:workflow.definition.create",
      context: {
        source: "mcp-http",
        workflowAction: "workflow.definition.create",
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.mutate",
      actor: { kind: "user", id: "workflow-dispatch:mcp-http" },
      resource: "workflow:workflow.definition.create",
      outcome: "allowed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.definition.create",
      }),
    }))
  })

  it("denies workflow mutations before calling the workflow service", async () => {
    const auditSink = {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    }
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: false as const, reason: "workflow denied", policyId: "deny-workflow" })),
    }
    const deps = makeDeps({ permissionGuard, auditSink })
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch("workflow.definition.delete", { workflowId: "wf-1" }, { source: "mcp-http" }))
      .rejects
      .toThrow("workflow denied")

    expect(deps.workflowService.delete).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.mutate",
      resource: "workflow:wf-1",
      outcome: "denied",
      metadata: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.definition.delete",
        workflowId: "wf-1",
        policyId: "deny-workflow",
      }),
    }))
  })

  it("records failed audit when an authorized workflow mutation throws", async () => {
    const auditSink = {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    }
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const deps = makeDeps({
      permissionGuard,
      auditSink,
      workflowService: {
        ...makeDeps().workflowService,
        create: vi.fn(async () => {
          throw new Error("create failed with secret prompt")
        }),
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch("workflow.definition.create", {}, { source: "mcp-http" }))
      .rejects
      .toThrow("create failed with secret prompt")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.mutate",
      resource: "workflow:workflow.definition.create",
      outcome: "failed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.definition.create",
        errorName: "Error",
        errorLength: "Error: create failed with secret prompt".length,
      }),
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("secret prompt")
  })

  it("workflow.definition.create accepts workflow default project, provider, model tier, and timeout", async () => {
    const created = {
      id: "wf-new", name: "新工作流", description: "", version: "v_new",
      createdAt: 1, updatedAt: 2, params: [],
      defaultProjectId: "project-1",
      defaultProviderId: "local-claude-code",
      defaultModelTier: "sonnet" as const,
      nodes: [{ id: "end", name: "End", type: "end", position: { x: 600, y: 200 }, config: { outputType: "text", template: "", variables: [] } }],
      edges: [],
    }
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        create: vi.fn(async () => ({ id: "wf-new", versionHash: "v_new" })),
        get: vi.fn(async () => structuredClone(created)),
        save: vi.fn(async () => ({ versionHash: "v_saved" })),
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    const result = await dispatcher.dispatch("workflow.definition.create", {
      name: "Review Flow",
      defaultProjectId: "project-1",
      defaultProviderId: "local-claude-code",
      defaultModelTier: "sonnet",
      defaultNodeTimeoutMins: 12,
    }, { source: "mcp-http" })

    expect(deps.workflowService.create).toHaveBeenCalledWith("project-1", {
      providerId: "local-claude-code",
      modelTier: "sonnet",
    })
    const savedDef = (deps.workflowService.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(savedDef).toMatchObject({
      name: "Review Flow",
      defaultProjectId: "project-1",
      defaultProviderId: "local-claude-code",
      defaultModelTier: "sonnet",
      defaultNodeTimeoutMins: 12,
    })
    expect(result.data).toEqual({ id: "wf-new", versionHash: "v_saved" })
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

  it("workflow.node.create returns nodeId", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch(
      "workflow.node.create",
      { workflowId: "wf-1", node: { name: "Prompt", type: "prompt" } },
      { source: "api" },
    )
    expect(result.ok).toBe(true)
    expect(result.data).toHaveProperty("nodeId")
    expect(typeof (result.data as Record<string, unknown>).nodeId).toBe("string")
    expect((result.data as Record<string, unknown>).nodeId).toHaveLength(36) // UUID format
  })

  it("serializes concurrent workflow mutations so later writes include earlier changes", async () => {
    let storedDefinition = {
      id: "wf-1", name: "Test", description: "", version: "v1",
      createdAt: 1, updatedAt: 2, params: [],
      nodes: [{ id: "end", name: "End", type: "end", position: { x: 600, y: 200 }, config: {} }],
      edges: [],
    }
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => structuredClone(storedDefinition)),
        save: vi.fn(async (definition) => {
          await Promise.resolve()
          storedDefinition = structuredClone(definition)
          return { versionHash: `v_${storedDefinition.nodes.length}` }
        }),
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    await Promise.all([
      dispatcher.dispatch(
        "workflow.node.create",
        { workflowId: "wf-1", node: { name: "Prompt A", type: "prompt" } },
        { source: "api" },
      ),
      dispatcher.dispatch(
        "workflow.node.create",
        { workflowId: "wf-1", node: { name: "Prompt B", type: "prompt" } },
        { source: "api" },
      ),
    ])

    expect(storedDefinition.nodes.map((node) => node.name).sort()).toEqual([
      "End",
      "Prompt A",
      "Prompt B",
    ])
  })

  it("workflow.definition.delete calls cancelRunsForWorkflow", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.definition.delete", { workflowId: "wf-1" }, { source: "api" })
    expect(result.ok).toBe(true)
    expect(deps.cancelRunsForWorkflow).toHaveBeenCalledWith("wf-1")
    expect(deps.cancelRun).not.toHaveBeenCalled()
    expect(deps.workflowService.delete).toHaveBeenCalledWith("wf-1")
    expect(deps.snapshotService.deleteWorkflow).toHaveBeenCalledWith("wf-1")
  })

  it("workflow.edge.create returns edgeId", async () => {
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => ({
          id: "wf-1", name: "Test", description: "", version: "v1",
          createdAt: 1, updatedAt: 2, params: [],
          nodes: [
            { id: "n1", name: "Prompt", type: "prompt", position: { x: 200, y: 200 }, config: {} },
            { id: "n2", name: "End", type: "end", position: { x: 600, y: 200 }, config: {} },
          ],
          edges: [],
        })),
        save: vi.fn(async () => ({ versionHash: "v_456" })),
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch(
      "workflow.edge.create",
      { workflowId: "wf-1", from: "n1", to: "n2" },
      { source: "api" },
    )
    expect(result.ok).toBe(true)
    expect(result.data).toHaveProperty("edgeId")
    expect(typeof (result.data as Record<string, unknown>).edgeId).toBe("string")
    expect((result.data as Record<string, unknown>).edgeId).toHaveLength(36)
  })

  it("workflow.node.delete rejects deleting end node", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    await expect(
      dispatcher.dispatch("workflow.node.delete", { workflowId: "wf-1", nodeId: "n1" }, { source: "api" }),
    ).rejects.toThrow(/Cannot delete the end node/)
  })

  it("workflow.node.delete returns removedEdgeCount", async () => {
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => ({
          id: "wf-1", name: "Test", description: "", version: "v1",
          createdAt: 1, updatedAt: 2, params: [],
          nodes: [
            { id: "n1", name: "Prompt", type: "prompt", position: { x: 200, y: 200 }, config: {} },
            { id: "n2", name: "End", type: "end", position: { x: 600, y: 200 }, config: {} },
          ],
          edges: [
            { id: "e1", from: "n1", to: "n2" },
          ],
        })),
        save: vi.fn(async () => ({ versionHash: "v_789" })),
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch(
      "workflow.node.delete",
      { workflowId: "wf-1", nodeId: "n1" },
      { source: "api" },
    )
    expect(result.ok).toBe(true)
    expect((result.data as Record<string, unknown>).removedEdgeCount).toBe(1)
  })

  it("workflow.node_type.describe returns availableProviders for prompt", async () => {
    const listProviders = vi.fn(async () => [
      { id: "p1", name: "Provider 1", model: "m-default", haikuModel: "m-haiku", sonnetModel: "m-sonnet", opusModel: "m-opus" },
      { id: "p2", name: "Provider 2", model: "m2-default", haikuModel: undefined, sonnetModel: "m2-sonnet", opusModel: undefined },
    ])
    const deps = makeDeps({ listProviders })
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.node_type.describe", { nodeType: "prompt" }, { source: "api" })
    expect(result.ok).toBe(true)
    const data = result.data as Record<string, unknown>
    expect(data).toHaveProperty("availableProviders")
    const providers = data.availableProviders as Array<Record<string, unknown>>
    expect(providers).toHaveLength(2)
    expect(providers[0]).toEqual({
      id: "p1", name: "Provider 1",
      models: { default: "m-default", haiku: "m-haiku", sonnet: "m-sonnet", opus: "m-opus" },
    })
    expect(providers[1]).toEqual({
      id: "p2", name: "Provider 2",
      models: { default: "m2-default", haiku: undefined, sonnet: "m2-sonnet", opus: undefined },
    })
  })

  it("workflow.node_type.describe omits availableProviders for end node", async () => {
    const listProviders = vi.fn(async () => [{ id: "p1", name: "P1", model: "m", haikuModel: "h", sonnetModel: "s", opusModel: "o" }])
    const deps = makeDeps({ listProviders })
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.node_type.describe", { nodeType: "end" }, { source: "api" })
    expect(result.ok).toBe(true)
    const data = result.data as Record<string, unknown>
    expect(data).not.toHaveProperty("availableProviders")
  })

  it("workflow.layout.update repositions nodes with dagre LR", async () => {
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => ({
          id: "wf-1", name: "Test", description: "", version: "v1",
          createdAt: 1, updatedAt: 2, params: [],
          nodes: [
            { id: "a", name: "Prompt A", type: "prompt", position: { x: 0, y: 0 }, config: {} },
            { id: "b", name: "Prompt B", type: "prompt", position: { x: 0, y: 0 }, config: {} },
            { id: "c", name: "End", type: "end", position: { x: 0, y: 0 }, config: {} },
          ],
          edges: [
            { id: "e1", from: "a", to: "b" },
            { id: "e2", from: "b", to: "c" },
          ],
        })),
        save: vi.fn(async () => ({ versionHash: "v_layout" })),
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch(
      "workflow.layout.update",
      { workflowId: "wf-1" },
      { source: "mcp-http" },
    )
    expect(result.ok).toBe(true)
    const savedDef = (deps.workflowService.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const posA = savedDef.nodes.find((n: { id: string }) => n.id === "a").position
    const posB = savedDef.nodes.find((n: { id: string }) => n.id === "b").position
    const posC = savedDef.nodes.find((n: { id: string }) => n.id === "c").position
    expect(posA.x).toBeLessThan(posB.x)
    expect(posB.x).toBeLessThan(posC.x)
  })

  it("workflow.layout.update supports TB direction", async () => {
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => ({
          id: "wf-1", name: "Test", description: "", version: "v1",
          createdAt: 1, updatedAt: 2, params: [],
          nodes: [
            { id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: {} },
            { id: "b", name: "B", type: "end", position: { x: 0, y: 0 }, config: {} },
          ],
          edges: [{ id: "e1", from: "a", to: "b" }],
        })),
        save: vi.fn(async () => ({ versionHash: "v_tb" })),
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch(
      "workflow.layout.update",
      { workflowId: "wf-1", direction: "TB" },
      { source: "mcp-http" },
    )
    expect(result.ok).toBe(true)
    const savedDef = (deps.workflowService.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const posA = savedDef.nodes.find((n: { id: string }) => n.id === "a").position
    const posB = savedDef.nodes.find((n: { id: string }) => n.id === "b").position
    expect(posA.y).toBeLessThan(posB.y)
  })

  it("throws on unknown action", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    await expect(dispatcher.dispatch("workflow.unknown.action", {}, { source: "api" }))
      .rejects.toThrow(/Unknown workflow action/)
  })
})
