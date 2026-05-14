import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowRunSnapshot } from "../../../src/types/workflow"
import { RunSnapshotService } from "../workflow/run-snapshot-service"

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => logger,
}))

const roots: string[] = []

async function tmpDir() {
  const d = path.join(os.tmpdir(), `wf-runs-${randomUUID()}`)
  await mkdir(d, { recursive: true })
  roots.push(d)
  return d
}

beforeEach(() => {
  logger.error.mockClear()
  logger.warn.mockClear()
})

afterEach(() => Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))))

function snapshot(runId: string, startedAt: number): WorkflowRunSnapshot {
  return {
    runId,
    workflowId: "wf",
    version: "v1",
    startedAt,
    status: "completed",
    params: {},
    nodeResults: {},
  }
}

describe("RunSnapshotService", () => {
  it("lists snapshots by run start time descending", async () => {
    const svc = new RunSnapshotService(await tmpDir())
    await svc.save(snapshot("older", 100))
    await svc.save(snapshot("newer", 300))
    await svc.save(snapshot("middle", 200))

    expect((await svc.list("wf")).map((s) => s.runId)).toEqual(["newer", "middle", "older"])
  })

  it("retains the latest 20 snapshots by run start time", async () => {
    const svc = new RunSnapshotService(await tmpDir())
    for (let i = 0; i < 21; i += 1) await svc.save(snapshot(`run-${i}`, i))

    const runs = await svc.list("wf")
    expect(runs).toHaveLength(20)
    expect(runs[0]?.runId).toBe("run-20")
    expect(runs.some((run) => run.runId === "run-0")).toBe(false)
  })

  it("logs snapshot filesystem failures with sanitized diagnostics", async () => {
    const root = await tmpDir()
    const svc = new RunSnapshotService(root)

    await expect(svc.list("wf-missing")).resolves.toEqual([])

    expect(logger.warn).toHaveBeenCalledWith("run snapshot readdir failed", expect.objectContaining({
      workflowId: "wf-missing",
      errorName: expect.any(String),
      errorLength: expect.any(Number),
      code: "ENOENT",
    }))
    const metadata = logger.warn.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(metadata).not.toHaveProperty("error")
    expect(metadata).not.toHaveProperty("stack")
    expect(JSON.stringify(metadata)).not.toContain(root)
  })
})
