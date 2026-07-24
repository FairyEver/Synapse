import { describe, expect, it, vi } from "vitest"
import "../../../../workflow-nodes/register.main"
import { markImportedScriptTrust, WorkflowPackageService } from "../workflow-package-service"
import { collectUnconfirmedImportedScripts } from "../imported-script-trust"
import type { WorkflowDefinition } from "../../../../src/types/workflow"

describe("imported script trust", () => {
  it("marks every imported revision unconfirmed without adding resource grants", () => {
    const imported = markImportedScriptTrust(definition())
    expect(imported.scriptTrust).toEqual({ source: "imported", confirmed: false })
    expect(imported).not.toHaveProperty("networkGrants")
    expect(imported.nodes[0]?.config).not.toHaveProperty("fileGrants")
  })

  it("collects complete scripts from reachable imported child workflows", async () => {
    const child = markImportedScriptTrust(definition())
    const entry: WorkflowDefinition = {
      ...definition(),
      id: "entry",
      name: "Entry",
      scriptTrust: { source: "imported", confirmed: false },
      nodes: [
        startNode(),
        {
          id: "call",
          name: "Call child",
          type: "workflow_call",
          position: { x: 0, y: 0 },
          config: {
            workflowId: child.id,
            variables: [],
            paramTemplates: {},
            paramBindings: {},
          },
        },
        endNode(),
      ],
      edges: [
        { id: "start-call", from: "start", to: "call" },
        { id: "call-end", from: "call", to: "end" },
      ],
    }

    const review = await collectUnconfirmedImportedScripts({
      entry,
      loadWorkflow: async (id) => id === child.id ? child : null,
    })

    expect(review.definitions.map((item) => item.id)).toEqual([child.id])
    expect(review.scripts).toEqual([expect.objectContaining({
      workflowId: child.id,
      workflowName: child.name,
      nodeId: "node",
      runtime: "Node.js",
      source: "process.stdout.write('null')",
    })])
  })

  it("excludes disconnected scripts from the current execution set", async () => {
    const imported = markImportedScriptTrust({
      ...definition(),
      nodes: [
        startNode(),
        scriptNode("reachable", "process.stdout.write('null')"),
        scriptNode("disconnected", "process.stdout.write('\"should-not-review\"')"),
        endNode(),
      ],
      edges: [
        { id: "start-script", from: "start", to: "reachable" },
        { id: "script-end", from: "reachable", to: "end" },
      ],
    })

    const review = await collectUnconfirmedImportedScripts({
      entry: imported,
      loadWorkflow: async () => null,
    })

    expect(review.scripts.map((script) => script.nodeId)).toEqual(["reachable"])
    expect(review.scripts[0]?.source).not.toContain("should-not-review")
  })

  it("does not recurse into a child workflow from an unreachable call node", async () => {
    const child = markImportedScriptTrust(definition("child"))
    const entry = markImportedScriptTrust({
      ...definition("entry"),
      nodes: [
        startNode(),
        endNode(),
        {
          id: "unreachable-call",
          name: "Unreachable child",
          type: "workflow_call",
          position: { x: 0, y: 0 },
          config: {
            workflowId: child.id,
            variables: [],
            paramTemplates: {},
            paramBindings: {},
          },
        },
      ],
      edges: [{ id: "start-end", from: "start", to: "end" }],
    })
    const loadWorkflow = vi.fn(async (id: string) => id === child.id ? child : null)

    const review = await collectUnconfirmedImportedScripts({ entry, loadWorkflow })

    expect(review.scripts).toEqual([])
    expect(loadWorkflow).not.toHaveBeenCalled()
  })

  it("captures every reachable loaded revision in a multi-level run snapshot", async () => {
    const grandchild = definition("grandchild")
    const child = workflowCalling("child", grandchild.id)
    const entry = workflowCalling("entry", child.id)
    const definitions = new Map([
      [child.id, child],
      [grandchild.id, grandchild],
    ])

    const review = await collectUnconfirmedImportedScripts({
      entry,
      loadWorkflow: async (id) => definitions.get(id) ?? null,
    })

    expect(review.snapshotDefinitions.map(({ id, version }) => ({ id, version }))).toEqual([
      { id: "child", version: "v1" },
      { id: "entry", version: "v1" },
      { id: "grandchild", version: "v1" },
    ])
  })

  it("keeps a missing child absent from the collected run snapshot", async () => {
    const entry = workflowCalling("entry", "missing-child")
    const review = await collectUnconfirmedImportedScripts({
      entry,
      loadWorkflow: async () => null,
    })

    expect(review.snapshotDefinitions.map(({ id }) => id)).toEqual(["entry"])
    expect(review.reachableRevisions).toEqual([{ workflowId: "entry", revision: "v1" }])
  })

  it("keeps every runtime-reachable conditional branch in the review", async () => {
    const entry = markImportedScriptTrust({
      ...definition(),
      nodes: [
        startNode(),
        {
          id: "switch",
          name: "Condition",
          type: "switch",
          position: { x: 0, y: 0 },
          config: { branches: [] },
        },
        scriptNode("branch-a", "postMessage('a')", "javascript_run"),
        scriptNode("branch-b", "process.stdout.write('\"b\"')"),
        endNode(),
      ],
      edges: [
        { id: "start-switch", from: "start", to: "switch" },
        { id: "switch-a", from: "switch", to: "branch-a" },
        { id: "switch-b", from: "switch", to: "branch-b" },
        { id: "a-end", from: "branch-a", to: "end" },
        { id: "b-end", from: "branch-b", to: "end" },
      ],
    })

    const review = await collectUnconfirmedImportedScripts({
      entry,
      loadWorkflow: async () => null,
    })

    expect(review.scripts.map((script) => script.nodeId)).toEqual(["branch-a", "branch-b"])
  })

  it("confirms multiple imported definitions in one atomic save", async () => {
    const child = markImportedScriptTrust(definition("child"))
    const entry = markImportedScriptTrust({
      ...definition("entry"),
      nodes: [
        startNode(),
        scriptNode("entry-script", "process.stdout.write('null')"),
        {
          id: "call",
          name: "Child",
          type: "workflow_call",
          position: { x: 0, y: 0 },
          config: {
            workflowId: child.id,
            variables: [],
            paramTemplates: {},
            paramBindings: {},
          },
        },
        endNode(),
      ],
      edges: [
        { id: "start-script", from: "start", to: "entry-script" },
        { id: "script-call", from: "entry-script", to: "call" },
        { id: "call-end", from: "call", to: "end" },
      ],
    })
    const save = vi.fn()
    const commitAtomicBatch = vi.fn(async () => ({
      errors: [{ type: "invalid_config" as const, message: "atomic failure" }],
    }))
    const definitions = new Map([[entry.id, entry], [child.id, child]])
    const service = new WorkflowPackageService({
      workflowService: {
        get: vi.fn(async (id) => definitions.get(id) ?? null),
        getExportDocument: vi.fn(async (id) => {
          const document = definitions.get(id)
          return document ? { kind: "current" as const, document } : null
        }),
        getLegacyMigrationExportDocument: vi.fn(),
        save,
        commitAtomicBatch: commitAtomicBatch as never,
      },
      providerService: { listProviders: vi.fn(async () => []) },
      permissionGuard: { check: vi.fn() },
      auditSink: { record: vi.fn() },
    })

    const preview = await service.prepareImportedScriptsForRun(entry)
    expect(preview.status).toBe("confirmation_required")
    if (preview.status !== "confirmation_required") return

    const result = await service.prepareImportedScriptsForRun(
      entry,
      preview.errors[0].details.confirmationToken,
    )

    expect(result).toEqual({
      status: "save_failed",
      errors: [{ type: "invalid_config", message: "atomic failure" }],
    })
    expect(commitAtomicBatch).toHaveBeenCalledOnce()
    const [savedDefinitions, removeIds, expectedRevisions] = commitAtomicBatch.mock.calls[0] as unknown as [
      WorkflowDefinition[],
      string[],
      Map<string, string | null>,
    ]
    expect(savedDefinitions.map((item: WorkflowDefinition) => item.id)).toEqual(["child", "entry"])
    expect(savedDefinitions.every((item: WorkflowDefinition) => item.scriptTrust?.confirmed)).toBe(true)
    expect(removeIds).toEqual([])
    expect(expectedRevisions).toEqual(new Map([["entry", "v1"], ["child", "v1"]]))
    expect(save).not.toHaveBeenCalled()
    expect(entry.scriptTrust?.confirmed).toBe(false)
    expect(child.scriptTrust?.confirmed).toBe(false)
  })

  it("returns a complete new review without committing when a child changes after preview", async () => {
    const childV1 = markImportedScriptTrust(definition("child"))
    const entry = {
      ...definition("entry"),
      nodes: [
        startNode(),
        {
          id: "call",
          name: "Child",
          type: "workflow_call",
          position: { x: 0, y: 0 },
          config: {
            workflowId: childV1.id,
            variables: [],
            paramTemplates: {},
            paramBindings: {},
          },
        },
        endNode(),
      ],
      edges: [
        { id: "start-call", from: "start", to: "call" },
        { id: "call-end", from: "call", to: "end" },
      ],
    }
    const childV2 = {
      ...childV1,
      version: "v2",
      nodes: childV1.nodes.map((node) => node.id === "node"
        ? { ...node, config: { ...node.config, source: "process.stdout.write('\"child-v2\"')" } }
        : node),
    }
    let currentChild = childV1
    const commitAtomicBatch = vi.fn(async (
      definitions: readonly WorkflowDefinition[],
      _removeIds: readonly string[],
      _expectedRevisions: ReadonlyMap<string, string | null>,
    ) => ({
      versions: new Map(definitions.map((definition) => [definition.id, `${definition.version}-confirmed`])),
      snapshot: {
        previous: [currentChild],
        next: definitions.map((definition) => ({
          ...definition,
          version: `${definition.version}-confirmed`,
        })),
      },
    }))
    const service = new WorkflowPackageService({
      workflowService: {
        get: vi.fn(async (id) => id === entry.id ? entry : currentChild),
        getExportDocument: vi.fn(async (id) => ({
          kind: "current" as const,
          document: id === entry.id ? entry : currentChild,
        })),
        getLegacyMigrationExportDocument: vi.fn(),
        save: vi.fn(),
        commitAtomicBatch: commitAtomicBatch as never,
      },
      providerService: { listProviders: vi.fn(async () => []) },
      permissionGuard: { check: vi.fn() },
      auditSink: { record: vi.fn() },
    })

    const previewV1 = await service.prepareImportedScriptsForRun(entry)
    expect(previewV1.status).toBe("confirmation_required")
    if (previewV1.status !== "confirmation_required") return
    expect(previewV1.errors[0].details.scripts).toEqual([
      expect.objectContaining({ workflowId: "child", source: "process.stdout.write('null')" }),
    ])

    currentChild = childV2
    const changed = await service.prepareImportedScriptsForRun(
      entry,
      previewV1.errors[0].details.confirmationToken,
    )
    expect(changed.status).toBe("confirmation_required")
    if (changed.status !== "confirmation_required") return
    expect(changed.errors[0].details.confirmationToken)
      .not.toBe(previewV1.errors[0].details.confirmationToken)
    expect(changed.errors[0].details.scripts).toEqual([
      expect.objectContaining({ workflowId: "child", source: "process.stdout.write('\"child-v2\"')" }),
    ])
    expect(commitAtomicBatch).not.toHaveBeenCalled()

    const confirmed = await service.prepareImportedScriptsForRun(
      entry,
      changed.errors[0].details.confirmationToken,
    )

    expect(confirmed).toEqual(expect.objectContaining({
      status: "ready",
      definition: entry,
    }))
    expect(commitAtomicBatch).toHaveBeenCalledOnce()
    expect(commitAtomicBatch.mock.calls[0]?.[2]).toEqual(new Map([
      ["entry", "v1"],
      ["child", "v2"],
    ]))
  })

  it("returns the authoritative entry revision after confirming the entry itself", async () => {
    const entry = markImportedScriptTrust(definition("entry"))
    const authoritative = {
      ...entry,
      version: "v2-confirmed",
      scriptTrust: { source: "imported" as const, confirmed: true },
    }
    const service = new WorkflowPackageService({
      workflowService: {
        get: vi.fn(async () => entry),
        getExportDocument: vi.fn(async () => ({ kind: "current" as const, document: entry })),
        getLegacyMigrationExportDocument: vi.fn(),
        save: vi.fn(),
        commitAtomicBatch: vi.fn(async () => ({
          versions: new Map([["entry", authoritative.version]]),
          snapshot: { previous: [entry], next: [authoritative] },
        })) as never,
      },
      providerService: { listProviders: vi.fn(async () => []) },
      permissionGuard: { check: vi.fn() },
      auditSink: { record: vi.fn() },
    })

    const preview = await service.prepareImportedScriptsForRun(entry)
    expect(preview.status).toBe("confirmation_required")
    if (preview.status !== "confirmation_required") return

    await expect(service.prepareImportedScriptsForRun(
      entry,
      preview.errors[0].details.confirmationToken,
    )).resolves.toEqual(expect.objectContaining({
      status: "ready",
      definition: authoritative,
    }))
  })

  it("returns the reviewed child snapshot when current storage changes after confirmation", async () => {
    const childV1 = markImportedScriptTrust(definition("child"))
    const childV2 = {
      ...childV1,
      version: "v2",
      nodes: childV1.nodes.map((node) => node.id === "node"
        ? { ...node, config: { ...node.config, source: "process.stdout.write('\"unreviewed-v2\"')" } }
        : node),
    }
    const entry = workflowCalling("entry", childV1.id)
    let currentChild = childV1
    const service = new WorkflowPackageService({
      workflowService: {
        get: vi.fn(async (id) => id === entry.id ? entry : currentChild),
        getExportDocument: vi.fn(),
        getLegacyMigrationExportDocument: vi.fn(),
        save: vi.fn(),
        commitAtomicBatch: vi.fn(async (definitions: readonly WorkflowDefinition[]) => {
          const confirmed = definitions.map((item) => ({
            ...item,
            version: `${item.version}-confirmed`,
          }))
          currentChild = childV2
          return {
            versions: new Map(confirmed.map((item) => [item.id, item.version])),
            snapshot: { previous: definitions, next: confirmed },
          }
        }) as never,
      },
      providerService: { listProviders: vi.fn(async () => []) },
      permissionGuard: { check: vi.fn() },
      auditSink: { record: vi.fn() },
    })

    const preview = await service.prepareImportedScriptsForRun(entry)
    expect(preview.status).toBe("confirmation_required")
    if (preview.status !== "confirmation_required") return

    const ready = await service.prepareImportedScriptsForRun(
      entry,
      preview.errors[0].details.confirmationToken,
    )

    expect(ready.status).toBe("ready")
    if (ready.status !== "ready") return
    expect(ready.snapshotDefinitions.find(({ id }) => id === childV1.id)).toMatchObject({
      version: "v1-confirmed",
      scriptTrust: { source: "imported", confirmed: true },
    })
    expect(JSON.stringify(ready.snapshotDefinitions)).not.toContain("unreviewed-v2")
  })

  it("keeps a confirmed child revision fixed after the no-confirmation check completes", async () => {
    const childV1 = {
      ...definition("child"),
      scriptTrust: { source: "imported" as const, confirmed: true },
    }
    const childV2 = {
      ...childV1,
      version: "v2",
      scriptTrust: { source: "imported" as const, confirmed: false },
      nodes: childV1.nodes.map((node) => node.id === "node"
        ? { ...node, config: { ...node.config, source: "process.stdout.write('\"late-v2\"')" } }
        : node),
    }
    const entry = workflowCalling("entry", childV1.id)
    let currentChild = childV1
    const service = new WorkflowPackageService({
      workflowService: {
        get: vi.fn(async (id) => id === entry.id ? entry : currentChild),
        getExportDocument: vi.fn(),
        getLegacyMigrationExportDocument: vi.fn(),
        save: vi.fn(),
        commitAtomicBatch: vi.fn(),
      },
      providerService: { listProviders: vi.fn(async () => []) },
      permissionGuard: { check: vi.fn() },
      auditSink: { record: vi.fn() },
    })

    const ready = await service.prepareImportedScriptsForRun(entry)
    currentChild = childV2

    expect(ready.status).toBe("ready")
    if (ready.status !== "ready") return
    expect(ready.snapshotDefinitions.find(({ id }) => id === childV1.id)).toBe(childV1)
    expect(JSON.stringify(ready.snapshotDefinitions)).not.toContain("late-v2")
  })

  it("returns a retryable conflict instead of replacing a stale runDefinition root", async () => {
    const requested = definition("entry")
    const stored = { ...requested, version: "v2" }
    const service = new WorkflowPackageService({
      workflowService: {
        get: vi.fn(async () => stored),
        getExportDocument: vi.fn(),
        getLegacyMigrationExportDocument: vi.fn(),
        save: vi.fn(),
        commitAtomicBatch: vi.fn(),
      },
      providerService: { listProviders: vi.fn(async () => []) },
      permissionGuard: { check: vi.fn() },
      auditSink: { record: vi.fn() },
    })

    await expect(service.prepareImportedScriptsForRun(requested)).resolves.toEqual({
      status: "version_conflict",
      errors: [{
        type: "invalid_config",
        message: "工作流已更新，请重新加载后再运行",
        retryable: true,
      }],
    })
  })
})

