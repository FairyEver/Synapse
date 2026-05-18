import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import type { WorkflowRunSnapshot } from "../../../src/types/workflow"
import { createMainLogger } from "../log-store"
import { errorCode } from "./workflow-utils"

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
        const raw = JSON.parse(await readFile(path.join(dir, file), "utf-8"))
        if (!isValidSnapshotShape(raw)) {
          logger.warn("run snapshot file has invalid structure, skipping", { workflowId, file })
          return null
        }
        return { file, snapshot: raw as WorkflowRunSnapshot }
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
    const dir = this.dir(s.workflowId)
    try {
      await mkdir(dir, { recursive: true })
      const target = path.join(dir, `${s.runId}.json`)
      const tmp = `${target}.tmp`
      await writeFile(tmp, JSON.stringify(s, null, 2), "utf-8")
      await rename(tmp, target)
      logger.info("run snapshot saved", { runId: s.runId, workflowId: s.workflowId, status: s.status, nodeCount: Object.keys(s.nodeResults).length })
    } catch (err) {
      logger.error("run snapshot save failed", {
        runId: s.runId,
        workflowId: s.workflowId,
        ...snapshotErrorMetadata(err),
      })
      throw err
    }
    // Stale cleanup is best-effort — a failure here should not invalidate the save above
    try {
      const snapshots = await this.readSnapshotFiles(s.workflowId)
      const stale = snapshots
        .sort((a, b) => this.snapshotTime(a.snapshot) - this.snapshotTime(b.snapshot))
        .slice(0, Math.max(0, snapshots.length - MAX))
      const tmpFiles = (await readdir(dir)).filter((file) => file.endsWith(".tmp"))
      const now = Date.now()
      const STALE_TMP_AGE_MS = 60_000
      const staleTmpFiles = (await Promise.all(
        tmpFiles.map(async (file) => {
          try {
            const st = await stat(path.join(dir, file))
            return now - st.mtimeMs > STALE_TMP_AGE_MS ? file : null
          } catch { return null }
        }),
      )).filter((f): f is string => f !== null)
      await Promise.all([
        ...stale.map(({ file }) => rm(path.join(dir, file), { force: true })),
        ...staleTmpFiles.map((file) => rm(path.join(dir, file), { force: true })),
      ])
    } catch (err) {
      logger.warn("run snapshot stale cleanup failed (save succeeded)", {
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

  async deleteWorkflow(workflowId: string): Promise<void> {
    const dir = this.dir(workflowId)
    try {
      await rm(dir, { recursive: true, force: true })
      logger.info("run snapshots deleted for workflow", { workflowId })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        logger.warn("run snapshot deleteWorkflow failed", {
          workflowId,
          ...snapshotErrorMetadata(err),
        })
      }
    }
  }

  /**
   * Find a snapshot by runId alone, without knowing the workflowId.
   * Scans all workflow directories under workflow-runs/ for the first matching
   * <runId>.json file. Single pass through subdirectories — O(W) dirent checks
   * vs the N+1 file reads of iterating workflows and calling get() for each.
   */
  async findByRunId(runId: string): Promise<WorkflowRunSnapshot | null> {
    let wfDirs: Dirent[]
    try {
      wfDirs = await readdir(path.join(this.dataDir, "workflow-runs"), { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
      logger.warn("findByRunId readdir failed", { runId, ...snapshotErrorMetadata(err) })
      return null
    }
    for (const dirent of wfDirs) {
      if (!dirent.isDirectory()) continue
      const file = path.join(this.dataDir, "workflow-runs", dirent.name, `${runId}.json`)
      try {
        const raw = JSON.parse(await readFile(file, "utf-8"))
        if (!isValidSnapshotShape(raw)) {
          logger.warn("findByRunId snapshot has invalid structure, skipping", { runId, workflowId: dirent.name })
          continue
        }
        return raw as WorkflowRunSnapshot
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          logger.warn("findByRunId readFile failed", { runId, workflowId: dirent.name, ...snapshotErrorMetadata(err) })
        }
      }
    }
    return null
  }

  async get(runId: string, workflowId: string): Promise<WorkflowRunSnapshot | null> {
    try {
      const raw = JSON.parse(await readFile(path.join(this.dir(workflowId), `${runId}.json`), "utf-8"))
      if (!isValidSnapshotShape(raw)) {
        logger.warn("run snapshot get: invalid structure", { runId, workflowId })
        return null
      }
      return raw as WorkflowRunSnapshot
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
  readonly errorMessage: string
  readonly code?: string
} {
  const message = error instanceof Error ? error.message : String(error)
  const code = errorCode(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
    errorMessage: message,
    ...(code ? { code } : {}),
  }
}

function isValidSnapshotShape(value: unknown): value is WorkflowRunSnapshot {
  if (typeof value !== "object" || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.runId === "string" &&
    typeof obj.workflowId === "string" &&
    typeof obj.version === "string" &&
    typeof obj.startedAt === "number" &&
    typeof obj.status === "string" &&
    typeof obj.nodeResults === "object" && obj.nodeResults !== null &&
    typeof obj.params === "object" && obj.params !== null
  )
}
