import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import type { WorkflowRunSnapshot } from "../../../../src/types/workflow"
import { RunSnapshotService } from "../run-snapshot-service"

describe("RunSnapshotService", () => {
  it("prunes debug artifact directories with stale run snapshots", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "synapse-run-snapshots-"))
    const service = new RunSnapshotService(dataDir)

    try {
      for (let index = 0; index < 21; index += 1) {
        const runId = `run-${String(index).padStart(2, "0")}`
        const artifactDir = path.join(dataDir, "workflow-runs", runId, "nodes", "node-1", "codex")
        await mkdir(artifactDir, { recursive: true })
        await writeFile(path.join(artifactDir, "stdout.log"), `run ${index}`, "utf-8")
        await service.save(snapshot(runId, index))
      }

      await expectExists(path.join(dataDir, "workflow-runs", "workflow-1", "run-00.json"), false)
      await expectExists(path.join(dataDir, "workflow-runs", "run-00"), false)
      await expectExists(path.join(dataDir, "workflow-runs", "workflow-1", "run-20.json"), true)
      await expectExists(path.join(dataDir, "workflow-runs", "run-20", "nodes", "node-1", "codex", "stdout.log"), true)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it("protects future snapshot definitions without rewriting the stored snapshot", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "synapse-run-snapshots-"))
    const service = new RunSnapshotService(dataDir)
    const file = path.join(dataDir, "workflow-runs", "workflow-1", "run-future.json")
    const raw = {
      ...snapshot("run-future", 1),
      definition: {
        id: "workflow-1",
        name: "Future workflow",
        version: "v2",
        meta: { schemaVersion: "2.0.0" },
        nodes: [],
        edges: [],
        params: [],
        createdAt: 1,
        updatedAt: 1,
      },
    }

    try {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(raw), "utf-8")

      const loaded = await service.get("run-future", "workflow-1")

      expect(loaded?.definition).toBeUndefined()
      expect(loaded?.definitionMigration).toEqual({
        kind: "unsupported_future",
        sourceVersion: "2.0.0",
        targetVersion: "1.0.0",
      })
      await expect(readFile(file, "utf-8")).resolves.toBe(JSON.stringify(raw))
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it("returns an explicit diagnostic when a snapshot definition migration fails", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "synapse-run-snapshots-"))
    const service = new RunSnapshotService(dataDir)
    const file = path.join(dataDir, "workflow-runs", "workflow-1", "run-invalid.json")
    const raw = {
      ...snapshot("run-invalid", 1),
      definition: { meta: { schemaVersion: "1.0.0" } },
    }

    try {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(raw), "utf-8")

      const loaded = await service.get("run-invalid", "workflow-1")

      expect(loaded?.definition).toBeUndefined()
      expect(loaded?.definitionMigration).toEqual({
        kind: "failed",
        sourceVersion: "1.0.0",
      })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it("selects only the newest snapshot file candidates for bounded lists", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "synapse-run-snapshots-"))
    const service = new RunSnapshotService(dataDir)
    const snapshotDir = path.join(dataDir, "workflow-runs", "workflow-1")

    try {
      await mkdir(snapshotDir, { recursive: true })
      for (let index = 1; index <= 21; index += 1) {
        const file = path.join(snapshotDir, `run-${index}.json`)
        await writeFile(file, JSON.stringify(snapshot(`run-${index}`, index)), "utf-8")
        await utimes(file, index, index)
      }

      await expect(service.list("workflow-1", 2)).resolves.toEqual([
        expect.objectContaining({ runId: "run-21" }),
        expect.objectContaining({ runId: "run-20" }),
      ])
      await expect(service.list("workflow-1", 100)).resolves.toHaveLength(20)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

function snapshot(runId: string, startedAt: number): WorkflowRunSnapshot {
  return {
    runId,
    workflowId: "workflow-1",
    version: "1.0.0",
    startedAt,
    endedAt: startedAt + 1,
    status: "completed",
    params: {},
    nodeResults: {},
  }
}

async function expectExists(target: string, expected: boolean): Promise<void> {
  await expect(access(target).then(() => true, () => false)).resolves.toBe(expected)
}
