import type {
  SynapseGitDiscardChangesResult,
  SynapseGitFileChange,
  SynapseGitRepository,
} from "../../../src/types/git"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../runtime/security"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitChangeSelectionService } from "./git-change-selection-service"
import type { GitClientCommandRunner } from "./git-command-runner"
import { assertRepositoryPath } from "./git-path-utils"
import {
  createGitOperationId,
  logGitOperationFailed,
  logGitOperationStarted,
  logGitOperationSucceeded,
  repositoryLogMeta,
} from "./git-logging"

type DiscardDeps = {
  readonly actor: ActorIdentity
  readonly auditSink: Pick<AuditSink, "record">
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
  readonly now?: () => Date
  readonly permissionGuard: Pick<PermissionGuard, "check">
  readonly selections: Pick<GitChangeSelectionService, "invalidate" | "validate">
  readonly trashItem: (targetPath: string) => Promise<void>
}

type DiscardOptions = {
  readonly operationId?: string
  readonly signal?: AbortSignal
}

function uniquePaths(paths: readonly (string | null)[]): string[] {
  return [...new Set(paths.filter((value): value is string => Boolean(value)))]
}

function pathsForDiscard(changes: readonly SynapseGitFileChange[]) {
  return {
    resetPaths: uniquePaths(changes.map((change) => (
      change.status === "added" || change.status === "renamed" ? change.path : null
    ))),
    restorePaths: uniquePaths(changes.map((change) => (
      change.status === "renamed"
        ? change.originalPath
        : change.status === "modified" || change.status === "deleted"
          ? change.path
          : null
    ))),
    trashPaths: uniquePaths(changes.map((change) => (
      change.status === "added" || change.status === "untracked" || change.status === "renamed"
        ? change.path
        : null
    ))),
  }
}

export function createGitDiscardService(deps: DiscardDeps) {
  const now = deps.now ?? (() => new Date())

  async function authorizeTrash(targetPath: string, repository: SynapseGitRepository, selectionId: string): Promise<void> {
    const metadata = {
      operation: "git.changes.discard",
      repositoryId: repository.id,
      selectionId,
      source: "git.workbench",
    }
    const permission = await deps.permissionGuard.check({
      action: "fs.write.outside-userdata",
      actor: deps.actor,
      context: metadata,
      resource: targetPath,
    })
    if (permission.allowed) return
    deps.auditSink.record({
      action: "fs.write.outside-userdata",
      actor: deps.actor,
      metadata: { ...metadata, policyId: permission.policyId, reason: permission.reason },
      outcome: "denied",
      resource: targetPath,
    })
    throw new Error("没有将所选文件移入系统废纸篓的权限。")
  }

  return {
    async discard(
      repository: SynapseGitRepository,
      input: { readonly selectionId: string },
      options: DiscardOptions = {},
    ): Promise<SynapseGitDiscardChangesResult> {
      const operation = "git.changes.discard"
      const operationId = options.operationId ?? createGitOperationId()
      const startedAt = performance.now()
      const meta = { ...repositoryLogMeta(repository), selectionId: input.selectionId }
      let selectionValidated = false
      let trashedCount = 0
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, meta)
      try {
        await deps.selections.validate(repository, input.selectionId)
        selectionValidated = true
        const selection = await deps.selections.validate(repository, input.selectionId)
        if (selection.changes.some((change) => change.conflicted || change.status === "conflicted")) {
          throw new Error("冲突文件需要在外部处理，不能在 Synapse 中丢弃。")
        }
        if (selection.changes.some((change) => change.status === "unknown")) {
          throw new Error("存在无法识别的 Git 改动，请在外部工具中检查后重试。")
        }
        const { resetPaths, restorePaths, trashPaths } = pathsForDiscard(selection.changes)
        const absoluteTrashPaths = trashPaths.map((filePath) => ({
          filePath,
          targetPath: assertRepositoryPath(repository.localPath, filePath),
        }))
        await Promise.all(absoluteTrashPaths.map(({ targetPath }) => (
          authorizeTrash(targetPath, repository, input.selectionId)
        )))

        for (const { filePath, targetPath } of absoluteTrashPaths) {
          const auditMetadata = {
            operation,
            repositoryId: repository.id,
            selectionId: input.selectionId,
            relativePath: filePath,
            source: "git.workbench",
          }
          try {
            await deps.trashItem(targetPath)
            trashedCount += 1
            deps.auditSink.record({
              action: "fs.write.outside-userdata",
              actor: deps.actor,
              metadata: auditMetadata,
              outcome: "allowed",
              resource: targetPath,
            })
          } catch (error) {
            deps.auditSink.record({
              action: "fs.write.outside-userdata",
              actor: deps.actor,
              metadata: auditMetadata,
              outcome: "failed",
              resource: targetPath,
            })
            const partial = trashedCount > 0 ? `已有 ${trashedCount} 个文件移入废纸篓。` : ""
            throw new Error(`无法将 ${filePath} 移入系统废纸篓；Synapse 不会永久删除该文件。${partial}`, { cause: error })
          }
        }

        if (resetPaths.length > 0) {
          try {
            await deps.commandRunner.run({
              abortSignal: options.signal,
              args: selection.head
                ? ["--literal-pathspecs", "reset", "--mixed", "HEAD", "--", ...resetPaths]
                : ["--literal-pathspecs", "rm", "--cached", "-f", "--ignore-unmatch", "--", ...resetPaths],
              cwd: repository.localPath,
              operation,
              operationId,
              repoPath: repository.localPath,
              repositoryId: repository.id,
            })
          } catch (error) {
            throw new Error("文件已移入废纸篓，但无法恢复所选文件的暂存状态，请从废纸篓恢复后在 Git 工具中检查。", { cause: error })
          }
        }
        if (restorePaths.length > 0) {
          if (!selection.head) throw new Error("仓库尚无提交，无法从 HEAD 恢复所选文件。")
          try {
            await deps.commandRunner.run({
              abortSignal: options.signal,
              args: [
                "--literal-pathspecs",
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                ...restorePaths,
              ],
              cwd: repository.localPath,
              operation,
              operationId,
              repoPath: repository.localPath,
              repositoryId: repository.id,
            })
          } catch (error) {
            const message = trashPaths.length > 0
              ? "部分文件已移入废纸篓，但无法从 HEAD 恢复所选文件，请在 Git 工具中检查。"
              : "无法从 HEAD 恢复所选文件，请在 Git 工具中检查。"
            throw new Error(message, { cause: error })
          }
        }

        const result = {
          completedAt: now().toISOString(),
          discardedCount: selection.changes.length,
          restoredPaths: restorePaths,
          trashedPaths: trashPaths,
        }
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
          ...meta,
          discardedCount: result.discardedCount,
          restoredCount: result.restoredPaths.length,
          trashedCount: result.trashedPaths.length,
        })
        return result
      } catch (error) {
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repositoryId: repository.id,
          repoPath: repository.localPath,
          startedAt,
          error,
          extra: { ...meta, trashedCount },
        })
        throw error
      } finally {
        if (selectionValidated) deps.selections.invalidate(input.selectionId)
      }
    },
  }
}

const noopLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
}

export type GitDiscardService = ReturnType<typeof createGitDiscardService>
