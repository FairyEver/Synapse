import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { WorkflowRunSnapshot } from "../../../src/types/workflow"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow.snapshots")

const MAX = 20

export class RunSnapshotService {
  constructor(private readonly dataDir: string) {}
  private dir(wfId: string) { return path.join(this.dataDir, "workflow-runs", wfId) }
  private snapshotTime(s: WorkflowRunSnapshot): number { return s.startedAt || s.endedAt || 0 }

  private async readSnapshotFiles(workflowId: string): Promise<Array<{ file: string; snapshot: WorkflowRunSnapshot }>> {
    const dir = this.dir(workflowId)
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"))
    const entries = await Promise.all(files.map(async (file) => {
      try {
        const snapshot = JSON.parse(await readFile(path.join(dir, file), "utf-8")) as WorkflowRunSnapshot
        return { file, snapshot }
      } catch {
        return null
      }
    }))
    return entries.filter((entry): entry is { file: string; snapshot: WorkflowRunSnapshot } => entry !== null)
  }

  async save(s: WorkflowRunSnapshot): Promise<void> {
    try {
      const dir = this.dir(s.workflowId)
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, `${s.runId}.json`), JSON.stringify(s, null, 2), "utf-8")
      const snapshots = await this.readSnapshotFiles(s.workflowId)
      const stale = snapshots
        .sort((a, b) => this.snapshotTime(a.snapshot) - this.snapshotTime(b.snapshot))
        .slice(0, Math.max(0, snapshots.length - MAX))
      await Promise.all(stale.map(({ file }) => rm(path.join(dir, file), { force: true })))
    } catch (err) {
      logger.error("run snapshot save failed", {
        runId: s.runId,
        workflowId: s.workflowId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    }
  }

  async list(workflowId: string): Promise<WorkflowRunSnapshot[]> {
    try {
      return (await this.readSnapshotFiles(workflowId))
        .sort((a, b) => this.snapshotTime(b.snapshot) - this.snapshotTime(a.snapshot))
        .map(({ snapshot }) => snapshot)
    } catch { return [] }
  }

  async get(runId: string, workflowId: string): Promise<WorkflowRunSnapshot | null> {
    try { return JSON.parse(await readFile(path.join(this.dir(workflowId), `${runId}.json`), "utf-8")) as WorkflowRunSnapshot }
    catch { return null }
  }
}
