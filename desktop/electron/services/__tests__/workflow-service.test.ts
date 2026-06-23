import { randomUUID } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }))
const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))
vi.mock("../log-store", () => ({
  createMainLogger: () => logger,
}))

import { DataRepositoryImpl, JsonNamespace, reviveWorkflowsEnvelope, workflowsSchema, type WorkflowEntryV1 } from "../../runtime/data-repo"
import { WorkflowService } from "../workflow/workflow-service"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import { defaultCodexNodeConfig } from "../../../workflow-nodes/codex/schema"
import "../../../workflow-nodes/register.main"

const roots: string[] = []
function tmpDir() {
  const d = mkdtempSync(path.join(os.tmpdir(), "wf-svc-"))
  roots.push(d); return d
}
afterEach(() => {
  logger.info.mockClear()
  logger.warn.mockClear()
  logger.error.mockClear()
  for (const r of roots.splice(0)) {
    rmSync(r, { recursive: true, force: true })
  }
})

function createRepoAt(dir: string): { repo: DataRepositoryImpl; svc: WorkflowService } {
  const repo = new DataRepositoryImpl()
  repo.register(workflowsSchema, new JsonNamespace({
    name: workflowsSchema.name,
    schemaVersion: workflowsSchema.currentVersion,
    backend: "json",
    filePath: path.join(dir, "workflows.json"),
    validate: workflowsSchema.validate,
    reviveEnvelope: reviveWorkflowsEnvelope,
  }))
  const svc = new WorkflowService(repo)
  return { repo, svc }
}

function createRepo(): { repo: DataRepositoryImpl; svc: WorkflowService; dir: string } {
  const dir = tmpDir()
  return { ...createRepoAt(dir), dir }
}

function makeDef(): WorkflowDefinition {
  const id = randomUUID()
  return {
    id, name: "WF", version: "", createdAt: 0, updatedAt: 0, params: [],
    nodes: [{ id: "end", name: "结束", type: "end", position: { x: 400, y: 0 }, config: { outputType: "text", template: "", variables: [] } }],
    edges: [],
  }
}

