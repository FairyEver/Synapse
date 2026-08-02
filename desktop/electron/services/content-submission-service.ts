import { getContentTypeDefinition } from "../../src/config/content-types"
import {
  canManageRepositoryContentLifecycle,
  canUpdateRepositoryContent,
} from "../../src/lib/content-ownership"
import type {
  SynapseContentMutationResult,
  SynapseContentType,
  SynapseCreateContentRequest,
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
  SynapseDeleteContentPayload,
  SynapsePurgeContentPayload,
  SynapseRestoreContentPayload,
  SynapseUpdateContentRequest,
  SynapseUpdateRulePayload,
  SynapseUpdateSkillPayload,
} from "../../src/types/content"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type { SynapseRepositoryLocalState } from "../../src/types/repository"
import { contentHistoryService } from "./content-history-service"
import { contentIndexService } from "./content-index-service"
import { contentWriteService, type ContentWriteResult } from "./content-write-service"
import { ContentRecoveryNeededError } from "./content-write-transaction-service"
import { configStore } from "./config-store"
import { runGitCommand } from "./git-command"
import { createMainLogger } from "./log-store"
import { formatGitFailureMessage, isNonFastForwardError } from "./git-error-utils"
import { pendingPushesService } from "./pending-pushes-service"
import { repositoryMaintenanceService } from "./repository-maintenance-service"
import {
  commitRepositoryPaths,
  pullRepositoryWithSafeRebase,
  readUnpushedCommitCount,
  RepositoryCommitCreatedError,
  runRepositoryGitExclusive,
} from "./repository-git-mutation-service"
import { userIdentityService } from "./user-identity-service"

const logger = createMainLogger("service.content-submit")
const GIT_REMOTE_OPERATION_TIMEOUT_MS = 60_000

type PushProgressListener = (statusText: string) => void

function getContentOwnershipLabel(contentType: SynapseContentType): string {
  return contentType === "skill"
    ? "Skill"
    : getContentTypeDefinition(contentType).singularLabel
}

function assertContentUpdateAllowed(
  contentType: SynapseContentType,
  createdBy: string,
  userId: string,
): void {
  if (!canUpdateRepositoryContent({ createdBy, type: contentType }, userId)) {
    throw new Error(`只有创建者可以更新 ${getContentOwnershipLabel(contentType)}。`)
  }
}

function assertContentLifecycleOwner(
  contentType: SynapseContentType,
  createdBy: string,
  userId: string,
  action: "删除" | "恢复" | "永久删除",
): void {
  if (!canManageRepositoryContentLifecycle({ createdBy, type: contentType }, userId)) {
    throw new Error(`只有创建者可以${action} ${getContentOwnershipLabel(contentType)}。`)
  }
}

function toCommitMessage(action: "create" | "update" | "delete" | "restore" | "purge", result: ContentWriteResult): string {
  return `[synapse] ${action} ${result.type} ${result.id.slice(0, 8)}`
}

function createMutationMessage(pushed: boolean, pendingPushCount: number): string {
  if (pushed) {
    return "已保存并同步。"
  }

  return pendingPushCount > 1 ? `已保存，等待同步 ${pendingPushCount} 条变更。` : "已保存，等待同步。"
}

function createDeferredMutationMessage(): string {
  return "已保存。"
}

function createRecoveryMutationMessage(): string {
  return "已保存到本地，等待同步状态恢复。"
}

function createLocalMutationMessage(): string {
  return "本地目录已更新。"
}

async function pushRepository(
  repository: SynapseRepositoryConfig,
  onProgress?: PushProgressListener,
): Promise<void> {
  onProgress?.("正在推送到仓库...")
  await runGitCommand({
    args: ["push"],
    cwd: repository.localPath,
    fallbackMessage: "推送到仓库失败。",
    onLine: (line) => {
      onProgress?.(line)
    },
    timeoutMessage: "同步变更超时，请检查网络后重试。",
    timeoutMs: GIT_REMOTE_OPERATION_TIMEOUT_MS,
  })
}

