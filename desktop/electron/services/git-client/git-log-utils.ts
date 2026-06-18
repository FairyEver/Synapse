import { randomUUID } from "node:crypto"
import type { StructuredLogger } from "../../runtime/logging"
import type { SynapseGitRepository, SynapseGitRepositorySnapshot } from "../../../src/types/git"
import { errorLogMeta, sanitizeErrorPreservingPaths } from "../error-sanitize"

const OUTPUT_LIMIT = 2_000

type GitLogger = Pick<StructuredLogger, "debug" | "error" | "info" | "warn">

type GitOperationContext = {
  readonly operation: string
  readonly operationId: string
  readonly startedAt: number
}

type GitCommandFailureLike = {
  readonly stderr?: unknown
  readonly stdout?: unknown
  readonly output?: unknown
  readonly exitCode?: unknown
  readonly signal?: unknown
  readonly timedOut?: unknown
}

export function createGitLogger(category: string): GitLogger {
  void category
  return noopGitLogger
}

const noopGitLogger: GitLogger = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
}

export function createGitOperation(operation: string): GitOperationContext {
  return {
    operation,
    operationId: randomUUID(),
    startedAt: Date.now(),
  }
}

export function gitOperationDuration(operation: Pick<GitOperationContext, "startedAt">): number {
  return Date.now() - operation.startedAt
}

export function gitRepositoryLogMeta(repository: SynapseGitRepository): Record<string, unknown> {
  return {
    repoId: repository.id,
    repoPath: sanitizeGitText(repository.localPath),
    repoName: repository.name,
  }
}

export function gitSnapshotLogMeta(
  snapshot: Pick<
    SynapseGitRepositorySnapshot,
    "ahead" | "behind" | "changes" | "currentBranch" | "hasConflicts" | "isGitRepository" | "pathExists" | "upstream"
  >,
): Record<string, unknown> {
  const conflictCount = snapshot.changes.filter((change) => change.conflicted).length
  return {
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    branch: snapshot.currentBranch,
    changeCount: snapshot.changes.length,
    conflictCount,
    hasConflicts: snapshot.hasConflicts,
    isDirty: snapshot.changes.length > 0,
    isGitRepository: snapshot.isGitRepository,
    pathExists: snapshot.pathExists,
    upstream: snapshot.upstream,
  }
}

export function gitOperationBaseMeta(
  operation: Pick<GitOperationContext, "operation" | "operationId">,
  repository?: SynapseGitRepository,
): Record<string, unknown> {
  return {
    operation: operation.operation,
    operationId: operation.operationId,
    ...(repository ? gitRepositoryLogMeta(repository) : {}),
  }
}

export function gitFailureLogMeta(
  error: unknown,
  options: {
    readonly category?: string
    readonly includeOutput?: boolean
  } = {},
): Record<string, unknown> {
  const commandError = error && typeof error === "object" ? error as GitCommandFailureLike : {}
  return {
    ...errorLogMeta(error, {
      includeCode: true,
      includeMessage: true,
      messageLimit: 600,
      sanitizeMessage: sanitizeGitText,
    }),
    ...(options.category ? { errorCategory: options.category } : {}),
    ...(typeof commandError.exitCode === "number" ? { exitCode: commandError.exitCode } : {}),
    ...(typeof commandError.signal === "string" ? { signal: commandError.signal } : {}),
    ...(commandError.timedOut === true ? { timedOut: true } : {}),
    ...(options.includeOutput ? gitCommandOutputMeta(commandError) : {}),
  }
}

export function gitCommandOutputMeta(error: GitCommandFailureLike): Record<string, unknown> {
  const stderr = typeof error.stderr === "string" ? truncateGitText(error.stderr) : undefined
  const stdout = typeof error.stdout === "string" ? truncateGitText(error.stdout) : undefined
  const output = typeof error.output === "string" ? truncateGitText(error.output) : undefined
  return {
    ...(stderr ? { stderrSummary: stderr } : {}),
    ...(stdout ? { stdoutSummary: stdout } : {}),
    ...(!stderr && !stdout && output ? { outputSummary: output } : {}),
  }
}

export function sanitizeGitText(value: string): string {
  return sanitizeErrorPreservingPaths(value)
}

export function truncateGitText(value: string): string {
  const sanitized = sanitizeGitText(value.trim())
  if (sanitized.length <= OUTPUT_LIMIT) return sanitized
  return `${sanitized.slice(0, OUTPUT_LIMIT)}...`
}

export function summarizeGitArgs(args: readonly string[]): readonly string[] {
  const separatorIndex = args.indexOf("--")
  const visibleArgs = separatorIndex >= 0
    ? [
        ...args.slice(0, separatorIndex + 1),
        `[${Math.max(args.length - separatorIndex - 1, 0)} path(s)]`,
      ]
    : [...args]

  return visibleArgs.map((arg, index) => {
    const previous = visibleArgs[index - 1]
    const secondPrevious = visibleArgs[index - 2]
    if (previous === "-m" || previous === "--message") return "[message redacted]"
    if (secondPrevious === "config" && (previous === "user.name" || previous === "user.email")) return "[value redacted]"
    return sanitizeGitText(arg)
  })
}

export function logGitOperationStart(
  logger: GitLogger,
  message: string,
  operation: GitOperationContext,
  repository?: SynapseGitRepository,
  meta: Record<string, unknown> = {},
): void {
  logger.info(message, {
    ...gitOperationBaseMeta(operation, repository),
    ...meta,
  })
}

export function logGitOperationSuccess(
  logger: GitLogger,
  message: string,
  operation: GitOperationContext,
  repository?: SynapseGitRepository,
  meta: Record<string, unknown> = {},
): void {
  logger.info(message, {
    ...gitOperationBaseMeta(operation, repository),
    durationMs: gitOperationDuration(operation),
    ...meta,
  })
}

export function logGitOperationFailure(
  logger: GitLogger,
  message: string,
  operation: GitOperationContext,
  error: unknown,
  repository?: SynapseGitRepository,
  meta: Record<string, unknown> = {},
): void {
  logger.error(message, {
    ...gitOperationBaseMeta(operation, repository),
    durationMs: gitOperationDuration(operation),
    ...gitFailureLogMeta(error, { includeOutput: true }),
    ...meta,
  })
}

export type {
  GitLogger,
  GitOperationContext,
}
