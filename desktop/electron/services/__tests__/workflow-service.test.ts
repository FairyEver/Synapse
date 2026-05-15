import { randomUUID } from "node:crypto"
import { mkdir, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
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

import { WorkflowService } from "../workflow/workflow-service"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import "../../../workflow-nodes/register.main"

const roots: string[] = []
async function tmpDir() {
  const d = path.join(os.tmpdir(), `wf-svc-${randomUUID()}`)
  await mkdir(d, { recursive: true }); roots.push(d); return d
}
afterEach(async () => {
  logger.info.mockClear()
  logger.warn.mockClear()
  logger.error.mockClear()
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})

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
    const dir = await tmpDir()
    const svc = new WorkflowService(() => dir)
    const def = makeDef()
    const r = await svc.save(def)
    expect("versionHash" in r && (r as { versionHash: string }).versionHash).toMatch(/^v_/)
    expect((await svc.list()).some((m) => m.id === def.id)).toBe(true)
    expect((await svc.get(def.id))?.name).toBe("WF")
  })
  it("latest save wins when saved twice", async () => {
    const dir = await tmpDir()
    const svc = new WorkflowService(() => dir)
    const def = makeDef()
    await svc.save(def)
    await svc.save({ ...def, name: "Updated" })
    expect((await svc.get(def.id))?.name).toBe("Updated")
  })
  it("falls back to the previous valid version when the latest version is corrupted", async () => {
    const dir = await tmpDir()
    const svc = new WorkflowService(() => dir)
    const def = makeDef()
    await svc.save(def)
    await svc.save({ ...def, name: "Updated" })
    const workflowDir = path.join(dir, "workflows", def.id)
    const versions = (await readdir(workflowDir)).filter((f) => f.endsWith(".json")).sort()
    await writeFile(path.join(workflowDir, versions[versions.length - 1]!), "{not json", "utf-8")

    expect((await svc.get(def.id))?.name).toBe("WF")
  })
  it("delete removes workflow", async () => {
    const dir = await tmpDir()
    const svc = new WorkflowService(() => dir)
    const def = makeDef()
    await svc.save(def); await svc.delete(def.id)
    expect(await svc.get(def.id)).toBeNull()
  })
  it("skips corrupted workflow versions without failing the whole list", async () => {
    const dir = await tmpDir()
    const svc = new WorkflowService(() => dir)
    const def = makeDef()
    await svc.save(def)
    await mkdir(path.join(dir, "workflows", "bad-workflow"), { recursive: true })
    await writeFile(
      path.join(dir, "workflows", "bad-workflow", "v_9999999999999_00000000_bad.json"),
      "{not json",
      "utf-8",
    )

    await expect(svc.get("bad-workflow")).resolves.toBeNull()
    await expect(svc.list()).resolves.toEqual([
      expect.objectContaining({ id: def.id, name: "WF" }),
    ])

    expect(logger.warn).toHaveBeenCalledWith("workflow get failed", {
      boundary: "workflow-service.get",
      id: "bad-workflow",
      versionFile: "v_9999999999999_00000000_bad.json",
      errorName: "SyntaxError",
      errorCode: undefined,
      errorLength: expect.any(Number),
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("{not json")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(dir)
  })
  it("logs workflow list read failures without leaking the repo path", async () => {
    const repoPath = path.join(os.tmpdir(), "wf-svc-secret-root", randomUUID())
    const svc = new WorkflowService(() => repoPath)

    await expect(svc.list()).resolves.toEqual([])

    expect(logger.warn).toHaveBeenCalledWith("workflow list failed", {
      boundary: "workflow-service.list",
      repoBasename: path.basename(repoPath),
      repoPathLength: repoPath.length,
      errorName: "Error",
      errorCode: "ENOENT",
      errorLength: expect.any(Number),
    })
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(repoPath)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(repoPath)
  })

  it("logs workflow get directory read failures without leaking the repo path", async () => {
    const repoPath = path.join(os.tmpdir(), "wf-svc-secret-get-root", randomUUID())
    const svc = new WorkflowService(() => repoPath)

    await expect(svc.get("missing-workflow")).resolves.toBeNull()

    expect(logger.info).toHaveBeenCalledWith("workflow get: not found", {
      boundary: "workflow-service.get.not-found",
      id: "missing-workflow",
      repoBasename: path.basename(repoPath),
      repoPathLength: repoPath.length,
      errorName: "Error",
      errorCode: "ENOENT",
      errorLength: expect.any(Number),
    })
    const logPayload = JSON.stringify(logger.info.mock.calls)
    expect(logPayload).not.toContain(repoPath)
    expect(logPayload).not.toContain("wf-svc-secret-get-root")
  })

  it("logs workflow save failures without raw filesystem error text", async () => {
    const repoPath = path.join(os.tmpdir(), "wf-svc-secret-save-root", randomUUID())
    roots.push(repoPath)
    await mkdir(path.dirname(repoPath), { recursive: true })
    await writeFile(repoPath, "not a directory", "utf-8")
    const svc = new WorkflowService(() => repoPath)

    await expect(svc.save(makeDef())).resolves.toEqual({
      errors: [{ type: "invalid_config", message: "保存失败：磁盘空间不足或权限不足，请检查后重试" }],
    })

    expect(logger.error).toHaveBeenCalledWith("workflow save failed — disk write error", {
      boundary: "workflow-service.save",
      id: expect.any(String),
      name: "WF",
      repoBasename: path.basename(repoPath),
      repoPathLength: repoPath.length,
      errorName: "Error",
      errorCode: "ENOTDIR",
      errorLength: expect.any(Number),
    })
    const logPayload = JSON.stringify(logger.error.mock.calls)
    expect(logPayload).not.toContain(repoPath)
    expect(logPayload).not.toContain("wf-svc-secret-save-root")
    expect(logPayload).not.toContain("not a directory")
  })

  it("logs workflow delete failures without raw filesystem error text", async () => {
    const repoPath = path.join(os.tmpdir(), "wf-svc-secret-delete-root", randomUUID())
    roots.push(repoPath)
    await mkdir(path.dirname(repoPath), { recursive: true })
    await writeFile(repoPath, "not a directory", "utf-8")
    const svc = new WorkflowService(() => repoPath)

    await expect(svc.delete("workflow-secret-id")).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith("workflow delete error", {
      boundary: "workflow-service.delete",
      id: "workflow-secret-id",
      repoBasename: path.basename(repoPath),
      repoPathLength: repoPath.length,
      errorName: "Error",
      errorCode: "ENOTDIR",
      errorLength: expect.any(Number),
    })
    const logPayload = JSON.stringify(logger.warn.mock.calls)
    expect(logPayload).not.toContain(repoPath)
    expect(logPayload).not.toContain("wf-svc-secret-delete-root")
    expect(logPayload).not.toContain("not a directory")
  })
})
