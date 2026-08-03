import { devNull } from "node:os"
import type {
  SynapseGitDiffResult,
  SynapseGitRepository,
  SynapseGitRepositorySnapshot,
  SynapseGitRepositorySummary,
} from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import {
  OPERATION_STATE_MESSAGE,
  readGitRepositoryOperationDiagnostics,
  type GitRepositoryOperationDiagnostics,
} from "../git-operation-state"
import type { GitClientCommandRunner } from "./git-command-runner"
import { assertRepositoryPath } from "./git-path-utils"
import {
  createGitOperationId,
  gitErrorMeta,
  logGitOperationFailed,
  repositoryLogMeta,
  summarizeChanges,
  summarizeSnapshot,
} from "./git-logging"
import { createGitStatusPorcelainV2Parser, parseGitStatusPorcelainV2 } from "./git-status-parser"
import { withGitChangeProjection } from "./git-change-projection"

type StatusDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly logger?: Pick<StructuredLogger, "error" | "warn">
  readonly pathExists: (filePath: string) => Promise<boolean>
  readonly refineTwoLayerChange?: (input: {
    readonly operation: string
    readonly operationId: string
    readonly paths: readonly string[]
    readonly repository: SynapseGitRepository
  }) => Promise<boolean>
  readonly readStateDiagnostics?: (repository: SynapseGitRepository) => Promise<GitRepositoryOperationDiagnostics>
}

const LIST_SUMMARY_CONCURRENCY_LIMIT = 4
const STATUS_PROJECTION_CONCURRENCY_LIMIT = 4
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024
const MAX_VISIBLE_STATUS_CHANGES = 10_000

function createGitStateDiagnosticsReader(
  commandRunner: Pick<GitClientCommandRunner, "run">,
  pathExists: (filePath: string) => Promise<boolean>,
) {
  return async (repository: SynapseGitRepository): Promise<GitRepositoryOperationDiagnostics> => {
    return readGitRepositoryOperationDiagnostics({
      localPath: repository.localPath,
      pathExists,
      run: (args) => commandRunner.run({
        cwd: repository.localPath,
        args,
        logFailure: false,
        operation: "git.status.diagnostics",
        repoPath: repository.localPath,
        repositoryId: repository.id,
      }),
    })
  }
}

function isNotGitRepository(error: unknown): boolean {
  return error instanceof Error && /not a git repository/i.test(error.message)
}