describe("WorkflowService", () => {
  it("save + list + get roundtrip", async () => {
    const { svc } = createRepo()
    const def = makeDef()
    const r = await svc.save(def)
    expect("versionHash" in r && (r as { versionHash: string }).versionHash).toMatch(/^v_/)
    expect((await svc.list()).some((m) => m.id === def.id)).toBe(true)
    expect((await svc.get(def.id))?.name).toBe("WF")
  })
  it("latest save wins when saved twice", async () => {
    const { svc } = createRepo()
    const def = makeDef()
    await svc.save(def)
    await svc.save({ ...def, name: "Updated" })
    expect((await svc.get(def.id))?.name).toBe("Updated")
  })
  it("delete removes workflow", async () => {
    const { svc } = createRepo()
    const def = makeDef()
    await svc.save(def); await svc.delete(def.id)
    expect(await svc.get(def.id)).toBeNull()
  })
  it("cleans workflow parameter presets when deleting a workflow", async () => {
    const { repo, svc } = createRepo()
    const cleanup = { deleteForWorkflow: vi.fn(async () => undefined) }
    const withCleanup = new WorkflowService(repo, undefined, cleanup)
    const def = makeDef()

    await svc.save(def)
    await withCleanup.delete(def.id)

    expect(cleanup.deleteForWorkflow).toHaveBeenCalledWith(def.id)
  })
  it("returns empty list when no workflows exist", async () => {
    const { svc } = createRepo()
    const list = await svc.list()
    expect(list).toEqual([])
  })
  it("lists recently updated or created workflows first", async () => {
    const { repo, svc } = createRepo()
    const workflows = repo.namespace<WorkflowEntryV1>("workflows")
    const base = makeDef()
    const olderUpdated = { ...base, id: "wf-old-edit", name: "Older edit", createdAt: 100, updatedAt: 200 }
    const latestCreated = { ...base, id: "wf-latest-create", name: "Latest create", createdAt: 300, updatedAt: 300 }
    const latestUpdated = { ...base, id: "wf-latest-edit", name: "Latest edit", createdAt: 50, updatedAt: 500 }
    const newerCreatedSameUpdate = { ...base, id: "wf-tie-newer-create", name: "Tie newer create", createdAt: 400, updatedAt: 300 }

    await workflows.upsert({ ...olderUpdated, schemaVersion: 1 })
    await workflows.upsert({ ...latestCreated, schemaVersion: 1 })
    await workflows.upsert({ ...latestUpdated, schemaVersion: 1 })
    await workflows.upsert({ ...newerCreatedSameUpdate, schemaVersion: 1 })

    expect((await svc.list()).map((workflow) => workflow.id)).toEqual([
      "wf-latest-edit",
      "wf-tie-newer-create",
      "wf-latest-create",
      "wf-old-edit",
    ])
  })
  it("returns null for missing workflow", async () => {
    const { svc } = createRepo()
    expect(await svc.get("nonexistent")).toBeNull()
  })
  it("create returns id and versionHash and is retrievable", async () => {
    const { svc } = createRepo()
    const result = await svc.create()
    expect("id" in result && typeof result.id === "string").toBe(true)
    expect("versionHash" in result && (result as { versionHash: string }).versionHash).toMatch(/^v_/)
    const id = (result as { id: string }).id
    const def = await svc.get(id)
    expect(def).not.toBeNull()
    expect(def!.name).toBe("新工作流")
    expect(def!.defaultNodeTimeoutMins).toBe(60)
    expect(def!.nodes).toHaveLength(1)
    expect(def!.nodes[0].type).toBe("end")
  })
  it("create stores the supplied default project", async () => {
    const { svc } = createRepo()
    const result = await svc.create("project-1")
    expect("id" in result).toBe(true)
    if (!("id" in result)) return
    const def = await svc.get(result.id)
    expect(def?.defaultProjectId).toBe("project-1")
  })
  it("create stores the supplied default provider model", async () => {
    const { svc } = createRepo()
    const result = await svc.create(undefined, { providerId: "provider-1", modelTier: "sonnet" })
    expect("id" in result).toBe(true)
    if (!("id" in result)) return
    const def = await svc.get(result.id)
    expect(def?.defaultProviderId).toBe("provider-1")
    expect(def?.defaultModelTier).toBe("sonnet")
  })
  it("rejects invalid workflow and returns structured errors", async () => {
    const { svc } = createRepo()
    const def = { ...makeDef(), nodes: [] }
    const result = await svc.save(def)
    expect("errors" in result).toBe(true)
    expect((result as { errors: unknown[] }).errors.length).toBeGreaterThan(0)
  })
  it("rejects workflows without a valid id before persisting", async () => {
    const { svc } = createRepo()
    const def = { ...makeDef(), id: "" }
    const result = await svc.save(def)
    expect("errors" in result).toBe(true)
    expect((result as { errors: Array<{ message: string }> }).errors[0].message).toContain("ID")
    expect(await svc.list()).toEqual([])
  })
  it("rejects codex workflows with stale default projects before persisting", async () => {
    const { repo } = createRepo()
    const svc = new WorkflowService(repo, async () => ({ configuredProjectIds: ["project-1"] }))
    const def: WorkflowDefinition = {
      ...makeDef(),
      defaultProjectId: "deleted-project",
      nodes: [
        {
          id: "codex-1",
          name: "Codex",
          type: "codex",
          position: { x: 0, y: 0 },
          config: { ...defaultCodexNodeConfig, prompt: "Run codex" },
        },
        { id: "end", name: "结束", type: "end", position: { x: 400, y: 0 }, config: { outputType: "text", template: "", variables: [] } },
      ],
      edges: [{ id: "edge-1", from: "codex-1", to: "end" }],
    }

    const result = await svc.save(def)

    expect("errors" in result).toBe(true)
    expect((result as { errors: Array<{ field?: string; message: string }> }).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "defaultProjectId",
        message: expect.stringContaining("deleted-project"),
      }),
    ]))
    expect(await svc.list()).toEqual([])
  })
  it("rejects workflow_call references to missing child workflows before persisting", async () => {
    const { svc } = createRepo()
    const parent = {
      ...makeDef(),
      id: "parent",
      nodes: [
        { id: "call", name: "调用", type: "workflow_call", position: { x: 0, y: 0 }, config: { workflowId: "deleted-child", variables: [], paramTemplates: {} } },
        { id: "end", name: "结束", type: "end", position: { x: 400, y: 0 }, config: { outputType: "text", template: "{{result}}", variables: [{ name: "result", source: { type: "node_output", node: "call" } }] } },
      ],
      edges: [{ id: "edge-1", from: "call", to: "end" }],
    } satisfies WorkflowDefinition

    const result = await svc.save(parent)

    expect("errors" in result).toBe(true)
    expect((result as { errors: Array<{ field?: string; message: string }> }).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "workflowId",
        message: "节点「调用」调用的子工作流不存在，请重新选择工作流",
      }),
    ]))
    expect(await svc.get("parent")).toBeNull()
  })
  it("normalizes nullable optional metadata before persisting so restart can list workflows", async () => {
    const { svc, dir } = createRepo()
    const dirty = {
      ...makeDef(),
      description: null,
      defaultProjectId: null,
      defaultProviderId: null,
      defaultModelTier: null,
      defaultNodeTimeoutMins: 0,
    } as unknown as WorkflowDefinition

    const result = await svc.save(dirty)
    expect("versionHash" in result).toBe(true)

    const restarted = createRepoAt(dir).svc
    await expect(restarted.list()).resolves.toHaveLength(1)
    const stored = JSON.parse(readFileSync(path.join(dir, "workflows.json"), "utf8"))
    const item = stored.items[dirty.id]
    expect(item.description).toBeUndefined()
    expect(item.defaultProjectId).toBeUndefined()
    expect(item.defaultProviderId).toBeUndefined()
    expect(item.defaultModelTier).toBeUndefined()
    expect(item.defaultNodeTimeoutMins).toBeUndefined()
  })
  it("revives legacy workflow records with nullable optional fields and missing param defaults", async () => {
    const dir = tmpDir()
    const def = makeDef()
    writeFileSync(path.join(dir, "workflows.json"), JSON.stringify({
      schemaVersion: 1,
      singleton: null,
      items: {
        [def.id]: {
          ...def,
          schemaVersion: 1,
          description: null,
          defaultProjectId: null,
          defaultProviderId: null,
          defaultModelTier: null,
          defaultNodeTimeoutMins: null,
          params: [{ name: "topic", type: "text" }],
        },
      },
    }), "utf8")

    const svc = createRepoAt(dir).svc
    await expect(svc.list()).resolves.toEqual([
      expect.objectContaining({ id: def.id, name: def.name, nodeCount: 1 }),
    ])
    await expect(svc.get(def.id)).resolves.toMatchObject({
      id: def.id,
      params: [{ name: "topic", type: "text", default: null }],
    })
  })
  it("isolates unrecoverable workflow records instead of failing the whole list", async () => {
    const dir = tmpDir()
    const valid = makeDef()
    writeFileSync(path.join(dir, "workflows.json"), JSON.stringify({
      schemaVersion: 1,
      singleton: null,
      items: {
        [valid.id]: { ...valid, schemaVersion: 1 },
        "broken-workflow": {
          id: "broken-workflow",
          schemaVersion: 1,
          name: "坏工作流",
          version: "v_broken",
          createdAt: 100,
          updatedAt: 200,
          params: [],
          edges: [],
        },
      },
    }), "utf8")

    const svc = createRepoAt(dir).svc
    const list = await svc.list()
    expect(list).toHaveLength(2)
    expect(list).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: valid.id, name: valid.name }),
      expect.objectContaining({
        id: "broken-workflow",
        name: "坏工作流",
        loadError: "工作流数据格式异常",
        nodeCount: 0,
      }),
    ]))
    await expect(svc.get("broken-workflow")).resolves.toMatchObject({
      id: "broken-workflow",
      loadError: "工作流数据格式异常",
      nodes: [],
      edges: [],
      params: [],
    })
  })
})
