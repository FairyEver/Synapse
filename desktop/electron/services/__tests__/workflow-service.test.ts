import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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

import {
  DataRepositoryImpl,
  JsonNamespace,
  reviveWorkflowsEnvelope,
  workflowMigrationStateSchema,
  workflowsSchema,
  type WorkflowEntryV1,
  type WorkflowMigrationStateEntryV1,
} from "../../runtime/data-repo"
import { WorkflowService, type WorkflowServiceMigrationOptions } from "../workflow/workflow-service"
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

function createRepoAt(dir: string, options: WorkflowServiceMigrationOptions = {}): { repo: DataRepositoryImpl; svc: WorkflowService } {
  const repo = new DataRepositoryImpl()
  repo.register(workflowsSchema, new JsonNamespace({
    name: workflowsSchema.name,
    schemaVersion: workflowsSchema.currentVersion,
    backend: "json",
    filePath: path.join(dir, "workflows.json"),
    validate: workflowsSchema.validate,
    reviveEnvelope: reviveWorkflowsEnvelope,
  }))
  repo.register(workflowMigrationStateSchema, new JsonNamespace<WorkflowMigrationStateEntryV1>({
    name: workflowMigrationStateSchema.name,
    schemaVersion: workflowMigrationStateSchema.currentVersion,
    backend: "json",
    filePath: path.join(dir, "workflow.migration-state.json"),
    validate: workflowMigrationStateSchema.validate,
  }))
  const svc = new WorkflowService(repo, undefined, undefined, options)
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
  it.skipIf(process.platform === "win32")("rejects multi-resource defaults that resolve to the same local file", async () => {
    const { svc } = createRepo()
    const root = tmpDir()
    const filePath = path.join(root, "input.txt")
    const aliasPath = path.join(root, "input-alias.txt")
    writeFileSync(filePath, "input")
    symlinkSync(filePath, aliasPath)
    const def = {
      ...makeDef(),
      params: [{
        name: "inputs",
        type: "file",
        allowMultiple: true,
        default: [
          { kind: "local_path", entryType: "file", path: filePath },
          { kind: "local_path", entryType: "file", path: aliasPath },
        ],
      }],
    } satisfies WorkflowDefinition

    const result = await svc.save(def)

    expect(result).toEqual({
      errors: [{ type: "invalid_config", message: "参数「inputs」第 2 项与前面的资源重复" }],
    })
    expect(await svc.get(def.id)).toBeNull()
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
  it("rejects workflow_call resource bindings whose cardinality differs from the saved child workflow", async () => {
    const { svc } = createRepo()
    const child = {
      ...makeDef(),
      id: "child",
      params: [{ name: "input_file", type: "file", default: null }],
    } satisfies WorkflowDefinition
    await svc.save(child)
    const parent = {
      ...makeDef(),
      id: "parent",
      params: [{ name: "input_files", type: "file", default: null, allowMultiple: true }],
      nodes: [
        {
          id: "call",
          name: "调用",
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
        { id: "end", name: "结束", type: "end", position: { x: 400, y: 0 }, config: { outputType: "text", template: "", variables: [] } },
      ],
      edges: [{ id: "edge-1", from: "call", to: "end" }],
    } satisfies WorkflowDefinition

    const result = await svc.save(parent)

    expect("errors" in result).toBe(true)
    expect((result as { errors: Array<{ field?: string; message: string }> }).errors).toContainEqual(expect.objectContaining({
      field: "paramBindings",
      message: expect.stringContaining("资源类型或多选设置不一致"),
    }))
    expect(await svc.get("parent")).toBeNull()
  })
  it("rejects workflow_call multi-resource templates before saving", async () => {
    const { svc } = createRepo()
    await svc.save({
      ...makeDef(),
      id: "child",
      params: [{ name: "input_files", type: "file", default: null, allowMultiple: true }],
    })
    const parent = {
      ...makeDef(),
      id: "parent",
      nodes: [
        {
          id: "call",
          name: "调用",
          type: "workflow_call",
          position: { x: 0, y: 0 },
          config: {
            workflowId: "child",
            variables: [{ name: "files", source: { type: "static", value: "[]" } }],
            paramTemplates: { input_files: "{{files}}" },
            paramBindings: {},
          },
        },
        { id: "end", name: "结束", type: "end", position: { x: 400, y: 0 }, config: { outputType: "text", template: "", variables: [] } },
      ],
      edges: [{ id: "edge-1", from: "call", to: "end" }],
    } satisfies WorkflowDefinition

    const result = await svc.save(parent)

    expect("errors" in result).toBe(true)
    expect((result as { errors: Array<{ nodeId?: string; field?: string; message: string }> }).errors).toContainEqual(expect.objectContaining({
      nodeId: "call",
      field: "paramTemplates",
      message: expect.stringContaining("多选资源参数「input_files」"),
    }))
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
        loadError: "工作流数据迁移失败，原始数据已保留。",
        nodeCount: 0,
      }),
    ]))
    await expect(svc.get("broken-workflow")).rejects.toThrow("原始数据已保留")
  })
  it("isolates non-object and missing-id entries while preserving their raw values on later writes", async () => {
    const dir = tmpDir()
    const valid = { ...makeDef(), id: "valid-workflow" }
    const missingId = { name: "缺少 ID", unexpected: [1, 2, 3] }
    writeFileSync(path.join(dir, "workflows.json"), JSON.stringify({
      schemaVersion: 1,
      singleton: null,
      items: {
        [valid.id]: valid,
        "primitive-workflow": "raw-value",
        "missing-id-workflow": missingId,
      },
    }), "utf8")
    const svc = createRepoAt(dir).svc

    expect(await svc.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: valid.id, name: valid.name }),
      expect.objectContaining({ id: "primitive-workflow", loadError: expect.any(String) }),
      expect.objectContaining({ id: "missing-id-workflow", name: missingId.name, loadError: expect.any(String) }),
    ]))

    await svc.save({ ...valid, name: "Updated" })
    const persisted = JSON.parse(readFileSync(path.join(dir, "workflows.json"), "utf8"))
    expect(persisted.items["primitive-workflow"]).toBe("raw-value")
    expect(persisted.items["missing-id-workflow"]).toEqual(missingId)
  })
  it.each([
    ["future", { meta: { schemaVersion: "2.0.0" } }],
    ["failed", { nodes: undefined }],
  ])("does not overwrite an isolated %s workflow through save", async (_case, override) => {
    const dir = tmpDir()
    const original = { ...makeDef(), id: "protected-workflow", ...override }
    const raw = JSON.stringify({
      schemaVersion: 1,
      singleton: null,
      items: { [original.id]: original },
    })
    writeFileSync(path.join(dir, "workflows.json"), raw, "utf8")
    const svc = createRepoAt(dir).svc

    const result = await svc.save({ ...makeDef(), id: original.id, name: "Replacement" })

    expect(result).toMatchObject({
      errors: [expect.objectContaining({ message: expect.stringContaining("不能被覆盖") })],
    })
    expect(JSON.parse(readFileSync(path.join(dir, "workflows.json"), "utf8")).items[original.id])
      .toEqual(original)
  })
  it("exposes a future-schema workflow only through the raw export gateway", async () => {
    const dir = tmpDir()
    const original = {
      ...makeDef(),
      id: "future-export-workflow",
      meta: { schemaVersion: "2.0.0" },
      futureOnly: { mode: "preserve-exactly" },
    }
    writeFileSync(path.join(dir, "workflows.json"), JSON.stringify({
      schemaVersion: 1,
      singleton: null,
      items: { [original.id]: original },
    }), "utf8")
    const svc = createRepoAt(dir).svc

    await expect(svc.getExportDocument(original.id)).resolves.toEqual({
      kind: "future",
      document: original,
      sourceVersion: "2.0.0",
    })
    await expect(svc.get(original.id)).rejects.toThrow("更高的数据版本")
  })
  it("creates and verifies an exact backup before rewriting the current workflow store", async () => {
    const dir = tmpDir()
    const def = makeDef()
    const second = { ...makeDef(), id: "second-legacy-workflow" }
    const original = `${JSON.stringify({
      schemaVersion: 1,
      singleton: null,
      items: {
        [def.id]: { ...def, schemaVersion: 1 },
        [second.id]: { ...second, schemaVersion: 1 },
      },
    }, null, 2)}\n`
    writeFileSync(path.join(dir, "workflows.json"), original, "utf8")

    const guardedBatchUpsert = vi.spyOn(JsonNamespace.prototype, "upsertManyIfFileUnchanged")
    const svc = createRepoAt(dir, { dataRootPath: dir }).svc
    try {
      await svc.initialize()

      expect(guardedBatchUpsert).toHaveBeenCalledTimes(1)
      expect(guardedBatchUpsert.mock.calls[0]?.[0]).toHaveLength(2)
    } finally {
      guardedBatchUpsert.mockRestore()
    }

    const backups = readdirSync(path.join(dir, "workflow-migration-backups"))
    expect(backups).toHaveLength(1)
    expect(readFileSync(path.join(dir, "workflow-migration-backups", backups[0]!), "utf8")).toBe(original)
    expect((await svc.get(def.id))?.meta?.schemaVersion).toBe("1.0.0")
    expect((await svc.get(second.id))?.meta?.schemaVersion).toBe("1.0.0")
  })
  it("recovers the newest valid workflow from configured legacy repository storage only once", async () => {
    const dir = tmpDir()
    const repositoryPath = tmpDir()
    const def = { ...makeDef(), id: "legacy-recovered", name: "找回的工作流" }
    const legacyDir = path.join(repositoryPath, "workflows", def.id)
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(path.join(legacyDir, "v_100_valid.json"), JSON.stringify(def), "utf8")
    writeFileSync(path.join(legacyDir, "v_200_partial.json"), "{", "utf8")

    const options: WorkflowServiceMigrationOptions = {
      dataRootPath: dir,
      listLegacyRepositoryPaths: async () => [repositoryPath],
    }
    const first = createRepoAt(dir, options).svc
    await first.initialize()
    await expect(first.get(def.id)).resolves.toMatchObject({
      id: def.id,
      name: def.name,
      meta: { schemaVersion: "1.0.0" },
    })
    expect(readFileSync(path.join(legacyDir, "v_100_valid.json"), "utf8")).toBe(JSON.stringify(def))

    await first.delete(def.id)
    writeFileSync(path.join(legacyDir, "v_300_new.json"), JSON.stringify({
      ...def,
      name: "不应复活的新版本",
      updatedAt: def.updatedAt + 1,
    }), "utf8")
    const restarted = createRepoAt(dir, options).svc
    await restarted.initialize()
    await expect(restarted.get(def.id)).resolves.toBeNull()
  })
  it("isolates a legacy workflow whose document id is unsafe", async () => {
    const dir = tmpDir()
    const repositoryPath = tmpDir()
    const legacyDir = path.join(repositoryPath, "workflows", "safe-directory-name")
    const source = { ...makeDef(), id: "unsafe/workflow", name: "不应找回" }
    mkdirSync(legacyDir, { recursive: true })
    const sourceText = JSON.stringify(source)
    writeFileSync(path.join(legacyDir, "v_100.json"), sourceText, "utf8")

    const svc = createRepoAt(dir, {
      dataRootPath: dir,
      listLegacyRepositoryPaths: async () => [repositoryPath],
    }).svc
    await svc.initialize()

    expect(await svc.list()).toEqual([])
    expect(readFileSync(path.join(legacyDir, "v_100.json"), "utf8")).toBe(sourceText)
    const migrationState = JSON.parse(
      readFileSync(path.join(dir, "workflow.migration-state.json"), "utf8"),
    ) as { items: Record<string, WorkflowMigrationStateEntryV1> }
    expect(Object.values(migrationState.items)).toContainEqual(expect.objectContaining({
      workflowId: "unsafe/workflow",
      sourceKind: "legacy_repository",
      status: "failed",
      errorCode: "DataMigrationValidationError",
      errorMessage: expect.stringContaining("failed validation"),
    }))
  })
  it("keeps current workflows available when a configured legacy repository cannot be scanned", async () => {
    const dir = tmpDir()
    const repositoryPath = tmpDir()
    writeFileSync(path.join(repositoryPath, "workflows"), "not-a-directory", "utf8")
    const svc = createRepoAt(dir, {
      listLegacyRepositoryPaths: async () => [repositoryPath],
    }).svc
    const def = makeDef()

    expect(await svc.save(def)).toHaveProperty("versionHash")
    expect((await svc.get(def.id))?.name).toBe(def.name)
    expect(logger.warn).toHaveBeenCalledWith(
      "legacy repository workflow scan entry skipped",
      expect.objectContaining({ operation: "read_repository" }),
    )
  })
})
