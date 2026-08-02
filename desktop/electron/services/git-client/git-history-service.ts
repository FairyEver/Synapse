import type { SynapseGitCommitDetail, SynapseGitCommitSummary, SynapseGitFileChange, SynapseGitRepository } from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitClientCommandRunner } from "./git-command-runner"
import {
  createGitOperationId,
  logGitOperationFailed,
  repositoryLogMeta,
} from "./git-logging"

const FIELD = "%x1f"
const RECORD = "%x1e"
const RECORD_SEPARATOR = String.fromCharCode(0x1e)
const PRETTY = `%H${FIELD}%h${FIELD}%s${FIELD}%an${FIELD}%ae${FIELD}%cI${RECORD}`
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024

function parseCommitRecord(record: string): SynapseGitCommitSummary | null {
  const [hash, shortHash, subject, authorName, authorEmail, committedAt] = record.split("\x1f")
  if (!hash || !shortHash || subject === undefined || !authorName || !authorEmail || !committedAt) return null
  return { hash, shortHash, subject, authorName, authorEmail, committedAt }
}

function statusFromNameStatus(code: string): SynapseGitFileChange["status"] {
  if (code.startsWith("A")) return "added"
  if (code.startsWith("M")) return "modified"
  if (code.startsWith("D")) return "deleted"
  if (code.startsWith("R")) return "renamed"
  return "unknown"
}

function parseNameStatus(tokens: readonly string[]): SynapseGitFileChange[] {
  const changes: SynapseGitFileChange[] = []
  for (let index = 0; index < tokens.length;) {
    const code = tokens[index++] ?? ""
    if (!code) continue
    const originalPath = tokens[index++] ?? ""
    if (!originalPath) break
    const renamed = code.startsWith("R")
    const nextPath = renamed ? (tokens[index++] ?? "") : originalPath
    if (!nextPath) break
    changes.push({
      path: nextPath,
      originalPath: renamed ? originalPath : null,
      status: statusFromNameStatus(code),
      staged: false,
      conflicted: false,
    })
  }
  return changes
}

function assertCommitHash(hash: string): string {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(hash)) {
    throw new Error("提交标识不合法。")
  }
  return hash
}

export function createGitHistoryService(deps: {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly logger?: Pick<StructuredLogger, "error">
}) {
  return {
    async list(
      repository: SynapseGitRepository,
      input: { readonly limit: number; readonly offset: number },
    ): Promise<SynapseGitCommitSummary[]> {
      const operation = "git.history.list"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      try {
        const result = await deps.commandRunner.run({
          cwd: repository.localPath,
          args: [
            "log",
            `--pretty=format:${PRETTY}`,
            "--date=iso-strict",
            "--max-count",
            String(input.limit),
            "--skip",
            String(input.offset),
          ],
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        return result.stdout
          .split("\x1e")
          .map((record) => parseCommitRecord(record.trim()))
          .filter((item): item is SynapseGitCommitSummary => Boolean(item))
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
            limit: input.limit,
            offset: input.offset,
          },
        })
        throw error
      }
    },

    async getCommit(repository: SynapseGitRepository, hash: string): Promise<SynapseGitCommitDetail> {
      const operation = "git.history.getCommit"
      const operationId = createGitOperationId()
      const startedAt = performance.now()
      try {
        const commitHash = assertCommitHash(hash)
        const summaryResult = await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["show", "--name-status", "-z", "--find-renames", `--pretty=format:${PRETTY}`, "--date=iso-strict", commitHash],
          operation,
          operationId,
          maxBufferBytes: PREVIEW_MAX_BYTES,
          outputOverflow: "truncate",
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        const summaryEnd = summaryResult.stdout.indexOf(RECORD_SEPARATOR)
        const summary = parseCommitRecord(summaryEnd >= 0 ? summaryResult.stdout.slice(0, summaryEnd) : "")
        if (!summary) throw new Error("找不到提交记录。")
        const nameStatus = summaryResult.stdout.slice(summaryEnd + 1).replace(/^[\r\n\0]+/, "")
        const diffResult = await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["show", "--format=", "--patch", commitHash],
          operation,
          operationId,
          maxBufferBytes: PREVIEW_MAX_BYTES,
          outputOverflow: "truncate",
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        return {
          ...summary,
          files: parseNameStatus(nameStatus.split("\0")),
          diff: diffResult.stdout,
          filesTruncated: summaryResult.stdoutTruncated ?? false,
          diffTruncated: diffResult.stdoutTruncated ?? false,
          truncated: Boolean(summaryResult.stdoutTruncated || diffResult.stdoutTruncated),
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
            hash,
          },
        })
        throw error
      }
    },
  }
}

const noopLogger = {
  error: () => undefined,
}

export type GitHistoryService = ReturnType<typeof createGitHistoryService>
