import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises"
import path from "node:path"
import type { SynapseGitCloneResult, SynapseGitRemoteKind, SynapseGitRepository } from "../../../src/types/git"
import type { DataNamespace, GitCloneJournalEntryV1 } from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/logging"
import type { GitClientCommandRunner } from "./git-command-runner"
import {
  createGitOperationId,
  logGitOperationBlocked,
  logGitOperationFailed,
  logGitOperationStarted,
  logGitOperationSucceeded,
  sanitizeRemoteUrl,
} from "./git-logging"

const CLONE_CONTAINER_PREFIX = ".synapse-clone-"
const CLONE_MARKER_DIRECTORY = ".synapse-owned-clone"
const CLONE_WORK_DIRECTORY = "repository"

type CloneInput = {
  readonly remoteUrl: string
  readonly parentDirectory: string
  readonly directoryName: string
}

type CloneJournal = Pick<DataNamespace<GitCloneJournalEntryV1>, "get" | "list" | "remove" | "upsert">

type CloneDeps = {
  readonly commandRunner: Pick<GitClientCommandRunner, "run">
  readonly journal: CloneJournal
  readonly logger?: Pick<StructuredLogger, "error" | "info" | "warn">
  readonly registry: {
    addLocal(input: { readonly name: string; readonly localPath: string }): Promise<SynapseGitRepository>
  }
  readonly pathExists: (filePath: string) => Promise<boolean>
  readonly now?: () => Date
  readonly randomId?: () => string
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
  const now = deps.now ?? (() => new Date())
  const randomId = deps.randomId ?? randomUUID

  const cleanupJournaledContainer = async (entry: GitCloneJournalEntryV1): Promise<boolean> => {
    const persisted = await deps.journal.get(entry.id)
    if (!persisted || persisted.tempPath !== entry.tempPath || persisted.targetPath !== entry.targetPath) return false
    if (!(await deps.pathExists(entry.tempPath))) {
      await deps.journal.remove(entry.id)
      return true
    }
    if (!isExpectedJournalEntry(entry) || !(await deps.pathExists(path.join(entry.tempPath, CLONE_MARKER_DIRECTORY)))) {
      deps.logger?.warn("Skipped untrusted Git clone recovery entry.", {
        operation: "git.clone.recover",
        journalId: entry.id,
        tempPath: entry.tempPath,
        targetPath: entry.targetPath,
      })
      return false
    }
    await rm(entry.tempPath, { force: true, recursive: true })
    await deps.journal.remove(entry.id)
    return true
  }

  const cleanupAfterOperation = async (entry: GitCloneJournalEntryV1): Promise<void> => {
    try {
      await cleanupJournaledContainer(entry)
    } catch (error) {
      deps.logger?.warn("Failed to clean Synapse Git clone container.", {
        operation: "git.clone.cleanup",
        journalId: entry.id,
        tempPath: entry.tempPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    async recoverAbandonedClones(): Promise<{ readonly removed: number; readonly skipped: number }> {
      let removed = 0
      let skipped = 0
      for (const entry of await deps.journal.list()) {
        try {
          if (await cleanupJournaledContainer(entry)) removed += 1
          else skipped += 1
        } catch (error) {
          skipped += 1
          deps.logger?.warn("Failed to recover abandoned Git clone container.", {
            operation: "git.clone.recover",
            journalId: entry.id,
            tempPath: entry.tempPath,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      return { removed, skipped }
    },

    async clone(input: CloneInput, options: CloneOptions = {}): Promise<SynapseGitCloneResult> {
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
      if (await deps.pathExists(targetPath)) {
        logGitOperationBlocked(deps.logger ?? noopLogger, operation, operationId, "target-exists", { targetPath })
        throw new Error("目标目录已存在。请选择空目录。")
      }

      const tempPath = await mkdtemp(path.join(parentDirectory, CLONE_CONTAINER_PREFIX))
      const markerPath = path.join(tempPath, CLONE_MARKER_DIRECTORY)
      const clonePath = path.join(tempPath, CLONE_WORK_DIRECTORY)
      const journalEntry: GitCloneJournalEntryV1 = {
        id: randomId(),
        schemaVersion: 1,
        tempPath,
        targetPath,
        createdAt: now().toISOString(),
      }
      try {
        await mkdir(markerPath)
        await deps.journal.upsert(journalEntry)
      } catch (error) {
        await rm(tempPath, { force: true, recursive: true })
        logGitOperationFailed(deps.logger ?? noopLogger, {
          operation,
          operationId,
          repoPath: targetPath,
          startedAt,
          error,
          extra: { remoteKind },
        })
        throw error
      }

      try {
        await deps.commandRunner.run({
          cwd: parentDirectory,
          args: ["clone", "--progress", remoteUrl, clonePath],
          abortSignal: options.signal,
          operation,
          operationId,
          repoPath: targetPath,
          remoteUrl,
          timeoutMs: 300_000,
        })
        if (await deps.pathExists(targetPath)) throw new Error("目标目录在克隆期间被创建，完整仓库已放弃移动。")
        await rename(clonePath, targetPath)
        await cleanupAfterOperation(journalEntry)

        try {
          const repository = await deps.registry.addLocal({ name: directoryName, localPath: targetPath })
          logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
            repositoryId: repository.id,
            repoPath: repository.localPath,
            remoteKind,
            registrationStatus: "registered",
          })
          return { status: "registered", repository, localPath: targetPath, remoteKind, message: null }
        } catch (error) {
          deps.logger?.warn("Git clone completed but repository registration failed.", {
            operation,
            operationId,
            repoPath: targetPath,
            error: error instanceof Error ? error.message : String(error),
          })
          logGitOperationSucceeded(deps.logger ?? noopLogger, operation, operationId, startedAt, {
            repoPath: targetPath,
            remoteKind,
            registrationStatus: "registration-failed",
          })
          return {
            status: "registration-failed",
            repository: null,
            localPath: targetPath,
            remoteKind,
            message: `仓库已完整克隆到 ${targetPath}，但未能加入列表。请使用“添加本地仓库”选择该目录。`,
          }
        }
      } catch (error) {
        await cleanupAfterOperation(journalEntry)
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

function isExpectedJournalEntry(entry: GitCloneJournalEntryV1): boolean {
  return path.isAbsolute(entry.tempPath)
    && path.isAbsolute(entry.targetPath)
    && path.dirname(entry.tempPath) === path.dirname(entry.targetPath)
    && path.basename(entry.tempPath).startsWith(CLONE_CONTAINER_PREFIX)
    && entry.tempPath !== entry.targetPath
}

const noopLogger = {
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
}

export type GitCloneService = ReturnType<typeof createGitCloneService>
