import type {
  SynapseGitBranch,
  SynapseGitCheckoutRemoteBranchInput,
  SynapseGitCheckoutRemoteBranchResult,
  SynapseGitRemoteBranchGroup,
  SynapseGitRepository,
  SynapseGitRepositorySnapshot,
} from "../../../src/types/git"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitClientCommandRunner } from "./git-command-runner"
import {
  createGitOperationId,
  logGitOperationBlocked,
  logGitOperationFailed,
  logGitOperationStarted,
  logGitOperationSucceeded,
  repositoryLogMeta,
} from "./git-logging"

type BranchDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly getSnapshot: (repository: SynapseGitRepository) => Promise<Pick<SynapseGitRepositorySnapshot, "changeCount" | "changes">>
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
}

type BranchOperationOptions = {
  readonly operationId?: string
  readonly signal?: AbortSignal
}

function requireBranchName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error("请输入分支名称。")
  return trimmed
}

export function createGitBranchService(deps: BranchDeps) {
  async function validateBranchName(
    repository: SynapseGitRepository,
    branchName: string,
    operation: string,
    operationId: string,
  ): Promise<string> {
    const name = requireBranchName(branchName)
    const result = await deps.commandRunner.run({
      cwd: repository.localPath,
      args: ["check-ref-format", "--branch", name],
      acceptedExitCodes: [0, 1],
      operation,
      operationId,
      repoPath: repository.localPath,
      repositoryId: repository.id,
    })
    if (result.stdout.trim() !== name) throw new Error("分支名称不合法。")
    return name
  }

  async function assertClean(repository: SynapseGitRepository, operation: string, operationId: string): Promise<void> {
    const snapshot = await deps.getSnapshot(repository)
    const changeCount = snapshot.changeCount ?? snapshot.changes.length
    if (changeCount > 0) {
      logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "working-tree-dirty", {
        ...repositoryLogMeta(repository),
        changeCount,
      })
      throw new Error("请先提交本地改动。")
    }
  }

  return {
    async list(repository: SynapseGitRepository): Promise<SynapseGitBranch[]> {
      const operation = "git.branch.list"
      const operationId = createGitOperationId()
      const currentResult = await deps.commandRunner.run({
        cwd: repository.localPath,
        args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
        acceptedExitCodes: [0, 1],
        operation,
        operationId,
        repoPath: repository.localPath,
        repositoryId: repository.id,
      })
      const branchesResult = await deps.commandRunner.run({
        cwd: repository.localPath,
        args: ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
        operation,
        operationId,
        repoPath: repository.localPath,
        repositoryId: repository.id,
      })
      const currentBranch = currentResult.stdout.trim()
      return branchesResult.stdout.split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((name) => ({
          name,
          current: name === currentBranch,
        }))
    },

    async checkout(repository: SynapseGitRepository, branchName: string, options: BranchOperationOptions = {}): Promise<void> {
      const operation = "git.checkout"
      const operationId = options.operationId ?? createGitOperationId()
      const startedAt = performance.now()
      const meta = { ...repositoryLogMeta(repository), branch: branchName }
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, meta)
      try {
        await assertClean(repository, operation, operationId)
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["checkout", await validateBranchName(repository, branchName, operation, operationId)],
          abortSignal: options.signal,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, meta)
      } catch (error) {
        if (!isWorkingTreeDirtyBlock(error)) {
          logGitOperationFailed(deps.logger ?? noopLogger, {
            operation,
            operationId,
            repositoryId: repository.id,
            repoPath: repository.localPath,
            startedAt,
            error,
            extra: meta,
          })
        }
        throw error
      }
    },

    async create(repository: SynapseGitRepository, branchName: string, options: BranchOperationOptions = {}): Promise<void> {
      const operation = "git.branch.create"
      const operationId = options.operationId ?? createGitOperationId()
      const startedAt = performance.now()
      const meta = { ...repositoryLogMeta(repository), branch: branchName }
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, meta)
      try {
        await assertClean(repository, operation, operationId)
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["checkout", "-b", await validateBranchName(repository, branchName, operation, operationId)],
          abortSignal: options.signal,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, meta)
      } catch (error) {
        if (!isWorkingTreeDirtyBlock(error)) {
          logGitOperationFailed(deps.logger ?? noopLogger, {
            operation,
            operationId,
            repositoryId: repository.id,
            repoPath: repository.localPath,
            startedAt,
            error,
            extra: meta,
          })
        }
        throw error
      }
    },

    async listRemote(repository: SynapseGitRepository): Promise<SynapseGitRemoteBranchGroup[]> {
      const operation = "git.branch.list-remote"
      const operationId = createGitOperationId()
      const result = await deps.commandRunner.run({
        cwd: repository.localPath,
        args: ["for-each-ref", "--format=%(refname:strip=2)%00%(symref)", "refs/remotes"],
        operation,
        operationId,
        repoPath: repository.localPath,
        repositoryId: repository.id,
      })
      const groups = new Map<string, Array<{ name: string; fullName: string }>>()
      for (const line of result.stdout.split(/\r?\n/)) {
        const [fullName = "", symbolicTarget = ""] = line.split("\0")
        if (!fullName || symbolicTarget || fullName.endsWith("/HEAD")) continue
        const separator = fullName.indexOf("/")
        if (separator <= 0 || separator === fullName.length - 1) continue
        const remoteName = fullName.slice(0, separator)
        const name = fullName.slice(separator + 1)
        const branches = groups.get(remoteName) ?? []
        branches.push({ name, fullName })
        groups.set(remoteName, branches)
      }
      return Array.from(groups.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([remoteName, branches]) => ({
          remoteName,
          branches: branches.sort((left, right) => left.name.localeCompare(right.name)),
        }))
    },

    async fetchRemote(repository: SynapseGitRepository, options: BranchOperationOptions = {}): Promise<void> {
      const operation = "git.branch.fetch-remote"
      const operationId = options.operationId ?? createGitOperationId()
      const startedAt = performance.now()
      const meta = repositoryLogMeta(repository)
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, meta)
      try {
        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["fetch", "--all", "--prune"],
          abortSignal: options.signal,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, meta)
      } catch (error) {
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repositoryId: repository.id,
          repoPath: repository.localPath,
          startedAt,
          error,
          extra: meta,
        })
        throw error
      }
    },

    async checkoutRemote(
      repository: SynapseGitRepository,
      input: SynapseGitCheckoutRemoteBranchInput,
      options: BranchOperationOptions = {},
    ): Promise<SynapseGitCheckoutRemoteBranchResult> {
      const operation = "git.checkout-remote"
      const operationId = options.operationId ?? createGitOperationId()
      const startedAt = performance.now()
      const meta = {
        ...repositoryLogMeta(repository),
        remoteName: input.remoteName,
        branch: input.branchName,
        localBranch: input.localBranchName,
      }
      logGitOperationStarted(deps.logger ?? noopLogger, operation, operationId, meta)
      try {
        await assertClean(repository, operation, operationId)
        const [branchName, localBranchName] = await Promise.all([
          validateBranchName(repository, input.branchName, operation, operationId),
          validateBranchName(repository, input.localBranchName, operation, operationId),
        ])
        const remotes = await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["remote"],
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        const remoteName = input.remoteName.trim()
        if (!remotes.stdout.split(/\r?\n/).map((value) => value.trim()).includes(remoteName)) {
          throw new Error("远端不存在，请先重新获取远程分支。")
        }
        const remoteBranchName = `${remoteName}/${branchName}`
        const remoteRef = await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["rev-parse", "--verify", "--quiet", `refs/remotes/${remoteBranchName}`],
          acceptedExitCodes: [0, 1],
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        if (!remoteRef.stdout.trim()) throw new Error("远程分支不存在，请先重新获取远程分支。")

        const localRef = await deps.commandRunner.run({
          cwd: repository.localPath,
          args: ["rev-parse", "--verify", "--quiet", `refs/heads/${localBranchName}`],
          acceptedExitCodes: [0, 1],
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        const localExists = Boolean(localRef.stdout.trim())
        if (localExists) {
          const upstream = await deps.commandRunner.run({
            cwd: repository.localPath,
            args: ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${localBranchName}`],
            operation,
            operationId,
            repoPath: repository.localPath,
            repositoryId: repository.id,
          })
          if (upstream.stdout.trim() !== remoteBranchName) {
            throw new Error("同名本地分支未跟踪该远程分支，请填写其他本地名称。")
          }
          const currentBranch = await deps.commandRunner.run({
            cwd: repository.localPath,
            args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
            acceptedExitCodes: [0, 1],
            operation,
            operationId,
            repoPath: repository.localPath,
            repositoryId: repository.id,
          })
          if (currentBranch.stdout.trim() !== localBranchName) {
            const worktrees = await deps.commandRunner.run({
              cwd: repository.localPath,
              args: ["worktree", "list", "--porcelain"],
              operation,
              operationId,
              repoPath: repository.localPath,
              repositoryId: repository.id,
            })
            if (worktrees.stdout.split(/\r?\n/).includes(`branch refs/heads/${localBranchName}`)) {
              throw new Error("该本地分支已在其他 Worktree 中检出，请先在对应 Worktree 切换分支。")
            }
          }
        }

        await deps.commandRunner.run({
          cwd: repository.localPath,
          args: localExists
            ? ["checkout", localBranchName]
            : ["checkout", "-b", localBranchName, "--track", remoteBranchName],
          abortSignal: options.signal,
          operation,
          operationId,
          repoPath: repository.localPath,
          repositoryId: repository.id,
        })
        const result = { created: !localExists, localBranchName, remoteBranchName }
        logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, meta)
        return result
      } catch (error) {
        if (!isWorkingTreeDirtyBlock(error)) {
          logGitOperationFailed(deps.logger ?? noopLogger, {
            operation,
            operationId,
            repositoryId: repository.id,
            repoPath: repository.localPath,
            startedAt,
            error,
            extra: meta,
          })
        }
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

function isWorkingTreeDirtyBlock(error: unknown): boolean {
  return error instanceof Error && error.message === "请先提交本地改动。"
}

export type GitBranchService = ReturnType<typeof createGitBranchService>
