import { randomUUID } from "node:crypto"
import type { SynapseGitRepository, SynapseGitRepositorySnapshot, SynapseGitWorkingTreeChange } from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import { errorLogMeta } from "../error-sanitize"
import { sanitizeGitDiagnosticText } from "./git-sanitize"

const MAX_OUTPUT_PREVIEW_LENGTH = 1200
const MAX_ARG_PREVIEW_LENGTH = 200
const MAX_PATH_SAMPLES = 5

type GitCommandDiagnostics = {
  readonly exitCode?: number | null
  readonly signal?: NodeJS.Signals | string | null
  readonly timedOut?: boolean
  readonly stdout?: string
  readonly stderr?: string
  readonly output?: string
}

type GitLogFailureInput = {
  readonly operation: string
  readonly operationId: string
  readonly repositoryId?: string
  readonly repoPath?: string
  readonly cwd?: string
  readonly args?: readonly string[]
  readonly startedAt?: number
  readonly error: unknown
  readonly extra?: Record<string, unknown>
}

function createGitOperationId(): string {
  return `git-${randomUUID()}`
}

function elapsedMs(startedAt: number | undefined): number | undefined {
  return typeof startedAt === "number" ? Math.max(0, Math.round(performance.now() - startedAt)) : undefined
}

function sanitizeGitLogText(value: string): string {
  return sanitizeGitDiagnosticText(value)
}

