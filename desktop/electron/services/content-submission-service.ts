import path from "node:path"
import { getContentTypeDefinition } from "../../src/config/content-types"
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
import { contentHistoryService } from "./content-history-service"
import { contentIndexService } from "./content-index-service"
import { contentWriteService, type ContentWriteResult } from "./content-write-service"
import { configStore } from "./config-store"
import { isGitRebaseInProgress, runGitCommand, type GitCommandResult } from "./git-command"
import { assertNoPreexistingGitRebase } from "./git-rebase-guard"
import { createMainLogger } from "./log-store"
import { formatGitFailureMessage, isNonFastForwardError } from "./git-error-utils"
import { toRepositoryGitPaths } from "./git-paths"
import { repositoryLockManager } from "./repository-lock-manager"
import { pendingPushesService } from "./pending-pushes-service"
import { repositoryMaintenanceService } from "./repository-maintenance-service"
import { repositoryStore } from "./repository-store"
import { userIdentityService } from "./user-identity-service"

const SYNAPSE_BOT_NAME = "Synapse Bot"
const SYNAPSE_BOT_EMAIL = "bot@synapse.local"
const logger = createMainLogger("service.content-submit")
const GIT_REMOTE_OPERATION_TIMEOUT_MS = 60_000

type PushProgressListener = (statusText: string) => void

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

function createLocalMutationMessage(): string {
  return "本地目录已更新。"
}

function runRepositoryGitCommand(
  cwd: string,
  args: string[],
  fallbackMessage: string,
  onOutput?: (line: string) => void,
  options: {
    timeoutMessage?: string
    timeoutMs?: number
  } = {},
): Promise<GitCommandResult> {
  return runGitCommand({
    args,
    cwd,
    fallbackMessage,
    formatFailureMessage: formatGitFailureMessage,
    onLine: (line) => {
      onOutput?.(line)
    },
    timeoutMessage: options.timeoutMessage,
    timeoutMs: options.timeoutMs,
  })
}

async function ensureBotIdentity(gitRootPath: string): Promise<void> {
  await runRepositoryGitCommand(
    gitRootPath,
    ["config", "--local", "user.name", SYNAPSE_BOT_NAME],
    "无法初始化 Synapse 提交身份。",
  )
  await runRepositoryGitCommand(
    gitRootPath,
    ["config", "--local", "user.email", SYNAPSE_BOT_EMAIL],
    "无法初始化 Synapse 提交身份。",
  )
}

async function abortRebaseIfNeeded(localPath: string): Promise<void> {
  if (!(await isGitRebaseInProgress(localPath))) {
    return
  }

  logger.warn("Rebase in progress detected. Aborting rebase to recover repository state.", { localPath })
  await runRepositoryGitCommand(
    localPath,
    ["rebase", "--abort"],
    "无法中止 rebase，请手动检查仓库状态。",
  )
}

async function pullWithRebase(
  repository: SynapseRepositoryConfig,
  onProgress?: PushProgressListener,
): Promise<void> {
  onProgress?.("正在拉取最新内容...")
  await assertNoPreexistingGitRebase(repository.localPath, (localPath) => {
    logger.warn("Pull with rebase skipped because repository already has a rebase in progress.", { localPath })
  })

  try {
    await runGitCommand({
      args: ["pull", "--rebase", "-X", "theirs"],
      cwd: repository.localPath,
      fallbackMessage: "同步仓库失败，请检查网络或仓库状态后重试。",
      onLine: (line) => {
        onProgress?.(line)
      },
      timeoutMessage: "同步仓库超时，请检查网络后重试。",
      timeoutMs: GIT_REMOTE_OPERATION_TIMEOUT_MS,
    })
  } catch (error) {
    await abortRebaseIfNeeded(repository.localPath)
    throw error
  }
}

