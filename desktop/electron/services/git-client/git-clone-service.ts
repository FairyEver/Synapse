import path from "node:path"
import type { SynapseGitRemoteKind, SynapseGitRepository } from "../../../src/types/git"
import type { GitClientCommandRunner } from "./git-command-runner"
import type { StructuredLogger } from "../../runtime/logging"
import {
  createGitOperationId,
  logGitOperationBlocked,
  logGitOperationFailed,
  logGitOperationStarted,
  logGitOperationSucceeded,
  sanitizeRemoteUrl,
} from "./git-logging"

type CloneInput = {
  readonly remoteUrl: string
  readonly parentDirectory: string
  readonly directoryName: string
}

type CloneResult = {
  readonly repository: SynapseGitRepository
  readonly remoteKind: SynapseGitRemoteKind
}

type CloneDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
  readonly registry: {
    addLocal(input: { readonly name: string; readonly localPath: string }): Promise<SynapseGitRepository>
  }
  readonly pathExists: (filePath: string) => Promise<boolean>
}

type CloneOptions = {
  readonly operationId?: string
  readonly signal?: AbortSignal
}

export function detectRemoteKind(remoteUrl: string): SynapseGitRemoteKind {
  if (/^http:\/\//i.test(remoteUrl)) return "http"
  if (/^https:\/\//i.test(remoteUrl)) return "https"
  if (/^(ssh:\/\/|[^@\s]+@[^:\s]+:.+)/i.test(remoteUrl)) return "ssh"
  return "unknown"
}

export function createGitCloneService(deps: CloneDeps) {
  return {
    async clone(input: CloneInput, options: CloneOptions = {}): Promise<CloneResult> {
      const operation = "git.clone"
      const operationId = options.operationId ?? createGitOperationId()
      const startedAt = performance.now()
      const remoteUrl = input.remoteUrl.trim()
      const parentDirectory = path.resolve(input.parentDirectory)
      const directoryName = input.directoryName.trim()
      if (!directoryName || directoryName === "." || directoryName === ".." || path.basename(directoryName) !== directoryName) {
        throw new Error("仓库目录名无效。")
      }
      const targetPath = path.join(parentDirectory, directoryName)
      const remoteKind = detectRemoteKind(remoteUrl)
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, {
        remoteKind,
        remoteUrl: sanitizeRemoteUrl(remoteUrl),
        targetPath,
        nameLength: directoryName.length,
      })
      if (!remoteUrl) {
        logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "missing-remote-url", { targetPath })
        throw new Error("请输入仓库地址。")
      }
      if (!targetPath) {
        logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "missing-target-path")
        throw new Error("请选择保存位置。")
      }
      if (await deps.pathExists(targetPath)) {
        logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "target-exists", { targetPath })
        throw new Error("目标目录已存在。请选择空目录。")
      }

      try {
        await deps.commandRunner.run({
          cwd: path.dirname(targetPath),
          args: ["clone", "--progress", remoteUrl, targetPath],
          abortSignal: options.signal,
          operation,
          operationId,
          repoPath: targetPath,
          remoteUrl,
          timeoutMs: 300_000,
        })
        const repository = await deps.registry.addLocal({ name: directoryName, localPath: targetPath })
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
          repositoryId: repository.id,
          repoPath: repository.localPath,
          remoteKind,
        })
        return { repository, remoteKind }
      } catch (error) {
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repoPath: targetPath,
          startedAt,
          error,
          extra: {
            remoteKind,
            remoteUrl: sanitizeRemoteUrl(remoteUrl),
          },
        })
        throw error
      }
    },
  }
}

const noopLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
}

export type GitCloneService = ReturnType<typeof createGitCloneService>
