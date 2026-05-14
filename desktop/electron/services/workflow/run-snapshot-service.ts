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
    let files: string[]
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json"))
    } catch (err) {
      logger.warn("run snapshot readdir failed", {
        workflowId,
        ...snapshotErrorMetadata(err),
      })
      return []
    }
    const entries = await Promise.all(files.map(async (file) => {
      try {
        const snapshot = JSON.parse(await readFile(path.join(dir, file), "utf-8")) as WorkflowRunSnapshot
        return { file, snapshot }
      } catch (err) {
        logger.warn("run snapshot file corrupted or unreadable, skipping", {
          workflowId, file,
          ...snapshotErrorMetadata(err),
        })
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
        ...snapshotErrorMetadata(err),
      })
    }
  }

  async list(workflowId: string): Promise<WorkflowRunSnapshot[]> {
    try {
      return (await this.readSnapshotFiles(workflowId))
        .sort((a, b) => this.snapshotTime(b.snapshot) - this.snapshotTime(a.snapshot))
        .map(({ snapshot }) => snapshot)
    } catch (err) {
      logger.warn("run snapshot list failed", {
        workflowId,
        ...snapshotErrorMetadata(err),
      })
      return []
    }
  }

  async get(runId: string, workflowId: string): Promise<WorkflowRunSnapshot | null> {
    try {
      return JSON.parse(await readFile(path.join(this.dir(workflowId), `${runId}.json`), "utf-8")) as WorkflowRunSnapshot
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // ENOENT is expected when the snapshot simply doesn't exist — no need to warn
      if (code !== "ENOENT") {
        logger.warn("run snapshot get failed", {
          runId, workflowId,
          ...snapshotErrorMetadata(err),
        })
      }
      return null
    }
  }
}

function snapshotErrorMetadata(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly code?: string
} {
  const message = error instanceof Error ? error.message : String(error)
  const code = errorCode(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
    ...(code ? { code } : {}),
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  const code = (error as NodeJS.ErrnoException).code
  return typeof code === "string" ? code : undefined
}
