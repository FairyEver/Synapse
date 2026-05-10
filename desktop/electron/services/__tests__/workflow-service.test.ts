import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }))

import { WorkflowService } from "../workflow/workflow-service"
import type { WorkflowDefinition } from "../../../src/types/workflow"

const roots: string[] = []
async function tmpDir() {
  const d = path.join(os.tmpdir(), `wf-svc-${randomUUID()}`)
  await mkdir(d, { recursive: true }); roots.push(d); return d
}
afterEach(() => Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))))

function makeDef(): WorkflowDefinition {
  return { id: randomUUID(), name: "WF", version: "", createdAt: 0, updatedAt: 0, params: [], nodes: [], edges: [] }
}

describe("WorkflowService", () => {
  it("save + list + get roundtrip", async () => {
    const svc = new WorkflowService(await tmpDir())
    const def = makeDef()
    const r = await svc.save(def)
    expect("versionHash" in r && (r as { versionHash: string }).versionHash).toMatch(/^v_/)
    expect((await svc.list()).some((m) => m.id === def.id)).toBe(true)
    expect((await svc.get(def.id))?.name).toBe("WF")
  })
  it("latest save wins when saved twice", async () => {
    const svc = new WorkflowService(await tmpDir())
    const def = makeDef()
    await svc.save(def)
    await svc.save({ ...def, name: "Updated" })
    expect((await svc.get(def.id))?.name).toBe("Updated")
  })
  it("delete removes workflow", async () => {
    const svc = new WorkflowService(await tmpDir())
    const def = makeDef()
    await svc.save(def); await svc.delete(def.id)
    expect(await svc.get(def.id)).toBeNull()
  })
})