function definition(id = "imported"): WorkflowDefinition {
  return {
    id,
    name: "Imported",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    meta: { schemaVersion: "2.7.0" },
    params: [],
    edges: [
      { id: "start-node", from: "start", to: "node" },
      { id: "node-end", from: "node", to: "end" },
    ],
    nodes: [
      startNode(),
      scriptNode("node", "process.stdout.write('null')"),
      endNode(),
    ],
  }
}

function startNode(): WorkflowDefinition["nodes"][number] {
  return {
    id: "start",
    name: "Start",
    type: "start",
    position: { x: 0, y: 0 },
    config: {},
  }
}

function endNode(): WorkflowDefinition["nodes"][number] {
  return {
    id: "end",
    name: "End",
    type: "end",
    position: { x: 0, y: 0 },
    config: {},
  }
}

function scriptNode(
  id: string,
  source: string,
  type: "nodejs_run" | "javascript_run" = "nodejs_run",
): WorkflowDefinition["nodes"][number] {
  return {
    id,
    name: id,
    type,
    position: { x: 0, y: 0 },
    config: {
      source,
      inputs: [],
      timeoutSeconds: 60,
      saveRunContent: true,
      ...(type === "nodejs_run" ? { moduleMode: "commonjs" as const } : {}),
    },
  }
}

function workflowCalling(id: string, childId: string): WorkflowDefinition {
  return {
    ...definition(id),
    nodes: [
      startNode(),
      {
        id: "call",
        name: "Call child",
        type: "workflow_call",
        position: { x: 0, y: 0 },
        config: {
          workflowId: childId,
          variables: [],
          paramTemplates: {},
          paramBindings: {},
        },
      },
      endNode(),
    ],
    edges: [
      { id: "start-call", from: "start", to: "call" },
      { id: "call-end", from: "call", to: "end" },
    ],
  }
}