export function createGitStatusService(deps: StatusDeps) {
  const lastAnomalyFingerprints = new Map<string, string>()

  async function omitIneffectiveTwoLayerChanges(
    repository: SynapseGitRepository,
    parsed: ReturnType<typeof parseGitStatusPorcelainV2>,
    operation: string,
    operationId: string,
  ): Promise<ReturnType<typeof parseGitStatusPorcelainV2>> {
    const keep = await mapWithConcurrency(parsed.changes, STATUS_PROJECTION_CONCURRENCY_LIMIT, async (change) => {
      if (change.indexStatus === "added" && change.worktreeStatus === "deleted") return false
      if (
        change.status === "conflicted"
        || change.indexStatus === "unchanged"
        || change.worktreeStatus === "unchanged"
      ) return true
      const paths = change.originalPath ? [change.originalPath, change.path] : [change.path]
      if (deps.refineTwoLayerChange) return deps.refineTwoLayerChange({ operation, operationId, paths, repository })
      return withGitChangeProjection({
        commandRunner: deps.commandRunner,
        operation,
        operationId,
        paths,
        repository,
      }, async ({ baseTree, gitIndexFile }) => {
        const result = await deps.commandRunner.run({
          args: ["diff", "--cached", "--name-only", baseTree, "--", ...paths],
          cwd: repository.localPath,
          gitIndexFile,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        return Boolean(result.stdout.trim())
      })
    })
    const changes = parsed.changes.filter((_, index) => keep[index])
    const removedCount = parsed.changes.length - changes.length
    if (removedCount === 0) return parsed
    return {
      ...parsed,
      changeCount: Math.max(0, parsed.changeCount - removedCount),
      changes,
      changesTruncated: parsed.changeCount - removedCount > changes.length,
    }
  }

  return {
    async assertWorktreeMutationAllowed(repository: SynapseGitRepository): Promise<void> {
      if (!deps.readStateDiagnostics) throw new Error(OPERATION_STATE_MESSAGE.unknown)
      let diagnostics: GitRepositoryOperationDiagnostics
      try {
        diagnostics = await deps.readStateDiagnostics(repository)
      } catch (error) {
        throw new Error(OPERATION_STATE_MESSAGE.unknown, { cause: error })
      }
      if (diagnostics.operationState !== "normal") {
        throw new Error(OPERATION_STATE_MESSAGE[diagnostics.operationState])
      }
    },

    async getSnapshot(repository: SynapseGitRepository): Promise<SynapseGitRepositorySnapshot> {
      if (!(await deps.pathExists(repository.localPath))) {
        deps.logger?.warn("Git repository path missing.", repositoryLogMeta(repository))
        return {
          repositoryId: repository.id,
          pathExists: false,
          isGitRepository: false,
          currentBranch: null,
          upstream: null,
          trackingStatus: "detached",
          ahead: 0,
          behind: 0,
          repositoryOperationState: "normal",
          hasConflicts: false,
          changeCount: 0,
          changesTruncated: false,
          changes: [],
        }
      }

      const operation = "git.status"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      try {
        const parser = createGitStatusPorcelainV2Parser({ maxChanges: MAX_VISIBLE_STATUS_CHANGES })
        let sawStatusChunk = false
        const result = await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
          captureStdout: false,
          logFailure: false,
          onStdoutChunk: (chunk) => {
            sawStatusChunk = true
            parser.push(chunk)
          },
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        const rawParsed = sawStatusChunk ? parser.finish() : parseGitStatusPorcelainV2(result.stdout)
        const parsed = await omitIneffectiveTwoLayerChanges(repository, rawParsed, operation, operationId)
        const diagnostics = await readStateDiagnosticsForLog(deps, repository, operation, operationId)
        const snapshot: SynapseGitRepositorySnapshot = {
          repositoryId: repository.id,
          pathExists: true,
          isGitRepository: true,
          repositoryOperationState: diagnostics.operationState,
          ...parsed,
        }
        const branchHeadSeen = sawStatusChunk ? parser.sawBranchHead : result.stdout.includes("# branch.head ")
        logStatusAnomalies(deps, lastAnomalyFingerprints, repository, operation, operationId, snapshot, diagnostics, branchHeadSeen)
        return snapshot
      } catch (error) {
        if (isNotGitRepository(error)) {
          deps.logger?.warn("Git repository status unavailable because path is not a Git repository.", {
            ...repositoryLogMeta(repository),
            operation,
            operationId,
          })
          return {
            repositoryId: repository.id,
            pathExists: true,
            isGitRepository: false,
            currentBranch: null,
            upstream: null,
            trackingStatus: "detached",
            ahead: 0,
            behind: 0,
            repositoryOperationState: "normal",
            hasConflicts: false,
            changeCount: 0,
            changesTruncated: false,
            changes: [],
          }
        }
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repositoryId: repository.id,
          repoPath: repository.localPath,
          startedAt,
          error,
          extra: repositoryLogMeta(repository),
        })
        throw error
      }
    },

    async listSummaries(
      repositories: readonly SynapseGitRepository[],
      readSnapshot?: (repository: SynapseGitRepository) => Promise<SynapseGitRepositorySnapshot>,
    ): Promise<SynapseGitRepositorySummary[]> {
      return mapWithConcurrency(repositories, LIST_SUMMARY_CONCURRENCY_LIMIT, async (repository) => {
        try {
          return {
            repository,
            snapshot: await (readSnapshot ? readSnapshot(repository) : this.getSnapshot(repository)),
            error: null,
          }
        } catch (error) {
          deps.logger?.warn("Git repository summary failed.", {
            ...repositoryLogMeta(repository),
            operation: "git.status.summary",
            ...summarizeSummaryError(error),
          })
          return {
            repository,
            snapshot: null,
            error: error instanceof Error ? error.message : "读取仓库状态失败。",
          }
        }
      })
    },

    async getDiff(
      repository: SynapseGitRepository,
      input: { readonly path: string },
    ): Promise<SynapseGitDiffResult> {
      const operation = "git.diff"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      try {
        assertRepositoryPath(repository.localPath, input.path)
        const snapshot = await this.getSnapshot(repository)
        const change = snapshot.changes.find((candidate) => candidate.path === input.path)
        if (!change) {
          throw new Error("该文件不是当前改动，请刷新后重试。")
        }
        const projectionPaths = change.originalPath ? [change.originalPath, change.path] : [change.path]
        const hasTwoLayerChange = change.indexStatus !== "unchanged" && change.worktreeStatus !== "unchanged"
        const result = change.status === "replaced" || hasTwoLayerChange
          ? await withGitChangeProjection({
              commandRunner: deps.commandRunner,
              operation,
              operationId,
              paths: projectionPaths,
              repository,
            }, ({ baseTree, gitIndexFile }) => deps.commandRunner.run({
              cwd: repository.localPath,
              args: ["diff", "--cached", "--no-ext-diff", baseTree, "--", ...projectionPaths],
              gitIndexFile,
              operation,
              operationId,
              maxBufferBytes: PREVIEW_MAX_BYTES,
              outputOverflow: "truncate",
              repoPath: repository.localPath,
              repositoryId: repository.id,
            }))
          : await deps.commandRunner.run({
              cwd: repository.localPath,
              args: change.status === "untracked" || change.status === "added"
                ? ["diff", "--no-index", "--no-ext-diff", "--", devNull, input.path]
                : ["diff", "HEAD", "--", ...projectionPaths],
              operation,
              operationId,
              maxBufferBytes: PREVIEW_MAX_BYTES,
              outputOverflow: "truncate",
              repoPath: repository.localPath,
              repositoryId: repository.id,
              ...((change.status === "untracked" || change.status === "added") ? { acceptedExitCodes: [0, 1] } : {}),
            })
        const text = result.stdout
        return {
          path: input.path,
          originalPath: change.originalPath,
          binary: /^Binary files /m.test(text),
          truncated: result.stdoutTruncated ?? false,
          text,
        }
      } catch (error) {
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repositoryId: repository.id,
          repoPath: repository.localPath,
          startedAt,
          error,
          extra: {
            ...repositoryLogMeta(repository),
            status: "main-process-validated",
            pathSample: input.path,
          },
        })
        throw error
      }
    },
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex])
    }
  }))

  return results
}

