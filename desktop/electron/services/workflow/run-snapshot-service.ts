import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import type { WorkflowRunSnapshot } from "../../../src/types/workflow"
import { createMainLogger } from "../log-store"
import { errorCode } from "./workflow-utils"
import { sanitizeError } from "../error-sanitize"
import { assertSafeWorkflowId, assertSafeWorkflowRunId } from "./workflow-id"
import { sanitizeWorkflowRunSnapshot } from "./run-snapshot-sanitize"
import { migrateWorkflowDocument } from "./workflow-document-migration"

const logger = createMainLogger("service.workflow.snapshots")

const MAX = 20

export class RunSnapshotService {
  constructor(private readonly dataDir: string) {}
  private dir(wfId: string) { return path.join(this.dataDir, "workflow-runs", assertSafeWorkflowId(wfId)) }
  private runArtifactDir(runId: string) { return path.join(this.dataDir, "workflow-runs", assertSafeWorkflowRunId(runId)) }
  private runArtifactNodesDir(runId: string) { return path.join(this.runArtifactDir(runId), "nodes") }
  private snapshotTime(s: WorkflowRunSnapshot): number { return s.startedAt || s.endedAt || 0 }

  private async readSnapshotFiles(workflowId: string): Promise<Array<{ file: string; snapshot: WorkflowRunSnapshot }>> {
    const dir = this.dir(workflowId)
    let files: string[]
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json"))
    } catch (err) {
      const code = errorCode(err)
      // ENOENT means no history yet — return empty without warning
      if (code === "ENOENT") return []
      logger.warn("run snapshot readdir failed", {
        workflowId,
        ...snapshotErrorMetadata(err),
      })
      throw err
    }
    const entries = await Promise.all(files.map(async (file) => {
      try {
        const raw = JSON.parse(await readFile(path.join(dir, file), "utf-8"))
        if (!isValidSnapshotShape(raw)) {
          logger.warn("run snapshot file has invalid structure, skipping", { workflowId, file })
          return null
        }
        return { file, snapshot: prepareSnapshotForRead(raw as WorkflowRunSnapshot) }
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
    const snapshot = prepareSnapshotForSave(s)
    const dir = this.dir(snapshot.workflowId)
    const runId = assertSafeWorkflowRunId(snapshot.runId)
    try {
      await mkdir(dir, { recursive: true })
      const target = path.join(dir, `${runId}.json`)
      const tmp = `${target}.tmp`
      await writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf-8")
      await rename(tmp, target)
      logger.info("run snapshot saved", { runId: snapshot.runId, workflowId: snapshot.workflowId, status: snapshot.status, nodeCount: Object.keys(snapshot.nodeResults).length })
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
        this.deleteRunArtifactDirectories(s.workflowId, stale.map(({ snapshot }) => snapshot.runId)),
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
    return (await this.readSnapshotFiles(workflowId))
      .sort((a, b) => this.snapshotTime(b.snapshot) - this.snapshotTime(a.snapshot))
      .map(({ snapshot }) => snapshot)
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    const dir = this.dir(workflowId)
    try {
      const snapshots = await this.readSnapshotFiles(workflowId)
      await this.deleteRunArtifactDirectories(workflowId, snapshots.map(({ snapshot }) => snapshot.runId))
      await rm(dir, { recursive: true, force: true })
      logger.info("run snapshots deleted for workflow", { workflowId })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // ENOENT means the snapshot directory doesn't exist — not an error
      if (code === "ENOENT") return
      logger.error("run snapshot deleteWorkflow failed", {
        workflowId,
        ...snapshotErrorMetadata(err),
      })
      throw err
    }
  }

  private async deleteRunArtifactDirectories(workflowId: string, runIds: readonly string[]): Promise<void> {
    const uniqueRunIds = [...new Set(runIds)]
    await Promise.all(uniqueRunIds.map(async (runId) => {
      try {
        await rm(this.runArtifactNodesDir(runId), { recursive: true, force: true })
        await this.removeEmptyRunArtifactDirectory(runId)
        logger.info("run artifacts deleted for workflow", { workflowId, runId })
      } catch (err) {
        logger.error("run artifact cleanup failed for workflow", {
          workflowId,
          runId,
          ...snapshotErrorMetadata(err),
        })
        throw err
      }
    }))
  }

  private async removeEmptyRunArtifactDirectory(runId: string): Promise<void> {
    try {
      await rmdir(this.runArtifactDir(runId))
    } catch (err) {
      const code = errorCode(err)
      if (code === "ENOENT" || code === "ENOTEMPTY" || code === "EEXIST") return
      throw err
    }
  }

  /**
   * Find a snapshot by runId alone, without knowing the workflowId.
   * Scans all workflow directories under workflow-runs/ for the first matching
   * <runId>.json file. Single pass through subdirectories — O(W) dirent checks
   * vs the N+1 file reads of iterating workflows and calling get() for each.
   */
  async findByRunId(runId: string): Promise<WorkflowRunSnapshot | null> {
    const safeRunId = assertSafeWorkflowRunId(runId)
    let wfDirs: Dirent[]
    try {
      wfDirs = await readdir(path.join(this.dataDir, "workflow-runs"), { withFileTypes: true })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null
      throw err
    }
    for (const dirent of wfDirs) {
      if (!dirent.isDirectory()) continue
      const file = path.join(this.dataDir, "workflow-runs", dirent.name, `${safeRunId}.json`)
      try {
        const raw = JSON.parse(await readFile(file, "utf-8"))
        if (!isValidSnapshotShape(raw)) {
          logger.warn("findByRunId snapshot has invalid structure, skipping", { runId, workflowId: dirent.name })
          continue
        }
        return prepareSnapshotForRead(raw as WorkflowRunSnapshot)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue
        logger.warn("findByRunId snapshot read error, skipping", {
          runId,
          workflowId: dirent.name,
          ...snapshotErrorMetadata(err),
        })
        continue
      }
    }
    return null
  }

  async get(runId: string, workflowId: string): Promise<WorkflowRunSnapshot | null> {
    const safeRunId = assertSafeWorkflowRunId(runId)
    try {
      const raw = JSON.parse(await readFile(path.join(this.dir(workflowId), `${safeRunId}.json`), "utf-8"))
      if (!isValidSnapshotShape(raw)) {
        logger.warn("run snapshot get: invalid structure", { runId, workflowId })
        return null
      }
      return prepareSnapshotForRead(raw as WorkflowRunSnapshot)
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

function prepareSnapshotForRead(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
  const { definitionMigration: _storedDiagnostic, ...snapshotWithoutDiagnostic } = snapshot
  void _storedDiagnostic
  if (!snapshotWithoutDiagnostic.definition) return sanitizeWorkflowRunSnapshot(snapshotWithoutDiagnostic)
  const result = migrateWorkflowDocument(snapshotWithoutDiagnostic.definition)
  if (result.kind === "current") {
    return sanitizeWorkflowRunSnapshot({ ...snapshotWithoutDiagnostic, definition: result.document })
  }
  logger.warn("run snapshot workflow definition migration failed, definition protected", {
    runId: snapshot.runId,
    workflowId: snapshot.workflowId,
    sourceVersion: result.sourceVersion,
    errorName: result.error.name,
  })
  const { definition: _definition, ...withoutDefinition } = snapshotWithoutDiagnostic
  void _definition
  return sanitizeWorkflowRunSnapshot({
    ...withoutDefinition,
    definitionMigration: {
      kind: result.kind,
      sourceVersion: result.sourceVersion,
      ...(result.kind === "unsupported_future" ? { targetVersion: result.targetVersion } : {}),
    },
  })
}

function prepareSnapshotForSave(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot {
  const { definitionMigration: _readDiagnostic, ...snapshotWithoutDiagnostic } = snapshot
  void _readDiagnostic
  if (!snapshotWithoutDiagnostic.definition) return sanitizeWorkflowRunSnapshot(snapshotWithoutDiagnostic)
  const result = migrateWorkflowDocument(snapshotWithoutDiagnostic.definition)
  if (result.kind !== "current") {
    throw new Error("Workflow snapshot definition could not be migrated before save.", {
      cause: result.error,
    })
  }
  return sanitizeWorkflowRunSnapshot({ ...snapshotWithoutDiagnostic, definition: result.document })
}

function snapshotErrorMetadata(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly errorMessage: string
  readonly code?: string
} {
  const message = error instanceof Error ? error.message : String(error)
  const sanitized = sanitizeError(message)
  const code = errorCode(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: sanitized.length,
    errorMessage: sanitized,
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
