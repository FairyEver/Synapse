import path from "node:path"
import type { SynapseGitRemoteKind, SynapseGitRepository } from "../../../src/types/git"
import { categorizeGitError } from "./git-command-runner"
import type { GitClientCommandRunner } from "./git-command-runner"
import {
  createGitLogger,
  createGitOperation,
  logGitOperationFailure,
  logGitOperationStart,
  logGitOperationSuccess,
  sanitizeGitText,
  type GitLogger,
} from "./git-log-utils"

type CloneInput = {
  readonly remoteUrl: string
  readonly targetPath: string
  readonly name: string
}

type CloneResult = {
  readonly repository: SynapseGitRepository
  readonly remoteKind: SynapseGitRemoteKind
}

type CloneDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly logger?: GitLogger
  readonly registry: {
    addLocal(input: { readonly name: string; readonly localPath: string }): Promise<SynapseGitRepository>
  }
  readonly pathExists: (filePath: string) => Promise<boolean>
}

const defaultLogger = createGitLogger("git.clone")

export function detectRemoteKind(remoteUrl: string): SynapseGitRemoteKind {
  if (/^https:\/\//i.test(remoteUrl)) return "https"
  if (/^(ssh:\/\/|[^@\s]+@[^:\s]+:.+)/i.test(remoteUrl)) return "ssh"
  return "unknown"
}

export function createGitCloneService(deps: CloneDeps) {
  const logger = deps.logger ?? defaultLogger
  return {
    async clone(input: CloneInput): Promise<CloneResult> {
      const operation = createGitOperation("git.clone")
      const remoteUrl = input.remoteUrl.trim()
      const targetPath = path.resolve(input.targetPath)
      const remoteKind = detectRemoteKind(remoteUrl)
      if (!remoteUrl) throw new Error("请输入仓库地址。")
      if (!targetPath) throw new Error("请选择保存位置。")
      if (await deps.pathExists(targetPath)) {
        logger.warn("Git operation blocked because clone target exists.", {
          operation: operation.operation,
          operationId: operation.operationId,
          remoteKind,
          targetPath: sanitizeGitText(targetPath),
        })
        throw new Error("目标目录已存在。请选择空目录。")
      }

      logGitOperationStart(logger, "Git operation started.", operation, undefined, {
        remoteKind,
        targetPath: sanitizeGitText(targetPath),
      })

      try {
        await deps.commandRunner.run({
          cwd: path.dirname(targetPath),
          args: ["clone", "--progress", remoteUrl, targetPath],
          operation: operation.operation,
          operationId: operation.operationId,
          timeoutMs: 300_000,
        })
        const repository = await deps.registry.addLocal({ name: input.name, localPath: targetPath })
        logGitOperationSuccess(logger, "Git operation completed.", operation, repository, {
          remoteKind,
        })
        return { repository, remoteKind }
      } catch (error) {
        logGitOperationFailure(logger, "Git operation failed.", operation, error, undefined, {
          errorCategory: categorizeGitError(error),
          remoteKind,
          targetPath: sanitizeGitText(targetPath),
        })
        throw error
      }
    },
  }
}

export type GitCloneService = ReturnType<typeof createGitCloneService>
