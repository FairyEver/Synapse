import { randomUUID } from "node:crypto"
import { mkdtempSync } from "node:fs"
import { rmSync } from "node:fs"
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

import { DataRepositoryImpl, JsonNamespace, workflowsSchema, type WorkflowEntryV1 } from "../../runtime/data-repo"
import { WorkflowService } from "../workflow/workflow-service"
import type { WorkflowDefinition } from "../../../src/types/workflow"
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

function createRepo(): { repo: DataRepositoryImpl; svc: WorkflowService } {
  const dir = tmpDir()
  const repo = new DataRepositoryImpl()
  repo.register(workflowsSchema, new JsonNamespace({
    name: workflowsSchema.name,
    schemaVersion: workflowsSchema.currentVersion,
    backend: "json",
    filePath: path.join(dir, "workflows.json"),
    validate: workflowsSchema.validate,
  }))
  const svc = new WorkflowService(repo)
  return { repo, svc }
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
})
