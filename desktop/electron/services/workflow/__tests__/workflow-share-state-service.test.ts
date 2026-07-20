import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DataRepositoryImpl,
  JsonNamespace,
  workflowShareStateSchema,
  type WorkflowShareStateEntryV1,
} from "../../../runtime/data-repo"
import type { WorkflowDefinition } from "../../../../src/types/workflow"
import { WorkflowShareStateService } from "../workflow-share-state-service"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }))
vi.mock("../../log-store", () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function definition(version: string, name = "工作流"): WorkflowDefinition {
  return {
    id: "workflow-1",
    name,
    version,
    createdAt: 1,
    updatedAt: 1,
    meta: { schemaVersion: "2.0.0" },
    params: [],
    nodes: [{ id: "end", name: "结束", type: "end", position: { x: 0, y: 0 }, config: { outputType: "text", template: "", variables: [] } }],
    edges: [],
  }
}

function harness() {
  const root = mkdtempSync(path.join(os.tmpdir(), "workflow-share-state-"))
  roots.push(root)
  const repo = new DataRepositoryImpl()
  repo.register(workflowShareStateSchema, new JsonNamespace<WorkflowShareStateEntryV1>({
    name: workflowShareStateSchema.name,
    schemaVersion: workflowShareStateSchema.currentVersion,
    backend: "json",
    filePath: path.join(root, "state.json"),
    validate: workflowShareStateSchema.validate,
  }))
  const workflows = new Map<string, WorkflowDefinition>()
  const enabled = new Map([["automation-1", true]])
  const workflowService = {
    restoreAtomicSnapshot: vi.fn(async (upserts: readonly WorkflowDefinition[], removeIds: readonly string[]) => {
      removeIds.forEach((id) => workflows.delete(id))
      upserts.forEach((item) => workflows.set(item.id, structuredClone(item)))
    }),
    getExportDocument: vi.fn(async (id: string) => {
      const item = workflows.get(id)
      return item ? { kind: "current" as const, document: structuredClone(item) } : null
    }),
  }
  const automation = {
    getEnabled: vi.fn(async (id: string) => enabled.get(id) ?? null),
    setEnabled: vi.fn(async (id: string, value: boolean) => { enabled.set(id, value) }),
  }
  return { repo, workflows, enabled, workflowService, automation }
}

describe("WorkflowShareStateService", () => {
  it("reuses one export lineage for later artifacts from the same workflow", async () => {
    const h = harness()
    const service = new WorkflowShareStateService(h.repo, h.workflowService, () => 5, h.automation)
    const createLineageId = vi.fn(() => "lineage-export")

    const first = await service.getOrCreateExportLineage({ workflowId: "workflow-1", createLineageId })
    const second = await service.getOrCreateExportLineage({ workflowId: "workflow-1", createLineageId })

    expect(first.lineageId).toBe("lineage-export")
    expect(second.lineageId).toBe(first.lineageId)
    expect(createLineageId).toHaveBeenCalledTimes(1)
  })

  it("commits a lineage record and restores the previous definition and Automation state on undo", async () => {
    const h = harness()
    const oldDefinition = definition("old", "旧版")
    const newDefinition = definition("new", "新版")
    h.workflows.set(oldDefinition.id, oldDefinition)
    const service = new WorkflowShareStateService(h.repo, h.workflowService, () => 10, h.automation)
    const transaction = await service.prepareImport({
      lineageId: "lineage-1",
      artifactId: "artifact-1",
      packageDigest: "sha256:test",
      sourceRevisions: { root: "source-new" },
      workflowIds: { root: newDefinition.id },
      selections: { models: [], projects: [], resources: [], environments: [] },
      nextRemoveIds: [],
      automationChanges: [{ id: "automation-1", enabled: false }],
    }, {
      previous: [oldDefinition],
      next: [newDefinition],
      removedIds: [],
      newlyCreatedIds: [],
    })
    h.workflows.set(newDefinition.id, newDefinition)
    await service.commitImport(transaction)

    expect((await service.getOrigin("lineage-1"))?.artifactId).toBe("artifact-1")
    expect(h.enabled.get("automation-1")).toBe(false)
    const undo = await service.getUndoPlan("lineage-1")
    expect(undo).not.toBeNull()
    const undoTransaction = await service.prepareUndo("lineage-1", undo!, {
      previous: [newDefinition],
      next: [oldDefinition],
      removedIds: [],
      newlyCreatedIds: [],
    })
    h.workflows.set(oldDefinition.id, oldDefinition)
    await service.commitImport(undoTransaction)
    expect(h.workflows.get("workflow-1")?.name).toBe("旧版")
    expect(h.enabled.get("automation-1")).toBe(true)
    expect(await service.getUndoPlan("lineage-1")).toBeNull()
  })

  it("rolls a prepared crash journal forward during startup recovery", async () => {
    const h = harness()
    const oldDefinition = definition("old", "旧版")
    const newDefinition = definition("new", "新版")
    h.workflows.set(oldDefinition.id, oldDefinition)
    const first = new WorkflowShareStateService(h.repo, h.workflowService, () => 20, h.automation)
    await first.prepareImport({
      lineageId: "lineage-2",
      artifactId: "artifact-2",
      packageDigest: "sha256:test-2",
      sourceRevisions: { root: "source-new" },
      workflowIds: { root: newDefinition.id },
      selections: { models: [], projects: [], resources: [], environments: [] },
      nextRemoveIds: [],
    }, {
      previous: [oldDefinition],
      next: [newDefinition],
      removedIds: [],
      newlyCreatedIds: [],
    })

    const recovered = new WorkflowShareStateService(h.repo, h.workflowService, () => 30, h.automation)
    await recovered.initialize()
    expect(h.workflows.get("workflow-1")?.name).toBe("新版")
    expect((await recovered.getOrigin("lineage-2"))?.artifactId).toBe("artifact-2")
  })

  it("rolls a prepared undo journal forward during startup recovery", async () => {
    const h = harness()
    const oldDefinition = definition("old", "旧版")
    const newDefinition = definition("new", "新版")
    h.workflows.set(oldDefinition.id, oldDefinition)
    const first = new WorkflowShareStateService(h.repo, h.workflowService, () => 35, h.automation)
    const imported = await first.prepareImport({
      lineageId: "lineage-undo-recovery",
      artifactId: "artifact-undo-recovery",
      packageDigest: "sha256:undo-recovery",
      sourceRevisions: { root: "source-new" },
      workflowIds: { root: newDefinition.id },
      selections: { models: [], projects: [], resources: [], environments: [] },
      nextRemoveIds: [],
      automationChanges: [{ id: "automation-1", enabled: false }],
    }, {
      previous: [oldDefinition],
      next: [newDefinition],
      removedIds: [],
      newlyCreatedIds: [],
    })
    h.workflows.set(newDefinition.id, newDefinition)
    await first.commitImport(imported)
    const undo = await first.getUndoPlan("lineage-undo-recovery")
    await first.prepareUndo("lineage-undo-recovery", undo!, {
      previous: [newDefinition],
      next: [oldDefinition],
      removedIds: [],
      newlyCreatedIds: [],
    })

    const recovered = new WorkflowShareStateService(h.repo, h.workflowService, () => 36, h.automation)
    await recovered.initialize()

    expect(h.workflows.get("workflow-1")?.name).toBe("旧版")
    expect(await recovered.getOrigin("lineage-undo-recovery")).toBeNull()
    expect(await recovered.getUndoPlan("lineage-undo-recovery")).toBeNull()
    expect(h.enabled.get("automation-1")).toBe(true)
  })

  it("records the imported revision required by a later undo", async () => {
    const h = harness()
    const oldDefinition = definition("old", "旧版")
    const newDefinition = definition("new", "新版")
    h.workflows.set(oldDefinition.id, oldDefinition)
    const service = new WorkflowShareStateService(h.repo, h.workflowService, () => 40, h.automation)
    const transaction = await service.prepareImport({
      lineageId: "lineage-3",
      artifactId: "artifact-3",
      packageDigest: "sha256:test-3",
      sourceRevisions: { root: "source-new" },
      workflowIds: { root: newDefinition.id },
      selections: { models: [], projects: [], resources: [], environments: [] },
      nextRemoveIds: [],
    }, {
      previous: [oldDefinition],
      next: [newDefinition],
      removedIds: [],
      newlyCreatedIds: [],
    })
    h.workflows.set(newDefinition.id, newDefinition)
    await service.commitImport(transaction)
    expect((await service.getUndoPlan("lineage-3"))?.expectedRevisions).toEqual({ "workflow-1": "new" })
  })

  it("removes lineage and undo state when an imported entrypoint group is deleted", async () => {
    const h = harness()
    const root = definition("root-version", "入口")
    const child = { ...definition("child-version", "子工作流"), id: "workflow-child" }
    h.workflows.set(root.id, root)
    h.workflows.set(child.id, child)
    const service = new WorkflowShareStateService(h.repo, h.workflowService, () => 50, h.automation)
    const imported = await service.prepareImport({
      lineageId: "lineage-delete",
      artifactId: "artifact-delete",
      packageDigest: "sha256:delete",
      sourceRevisions: { root: "source-root", child: "source-child" },
      workflowIds: { root: root.id, child: child.id },
      entrypointRefs: ["root"],
      selections: { models: [], projects: [], resources: [], environments: [] },
      nextRemoveIds: [],
    }, {
      previous: [],
      next: [root, child],
      removedIds: [],
      newlyCreatedIds: [root.id, child.id],
    })
    await service.commitImport(imported)

    const deletion = await service.prepareDelete(
      "lineage-delete",
      [root.id, child.id],
      true,
      { previous: [root, child], next: [], removedIds: [root.id, child.id], newlyCreatedIds: [] },
    )
    h.workflows.clear()
    await service.commitImport(deletion)

    expect(await service.getOrigin("lineage-delete")).toBeNull()
    expect(await service.getUndoPlan("lineage-delete")).toBeNull()
  })
})
