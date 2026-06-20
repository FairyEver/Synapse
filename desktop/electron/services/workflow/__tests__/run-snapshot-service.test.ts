import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
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
