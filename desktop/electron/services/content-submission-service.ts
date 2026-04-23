import { access } from "node:fs/promises"
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
import { runGitCommand, type GitCommandResult } from "./git-command"
import { createMainLogger } from "./log-store"
import { formatGitFailureMessage } from "./git-error-utils"
import { pendingPushesService } from "./pending-pushes-service"
import { repositoryMaintenanceService } from "./repository-maintenance-service"
import { repositoryStore } from "./repository-store"
import { userIdentityService } from "./user-identity-service"

const SYNAPSE_BOT_NAME = "Synapse Bot"
const SYNAPSE_BOT_EMAIL = "bot@synapse.local"
const logger = createMainLogger("service.content-submit")

type PushProgressListener = (statusText: string) => void

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/")
}

function toCommitMessage(action: "create" | "update" | "delete" | "restore" | "purge", result: ContentWriteResult): string {
  return `[synapse] ${action} ${result.type} ${result.id.slice(0, 8)}`
}

function isNonFastForwardError(errorMessage: string): boolean {
  const loweredMessage = errorMessage.toLowerCase()

  return (
    loweredMessage.includes("non-fast-forward")
    || loweredMessage.includes("[rejected]")
    || loweredMessage.includes("fetch first")
  )
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
): Promise<GitCommandResult> {
  return runGitCommand({
    args,
    cwd,
    fallbackMessage,
    formatFailureMessage: formatGitFailureMessage,
    onLine: (line) => {
      onOutput?.(line)
    },
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

async function isRebaseInProgress(localPath: string): Promise<boolean> {
  const gitDir = path.join(localPath, ".git")

  try {
    await access(path.join(gitDir, "rebase-merge"))
    return true
  } catch {
    // not in rebase-merge
  }

  try {
    await access(path.join(gitDir, "rebase-apply"))
    return true
  } catch {
    return false
  }
}

async function abortRebaseIfNeeded(localPath: string): Promise<void> {
  if (!(await isRebaseInProgress(localPath))) {
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

  try {
    await runRepositoryGitCommand(
      repository.localPath,
      ["pull", "--rebase"],
      "同步仓库失败，请检查网络或仓库状态后重试。",
      (line) => {
        onProgress?.(line)
      },
    )
  } catch (error) {
    await abortRebaseIfNeeded(repository.localPath)
    throw error
  }
}

async function stagePaths(gitRootPath: string, filePaths: string[]): Promise<void> {
  const relativePaths = filePaths
    .map((filePath) => path.relative(gitRootPath, filePath))
    .filter((relativePath) => relativePath && !relativePath.startsWith(".."))
    .map(toGitPath)

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
  await runRepositoryGitCommand(
    repository.localPath,
    ["push"],
    "推送到仓库失败。",
    (line) => {
      onProgress?.(line)
    },
  )
}

async function readReadyRepositoryState(repository: SynapseRepositoryConfig) {
  const repositoryState = await repositoryStore.getRepositoryState(repository)

  if (repositoryState.status !== "ready") {
    throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
  }

  return repositoryState
}

class ContentSubmissionService {
  private pendingPushChains = new Map<string, Promise<void>>()

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
  ): Promise<void> {
    return this.runPushExclusive(repository.uuid, async () => {
      const repositoryState = await repositoryStore.getRepositoryState(repository)

      if (repositoryState.status !== "ready") {
        throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
      }

      if (!repositoryState.isGitRepository) {
        return
      }

      const pendingState = await pendingPushesService.readState(repository)
      const attemptedPendingPushIds = pendingState.items.map((item) => item.id)

      if (pendingState.count === 0) {
        return
      }

      try {
        await pushRepository(repository, onProgress)
        await pendingPushesService.clear(repository, attemptedPendingPushIds)
        await contentIndexService.syncIndex(repository)
      } catch (error) {
        const message = error instanceof Error ? error.message : "推送到仓库失败。"

        if (isNonFastForwardError(message)) {
          await pullWithRebase(repository, onProgress)
          await pushRepository(repository, onProgress)
          await pendingPushesService.clear(repository, attemptedPendingPushIds)
          await contentIndexService.syncIndex(repository)
          return
        }

        await pendingPushesService.markFailure(repository, message, attemptedPendingPushIds)
        throw error
      }
    })
  }

  private async updateContentWithConflictCheck(
    contentType: SynapseContentType,
    payload: SynapseUpdateRulePayload | SynapseUpdateSkillPayload,
    identity: Awaited<ReturnType<typeof userIdentityService.requireReadyRepoProfile>>,
  ): Promise<SynapseContentMutationResult> {
    const repositoryConfig = await this.resolveActiveRepository()

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

    await ensureBotIdentity(repositoryState.gitRootPath ?? repository.localPath)
    await stagePaths(repositoryState.gitRootPath ?? repository.localPath, writeResult.gitPaths)
    const commitHash = await commitChanges(
      repositoryState.gitRootPath ?? repository.localPath,
      action,
      writeResult,
    )
    await contentIndexService.syncIndex(repository)

    if (options.deferPush) {
      const pendingPushState = await pendingPushesService.enqueue(repository, {
        action,
        commitHash,
        targetId: writeResult.id,
        title: writeResult.title,
      })

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

    await contentIndexService.syncIndex(repository)

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
      throw new Error("当前还没有激活的本地目录。")
    }

    return repository
  }

  private async runPushExclusive<T>(
    repositoryUuid: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    const previousChain = this.pendingPushChains.get(repositoryUuid) ?? Promise.resolve()
    let releaseCurrentChain!: () => void

    const currentChain = new Promise<void>((resolve) => {
      releaseCurrentChain = resolve
    })
    const nextChain = previousChain
      .catch(() => undefined)
      .then(() => currentChain)

    this.pendingPushChains.set(repositoryUuid, nextChain)

    await previousChain.catch(() => undefined)

    try {
      return await callback()
    } finally {
      releaseCurrentChain()

      if (this.pendingPushChains.get(repositoryUuid) === nextChain) {
        this.pendingPushChains.delete(repositoryUuid)
      }
    }
  }
}

const contentSubmissionService = new ContentSubmissionService()

export { contentSubmissionService }
