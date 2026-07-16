import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises"
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
  it("rejects unsafe workflow ids before writing snapshots outside workflow-runs", async () => {
    const root = await tmpDir()
    const svc = new RunSnapshotService(root)
    const unsafeSnapshot = {
      ...snapshot("run-escape", 100),
      workflowId: "../escaped-workflow",
    }

    await expect(svc.save(unsafeSnapshot)).rejects.toThrow("Invalid workflow id")
    await expect(readdir(path.join(root, "escaped-workflow"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects unsafe run ids before writing snapshots outside workflow directories", async () => {
    const root = await tmpDir()
    const svc = new RunSnapshotService(root)
    const unsafeSnapshot = {
      ...snapshot("../escaped-run", 100),
      workflowId: "wf",
    }

    await expect(svc.save(unsafeSnapshot)).rejects.toThrow("Invalid workflow run id")
    await expect(readdir(path.join(root, "workflow-runs"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects unsafe workflow ids before deleting snapshot directories", async () => {
    const root = await tmpDir()
    const escapedDir = path.join(root, "escaped-workflow")
    await mkdir(escapedDir, { recursive: true })
    await writeFile(path.join(escapedDir, "keep.txt"), "keep", "utf-8")
    const svc = new RunSnapshotService(root)

    await expect(svc.deleteWorkflow("../escaped-workflow")).rejects.toThrow("Invalid workflow id")
    await expect(readdir(escapedDir)).resolves.toEqual(["keep.txt"])
  })

  it("deletes run-id artifact directories referenced by workflow snapshots", async () => {
    const root = await tmpDir()
    const svc = new RunSnapshotService(root)
    await svc.save(snapshot("run-artifacts", 100))
    const artifactDir = path.join(root, "workflow-runs", "run-artifacts", "nodes", "codex-1", "codex")
    await mkdir(artifactDir, { recursive: true })
    await writeFile(path.join(artifactDir, "prompt.txt"), "secret prompt", "utf-8")

    await svc.deleteWorkflow("wf")

    await expect(readdir(path.join(root, "workflow-runs", "wf"))).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readdir(path.join(root, "workflow-runs", "run-artifacts", "nodes"))).rejects.toMatchObject({ code: "ENOENT" })
  })

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

  it("redacts Code X config override values before writing snapshot files", async () => {
    const root = await tmpDir()
    const svc = new RunSnapshotService(root)
    await svc.save({
      ...snapshot("run-secret", 100),
      definition: {
        id: "wf",
        name: "Workflow",
        version: "v1",
        createdAt: 1,
        updatedAt: 2,
        params: [],
        edges: [],
        nodes: [
          {
            id: "codex-1",
            name: "Code X",
            type: "codex",
            position: { x: 0, y: 0 },
            config: {
              configOverrides: [{ key: "ANTHROPIC_API_KEY", value: "sk-raw-secret" }],
            },
          },
        ],
      },
    })

    const raw = await readFile(path.join(root, "workflow-runs", "wf", "run-secret.json"), "utf-8")
    const listed = await svc.list("wf")

    expect(raw).not.toContain("sk-raw-secret")
    expect(raw).toContain("[redacted]")
    expect(JSON.stringify(listed)).not.toContain("sk-raw-secret")
  })

  it("redacts workflow params before writing snapshot files", async () => {
    const root = await tmpDir()
    const svc = new RunSnapshotService(root)
    await svc.save({
      ...snapshot("run-param-secret", 100),
      params: {
        apiToken: "sk-param-secret",
        nested: {
          password: "plain-password",
          note: "Authorization: Bearer raw-token at /Users/liyang/private.txt",
        },
      },
    })

    const raw = await readFile(path.join(root, "workflow-runs", "wf", "run-param-secret.json"), "utf-8")
    const listed = await svc.list("wf")

    expect(raw).toContain("[redacted]")
    expect(raw).toContain("[path]")
    expect(raw).not.toContain("sk-param-secret")
    expect(raw).not.toContain("plain-password")
    expect(raw).not.toContain("raw-token")
    expect(raw).not.toContain("/Users/liyang/private.txt")
    expect(JSON.stringify(listed)).not.toContain("sk-param-secret")
  })

  it("sanitizes file paths from error messages in logs", async () => {
    const root = await tmpDir()
    const wfDir = path.join(root, "workflow-runs", "wf")
    await mkdir(wfDir, { recursive: true })
    // Keep a local path in malformed JSON so the parse error exercises log sanitization.
    await writeFile(path.join(wfDir, "run-1.json"), `${root}/private.json`, "utf-8")

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

  it("migrates an old snapshot definition in memory without rewriting the history file", async () => {
    const root = await tmpDir()
    const workflowDir = path.join(root, "workflow-runs", "wf")
    await mkdir(workflowDir, { recursive: true })
    const legacy = {
      ...snapshot("legacy-run", 100),
      definition: {
        id: "wf",
        name: "Legacy",
        version: "v1",
        createdAt: 1,
        updatedAt: 2,
        params: [],
        nodes: [{ id: "end", name: "结束", type: "end", position: { x: 0, y: 0 }, config: {} }],
        edges: [],
      },
    }
    const raw = JSON.stringify(legacy)
    const target = path.join(workflowDir, "legacy-run.json")
    await writeFile(target, raw, "utf8")

    const listed = await new RunSnapshotService(root).list("wf")

    expect(listed[0]?.definition?.meta?.schemaVersion).toBe("1.0.0")
    expect(await readFile(target, "utf8")).toBe(raw)
  })

  it("rejects unsafe run ids before reading snapshots outside workflow-runs", async () => {
    const root = await tmpDir()
    const escapedDir = path.join(root, "escaped-workflow")
    await mkdir(escapedDir, { recursive: true })
    await writeFile(
      path.join(escapedDir, "target.json"),
      JSON.stringify({ ...snapshot("target", 100), workflowId: "escaped-workflow" }),
      "utf-8",
    )
    const svc = new RunSnapshotService(root)

    await expect(svc.findByRunId("../escaped-workflow/target")).rejects.toThrow("Invalid workflow run id")
    await expect(svc.findByRunId("bad/id")).rejects.toThrow("Invalid workflow run id")
    await expect(svc.findByRunId("bad\\id")).rejects.toThrow("Invalid workflow run id")
    await expect(svc.get("../escaped-workflow/target", "wf")).rejects.toThrow("Invalid workflow run id")
    await expect(svc.get("bad/id", "wf")).rejects.toThrow("Invalid workflow run id")
    await expect(svc.get("bad\\id", "wf")).rejects.toThrow("Invalid workflow run id")
  })
})