async function stagePaths(gitRootPath: string, filePaths: string[]): Promise<void> {
  const relativePaths = toRepositoryGitPaths(gitRootPath, filePaths, { unique: true })

  if (relativePaths.length === 0) {
    throw new Error("当前没有可提交的改动。")
  }

  await runRepositoryGitCommand(
    gitRootPath,
    ["add", "--", ...relativePaths],
    "暂存本地改动失败。",
  )
}

async function commitChanges(
  gitRootPath: string,
  action: "create" | "update" | "delete" | "restore" | "purge",
  result: ContentWriteResult,
): Promise<string> {
  await runRepositoryGitCommand(
    gitRootPath,
    ["commit", "-m", toCommitMessage(action, result)],
    "提交内容失败。",
  )

  const headCommit = await runRepositoryGitCommand(
    gitRootPath,
    ["rev-parse", "HEAD"],
    "读取最新提交失败。",
  )

  return headCommit.stdout.trim()
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

async function readReadyRepositoryState(repository: SynapseRepositoryConfig) {
  const repositoryState = await repositoryStore.getRepositoryState(repository)

  if (repositoryState.status !== "ready") {
    throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
  }

  return repositoryState
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
    const writeResult = await contentWriteService.createContent(request, identity)

    return this.commitAndMaybePush("create", writeResult, {
      deferPush: true,
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

    return this.updateContentWithConflictCheck(
      request.contentType,
      request.payload as SynapseUpdateRulePayload | SynapseUpdateSkillPayload,
      identity,
    )
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
    return this.deleteWithConflictCheck(payload, identity)
  }

  async restoreContent(payload: SynapseRestoreContentPayload): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository()
    const identity = await userIdentityService.requireReadyRepoProfile(repository.uuid)
    return this.restoreWithConflictCheck(payload, identity)
  }

  async purgeContent(payload: SynapsePurgeContentPayload): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository()
    const identity = await userIdentityService.requireReadyRepoProfile(repository.uuid)
    return this.purgeAndCommit(payload, identity)
  }

  async readPendingPushState(repository: SynapseRepositoryConfig) {
    return pendingPushesService.readState(repository)
  }

  async flushPendingPushes(
    repository: SynapseRepositoryConfig,
    onProgress?: PushProgressListener,
    options?: { skipLock?: boolean; recordFailure?: boolean },
  ): Promise<void> {
    const repositoryState = await repositoryStore.getRepositoryState(repository)

    if (repositoryState.status !== "ready") {
      throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
    }

    if (!repositoryState.isGitRepository) {
      return
    }

    const pendingState = await pendingPushesService.readState(repository, { limit: null })
    const attemptedPendingPushIds = pendingState.items.map((item) => item.id)

    if (pendingState.count === 0) {
      return
    }

    const release = options?.skipLock
      ? () => {}
      : await repositoryLockManager.acquire(repository.uuid, "push")
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
        await pullWithRebase(repository, onProgress)
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
    } finally {
      release()
    }
  }

  private async updateContentWithConflictCheck(
    contentType: SynapseContentType,
    payload: SynapseUpdateRulePayload | SynapseUpdateSkillPayload,
    identity: Awaited<ReturnType<typeof userIdentityService.requireReadyRepoProfile>>,
  ): Promise<SynapseContentMutationResult> {
    const repositoryConfig = await this.resolveActiveRepository()
    const repositoryState = await readReadyRepositoryState(repositoryConfig)

    if (repositoryState.isGitRepository) {
      await pullWithRebase(repositoryConfig)
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

    return this.commitAndMaybePush("update", writeResult, {
      deferPush: true,
    })
  }

  private async deleteWithConflictCheck(
    payload: SynapseDeleteContentPayload,
    identity: Awaited<ReturnType<typeof userIdentityService.requireReadyRepoProfile>>,
  ): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository()
    const repositoryState = await readReadyRepositoryState(repository)

    if (repositoryState.isGitRepository) {
      await pullWithRebase(repository)
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

    return this.commitAndMaybePush("delete", writeResult)
  }

  private async restoreWithConflictCheck(
    payload: SynapseRestoreContentPayload,
    identity: Awaited<ReturnType<typeof userIdentityService.requireReadyRepoProfile>>,
  ): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository()
    const repositoryState = await readReadyRepositoryState(repository)

    if (repositoryState.isGitRepository) {
      await pullWithRebase(repository)
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

    return this.commitAndMaybePush("restore", writeResult, {
      deferPush: true,
    })
  }

  private async purgeAndCommit(
    payload: SynapsePurgeContentPayload,
    identity: Awaited<ReturnType<typeof userIdentityService.requireReadyRepoProfile>>,
  ): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository()
    const repositoryState = await readReadyRepositoryState(repository)

    if (repositoryState.isGitRepository) {
      await pullWithRebase(repository)
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

    return this.commitAndMaybePush("purge", writeResult)
  }

  private async commitAndMaybePush(
    action: "create" | "update" | "delete" | "restore" | "purge",
    writeResult: ContentWriteResult,
    options: {
      deferPush?: boolean
    } = {},
  ): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository()
    const repositoryState = await readReadyRepositoryState(repository)

    if (!repositoryState.isGitRepository || !repositoryState.gitRootPath) {
      await contentIndexService.syncIndex(repository)

      return {
        id: writeResult.id,
        type: writeResult.type,
        status: "saved",
        title: writeResult.title,
        latestHistoryDirname: writeResult.latestHistoryDirname,
        modifiedAt: writeResult.modifiedAt,
        pushed: false,
        pendingPushCount: 0,
        message: createLocalMutationMessage(),
      }
    }

    const tBotId = Date.now()
    await ensureBotIdentity(repositoryState.gitRootPath ?? repository.localPath)
    logger.info("commitAndMaybePush: ensureBotIdentity done.", { durationMs: Date.now() - tBotId, action, repositoryUuid: repository.uuid })

    const tStage = Date.now()
    await stagePaths(repositoryState.gitRootPath ?? repository.localPath, writeResult.gitPaths)
    logger.info("commitAndMaybePush: stagePaths done.", { durationMs: Date.now() - tStage, action, repositoryUuid: repository.uuid })

    const tCommit = Date.now()
    const commitHash = await commitChanges(
      repositoryState.gitRootPath ?? repository.localPath,
      action,
      writeResult,
    )
    logger.info("commitAndMaybePush: commitChanges done.", { durationMs: Date.now() - tCommit, commitHash, action, repositoryUuid: repository.uuid })

    await syncIndexAfterGitMutation(repository, {
      successMessage: "commitAndMaybePush: syncIndex done.",
      warningMessage: "commitAndMaybePush: syncIndex failed after git mutation.",
      metadata: { action },
    })

    if (options.deferPush) {
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
        message: createDeferredMutationMessage(),
      }
    }

    // Optimistic enqueue: record pending push before attempting push so that
    // if the process is killed between commit and push completion, the record
    // survives and can be retried on next launch.
    const optimisticState = await pendingPushesService.enqueue(repository, {
      action,
      commitHash,
      targetId: writeResult.id,
      title: writeResult.title,
    })
    const optimisticIds = optimisticState.items
      .filter((item) => item.commitHash === commitHash && item.targetId === writeResult.id)
      .map((item) => item.id)

    let pushed = true

    try {
      await pushRepository(repository)
      await pendingPushesService.clear(repository, optimisticIds)
    } catch (error) {
      const message = error instanceof Error ? error.message : "推送到仓库失败。"

      if (isNonFastForwardError(message)) {
        try {
          await pullWithRebase(repository)
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

    const pendingPushState = await pendingPushesService.readState(repository)

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
      pendingPushCount: pendingPushState.count,
      message: createMutationMessage(pushed, pendingPushState.count),
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
