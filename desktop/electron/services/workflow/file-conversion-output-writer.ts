import { lstat, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../../runtime/security"
import {
  getWorkflowFileConversionOutputRoot,
  isWorkflowFileConversionOutputPathAllowed,
  WorkflowFileConversionOutputWriteError,
} from "../../../workflow-nodes/file-conversion/output-boundary"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("workflow.file-conversion-output-writer")

export interface WorkflowFileConversionOutputWriteRequest {
  readonly outputPath: string
  readonly markdown: string
  readonly actor?: ActorIdentity
  readonly runId: string
  readonly abortSignal: AbortSignal
}

export type WorkflowFileConversionOutputWriter = (request: WorkflowFileConversionOutputWriteRequest) => Promise<void>

export function createWorkflowFileConversionOutputWriter(deps: {
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
}): WorkflowFileConversionOutputWriter {
  return async (request) => {
    if (request.abortSignal.aborted) {
      throw new WorkflowFileConversionOutputWriteError("write_failed", "Workflow output write was cancelled.")
    }

    await assertSafeWorkflowFileConversionOutputPath(request.outputPath)

    const actor = request.actor ?? { kind: "system" as const, id: "workflow-engine" }
    const metadata = { source: "workflow.fileConversionOutput", runId: request.runId }
    const permission = await deps.permissionGuard.check({
      action: "fs.write",
      actor,
      resource: request.outputPath,
      context: metadata,
    })
    if (!permission.allowed) {
      logger.warn("workflow file conversion output denied", {
        runId: request.runId,
        outputPathLength: request.outputPath.length,
        reason: permission.reason,
        policyId: permission.policyId,
      })
      recordAudit(deps.auditSink, {
        action: "fs.write",
        actor,
        resource: request.outputPath,
        outcome: "denied",
        metadata: {
          ...metadata,
          reason: permission.reason,
          policyId: permission.policyId,
        },
      }, request, "denied")
      throw new WorkflowFileConversionOutputWriteError("write_failed", "Workflow output write was denied.")
    }

    try {
      await mkdir(path.dirname(request.outputPath), { recursive: true })
      await assertSafeWorkflowFileConversionOutputPath(request.outputPath)
      await writeFile(request.outputPath, request.markdown, "utf8")
      recordAudit(deps.auditSink, {
        action: "fs.write",
        actor,
        resource: request.outputPath,
        outcome: "allowed",
        metadata,
      }, request, "allowed")
      logger.info("workflow file conversion output written", {
        runId: request.runId,
        outputPathLength: request.outputPath.length,
      })
    } catch (error) {
      if (error instanceof WorkflowFileConversionOutputWriteError) {
        logger.warn("workflow file conversion output denied", {
          runId: request.runId,
          outputPathLength: request.outputPath.length,
          reason: error.code,
        })
        recordAudit(deps.auditSink, {
          action: "fs.write",
          actor,
          resource: request.outputPath,
          outcome: "denied",
          metadata: {
            ...metadata,
            reason: error.code,
          },
        }, request, "denied")
        throw error
      }

      logger.warn("workflow file conversion output write failed", {
        runId: request.runId,
        outputPathLength: request.outputPath.length,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: (error instanceof Error ? error.message : String(error)).length,
      })
      recordAudit(deps.auditSink, {
        action: "fs.write",
        actor,
        resource: request.outputPath,
        outcome: "failed",
        metadata: {
          ...metadata,
          errorName: error instanceof Error ? error.name : typeof error,
          errorLength: (error instanceof Error ? error.message : String(error)).length,
        },
      }, request, "failed")
      throw new WorkflowFileConversionOutputWriteError("write_failed", "Workflow output write failed.", { cause: error })
    }
  }
}

function recordAudit(
  auditSink: AuditSink,
  event: Parameters<AuditSink["record"]>[0],
  request: WorkflowFileConversionOutputWriteRequest,
  outcome: "allowed" | "denied" | "failed",
): void {
  try {
    auditSink.record(event)
  } catch (error) {
    logger.warn("workflow file conversion output audit failed", {
      runId: request.runId,
      outcome,
      outputPathLength: request.outputPath.length,
      errorName: error instanceof Error ? error.name : typeof error,
      errorLength: (error instanceof Error ? error.message : String(error)).length,
    })
    throw error
  }
}

async function assertSafeWorkflowFileConversionOutputPath(outputPath: string): Promise<void> {
  if (!isWorkflowFileConversionOutputPathAllowed(outputPath)) {
    throw new WorkflowFileConversionOutputWriteError("invalid_output_path", "Output path is outside the workflow output directory.")
  }

  const root = path.resolve(getWorkflowFileConversionOutputRoot())
  const target = path.resolve(outputPath)
  await ensureOutputRoot(root)

  const relative = path.relative(root, target)
  let current = root
  for (const part of relative.split(path.sep)) {
    if (!part) continue
    current = path.join(current, part)
    const stat = await lstat(current).catch((error: unknown) => {
      if (isNotFoundError(error)) return null
      throw new WorkflowFileConversionOutputWriteError("invalid_output_path", "Could not inspect workflow output path.", { cause: error })
    })
    if (!stat) break
    if (stat.isSymbolicLink()) {
      throw new WorkflowFileConversionOutputWriteError("invalid_output_path", "Workflow output path must not contain symlinks.")
    }
  }
}

async function ensureOutputRoot(root: string): Promise<void> {
  const stat = await lstat(root).catch((error: unknown) => {
    if (isNotFoundError(error)) return null
    throw new WorkflowFileConversionOutputWriteError("invalid_output_path", "Could not inspect workflow output directory.", { cause: error })
  })
  if (stat?.isSymbolicLink()) {
    throw new WorkflowFileConversionOutputWriteError("invalid_output_path", "Workflow output directory must not be a symlink.")
  }
  if (!stat) {
    await mkdir(root, { recursive: true }).catch((error: unknown) => {
      throw new WorkflowFileConversionOutputWriteError("write_failed", "Could not create workflow output directory.", { cause: error })
    })
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