function summarizeSummaryError(error: unknown): Record<string, unknown> {
  if (error && typeof error === "object" && "changes" in error) {
    const changes = (error as { readonly changes?: unknown }).changes
    if (Array.isArray(changes)) return summarizeChanges(changes)
  }
  return {
    ...gitErrorMeta(error),
  }
}

async function readStateDiagnosticsForLog(
  deps: StatusDeps,
  repository: SynapseGitRepository,
  operation: string,
  operationId: string,
): Promise<GitRepositoryOperationDiagnostics> {
  if (!deps.readStateDiagnostics) return { indexLockExists: false, operationState: "normal" }
  try {
    return await deps.readStateDiagnostics(repository)
  } catch (error) {
    deps.logger?.warn("Git repository diagnostic probe failed.", {
      ...repositoryLogMeta(repository),
      operation,
      operationId,
      ...gitErrorMeta(error),
    })
    return { indexLockExists: false, operationState: "unknown" }
  }
}

function logStatusAnomalies(
  deps: StatusDeps,
  lastAnomalyFingerprints: Map<string, string>,
  repository: SynapseGitRepository,
  operation: string,
  operationId: string,
  snapshot: SynapseGitRepositorySnapshot,
  diagnostics: GitRepositoryOperationDiagnostics,
  branchHeadSeen: boolean,
): void {
  const anomalies = collectStatusAnomalies(snapshot, diagnostics, branchHeadSeen)
  if (anomalies.length === 0) {
    lastAnomalyFingerprints.delete(repository.id)
    return
  }

  const fingerprint = JSON.stringify({
    anomalies,
    branch: snapshot.currentBranch,
    upstream: snapshot.upstream,
    conflictedCount: snapshot.changes.filter((change) => change.status === "conflicted").length,
  })
  if (lastAnomalyFingerprints.get(repository.id) === fingerprint) return
  lastAnomalyFingerprints.set(repository.id, fingerprint)

  deps.logger?.warn("Git repository state anomaly detected.", {
    ...repositoryLogMeta(repository),
    operation,
    operationId,
    anomalies,
    ...summarizeSnapshot(snapshot),
    diagnostics,
  })
}

function collectStatusAnomalies(
  snapshot: SynapseGitRepositorySnapshot,
  diagnostics: GitRepositoryOperationDiagnostics,
  branchHeadSeen: boolean,
): string[] {
  const anomalies: string[] = []
  if (!branchHeadSeen) {
    anomalies.push("head-missing")
  } else if (snapshot.currentBranch === null) {
    anomalies.push("detached-head")
  }
  if (snapshot.currentBranch && !snapshot.upstream) anomalies.push("upstream-missing")
  if (snapshot.hasConflicts) anomalies.push("conflicts")
  if (diagnostics.indexLockExists) anomalies.push("index-lock")
  if (diagnostics.operationState !== "normal") anomalies.push(`${diagnostics.operationState}-in-progress`)
  return anomalies
}

const noopLogger = {
  error: () => undefined,
  warn: () => undefined,
}

export type GitStatusService = ReturnType<typeof createGitStatusService>
export { createGitStateDiagnosticsReader }
