import path from "node:path"
import { devNull } from "node:os"
import type {
  SynapseGitDiffResult,
  SynapseGitRepository,
  SynapseGitRepositorySnapshot,
  SynapseGitRepositorySummary,
} from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
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

type GitRepositoryStateDiagnostics = {
  readonly cherryPickInProgress: boolean
  readonly indexLockExists: boolean
  readonly mergeInProgress: boolean
  readonly rebaseInProgress: boolean
}

type StatusDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly logger?: Pick<StructuredLogger, "error" | "warn">
  readonly pathExists: (filePath: string) => Promise<boolean>
  readonly readStateDiagnostics?: (repository: SynapseGitRepository) => Promise<GitRepositoryStateDiagnostics>
}

const LIST_SUMMARY_CONCURRENCY_LIMIT = 4
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024
const MAX_VISIBLE_STATUS_CHANGES = 10_000

function createGitStateDiagnosticsReader(
  commandRunner: Pick<GitClientCommandRunner, "run">,
  pathExists: (filePath: string) => Promise<boolean>,
) {
  return async (repository: SynapseGitRepository): Promise<GitRepositoryStateDiagnostics> => {
    const result = await commandRunner.run({
      cwd: repository.localPath,
      args: [
        "rev-parse",
        "--git-path",
        "index.lock",
        "--git-path",
        "MERGE_HEAD",
        "--git-path",
        "rebase-merge",
        "--git-path",
        "rebase-apply",
        "--git-path",
        "CHERRY_PICK_HEAD",
      ],
      logFailure: false,
      operation: "git.status.diagnostics",
      repoPath: repository.localPath,
      repositoryId: repository.id,
    })
    const [
      indexLockPath = "",
      mergeHeadPath = "",
      rebaseMergePath = "",
      rebaseApplyPath = "",
      cherryPickHeadPath = "",
    ] = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

    const [
      indexLockExists,
      mergeInProgress,
      rebaseMergeExists,
      rebaseApplyExists,
      cherryPickInProgress,
    ] = await Promise.all([
      gitPathExists(repository.localPath, indexLockPath, pathExists),
      gitPathExists(repository.localPath, mergeHeadPath, pathExists),
      gitPathExists(repository.localPath, rebaseMergePath, pathExists),
      gitPathExists(repository.localPath, rebaseApplyPath, pathExists),
      gitPathExists(repository.localPath, cherryPickHeadPath, pathExists),
    ])

    return {
      cherryPickInProgress,
      indexLockExists,
      mergeInProgress,
      rebaseInProgress: rebaseMergeExists || rebaseApplyExists,
    }
  }
}

function gitPathExists(
  repositoryPath: string,
  gitPath: string,
  pathExists: (filePath: string) => Promise<boolean>,
): Promise<boolean> {
  if (!gitPath) return Promise.resolve(false)
  return pathExists(path.isAbsolute(gitPath) ? gitPath : path.join(repositoryPath, gitPath))
}

function isNotGitRepository(error: unknown): boolean {
  return error instanceof Error && /not a git repository/i.test(error.message)
}

export function createGitStatusService(deps: StatusDeps) {
  const lastAnomalyFingerprints = new Map<string, string>()

  return {
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
        const parsed = sawStatusChunk ? parser.finish() : parseGitStatusPorcelainV2(result.stdout)
        const snapshot = {
          repositoryId: repository.id,
          pathExists: true,
          isGitRepository: true,
          ...parsed,
        }
        const diagnostics = await readStateDiagnosticsForLog(deps, repository, operation, operationId)
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
        const isNewFile = change.status === "untracked" || change.status === "added"
        const args = isNewFile
          ? ["diff", "--no-index", "--no-ext-diff", "--", devNull, input.path]
          : ["diff", "HEAD", "--", ...(change.originalPath ? [change.originalPath] : []), change.path]
        const result = await deps.commandRunner.run({
          cwd: repository.localPath,
          args,
          operation,
          operationId,
          maxBufferBytes: PREVIEW_MAX_BYTES,
          outputOverflow: "truncate",
          repoPath: repository.localPath,
          repositoryId: repository.id,
          ...(isNewFile ? { acceptedExitCodes: [0, 1] } : {}),
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
): Promise<GitRepositoryStateDiagnostics | null> {
  if (!deps.readStateDiagnostics) return null
  try {
    return await deps.readStateDiagnostics(repository)
  } catch (error) {
    deps.logger?.warn("Git repository diagnostic probe failed.", {
      ...repositoryLogMeta(repository),
      operation,
      operationId,
      ...gitErrorMeta(error),
    })
    return null
  }
}

function logStatusAnomalies(
  deps: StatusDeps,
  lastAnomalyFingerprints: Map<string, string>,
  repository: SynapseGitRepository,
  operation: string,
  operationId: string,
  snapshot: SynapseGitRepositorySnapshot,
  diagnostics: GitRepositoryStateDiagnostics | null,
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
    conflictedCount: snapshot.changes.filter((change) => change.conflicted).length,
  })
  if (lastAnomalyFingerprints.get(repository.id) === fingerprint) return
  lastAnomalyFingerprints.set(repository.id, fingerprint)

  deps.logger?.warn("Git repository state anomaly detected.", {
    ...repositoryLogMeta(repository),
    operation,
    operationId,
    anomalies,
    ...summarizeSnapshot(snapshot),
    ...(diagnostics ? { diagnostics } : {}),
  })
}

function collectStatusAnomalies(
  snapshot: SynapseGitRepositorySnapshot,
  diagnostics: GitRepositoryStateDiagnostics | null,
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
  if (diagnostics?.indexLockExists) anomalies.push("index-lock")
  if (diagnostics?.mergeInProgress) anomalies.push("merge-in-progress")
  if (diagnostics?.rebaseInProgress) anomalies.push("rebase-in-progress")
  if (diagnostics?.cherryPickInProgress) anomalies.push("cherry-pick-in-progress")
  return anomalies
}

const noopLogger = {
  error: () => undefined,
  warn: () => undefined,
}

export type GitStatusService = ReturnType<typeof createGitStatusService>
export { createGitStateDiagnosticsReader }
