import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { WorkflowRunSnapshot } from "../../../src/types/workflow"

const MAX = 20

export class RunSnapshotService {
  constructor(private readonly dataDir: string) {}
  private dir(wfId: string) { return path.join(this.dataDir, "workflow-runs", wfId) }

  async save(s: WorkflowRunSnapshot): Promise<void> {
    const dir = this.dir(s.workflowId)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${s.runId}.json`), JSON.stringify(s, null, 2), "utf-8")
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()
    await Promise.all(files.slice(0, Math.max(0, files.length - MAX)).map((f) => rm(path.join(dir, f), { force: true })))
  }

  async list(workflowId: string): Promise<WorkflowRunSnapshot[]> {
    try {
      const files = (await readdir(this.dir(workflowId))).filter((f) => f.endsWith(".json")).sort().reverse()
      return (await Promise.all(files.map(async (f) => {
        try { return JSON.parse(await readFile(path.join(this.dir(workflowId), f), "utf-8")) as WorkflowRunSnapshot }
        catch { return null }
      }))).filter(Boolean) as WorkflowRunSnapshot[]
    } catch { return [] }
  }

  async get(runId: string, workflowId: string): Promise<WorkflowRunSnapshot | null> {
    try { return JSON.parse(await readFile(path.join(this.dir(workflowId), `${runId}.json`), "utf-8")) as WorkflowRunSnapshot }
    catch { return null }
  }
}
