import { lstat as fsLstat } from "node:fs/promises"
import type { Stats } from "node:fs"

import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { DispatchContext } from "../../../synapse-capabilities/shared/types"
import { FileOpenerError } from "../shared/errors"
import { fileOpenInputSchema, type FileOpenInput, type FileOpenResult } from "../shared/schema"

type FileOpenerLogger = {
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
}

export type FileOpenerContext = Omit<DispatchContext, "source"> & {
  readonly source?: DispatchContext["source"] | "app.ui" | "app.deep_link"
  readonly metadata?: Record<string, unknown>
  readonly abortSignal?: AbortSignal
}

export class FileOpenerService {
  constructor(private readonly deps: {
    readonly permissionGuard: PermissionGuard
    readonly auditSink: AuditSink
    readonly openPath: (path: string) => Promise<string>
    readonly lstat?: (path: string) => Promise<Stats>
    readonly logger?: FileOpenerLogger
  }) {}

  async open(input: FileOpenInput, context: FileOpenerContext = {}): Promise<FileOpenResult> {
    const parsed = fileOpenInputSchema.safeParse(input)
    if (!parsed.success) throw new FileOpenerError("invalid_path")

    const filePath = parsed.data.path
    const actor: ActorIdentity = context.actor ?? { kind: "user", id: "file-opener" }
    const metadata = { source: context.source ?? "app.ui", ...context.metadata }

    await this.authorize("fs.read.outside-userdata", actor, filePath, metadata)
    let stats: Stats
    try {
      stats = await (this.deps.lstat ?? fsLstat)(filePath)
    } catch (error) {
      this.record("fs.read.outside-userdata", actor, filePath, "failed", metadata, "lstat_failed")
      this.deps.logger?.warn("file opener validation failed", summarize(filePath, error))
      throw new FileOpenerError("file_not_found_or_inaccessible")
    }
    if (stats.isSymbolicLink()) {
      this.record("fs.read.outside-userdata", actor, filePath, "failed", metadata, "symbolic_link")
      throw new FileOpenerError("symbolic_link_not_supported")
    }
    if (!stats.isFile()) {
      this.record("fs.read.outside-userdata", actor, filePath, "failed", metadata, "not_regular_file")
      throw new FileOpenerError("not_regular_file")
    }
    this.record("fs.read.outside-userdata", actor, filePath, "allowed", metadata)

    await this.authorize("shell.exec", actor, filePath, metadata)
    if (context.abortSignal?.aborted) throw new DOMException("Aborted", "AbortError")
    try {
      const errorText = await this.deps.openPath(filePath)
      if (errorText !== "") {
        this.record("shell.exec", actor, filePath, "failed", metadata, "system_rejected")
        this.deps.logger?.warn("file opener request rejected", {
          pathLength: filePath.length,
          systemErrorLength: errorText.length,
        })
        throw new FileOpenerError("system_rejected")
      }
    } catch (error) {
      if (error instanceof FileOpenerError) throw error
      this.record("shell.exec", actor, filePath, "failed", metadata, "open_path_threw")
      this.deps.logger?.warn("file opener request failed", summarize(filePath, error))
      throw new FileOpenerError("open_failed")
    }
    this.record("shell.exec", actor, filePath, "allowed", metadata)
    this.deps.logger?.info("file opener request submitted", { pathLength: filePath.length })
    return { path: filePath }
  }

  private async authorize(
    action: "fs.read.outside-userdata" | "shell.exec",
    actor: ActorIdentity,
    resource: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.deps.permissionGuard.check({ action, actor, resource, context: metadata })
    if (result.allowed) return
    this.record(action, actor, resource, "denied", {
      ...metadata,
      policyId: result.policyId,
    })
    this.deps.logger?.warn("file opener permission denied", {
      action,
      policyId: result.policyId,
      pathLength: resource.length,
    })
    throw new FileOpenerError("permission_denied")
  }

  private record(
    action: "fs.read.outside-userdata" | "shell.exec",
    actor: ActorIdentity,
    resource: string,
    outcome: "allowed" | "denied" | "failed",
    metadata: Record<string, unknown>,
    failureKind?: string,
  ): void {
    this.deps.auditSink.record({
      action,
      actor,
      resource,
      outcome,
      metadata: failureKind ? { ...metadata, failureKind } : metadata,
    })
  }
}

function summarize(filePath: string, error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error)
  return {
    pathLength: filePath.length,
    errorName: error instanceof Error ? error.name : undefined,
    errorCode: typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined,
    errorLength: message.length,
  }
}