async function syncIndexAfterGitMutation(
  repository: SynapseRepositoryConfig,
  options: {
    successMessage: string
    warningMessage: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const startedAt = Date.now()

  try {
    await contentIndexService.syncIndex(repository)
    logger.info(options.successMessage, {
      durationMs: Date.now() - startedAt,
      repositoryUuid: repository.uuid,
      ...options.metadata,
    })
  } catch (error) {
    logger.warn(options.warningMessage, {
      ...options.metadata,
      error,
      repositoryUuid: repository.uuid,
    })
  }
}

class ContentSubmissionService {
  async createContent(request: SynapseCreateContentRequest): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository()
    const identity = await userIdentityService.requireReadyRepoProfile(repository.uuid)
    return this.runRepositoryGitExclusive(repository, "content.create", async (repositoryState) => {
      const writeResult = await contentWriteService.createContent(request, identity)
      return this.commitAndMaybePushInExclusive(repository, repositoryState, "create", writeResult, {
        deferPush: true,
      })
    })
  }

  async createRule(payload: SynapseCreateRulePayload): Promise<SynapseContentMutationResult> {
    return this.createContent({
      contentType: "rule",
      payload,
    })
  }

  async createSkill(payload: SynapseCreateSkillPayload): Promise<SynapseContentMutationResult> {
    return this.createContent({
      contentType: "skill",
      payload,
    })
  }

  async updateContent(request: SynapseUpdateContentRequest): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository()
    const identity = await userIdentityService.requireReadyRepoProfile(repository.uuid)
    return this.runRepositoryGitExclusive(repository, "content.update", (repositoryState) => (
      this.updateContentWithConflictCheck(
        repository,
        repositoryState,
        request.contentType,
        request.payload as SynapseUpdateRulePayload | SynapseUpdateSkillPayload,
        identity,
      )
    ))
  }

  async updateRule(payload: SynapseUpdateRulePayload): Promise<SynapseContentMutationResult> {
    return this.updateContent({
      contentType: "rule",
      payload,
    })
  }

  async updateSkill(payload: SynapseUpdateSkillPayload): Promise<SynapseContentMutationResult> {
    return this.updateContent({
      contentType: "skill",
      payload,
    })
  }

  async deleteContent(payload: SynapseDeleteContentPayload): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository()
    const identity = await userIdentityService.requireReadyRepoProfile(repository.uuid)
    return this.runRepositoryGitExclusive(repository, "content.delete", (repositoryState) => (
      this.deleteWithConflictCheck(repository, repositoryState, payload, identity)
    ))
  }

  async restoreContent(payload: SynapseRestoreContentPayload): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository()
    const identity = await userIdentityService.requireReadyRepoProfile(repository.uuid)
    return this.runRepositoryGitExclusive(repository, "content.restore", (repositoryState) => (
      this.restoreWithConflictCheck(repository, repositoryState, payload, identity)
    ))
  }

  async purgeContent(payload: SynapsePurgeContentPayload): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository()
    const identity = await userIdentityService.requireReadyRepoProfile(repository.uuid)
    return this.runRepositoryGitExclusive(repository, "content.purge", (repositoryState) => (
      this.purgeAndCommit(repository, repositoryState, payload, identity)
    ))
  }

  runRepositoryGitExclusive<T>(
    repository: SynapseRepositoryConfig,
    operation: string,
    task: (state: SynapseRepositoryLocalState) => Promise<T>,
  ): Promise<T> {
    return runRepositoryGitExclusive(repository, operation, task)
  }

  readUnpushedCommitCount(repository: SynapseRepositoryConfig): Promise<number> {
    return readUnpushedCommitCount(repository)
  }

  async readPendingPushState(repository: SynapseRepositoryConfig) {
    return pendingPushesService.readState(repository)
  }

  async flushPendingPushes(
    repository: SynapseRepositoryConfig,
    onProgress?: PushProgressListener,
    options?: { recordFailure?: boolean },
  ): Promise<void> {
    return this.runRepositoryGitExclusive(repository, "push", (repositoryState) => (
      this.flushPendingPushesInExclusive(repository, repositoryState, onProgress, options)
    ))
  }

  async flushPendingPushesInExclusive(
    repository: SynapseRepositoryConfig,
    repositoryState: SynapseRepositoryLocalState,
    onProgress?: PushProgressListener,
    options?: { recordFailure?: boolean },
  ): Promise<void> {
    if (!repositoryState.isGitRepository) return

    const pendingState = await pendingPushesService.readState(repository, { limit: null })
    const attemptedPendingPushIds = pendingState.items.map((item) => item.id)
    const unpushedCommitCount = await readUnpushedCommitCount(repository, repositoryState)

    if (pendingState.count === 0 && unpushedCommitCount === 0) return

    try {
      const tPush = Date.now()
      logger.info("flushPendingPushes: pushRepository starting.", { repositoryUuid: repository.uuid })
      await pushRepository(repository, onProgress)
      logger.info("flushPendingPushes: pushRepository done.", { durationMs: Date.now() - tPush, repositoryUuid: repository.uuid })
      await pendingPushesService.clear(repository, attemptedPendingPushIds)
      await syncIndexAfterGitMutation(repository, {
        successMessage: "flushPendingPushes: syncIndex done.",
        warningMessage: "flushPendingPushes: syncIndex failed after git mutation.",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "推送到仓库失败。"

      if (isNonFastForwardError(message)) {
        await pullRepositoryWithSafeRebase(repository, onProgress)
        const tRetryPush = Date.now()
        await pushRepository(repository, onProgress)
        logger.info("flushPendingPushes: retry pushRepository done.", { durationMs: Date.now() - tRetryPush, repositoryUuid: repository.uuid })
        await pendingPushesService.clear(repository, attemptedPendingPushIds)
        await syncIndexAfterGitMutation(repository, {
          successMessage: "flushPendingPushes: retry syncIndex done.",
          warningMessage: "flushPendingPushes: syncIndex failed after git mutation.",
        })
        return
      }

      if (options?.recordFailure !== false) {
        await pendingPushesService.markFailure(repository, message, attemptedPendingPushIds)
      }
      throw error
    }
  }

  private async updateContentWithConflictCheck(
    repositoryConfig: SynapseRepositoryConfig,
    repositoryState: SynapseRepositoryLocalState,
    contentType: SynapseContentType,
    payload: SynapseUpdateRulePayload | SynapseUpdateSkillPayload,
    identity: Awaited<ReturnType<typeof userIdentityService.requireReadyRepoProfile>>,
  ): Promise<SynapseContentMutationResult> {
    if (repositoryState.isGitRepository) {
      await pullRepositoryWithSafeRebase(repositoryConfig)
    }

    await contentIndexService.syncIndex(repositoryConfig)

    const latestDetail = await contentHistoryService.readCurrentDetail(
      repositoryConfig,
      contentType,
      payload.id,
    )

    if (!latestDetail) {
      throw new Error(`找不到对应的 ${getContentTypeDefinition(contentType).singularLabel} 内容。`)
    }

    assertContentUpdateAllowed(contentType, latestDetail.createdBy, identity.userId)

    if (!payload.force && latestDetail.latestHistoryDirname !== payload.baseHistoryDirname) {
      return {
        id: payload.id,
        type: contentType,
        status: "conflict",
        latestHistoryDirname: latestDetail.latestHistoryDirname,
        latestModifiedAt: latestDetail.modifiedAt,
        latestModifiedByDisplayName: latestDetail.modifiedByDisplayName,
      }
    }

    const writeResult = await contentWriteService.updateContent(
      {
        contentType,
        payload,
      } as SynapseUpdateContentRequest,
      identity,
    )

    return this.commitAndMaybePushInExclusive(repositoryConfig, repositoryState, "update", writeResult, {
      deferPush: true,
    })
  }

  private async deleteWithConflictCheck(
    repository: SynapseRepositoryConfig,
    repositoryState: SynapseRepositoryLocalState,
    payload: SynapseDeleteContentPayload,
    identity: Awaited<ReturnType<typeof userIdentityService.requireReadyRepoProfile>>,
  ): Promise<SynapseContentMutationResult> {
    if (repositoryState.isGitRepository) {
      await pullRepositoryWithSafeRebase(repository)
    }

    await contentIndexService.syncIndex(repository)

    const latestDetail = await contentHistoryService.readCurrentDetail(
      repository,
      payload.type,
      payload.id,
    )

    if (!latestDetail) {
      throw new Error(`找不到对应的 ${getContentTypeDefinition(payload.type).singularLabel} 内容。`)
    }

    assertContentLifecycleOwner(payload.type, latestDetail.createdBy, identity.userId, "删除")

    if (!payload.force && latestDetail.latestHistoryDirname !== payload.baseHistoryDirname) {
      return {
        id: payload.id,
        type: payload.type,
        status: "conflict",
        latestHistoryDirname: latestDetail.latestHistoryDirname,
        latestModifiedAt: latestDetail.modifiedAt,
        latestModifiedByDisplayName: latestDetail.modifiedByDisplayName,
      }
    }

    const writeResult = await contentWriteService.deleteContent(payload.type, payload.id, identity)

    return this.commitAndMaybePushInExclusive(repository, repositoryState, "delete", writeResult)
  }

  private async restoreWithConflictCheck(
    repository: SynapseRepositoryConfig,
    repositoryState: SynapseRepositoryLocalState,
    payload: SynapseRestoreContentPayload,
    identity: Awaited<ReturnType<typeof userIdentityService.requireReadyRepoProfile>>,
  ): Promise<SynapseContentMutationResult> {
    if (repositoryState.isGitRepository) {
      await pullRepositoryWithSafeRebase(repository)
    }

    await contentIndexService.syncIndex(repository)

    const latestDetail = await contentHistoryService.readCurrentDetail(
      repository,
      payload.type,
      payload.id,
    )

    if (!latestDetail) {
      throw new Error(`找不到对应的 ${getContentTypeDefinition(payload.type).singularLabel} 内容。`)
    }

    assertContentLifecycleOwner(payload.type, latestDetail.createdBy, identity.userId, "恢复")

    if (latestDetail.latestHistoryDirname !== payload.baseHistoryDirname) {
      return {
        id: payload.id,
        type: payload.type,
        status: "conflict",
        latestHistoryDirname: latestDetail.latestHistoryDirname,
        latestModifiedAt: latestDetail.modifiedAt,
        latestModifiedByDisplayName: latestDetail.modifiedByDisplayName,
      }
    }

    const writeResult = await contentWriteService.restoreContent(payload.type, payload.id, identity)

    return this.commitAndMaybePushInExclusive(repository, repositoryState, "restore", writeResult, {
      deferPush: true,
    })
  }

  private async purgeAndCommit(
    repository: SynapseRepositoryConfig,
    repositoryState: SynapseRepositoryLocalState,
    payload: SynapsePurgeContentPayload,
    identity: Awaited<ReturnType<typeof userIdentityService.requireReadyRepoProfile>>,
  ): Promise<SynapseContentMutationResult> {
    if (repositoryState.isGitRepository) {
      await pullRepositoryWithSafeRebase(repository)
    }

    await contentIndexService.syncIndex(repository)

    const latestDetail = await contentHistoryService.readCurrentDetail(
      repository,
      payload.type,
      payload.id,
    )

    if (!latestDetail) {
      throw new Error(`找不到对应的 ${getContentTypeDefinition(payload.type).singularLabel} 内容。`)
    }

    assertContentLifecycleOwner(payload.type, latestDetail.createdBy, identity.userId, "永久删除")

    if (latestDetail.latestHistoryDirname !== payload.baseHistoryDirname || !latestDetail.deleted) {
      return {
        id: payload.id,
        type: payload.type,
        status: "conflict",
        latestHistoryDirname: latestDetail.latestHistoryDirname,
        latestModifiedAt: latestDetail.modifiedAt,
        latestModifiedByDisplayName: latestDetail.modifiedByDisplayName,
      }
    }

    const writeResult = await contentWriteService.purgeContent(payload.type, payload.id, identity)

    return this.commitAndMaybePushInExclusive(repository, repositoryState, "purge", writeResult)
  }

  private async commitAndMaybePushInExclusive(
    repository: SynapseRepositoryConfig,
    repositoryState: SynapseRepositoryLocalState,
    action: "create" | "update" | "delete" | "restore" | "purge",
    writeResult: ContentWriteResult,
    options: {
      deferPush?: boolean
    } = {},
  ): Promise<SynapseContentMutationResult> {
    const transaction = writeResult.transaction
    if (!repositoryState.isGitRepository || !repositoryState.gitRootPath) {
      await contentIndexService.syncIndex(repository)
      await transaction.finalize()

      return {
        id: writeResult.id,
        type: writeResult.type,
        status: "saved",
        title: writeResult.title,
        latestHistoryDirname: writeResult.latestHistoryDirname,
        modifiedAt: writeResult.modifiedAt,
        pushed: false,
        pendingPushCount: 0,
        syncStatus: "local-only",
        message: createLocalMutationMessage(),
      }
    }

    const tCommit = Date.now()
    let commitHash: string
    try {
      await transaction.markCommitting()
      commitHash = await commitRepositoryPaths({
        fallbackMessage: "提交内容失败。",
        filePaths: writeResult.gitPaths,
        gitRootPath: repositoryState.gitRootPath,
        message: toCommitMessage(action, writeResult),
      })
    } catch (error) {
      if (error instanceof RepositoryCommitCreatedError) {
        try {
          await transaction.markCommitted(error.commitHash)
          await transaction.finalize()
        } catch (recoveryError) {
          throw new ContentRecoveryNeededError(undefined, { cause: recoveryError })
        }
        throw error
      }
      try {
        await transaction.rollback()
      } catch (rollbackError) {
        throw new ContentRecoveryNeededError(undefined, { cause: rollbackError })
      }
      throw error
    }
    try {
      await transaction.markCommitted(commitHash)
      await transaction.finalize()
    } catch (error) {
      throw new ContentRecoveryNeededError(
        "内容已经提交，但恢复事务尚未完成清理；Synapse 将在下次启动时继续处理。",
        { cause: error },
      )
    }
    logger.info("commitAndMaybePush: commitChanges done.", { durationMs: Date.now() - tCommit, commitHash, action, repositoryUuid: repository.uuid })

    await syncIndexAfterGitMutation(repository, {
      successMessage: "commitAndMaybePush: syncIndex done.",
      warningMessage: "commitAndMaybePush: syncIndex failed after git mutation.",
      metadata: { action },
    })

    if (options.deferPush) {
      try {
        const tEnqueue = Date.now()
        const pendingPushState = await pendingPushesService.enqueue(repository, {
          action,
          commitHash,
          targetId: writeResult.id,
          title: writeResult.title,
        })
        logger.info("commitAndMaybePush: enqueue done.", { durationMs: Date.now() - tEnqueue, pendingCount: pendingPushState.count, repositoryUuid: repository.uuid })

        return {
          id: writeResult.id,
          type: writeResult.type,
          status: "saved",
          title: writeResult.title,
          latestHistoryDirname: writeResult.latestHistoryDirname,
          modifiedAt: writeResult.modifiedAt,
          pushed: false,
          pendingPushCount: pendingPushState.count,
          syncStatus: "pending",
          message: createDeferredMutationMessage(),
        }
      } catch (error) {
        const unpushedCommitCount = await readUnpushedCommitCount(repository, repositoryState)
        logger.warn("Pending push registration failed after content commit.", {
          action,
          error,
          repositoryUuid: repository.uuid,
        })
        return {
          id: writeResult.id,
          type: writeResult.type,
          status: "saved",
          title: writeResult.title,
          latestHistoryDirname: writeResult.latestHistoryDirname,
          modifiedAt: writeResult.modifiedAt,
          pushed: false,
          pendingPushCount: Math.max(1, unpushedCommitCount),
          syncStatus: "recovery-needed",
          message: createRecoveryMutationMessage(),
        }
      }
    }

    // Optimistic enqueue: record pending push before attempting push so that
    // if the process is killed between commit and push completion, the record
    // survives and can be retried on next launch.
    let pendingRegistrationFailed = false
    let optimisticIds: number[] = []
    try {
      const optimisticState = await pendingPushesService.enqueue(repository, {
        action,
        commitHash,
        targetId: writeResult.id,
        title: writeResult.title,
      })
      optimisticIds = optimisticState.items
        .filter((item) => item.commitHash === commitHash && item.targetId === writeResult.id)
        .map((item) => item.id)
    } catch (error) {
      pendingRegistrationFailed = true
      logger.warn("Pending push registration failed before immediate push.", {
        action,
        error,
        repositoryUuid: repository.uuid,
      })
    }

    let pushed = true

    try {
      await pushRepository(repository)
      await pendingPushesService.clear(repository, optimisticIds)
    } catch (error) {
      const message = error instanceof Error ? error.message : "推送到仓库失败。"

      if (isNonFastForwardError(message)) {
        try {
          await pullRepositoryWithSafeRebase(repository)
          await pushRepository(repository)
          await pendingPushesService.clear(repository, optimisticIds)
        } catch (retryError) {
          pushed = false
          logger.warn("Deferred push after non-fast-forward retry failed.", {
            action,
            error: retryError,
            repositoryUuid: repository.uuid,
            writeResult,
          })
        }
      } else {
        pushed = false
        logger.warn("Deferred push after push failure.", {
          action,
          error,
          repositoryUuid: repository.uuid,
          writeResult,
        })
      }
    }

    await syncIndexAfterGitMutation(repository, {
      successMessage: "commitAndMaybePush: syncIndex done.",
      warningMessage: "commitAndMaybePush: syncIndex failed after git mutation.",
      metadata: { action },
    })

    const pendingPushState = await pendingPushesService.readState(repository).catch(() => ({ count: 0, items: [] }))
    const unpushedCommitCount = pushed ? 0 : await readUnpushedCommitCount(repository, repositoryState)

    if (pushed) {
      void repositoryMaintenanceService.maybeRunAfterPush(repository, {
        contentId: writeResult.id,
        contentType: writeResult.type,
      }).catch((error) => {
        logger.warn("Post-push maintenance failed.", {
          error,
          repositoryUuid: repository.uuid,
          writeResult,
        })
      })
    }

    return {
      id: writeResult.id,
      type: writeResult.type,
      status: "saved",
      title: writeResult.title,
      latestHistoryDirname: writeResult.latestHistoryDirname,
      modifiedAt: writeResult.modifiedAt,
      pushed,
      pendingPushCount: Math.max(pendingPushState.count, unpushedCommitCount),
      syncStatus: pushed ? "synced" : pendingRegistrationFailed ? "recovery-needed" : "pending",
      message: pushed
        ? createMutationMessage(true, 0)
        : pendingRegistrationFailed ? createRecoveryMutationMessage() : createMutationMessage(false, pendingPushState.count),
    }
  }

  private async resolveActiveRepository(): Promise<SynapseRepositoryConfig> {
    const config = await configStore.load()
    const repository = config.repositories.find((item) => item.uuid === config.activeRepoUuid) ?? null

    if (!repository) {
      throw new Error("当前还没有选中的本地目录。")
    }

    return repository
  }

}

const contentSubmissionService = new ContentSubmissionService()

export { contentSubmissionService }
