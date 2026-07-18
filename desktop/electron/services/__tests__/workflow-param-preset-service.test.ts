import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import {
  DataRepositoryImpl,
  JsonNamespace,
  reviveWorkflowParamPresetsEnvelope,
  workflowParamPresetsSchema,
  type WorkflowParamPresetEntryV1,
  type WorkflowParamPresetEntryV2,
} from "../../runtime/data-repo"
import { WorkflowParamPresetService } from "../workflow/workflow-param-preset-service"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function createService(): WorkflowParamPresetService {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wf-param-presets-"))
  roots.push(dir)
  const repo = new DataRepositoryImpl()
  repo.register(workflowParamPresetsSchema, new JsonNamespace({
    name: workflowParamPresetsSchema.name,
    schemaVersion: workflowParamPresetsSchema.currentVersion,
    backend: "json",
    filePath: path.join(dir, "workflow.param-presets.json"),
    validate: workflowParamPresetsSchema.validate,
  }))
  return new WorkflowParamPresetService(repo)
}

describe("WorkflowParamPresetService", () => {
  it("lists presets by workflowId and keeps workflows isolated", async () => {
    const service = createService()
    await service.save({ workflowId: "workflow-a", name: "课程标题", values: { topic: "A" } })
    await service.save({ workflowId: "workflow-b", name: "课程标题", values: { topic: "B" } })

    expect(await service.list("workflow-a")).toEqual([
      expect.objectContaining({ workflowId: "workflow-a", name: "课程标题", values: { topic: "A" } }),
    ])
    expect(await service.list("workflow-b")).toEqual([
      expect.objectContaining({ workflowId: "workflow-b", name: "课程标题", values: { topic: "B" } }),
    ])
  })

  it("rejects duplicate names in one workflow unless overwritePresetId is supplied", async () => {
    const service = createService()
    const first = await service.save({ workflowId: "workflow-a", name: "课程标题", values: { topic: "A" } })

    await expect(
      service.save({ workflowId: "workflow-a", name: "课程标题", values: { topic: "B" } }),
    ).rejects.toThrow("Preset name already exists")

    const overwritten = await service.save({
      workflowId: "workflow-a",
      name: "课程标题",
      values: { topic: "B" },
      overwritePresetId: first.id,
    })

    expect(overwritten.id).toBe(first.id)
    expect(overwritten.values).toEqual({ topic: "B" })
    expect(overwritten.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
  })

  it("trims names, rejects empty names, deletes presets, and removes a workflow's presets", async () => {
    const service = createService()
    await expect(service.save({ workflowId: "workflow-a", name: "   ", values: {} }))
      .rejects.toThrow("Preset name is required")

    const first = await service.save({ workflowId: "workflow-a", name: "  A  ", values: { text: "one" } })
    const second = await service.save({ workflowId: "workflow-a", name: "B", values: { text: "two" } })
    expect(first.name).toBe("A")

    await service.delete(second.id)
    expect((await service.list("workflow-a")).map((preset) => preset.id)).toEqual([first.id])

    await service.deleteForWorkflow("workflow-a")
    expect(await service.list("workflow-a")).toEqual([])
  })

  it("stores ordered multi-resource path arrays", async () => {
    const service = createService()
    const root = mkdtempSync(path.join(os.tmpdir(), "wf-param-resources-"))
    roots.push(root)
    const firstPath = path.join(root, "a.txt")
    const secondPath = path.join(root, "b.txt")
    writeFileSync(firstPath, "a")
    writeFileSync(secondPath, "b")
    const saved = await service.save({
      workflowId: "workflow-a",
      name: "多文件",
      values: { files: [firstPath, secondPath] },
    })

    expect(saved.values).toEqual({ files: [firstPath, secondPath] })
    expect(saved.resourceEntryTypes).toEqual({ files: "file" })
    expect(await service.list("workflow-a")).toEqual([expect.objectContaining({ values: saved.values })])
  })

  it("lists presets without resource IO and resolves current types on demand", async () => {
    const service = createService()
    const root = mkdtempSync(path.join(os.tmpdir(), "wf-param-resources-"))
    roots.push(root)
    const filePath = path.join(root, "input.txt")
    writeFileSync(filePath, "input")

    const saved = await service.save({
      workflowId: "workflow-a",
      name: "资源类型",
      values: { files: [filePath], directories: [root] },
    })
    expect(saved.resourceEntryTypes).toEqual({ files: "file", directories: "directory" })

    rmSync(filePath)
    expect(await service.list("workflow-a")).toEqual([
      expect.objectContaining({
        resourceEntryTypes: {},
      }),
    ])
    await expect(service.resolveResourceEntryTypes(saved.id)).resolves.toEqual({
      files: "unavailable",
      directories: "directory",
    })
  })

  it("resolves current types for single-resource string values", async () => {
    const service = createService()
    const root = mkdtempSync(path.join(os.tmpdir(), "wf-param-resources-"))
    roots.push(root)
    const filePath = path.join(root, "input.txt")
    writeFileSync(filePath, "input")

    const saved = await service.save({
      workflowId: "workflow-a",
      name: "单资源类型",
      values: { input: filePath },
    })

    expect(saved.resourceEntryTypes).toEqual({ input: "file" })
    await expect(service.resolveResourceEntryTypes(saved.id)).resolves.toEqual({ input: "file" })
  })

  it("rejects resource type resolution for a missing preset", async () => {
    const service = createService()

    await expect(service.resolveResourceEntryTypes("missing")).rejects.toThrow("Preset not found")
  })

  it("rejects multi-resource aliases that resolve to the same path", async () => {
    const service = createService()
    const root = mkdtempSync(path.join(os.tmpdir(), "wf-param-resources-"))
    roots.push(root)
    const filePath = path.join(root, "input.txt")
    const aliasPath = path.join(root, "input-alias.txt")
    writeFileSync(filePath, "input")
    symlinkSync(filePath, aliasPath, "file")

    await expect(service.save({
      workflowId: "workflow-a",
      name: "重复文件",
      values: { files: [filePath, aliasPath] },
    })).rejects.toThrow("Preset param files contains duplicate paths")

    expect(await service.list("workflow-a")).toEqual([])
  })

  it("normalizes invalid stored values out of the namespace", () => {
    const valid: WorkflowParamPresetEntryV2 = {
      id: "preset-1",
      schemaVersion: 2,
      workflowId: "workflow-a",
      name: "A",
      values: { topic: "value" },
      createdAt: 1,
      updatedAt: 1,
    }

    expect(workflowParamPresetsSchema.validate(valid)).toBe(true)
    expect(workflowParamPresetsSchema.validate({ ...valid, values: { files: ["/tmp/a.txt"] } })).toBe(true)
    expect(workflowParamPresetsSchema.validate({ ...valid, values: { files: [] } })).toBe(false)
    expect(workflowParamPresetsSchema.validate({ ...valid, values: { count: 1 } })).toBe(false)
    expect(workflowParamPresetsSchema.validate({ ...valid, workflowId: "" })).toBe(false)
  })

  it("revives v1 string presets as v2 entries", () => {
    const legacy: WorkflowParamPresetEntryV1 = {
      id: "preset-1",
      schemaVersion: 1,
      workflowId: "workflow-a",
      name: "A",
      values: { topic: "value" },
      createdAt: 1,
      updatedAt: 1,
    }

    expect(reviveWorkflowParamPresetsEnvelope({
      schemaVersion: 1,
      singleton: null,
      items: { [legacy.id]: legacy },
    })).toEqual({
      schemaVersion: 2,
      singleton: null,
      items: { [legacy.id]: { ...legacy, schemaVersion: 2 } },
    })
  })
})
