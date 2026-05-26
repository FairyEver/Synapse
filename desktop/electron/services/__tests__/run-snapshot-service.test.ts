import { randomUUID } from "node:crypto"
import { mkdir, readdir, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowRunSnapshot } from "../../../src/types/workflow"
import { RunSnapshotService } from "../workflow/run-snapshot-service"

const logger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
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
  logger.info.mockClear()
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

  it("cleans stale tmp files during save cleanup", async () => {
    const root = await tmpDir()
    const dir = path.join(root, "workflow-runs", "wf")
    await mkdir(dir, { recursive: true })
    const tmpPath = path.join(dir, "orphan.json.tmp")
    await writeFile(tmpPath, "partial", "utf-8")
    const past = new Date(Date.now() - 120_000)
    await utimes(tmpPath, past, past)
    const svc = new RunSnapshotService(root)

    await svc.save(snapshot("run", 100))

    expect((await readdir(dir)).some((file) => file.endsWith(".tmp"))).toBe(false)
  })

  it("sanitizes file paths from error messages in logs", async () => {
    const root = await tmpDir()
    const wfDir = path.join(root, "workflow-runs", "wf")
    await mkdir(wfDir, { recursive: true })
    // Create a "file" that's actually a directory — readFile fails with EISDIR on macOS,
    // and the error message contains the file path
    await mkdir(path.join(wfDir, "run-1.json"), { recursive: true })

    const svc = new RunSnapshotService(root)
    await svc.list("wf")

    const warnCall = logger.warn.mock.calls.find(
      (call: unknown[]) => call[0] === "run snapshot file corrupted or unreadable, skipping"
    )
    expect(warnCall).toBeDefined()
    const metadata = warnCall![1] as Record<string, unknown>
    expect(metadata.errorMessage).toBeDefined()
    // Should not contain any local file paths
    expect(String(metadata.errorMessage)).not.toContain(root)
    expect(String(metadata.errorMessage)).not.toMatch(/\/(?:Users|tmp|private)\//)
    expect(metadata).not.toHaveProperty("error")
    expect(metadata).not.toHaveProperty("stack")
  })

  it("continues findByRunId after a corrupted snapshot in another workflow directory", async () => {
    const root = await tmpDir()
    const badDir = path.join(root, "workflow-runs", "aaa-bad")
    const goodDir = path.join(root, "workflow-runs", "zzz-good")
    await mkdir(badDir, { recursive: true })
    await mkdir(goodDir, { recursive: true })
    await writeFile(path.join(badDir, "target-run.json"), "{", "utf-8")
    await writeFile(
      path.join(goodDir, "target-run.json"),
      JSON.stringify({ ...snapshot("target-run", 100), workflowId: "zzz-good" }),
      "utf-8",
    )

    const svc = new RunSnapshotService(root)

    await expect(svc.findByRunId("target-run")).resolves.toMatchObject({
      runId: "target-run",
      workflowId: "zzz-good",
    })
  })
})