function truncateText(value: string, limit = MAX_OUTPUT_PREVIEW_LENGTH): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}...[truncated ${value.length - limit} chars]`
}

function sanitizeOutputPreview(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const sanitized = truncateText(sanitizeGitLogText(value.trim()))
  return sanitized || undefined
}

function sanitizeRemoteUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ""
    url.password = ""
    for (const key of url.searchParams.keys()) {
      if (/token|secret|key|password|credential|authorization|cookie/i.test(key)) {
        url.searchParams.set(key, "[redacted]")
      }
    }
    return sanitizeGitLogText(url.toString())
  } catch {
    return sanitizeGitLogText(value.replace(/(^[^@\s]+):([^@\s]+)@/, "$1:[redacted]@"))
  }
}

function summarizeGitArgs(args: readonly string[] | undefined): readonly string[] | undefined {
  if (!args) return undefined
  const summarized: string[] = []
  let pathListCount = 0

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (arg === "--") {
      const remaining = args.length - index - 1
      summarized.push("--")
      if (remaining > 0) summarized.push(`[path-list ${remaining}]`)
      pathListCount = remaining
      break
    }
    if (arg === "-m" || arg === "--message") {
      const message = args[index + 1] ?? ""
      summarized.push(arg, `[message ${message.length} chars]`)
      index += 1
      continue
    }
    if (arg.startsWith("--message=")) {
      summarized.push(`--message=[message ${arg.slice("--message=".length).length} chars]`)
      continue
    }

    const safeArg = sanitizeRemoteUrl(arg)
    summarized.push(safeArg.length > MAX_ARG_PREVIEW_LENGTH
      ? `${safeArg.slice(0, MAX_ARG_PREVIEW_LENGTH)}...[truncated ${safeArg.length - MAX_ARG_PREVIEW_LENGTH} chars]`
      : safeArg)
  }

  return pathListCount > 0 ? summarized : summarized.slice(0, 40)
}

function readCommandDiagnostics(error: unknown): GitCommandDiagnostics {
  if (!error || typeof error !== "object") return {}
  const record = error as Record<string, unknown>
  return {
    exitCode: typeof record.exitCode === "number" || record.exitCode === null ? record.exitCode : undefined,
    signal: typeof record.signal === "string" || record.signal === null ? record.signal : undefined,
    timedOut: typeof record.timedOut === "boolean" ? record.timedOut : undefined,
    stdout: typeof record.stdout === "string" ? record.stdout : undefined,
    stderr: typeof record.stderr === "string" ? record.stderr : undefined,
    output: typeof record.output === "string" ? record.output : undefined,
  }
}

function categorizeGitErrorForLog(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/no available git|no git command|ENOENT|没有可用的 git|git 命令/i.test(message)) return "git-missing"
  if (/authentication failed|could not read username|access denied|invalid username or password|认证失败/i.test(message)) return "auth-failed"
  if (/permission denied|publickey|403|not allowed|权限/i.test(message)) return "permission-denied"
  if (/repository not found|remote not found|not found|does not appear to be a git repository/i.test(message)) return "remote-not-found"
  if (/could not resolve host|failed to connect|network|timed out|timeout|proxy|ssl|certificate|connection reset|超时/i.test(message)) return "network-failed"
  if (/not a git repository/i.test(message)) return "not-git-repository"
  if (/local changes would be overwritten|working tree|uncommitted changes|未提交/i.test(message)) return "working-tree-dirty"
  if (/non-fast-forward|fetch first|rejected/i.test(message)) return "non-fast-forward"
  if (/conflict|merge conflict|CONFLICT/i.test(message)) return "conflict"
  if (/index\.lock|another git process/i.test(message)) return "index-lock"
  return "unknown"
}

function gitErrorMeta(error: unknown): Record<string, unknown> {
  const diagnostics = readCommandDiagnostics(error)
  const stderrPreview = sanitizeOutputPreview(diagnostics.stderr)
  const stdoutPreview = sanitizeOutputPreview(diagnostics.stdout)
  const outputPreview = !stderrPreview && !stdoutPreview ? sanitizeOutputPreview(diagnostics.output) : undefined
  return {
    ...errorLogMeta(error, {
      includeCode: true,
      includeMessage: true,
      messageLimit: 600,
      sanitizeMessage: sanitizeGitDiagnosticText,
    }),
    category: categorizeGitErrorForLog(error),
    ...(diagnostics.exitCode !== undefined ? { exitCode: diagnostics.exitCode } : {}),
    ...(diagnostics.signal !== undefined ? { signal: diagnostics.signal } : {}),
    ...(diagnostics.timedOut !== undefined ? { timedOut: diagnostics.timedOut } : {}),
    ...(stderrPreview ? { stderrPreview } : {}),
    ...(stdoutPreview ? { stdoutPreview } : {}),
    ...(outputPreview ? { outputPreview } : {}),
  }
}

function logGitOperationStarted(
  logger: Pick<StructuredLogger, "info">,
  operation: string,
  operationId: string,
  meta: Record<string, unknown>,
): void {
  logger.info("Git operation started.", {
    operation,
    operationId,
    ...meta,
  })
}

function logGitOperationSucceeded(
  logger: Pick<StructuredLogger, "info">,
  operation: string,
  operationId: string,
  startedAt: number,
  meta: Record<string, unknown> = {},
): void {
  logger.info("Git operation completed.", {
    operation,
    operationId,
    durationMs: elapsedMs(startedAt),
    ...meta,
  })
}

function logGitOperationBlocked(
  logger: Pick<StructuredLogger, "warn">,
  operation: string,
  operationId: string,
  reason: string,
  meta: Record<string, unknown> = {},
): void {
  logger.warn("Git operation blocked.", {
    operation,
    operationId,
    reason,
    ...meta,
  })
}

function logGitOperationFailed(
  logger: Pick<StructuredLogger, "error">,
  input: GitLogFailureInput,
): void {
  logger.error("Git operation failed.", {
    operation: input.operation,
    operationId: input.operationId,
    ...(input.repositoryId ? { repositoryId: input.repositoryId } : {}),
    ...(input.repoPath ? { repoPath: input.repoPath } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(input.args ? { gitArgs: summarizeGitArgs(input.args) } : {}),
    ...(input.startedAt !== undefined ? { durationMs: elapsedMs(input.startedAt) } : {}),
    ...input.extra,
    ...gitErrorMeta(input.error),
  })
}

function summarizeChanges(changes: readonly Pick<SynapseGitWorkingTreeChange, "status" | "path">[]): Record<string, unknown> {
  const byStatus: Record<string, number> = {}
  let conflictedCount = 0
  const samples: string[] = []

  for (const change of changes) {
    byStatus[change.status] = (byStatus[change.status] ?? 0) + 1
    if (change.status === "conflicted") conflictedCount += 1
    if (samples.length < MAX_PATH_SAMPLES) samples.push(change.path)
  }

  return {
    changeCount: changes.length,
    conflictedCount,
    changeStatusCounts: byStatus,
    ...(samples.length > 0 ? { pathSamples: samples } : {}),
  }
}

function summarizeSnapshot(snapshot: Pick<SynapseGitRepositorySnapshot, "currentBranch" | "upstream" | "ahead" | "behind" | "hasConflicts" | "changeCount" | "changes">): Record<string, unknown> {
  const changeCount = snapshot.changeCount ?? snapshot.changes.length
  return {
    branch: snapshot.currentBranch,
    upstream: snapshot.upstream,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    hasConflicts: snapshot.hasConflicts,
    isDirty: changeCount > 0,
    ...summarizeChanges(snapshot.changes),
    changeCount,
  }
}

function repositoryLogMeta(repository: Pick<SynapseGitRepository, "id" | "localPath" | "name">): Record<string, unknown> {
  return {
    repositoryId: repository.id,
    repoPath: repository.localPath,
    repositoryName: repository.name,
  }
}

export {
  createGitOperationId,
  gitErrorMeta,
  logGitOperationBlocked,
  logGitOperationFailed,
  logGitOperationStarted,
  logGitOperationSucceeded,
  repositoryLogMeta,
  sanitizeGitLogText,
  sanitizeOutputPreview,
  sanitizeRemoteUrl,
  summarizeChanges,
  summarizeGitArgs,
  summarizeSnapshot,
}
export type {
  GitLogFailureInput,
}
