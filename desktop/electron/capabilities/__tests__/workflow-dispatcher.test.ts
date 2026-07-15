import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const logStoreMock = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))

import { createWorkflowDispatcher, type WorkflowDispatchDeps } from "../workflow-dispatcher"
import type { WorkflowDefinition, WorkflowRunSnapshot, WorkflowRunStatus } from "../../../src/types/workflow"
import { buildWorkflowTools } from "../../../synapse-capabilities/shared/workflow-domain"
import { mcpClientActorForSource } from "../../../synapse-capabilities/shared/types"
import "../../../workflow-nodes/register.main"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"

vi.mock("../../services/log-store", () => ({
  createMainLogger: vi.fn(() => logStoreMock.logger),
}))

function makeDeps(overrides: Partial<WorkflowDispatchDeps> = {}): WorkflowDispatchDeps {
  return {
    workflowService: {
      list: vi.fn(async () => [{ id: "wf-1", name: "Test", version: "v1", nodeCount: 2, createdAt: 1, updatedAt: 2 }]),
      get: vi.fn(async (id: string) => {
        if (id === "wf-1") return {
          id: "wf-1", name: "Test", description: "", version: "v1",
          createdAt: 1, updatedAt: 2, params: [],
          nodes: [endNode("n1")],
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
        configSchema: z.object({}),
        cardSummary: () => ({ title: "AI 对话", subtitle: "" }),
      })),
    } as unknown as WorkflowDispatchDeps["nodeTypeRegistry"],
    eventBus: { emit: vi.fn() } as unknown as WorkflowDispatchDeps["eventBus"],
    runWorkflow: vi.fn(async () => ({ runId: "run-1" })),
    cancelRun: vi.fn(() => true),
    cancelRunsForWorkflow: vi.fn(),
    getRunStatus: vi.fn(async () => null),
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function scriptNode(id: string, name: string, x: number, y: number): WorkflowDefinition["nodes"][number] {
  return {
    id,
    name,
    type: "script",
    position: { x, y },
    config: { shell: "posix", script: "printf ok", variables: [] },
  }
}

function endNode(id = "end", name = "End", x = 600, y = 200): WorkflowDefinition["nodes"][number] {
  return {
    id,
    name,
    type: "end",
    position: { x, y },
    config: { outputType: "text", template: "", variables: [] },
  }
}

describe("createWorkflowDispatcher", () => {
  beforeEach(() => {
    logStoreMock.logger.error.mockClear()
    logStoreMock.logger.info.mockClear()
    logStoreMock.logger.warn.mockClear()
  })

  it("describes option params in the workflow param update MCP schema", () => {
    const tools = buildWorkflowTools()
    const paramUpdateTool = tools.find((item) => item.name === "workflow_param_update")
    expect(paramUpdateTool).toBeDefined()

    const paramProperties = (paramUpdateTool?.inputSchema as {
      properties?: {
        params?: {
          items?: {
            properties?: Record<string, unknown>
          }
        }
      }
    }).properties?.params?.items?.properties

    expect(paramProperties?.type).toMatchObject({ enum: expect.arrayContaining(["option"]) })
    expect(paramProperties).toHaveProperty("options")
    expect(paramProperties).toHaveProperty("allowCustomOption")
    expect(paramProperties).toHaveProperty("allowMultiple")

    const nodeTypeListTool = tools.find((item) => item.name === "workflow_node_type_list")
    expect(nodeTypeListTool?.description).toContain("text/number/option")

    const nodeTypeDescribeTool = tools.find((item) => item.name === "workflow_node_type_describe")
    expect(nodeTypeDescribeTool?.description).toContain("configSchema.required")

    const runExecuteTool = tools.find((item) => item.name === "workflow_run_execute")
    const runExecuteParams = (runExecuteTool?.inputSchema as {
      properties?: { params?: { description?: string } }
    }).properties?.params
    expect(runExecuteTool?.description).toContain("custom-enabled options")
    expect(runExecuteParams?.description).toContain("allowCustomOption=true")
    expect(runExecuteParams?.description).toContain("allowMultiple=true")
    expect(runExecuteParams?.description).toContain("up to 100")
    expect(runExecuteParams?.description).toContain("Custom run values are not saved back")

    const runGetTool = tools.find((item) => item.name === "workflow_run_get")
    expect(runGetTool?.inputSchema).toMatchObject({
      required: ["workflowId", "runId"],
      properties: {
        workflowId: { type: "string" },
        runId: { type: "string" },
      },
    })
  })

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

  it("workflow.run.get hydrates snapshot fallback to the run status contract", async () => {
    const snapshot: WorkflowRunSnapshot = {
      runId: "run-snap",
      workflowId: "wf-1",
      version: "v1",
      startedAt: 1000,
      endedAt: 1600,
      status: "failed",
      params: { topic: "alpha" },
      nodeResults: {
        prompt: {
          nodeId: "prompt",
          status: "failed",
          input: { variables: {} },
          error: "node failed",
        },
      },
      error: "workflow failed",
    }
    const deps = makeDeps({
      getRunStatus: vi.fn(async () => null),
      snapshotService: {
        ...makeDeps().snapshotService,
        findByRunId: vi.fn(async () => snapshot),
      } as unknown as WorkflowDispatchDeps["snapshotService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    const result = await dispatcher.dispatch("workflow.run.get", { workflowId: "wf-1", runId: "run-snap" }, { source: "api" })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual({
      runId: "run-snap",
      workflowId: "wf-1",
      status: "failed",
      nodeResults: snapshot.nodeResults,
      startedAt: 1000,
      endedAt: 1600,
      durationMs: 600,
      params: { topic: "alpha" },
      error: "workflow failed",
    })
    expect(result.data).not.toHaveProperty("version")
  })

  it("workflow.run.get sanitizes active run status before returning it to MCP callers", async () => {
    const activeStatus: WorkflowRunStatus = {
      runId: "run-active",
      workflowId: "wf-1",
      status: "running",
      startedAt: 1000,
      params: {
        authorization: "Bearer active-param-secret",
        apiKey: "sk-active-param-secret",
      },
      nodeResults: {
        codex: {
          nodeId: "codex",
          status: "success",
          input: {
            variables: {
              apiKey: "sk-input-secret",
            },
            prompt: "token=prompt-secret",
          },
          output: "Authorization: Bearer output-secret",
          outputs: {
            token: "sk-output-secret",
          },
        },
      },
      definition: {
        id: "wf-1",
        name: "Sensitive workflow",
        version: "v1",
        createdAt: 1,
        updatedAt: 2,
        params: [],
        nodes: [{
          id: "codex",
          name: "Codex",
          type: "codex",
          position: { x: 0, y: 0 },
          config: {
            prompt: "apiKey=definition-secret",
            configOverrides: [{ key: "env.SECRET", value: "sk-definition-secret" }],
          },
        }],
        edges: [],
      },
      error: "password=active-error-secret",
    }
    const deps = makeDeps({
      getRunStatus: vi.fn(async () => activeStatus),
    })
    const dispatcher = createWorkflowDispatcher(deps)

    const result = await dispatcher.dispatch("workflow.run.get", { workflowId: "wf-1", runId: "run-active" }, { source: "mcp-http" })

    expect(result.ok).toBe(true)
    const serialized = JSON.stringify(result.data)
    expect(serialized).not.toContain("active-param-secret")
    expect(serialized).not.toContain("sk-active-param-secret")
    expect(serialized).not.toContain("sk-input-secret")
    expect(serialized).not.toContain("prompt-secret")
    expect(serialized).not.toContain("output-secret")
    expect(serialized).not.toContain("sk-output-secret")
    expect(serialized).not.toContain("definition-secret")
    expect(serialized).not.toContain("sk-definition-secret")
    expect(serialized).not.toContain("active-error-secret")
    expect(result.data).toMatchObject({
      runId: "run-active",
      workflowId: "wf-1",
      status: "running",
    })
  })

  it("workflow.run.get returns null when the run belongs to another workflow", async () => {
    const snapshot = {
      runId: "run-private",
      workflowId: "wf-private",
      status: "completed",
      startedAt: 1,
      endedAt: 2,
      version: "v1",
      params: { private: "value" },
      nodeResults: {},
    } satisfies WorkflowRunSnapshot
    const deps = makeDeps({
      snapshotService: {
        ...makeDeps().snapshotService,
        findByRunId: vi.fn(async () => snapshot),
      } as unknown as WorkflowDispatchDeps["snapshotService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    const result = await dispatcher.dispatch("workflow.run.get", {
      workflowId: "wf-public",
      runId: "run-private",
    }, { source: "mcp-http" })

    expect(result).toEqual({ ok: true, data: null })
  })

  it("workflow.run.get rejects unsafe run ids before querying snapshots", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch("workflow.run.get", { workflowId: "wf-1", runId: "../escaped-run" }, { source: "api" }))
      .rejects
      .toThrow("Invalid workflow run id")
    expect(deps.getRunStatus).not.toHaveBeenCalled()
    expect(deps.snapshotService.findByRunId).not.toHaveBeenCalled()
  })

  it("serializes workflow.definition.update behind in-flight workflow mutations", async () => {
    const releaseFirstSave = deferred<{ versionHash: string }>()
    const baseDefinition: WorkflowDefinition = {
      id: "wf-1", name: "Test", description: "", version: "v1",
      createdAt: 1, updatedAt: 2, params: [],
      nodes: [endNode("n1")],
      edges: [],
    }
    const save = vi.fn(async (def: WorkflowDefinition) => {
      if (save.mock.calls.length === 1) return releaseFirstSave.promise
      return { versionHash: `v_${def.name}` }
    })
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => structuredClone(baseDefinition)),
        save,
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    const firstMutation = dispatcher.dispatch(
      "workflow.node.update",
      { workflowId: "wf-1", nodeId: "n1", patch: { name: "Updated End" } },
      { source: "api" },
    )
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

    const definitionUpdate = dispatcher.dispatch(
      "workflow.definition.update",
      { definition: { ...baseDefinition, name: "Replacement" } },
      { source: "api" },
    )
    await Promise.resolve()

    expect(save).toHaveBeenCalledTimes(1)
    releaseFirstSave.resolve({ versionHash: "v_first" })
    await firstMutation
    await definitionUpdate
    expect(save).toHaveBeenCalledTimes(2)
  })

  it("serializes workflow.definition.delete behind in-flight workflow mutations", async () => {
    const releaseFirstSave = deferred<{ versionHash: string }>()
    const baseDefinition: WorkflowDefinition = {
      id: "wf-1", name: "Test", description: "", version: "v1",
      createdAt: 1, updatedAt: 2, params: [],
      defaultProjectId: "project-1",
      nodes: [
        scriptNode("n1", "Prompt", 100, 200),
        endNode(),
      ],
      edges: [{ id: "edge-n1-end", from: "n1", to: "end" }],
    }
    const save = vi.fn(async () => releaseFirstSave.promise)
    const deleteWorkflow = vi.fn(async () => {})
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => structuredClone(baseDefinition)),
        save,
        delete: deleteWorkflow,
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    const firstMutation = dispatcher.dispatch(
      "workflow.node.update",
      { workflowId: "wf-1", nodeId: "n1", patch: { name: "Updated Prompt" } },
      { source: "api" },
    )
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

    const deletion = dispatcher.dispatch("workflow.definition.delete", { workflowId: "wf-1" }, { source: "api" })
    await Promise.resolve()
    await Promise.resolve()

    expect(deps.cancelRunsForWorkflow).not.toHaveBeenCalled()
    expect(deleteWorkflow).not.toHaveBeenCalled()
    releaseFirstSave.resolve({ versionHash: "v_first" })
    await firstMutation
    await deletion
    expect(deps.cancelRunsForWorkflow).toHaveBeenCalledWith("wf-1")
    expect(deleteWorkflow).toHaveBeenCalledWith("wf-1")
  })

  it("rejects workflow.definition.update before saving when definition id is missing", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const definitionWithoutId: Record<string, unknown> = {
      id: "wf-1", name: "Test", description: "", version: "v1",
      createdAt: 1, updatedAt: 2, params: [],
      nodes: [endNode("n1")],
      edges: [],
    }
    delete definitionWithoutId.id

    await expect(dispatcher.dispatch(
      "workflow.definition.update",
      { definition: definitionWithoutId },
      { source: "api" },
    )).rejects.toThrow("Missing or invalid 'definition.id'")
    expect(deps.workflowService.save).not.toHaveBeenCalled()
  })

  it("reports workflow_call resource binding mismatches during definition inspection", async () => {
    const deps = makeDeps({
      loadValidationOptions: vi.fn(async () => ({
        availableWorkflowIds: ["child"],
        workflowParamsById: new Map([["child", [
          { name: "input_file", type: "file" as const, default: null },
        ]]]),
      })),
    })
    const dispatcher = createWorkflowDispatcher(deps)
    const definition: WorkflowDefinition = {
      id: "parent",
      name: "Parent",
      version: "v1",
      createdAt: 1,
      updatedAt: 2,
      params: [{ name: "input_files", type: "file", default: null, allowMultiple: true }],
      nodes: [
        {
          id: "call",
          name: "Call",
          type: "workflow_call",
          position: { x: 0, y: 0 },
          config: {
            workflowId: "child",
            variables: [],
            paramTemplates: {},
            paramBindings: {
              input_file: { mode: "value", source: { type: "param", param: "input_files" } },
            },
          },
        },
        endNode("end"),
      ],
      edges: [{ id: "edge-1", from: "call", to: "end" }],
    }

    const result = await dispatcher.dispatch(
      "workflow.definition.inspect",
      { definition },
      { source: "api" },
    )

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(expect.objectContaining({
      valid: false,
      errors: expect.arrayContaining([
        expect.objectContaining({
          nodeId: "call",
          field: "paramBindings",
          message: expect.stringContaining("资源类型或多选设置不一致"),
        }),
      ]),
    }))
  })

  it("rejects workflow_call multi-resource templates before an MCP node update is saved", async () => {
    const definition: WorkflowDefinition = {
      id: "parent",
      name: "Parent",
      version: "v1",
      createdAt: 1,
      updatedAt: 2,
      params: [],
      nodes: [
        {
          id: "call",
          name: "Call",
          type: "workflow_call",
          position: { x: 0, y: 0 },
          config: {
            workflowId: "child",
            variables: [{ name: "files", source: { type: "static", value: "[]" } }],
            paramTemplates: { input_files: "{{files}}" },
            paramBindings: {},
          },
        },
        endNode("end"),
      ],
      edges: [{ id: "edge-1", from: "call", to: "end" }],
    }
    const save = vi.fn(async () => ({ versionHash: "v2" }))
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => structuredClone(definition)),
        save,
      } as unknown as WorkflowDispatchDeps["workflowService"],
      loadValidationOptions: vi.fn(async () => ({
        availableWorkflowIds: ["child"],
        workflowParamsById: new Map([["child", [
          { name: "input_files", type: "file" as const, default: null, allowMultiple: true },
        ]]]),
      })),
    })
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch(
      "workflow.node.update",
      { workflowId: "parent", nodeId: "call", patch: { name: "Updated Call" } },
      { source: "mcp-http" },
    )).rejects.toThrow("多选资源参数「input_files」不能使用 paramTemplates")
    expect(save).not.toHaveBeenCalled()
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

    const result = await dispatcher.dispatch("workflow.definition.create", {}, {
      source: "mcp-http",
      actor: mcpClientActorForSource("mcp-http"),
    })

    expect(result.ok).toBe(true)
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "workflow.mutate",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "workflow:workflow.definition.create",
      context: {
        source: "mcp-http",
        workflowAction: "workflow.definition.create",
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.mutate",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "workflow:workflow.definition.create",
      outcome: "allowed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.definition.create",
      }),
    }))
  })

  it("checks permission and audits allowed workflow reads", async () => {
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

    const result = await dispatcher.dispatch("workflow.definition.get", { workflowId: "wf-1" }, {
      source: "mcp-http",
      actor: mcpClientActorForSource("mcp-http"),
    })

    expect(result.ok).toBe(true)
    expect(deps.workflowService.get).toHaveBeenCalledWith("wf-1")
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "workflow.read",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "workflow:wf-1",
      context: {
        source: "mcp-http",
        workflowAction: "workflow.definition.get",
        workflowId: "wf-1",
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.read",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "workflow:wf-1",
      outcome: "allowed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.definition.get",
        workflowId: "wf-1",
      }),
    }))
  })

  it("checks permission and audits workflow.definition.update against the nested definition id", async () => {
    const auditSink = {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    }
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const definition: WorkflowDefinition = {
      id: "wf-1", name: "Updated", description: "", version: "v1",
      createdAt: 1, updatedAt: 2, params: [],
      nodes: [endNode("n1")],
      edges: [],
    }
    const deps = makeDeps({ permissionGuard, auditSink })
    const dispatcher = createWorkflowDispatcher(deps)

    const result = await dispatcher.dispatch("workflow.definition.update", { definition }, {
      source: "mcp-http",
      actor: mcpClientActorForSource("mcp-http"),
    })

    expect(result.ok).toBe(true)
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "workflow.mutate",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "workflow:wf-1",
      context: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.definition.update",
        workflowId: "wf-1",
        hasDefinition: true,
      }),
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.mutate",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
      resource: "workflow:wf-1",
      outcome: "allowed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.definition.update",
        workflowId: "wf-1",
        hasDefinition: true,
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

  it("denies workflow reads before calling the workflow service", async () => {
    const auditSink = {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    }
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: false as const, reason: "workflow read denied", policyId: "deny-workflow-read" })),
    }
    const deps = makeDeps({ permissionGuard, auditSink })
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch("workflow.run.list", { workflowId: "wf-1" }, { source: "mcp-http" }))
      .rejects
      .toThrow("workflow read denied")

    expect(deps.snapshotService.list).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.read",
      resource: "workflow:wf-1",
      outcome: "denied",
      metadata: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.run.list",
        workflowId: "wf-1",
        policyId: "deny-workflow-read",
      }),
    }))
  })

  it("authorizes workflow.run.get against the workflow before resolving the run id", async () => {
    const auditSink = {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    }
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({
        allowed: false as const,
        reason: "workflow run denied",
        policyId: "deny-workflow-run",
      })),
    }
    const deps = makeDeps({ permissionGuard, auditSink })
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch("workflow.run.get", {
      workflowId: "wf-private",
      runId: "run-private",
    }, { source: "mcp-http" })).rejects.toThrow("workflow run denied")

    expect(deps.getRunStatus).not.toHaveBeenCalled()
    expect(deps.snapshotService.findByRunId).not.toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledWith({
      action: "workflow.read",
      actor: { kind: "user", id: "workflow-dispatch:mcp-http" },
      resource: "workflow:wf-private",
      context: {
        source: "mcp-http",
        workflowAction: "workflow.run.get",
        workflowId: "wf-private",
        runId: "run-private",
      },
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.read",
      resource: "workflow:wf-private",
      outcome: "denied",
      metadata: expect.objectContaining({
        workflowId: "wf-private",
        runId: "run-private",
        policyId: "deny-workflow-run",
      }),
    }))
  })

  it("denies workflow discovery and inspect reads before calling handlers", async () => {
    const cases = [
      {
        action: "workflow.node_type.list",
        params: {},
        resource: "workflow:workflow.node_type.list",
        assertNotCalled: (deps: WorkflowDispatchDeps) => {
          expect(deps.nodeTypeRegistry.listTypes).not.toHaveBeenCalled()
        },
      },
      {
        action: "workflow.node_type.describe",
        params: { nodeType: "prompt" },
        resource: "workflow:workflow.node_type.describe",
        assertNotCalled: (deps: WorkflowDispatchDeps) => {
          expect(deps.nodeTypeRegistry.getManifest).not.toHaveBeenCalled()
        },
      },
      {
        action: "workflow.definition.inspect",
        params: {
          definition: {
            id: "wf-inspect", name: "Inspect", description: "", version: "v1",
            createdAt: 1, updatedAt: 2, params: [],
            nodes: [endNode("end")],
            edges: [],
          },
        },
        resource: "workflow:wf-inspect",
        assertNotCalled: (deps: WorkflowDispatchDeps) => {
          expect(deps.nodeTypeRegistry.getManifest).not.toHaveBeenCalled()
        },
      },
    ] as const

    for (const testCase of cases) {
      const auditSink = {
        record: vi.fn(),
        list: () => [],
        clearForTests: vi.fn(),
      }
      const permissionGuard = {
        registerPolicy: vi.fn(),
        check: vi.fn(async () => ({ allowed: false as const, reason: "workflow read denied", policyId: "deny-workflow-read" })),
      }
      const deps = makeDeps({ permissionGuard, auditSink })
      const dispatcher = createWorkflowDispatcher(deps)

      await expect(dispatcher.dispatch(testCase.action, testCase.params, { source: "mcp-http" }))
        .rejects
        .toThrow("workflow read denied")

      testCase.assertNotCalled(deps)
      expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
        action: "workflow.read",
        resource: testCase.resource,
      }))
      expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "workflow.read",
        resource: testCase.resource,
        outcome: "denied",
        metadata: expect.objectContaining({
          source: "mcp-http",
          workflowAction: testCase.action,
          policyId: "deny-workflow-read",
        }),
      }))
    }
  })

  it("audits permission guard failures before calling the workflow service", async () => {
    const auditSink = {
      record: vi.fn(),
      list: () => [],
      clearForTests: vi.fn(),
    }
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => {
        throw new Error("guard failed with token=secret-prompt at /Users/liyang/private-workflow")
      }),
    }
    const deps = makeDeps({ permissionGuard, auditSink })
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch("workflow.definition.delete", { workflowId: "wf-1" }, { source: "mcp-http" }))
      .rejects
      .toThrow("guard failed with token=secret-prompt at /Users/liyang/private-workflow")

    expect(deps.workflowService.delete).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.mutate",
      resource: "workflow:wf-1",
      outcome: "failed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.definition.delete",
        workflowId: "wf-1",
        reason: "permission-check-error",
        errorName: "Error",
        errorLength: "Error: guard failed with token=secret-prompt at /Users/liyang/private-workflow".length,
      }),
    }))
    expect(auditSink.record).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("secret-prompt")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("/Users/liyang/private-workflow")

    const failedLog = logStoreMock.logger.warn.mock.calls.find(([message]) => message === "workflow mcp dispatch failed")
    expect(failedLog).toBeDefined()
    const serializedLog = JSON.stringify(failedLog)
    expect(serializedLog).not.toContain("secret-prompt")
    expect(serializedLog).not.toContain("/Users/liyang/private-workflow")
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
          throw new Error("create failed with token=secret-prompt at /Users/liyang/secret-workspace")
        }),
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch("workflow.definition.create", {}, { source: "mcp-http" }))
      .rejects
      .toThrow("create failed with token=secret-prompt at /Users/liyang/secret-workspace")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.mutate",
      resource: "workflow:workflow.definition.create",
      outcome: "failed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.definition.create",
        errorName: "Error",
        errorLength: "Error: create failed with token=secret-prompt at /Users/liyang/secret-workspace".length,
      }),
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("secret-prompt")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("/Users/liyang/secret-workspace")

    const failedLog = logStoreMock.logger.warn.mock.calls.find(([message]) => message === "workflow mcp dispatch failed")
    expect(failedLog).toBeDefined()
    const serializedLog = JSON.stringify(failedLog)
    expect(serializedLog).not.toContain("secret-prompt")
    expect(serializedLog).not.toContain("/Users/liyang/secret-workspace")
  })

  it("workflow.definition.create accepts workflow default project, provider, model tier, and timeout", async () => {
    const created = {
      id: "wf-new", name: "新工作流", description: "", version: "v_new",
      createdAt: 1, updatedAt: 2, params: [],
      defaultProjectId: "project-1",
      defaultProviderId: "local-claude-code",
      defaultModelTier: "sonnet" as const,
      nodes: [endNode()],
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
    expect(deps.runWorkflow).toHaveBeenCalledWith("wf-1", { key: "val" }, {
      actor: { kind: "user", id: "workflow-dispatch:api" },
    })
  })

  it("workflow.run.execute forwards mixed multi-resource arrays unchanged for runtime normalization", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const files = [
      "/tmp/a.txt",
      { kind: "local_path", entryType: "file", path: "/tmp/b.txt" },
    ]

    const result = await dispatcher.dispatch(
      "workflow.run.execute",
      { workflowId: "wf-1", params: { files } },
      { source: "api" },
    )

    expect(result.ok).toBe(true)
    expect(deps.runWorkflow).toHaveBeenCalledWith("wf-1", { files }, expect.any(Object))
  })

  it("workflow.run.execute passes the dispatch actor into the workflow run", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const actor = mcpClientActorForSource("mcp-http")

    const result = await dispatcher.dispatch(
      "workflow.run.execute",
      { workflowId: "wf-1", params: { key: "val" } },
      { source: "mcp-http", actor },
    )

    expect(result.ok).toBe(true)
    expect(deps.runWorkflow).toHaveBeenCalledWith("wf-1", { key: "val" }, { actor })
  })

  it("workflow.run.execute returns structured run validation errors", async () => {
    const errors = [
      { type: "invalid_config" as const, message: "Workflow not found" },
      { type: "missing_param" as const, nodeId: "prompt-1", message: "topic is required" },
    ]
    const deps = makeDeps({
      runWorkflow: vi.fn(async () => ({ errors })),
    })
    const dispatcher = createWorkflowDispatcher(deps)

    const result = await dispatcher.dispatch(
      "workflow.run.execute",
      { workflowId: "wf-missing", params: { topic: "" } },
      { source: "api" },
    )

    expect(result).toEqual({ ok: false, errors })
  })

  it("audits structured workflow.run.execute errors as failed mutations", async () => {
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
      auditSink,
      permissionGuard,
      runWorkflow: vi.fn(async () => ({
        errors: [
          { type: "invalid_config" as const, message: "已有运行中的实例，请稍后再试。" },
        ],
      })),
    })
    const dispatcher = createWorkflowDispatcher(deps)

    const result = await dispatcher.dispatch(
      "workflow.run.execute",
      { workflowId: "wf-1", params: { key: "val" } },
      { source: "mcp-http" },
    )

    expect(result.ok).toBe(false)
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.mutate",
      resource: "workflow:wf-1",
      outcome: "failed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.run.execute",
        workflowId: "wf-1",
        hasRunParams: true,
        errorCount: 1,
        errorTypes: ["invalid_config"],
      }),
    }))
    expect(logStoreMock.logger.warn).toHaveBeenCalledWith("workflow mcp dispatch failed", expect.objectContaining({
      action: "workflow.run.execute",
      workflowId: "wf-1",
      hasRunParams: true,
      errorCount: 1,
      errorTypes: ["invalid_config"],
    }))
  })

  it("audits and logs the returned runId for successful workflow.run.execute mutations", async () => {
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
      auditSink,
      permissionGuard,
      runWorkflow: vi.fn(async () => ({ runId: "run-audit-1" })),
    })
    const dispatcher = createWorkflowDispatcher(deps)

    const result = await dispatcher.dispatch(
      "workflow.run.execute",
      { workflowId: "wf-1", params: { key: "val" } },
      { source: "mcp-http" },
    )

    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ runId: "run-audit-1" })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "workflow.mutate",
      resource: "workflow:wf-1",
      outcome: "allowed",
      metadata: expect.objectContaining({
        source: "mcp-http",
        workflowAction: "workflow.run.execute",
        workflowId: "wf-1",
        hasRunParams: true,
        runId: "run-audit-1",
      }),
    }))
    expect(logStoreMock.logger.info).toHaveBeenCalledWith("workflow mcp dispatch succeeded", expect.objectContaining({
      action: "workflow.run.execute",
      workflowId: "wf-1",
      hasRunParams: true,
      runId: "run-audit-1",
    }))
  })

  it("workflow.run.disable calls cancelRun", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.run.disable", { runId: "run-1" }, { source: "api" })
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ runId: "run-1", cancelRequested: true })
    expect(deps.cancelRun).toHaveBeenCalledWith("run-1")
  })

  it("workflow.run.disable rejects unsafe run ids before cancelling", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch("workflow.run.disable", { runId: "bad/run" }, { source: "api" }))
      .rejects
      .toThrow("Invalid workflow run id")
    expect(deps.cancelRun).not.toHaveBeenCalled()
  })

  it("workflow.run.disable stays idempotent when the run is no longer active", async () => {
    const deps = makeDeps({ cancelRun: vi.fn(() => false) })
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.run.disable", { runId: "run-missing" }, { source: "api" })

    expect(result).toEqual({ ok: true, data: { runId: "run-missing", cancelRequested: false } })
    expect(deps.cancelRun).toHaveBeenCalledWith("run-missing")
  })

  it("reads workflow.node.delete state only through the mutation lock", async () => {
    const definition: WorkflowDefinition = {
      id: "wf-1", name: "Test", description: "", version: "v1",
      createdAt: 1, updatedAt: 2, params: [],
      nodes: [
        scriptNode("n1", "Prompt", 100, 200),
        endNode(),
      ],
      edges: [],
    }
    const get = vi.fn(async () => structuredClone(definition))
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get,
        save: vi.fn(async () => ({ versionHash: "v_saved" })),
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    await dispatcher.dispatch(
      "workflow.node.delete",
      { workflowId: "wf-1", nodeId: "n1" },
      { source: "api" },
    )
    expect(get).toHaveBeenCalledTimes(1)
  })

  it("workflow.node.create rejects an unconnected node without saving", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    await expect(dispatcher.dispatch(
      "workflow.node.create",
      { workflowId: "wf-1", node: { name: "New Node", type: "script", config: { shell: "posix", script: "printf ok", variables: [] } } },
      { source: "api" },
    )).rejects.toThrow("Save failed")
    expect(deps.workflowService.save).not.toHaveBeenCalled()
  })

  it("workflow.node.create rejects missing node config before loading the workflow", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch(
      "workflow.node.create",
      { workflowId: "wf-1", node: { name: "Prompt", type: "prompt" } },
      { source: "api" },
    )).rejects.toThrow("Missing or invalid 'node.config'")

    expect(deps.workflowService.get).not.toHaveBeenCalled()
    expect(deps.workflowService.save).not.toHaveBeenCalled()
  })

  it("workflow.node.create does not return a nodeId for invalid nodes", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    await expect(dispatcher.dispatch(
      "workflow.node.create",
      { workflowId: "wf-1", node: { name: "Prompt", type: "script", config: { shell: "posix", script: "printf ok", variables: [] } } },
      { source: "api" },
    )).rejects.toThrow("Save failed")
    expect(deps.workflowService.save).not.toHaveBeenCalled()
  })

  it("workflow.node.create rejects invalid mutations without saving or mutating the loaded definition", async () => {
    const storedDefinition: WorkflowDefinition = {
      id: "wf-1", name: "Test", description: "", version: "v1",
      createdAt: 1, updatedAt: 2, params: [],
      nodes: [endNode()],
      edges: [],
    }
    const save = vi.fn(async () => ({ versionHash: "v_should_not_save" }))
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => storedDefinition),
        save,
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch(
      "workflow.node.create",
      { workflowId: "wf-1", node: { name: "Unconnected", type: "script", config: { shell: "posix", script: "printf ok", variables: [] } } },
      { source: "api" },
    )).rejects.toThrow("Save failed")

    expect(save).not.toHaveBeenCalled()
    expect(storedDefinition.nodes).toHaveLength(1)
    expect(storedDefinition.nodes[0]?.id).toBe("end")
  })

  it("workflow.node.create can add a node with connecting edges in one validated save", async () => {
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => ({
          id: "wf-1", name: "Test", description: "", version: "v1",
          createdAt: 1, updatedAt: 2, params: [],
          defaultProjectId: "project-1",
          nodes: [
            scriptNode("n1", "Prepare", 200, 200),
            endNode("end"),
          ],
          edges: [{ id: "edge-n1-end", from: "n1", to: "end" }],
        })),
        save: vi.fn(async () => ({ versionHash: "v_connected" })),
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    const result = await dispatcher.dispatch(
      "workflow.node.create",
      {
        workflowId: "wf-1",
        node: { name: "Generate", type: "script", config: { shell: "posix", script: "printf generated", variables: [] } },
        incomingEdges: [{ from: "n1" }],
        outgoingEdges: [{ to: "end" }],
      },
      { source: "api" },
    )

    expect(result.ok).toBe(true)
    expect(result.data).toEqual(expect.objectContaining({
      nodeId: expect.any(String),
      versionHash: "v_connected",
      edgeIds: {
        incoming: [expect.any(String)],
        outgoing: [expect.any(String)],
      },
    }))
    const savedDef = (deps.workflowService.save as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowDefinition
    const newNodeId = (result.data as { nodeId: string }).nodeId
    expect(savedDef.nodes.some((node) => node.id === newNodeId && node.name === "Generate")).toBe(true)
    expect(savedDef.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "n1", to: newNodeId }),
      expect.objectContaining({ from: newNodeId, to: "end" }),
    ]))
  })

  it("serializes concurrent workflow mutations so later writes include earlier changes", async () => {
    let storedDefinition = {
      id: "wf-1", name: "Test", description: "", version: "v1",
      createdAt: 1, updatedAt: 2, params: [],
      defaultProjectId: "project-1",
      nodes: [scriptNode("a", "Script A", 200, 200), endNode()],
      edges: [{ id: "e1", from: "a", to: "end" }],
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
        "workflow.node.update",
        { workflowId: "wf-1", nodeId: "a", patch: { name: "Script A Updated" } },
        { source: "api" },
      ),
      dispatcher.dispatch(
        "workflow.node.update",
        { workflowId: "wf-1", nodeId: "end", patch: { name: "End Updated" } },
        { source: "api" },
      ),
    ])

    expect(storedDefinition.nodes.map((node) => node.name).sort()).toEqual([
      "End Updated",
      "Script A Updated",
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
          defaultProjectId: "project-1",
          nodes: [
            scriptNode("n1", "Prompt", 200, 200),
            endNode("n2"),
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

  it("workflow.edge.delete rejects missing edge without saving", async () => {
    const save = vi.fn(async () => ({ versionHash: "v_456" }))
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => ({
          id: "wf-1", name: "Test", description: "", version: "v1",
          createdAt: 1, updatedAt: 2, params: [],
          defaultProjectId: "project-1",
          nodes: [
            scriptNode("n1", "Prompt", 200, 200),
            endNode("n2"),
          ],
          edges: [{ id: "e1", from: "n1", to: "n2" }],
        })),
        save,
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)

    await expect(dispatcher.dispatch(
      "workflow.edge.delete",
      { workflowId: "wf-1", edgeId: "missing-edge" },
      { source: "api" },
    )).rejects.toThrow("Edge not found: missing-edge")
    expect(save).not.toHaveBeenCalled()
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
          defaultProjectId: "project-1",
          nodes: [
            scriptNode("n1", "Prompt", 200, 200),
            endNode("n2"),
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

  it("workflow.node_type.describe returns codex config schema without providers", async () => {
    const listProviders = vi.fn(async () => [{ id: "p1", name: "P1", model: "m", haikuModel: "h", sonnetModel: "s", opusModel: "o" }])
    const deps = makeDeps({ nodeTypeRegistry, listProviders })
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.node_type.describe", { nodeType: "codex" }, { source: "api" })
    expect(result.ok).toBe(true)

    const data = result.data as Record<string, unknown>
    expect(data.type).toBe("codex")
    expect(data).not.toHaveProperty("availableProviders")
    expect(data.configFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "workingDirectory" }),
      expect.objectContaining({ name: "approvalPolicy" }),
      expect.objectContaining({ name: "sandbox" }),
      expect.objectContaining({ name: "enableSearch" }),
      expect.objectContaining({ name: "additionalWritableDirs" }),
      expect.objectContaining({ name: "images" }),
      expect.objectContaining({ name: "configOverrides" }),
      expect.objectContaining({ name: "captureDebugArtifacts" }),
      expect.objectContaining({ name: "prompt" }),
    ]))
  })

  it("workflow.node_type.describe returns claude code config schema without providers", async () => {
    const listProviders = vi.fn(async () => [{ id: "p1", name: "P1", model: "m", haikuModel: "h", sonnetModel: "s", opusModel: "o" }])
    const deps = makeDeps({ nodeTypeRegistry, listProviders })
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.node_type.describe", { nodeType: "claude_code" }, { source: "api" })
    expect(result.ok).toBe(true)

    const data = result.data as Record<string, unknown>
    expect(data.type).toBe("claude_code")
    expect(data).not.toHaveProperty("availableProviders")
    expect(data.configFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "workingDirectory" }),
      expect.objectContaining({ name: "permissionMode" }),
      expect.objectContaining({ name: "model" }),
      expect.objectContaining({ name: "maxTurns" }),
      expect.objectContaining({ name: "outputFormat" }),
      expect.objectContaining({ name: "settingSources" }),
      expect.objectContaining({ name: "additionalDirectories" }),
      expect.objectContaining({ name: "allowedTools" }),
      expect.objectContaining({ name: "disallowedTools" }),
      expect.objectContaining({ name: "captureDebugArtifacts" }),
      expect.objectContaining({ name: "prompt" }),
    ]))
    const configFields = data.configFields as Array<{ name: string; optional?: boolean }>
    for (const fieldName of ["verbose", "settingSources", "captureDebugArtifacts"]) {
      expect(configFields.find((field) => field.name === fieldName)?.optional).not.toBe(true)
    }

    const configSchema = data.configSchema as Record<string, unknown>
    const configProperties = configSchema.properties as Record<string, unknown>
    expect(configProperties).toMatchObject({
      prompt: expect.objectContaining({ type: "string" }),
      verbose: expect.objectContaining({ type: "boolean" }),
      settingSources: expect.objectContaining({ type: "array" }),
      captureDebugArtifacts: expect.objectContaining({ type: "boolean" }),
    })
    expect(configSchema.required).toEqual(expect.arrayContaining([
      "prompt",
      "verbose",
      "settingSources",
      "captureDebugArtifacts",
    ]))
  })

  it("workflow.layout.update repositions nodes with dagre LR", async () => {
    const deps = makeDeps({
      workflowService: {
        ...makeDeps().workflowService,
        get: vi.fn(async () => ({
          id: "wf-1", name: "Test", description: "", version: "v1",
          createdAt: 1, updatedAt: 2, params: [],
          defaultProjectId: "project-1",
          nodes: [
            scriptNode("a", "Prompt A", 0, 0),
            scriptNode("b", "Prompt B", 0, 0),
            endNode("c", "End", 0, 0),
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
          defaultProjectId: "project-1",
          nodes: [
            scriptNode("a", "A", 0, 0),
            endNode("b", "B", 0, 0),
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
