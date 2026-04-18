import { spawn } from "node:child_process"
import path from "node:path"
import type {
  SynapseContentMutationResult,
  SynapseContentType,
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
  SynapseDeleteContentPayload,
  SynapseUpdateRulePayload,
  SynapseUpdateSkillPayload,
} from "../../src/types/content"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { contentHistoryService } from "./content-history-service"
import { contentIndexService } from "./content-index-service"
import { contentWriteService, type ContentWriteResult } from "./content-write-service"
import { createMainLogger } from "./log-store"
import { pendingPushesService } from "./pending-pushes-service"
import { repositoryStore } from "./repository-store"
import { userIdentityService } from "./user-identity-service"

const SYNAPSE_BOT_NAME = "Synapse Bot"
const SYNAPSE_BOT_EMAIL = "bot@synapse.local"
const logger = createMainLogger("service.content-submit")

type GitCommandResult = {
  stderr: string
  stdout: string
}

type PushProgressListener = (statusText: string) => void

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/")
}

function toCommitMessage(action: "create" | "update" | "delete", result: ContentWriteResult): string {
  return `[synapse] ${action} ${result.type} ${result.id.slice(0, 8)}`
}

function formatGitSpawnError(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return "当前系统没有可用的 git 命令，请先安装 Git 并确保命令行可访问。"
  }

  return error instanceof Error ? error.message : "启动 Git 命令失败。"
}

function formatGitFailureMessage(output: string, fallbackMessage: string): string {
  const normalizedOutput = output.trim()
  const firstLine = normalizedOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  const loweredOutput = normalizedOutput.toLowerCase()

  if (
    loweredOutput.includes("authentication failed")
    || loweredOutput.includes("could not read username")
    || loweredOutput.includes("permission denied (publickey)")
    || loweredOutput.includes("permission denied")
    || loweredOutput.includes("fatal: could not read from remote repository")
  ) {
    return "无法连接仓库，请检查网络。"
  }

  if (
    loweredOutput.includes("repository not found")
    || loweredOutput.includes("not found")
    || loweredOutput.includes("no such remote")
  ) {
    return "当前仓库没有可用的远程配置，或当前账号没有访问权限。"
  }

  if (
    loweredOutput.includes("could not resolve host")
    || loweredOutput.includes("failed to connect")
    || loweredOutput.includes("connection timed out")
    || loweredOutput.includes("network is unreachable")
    || loweredOutput.includes("connection reset")
  ) {
    return "无法连接仓库，请检查网络。"
  }

  if (
    loweredOutput.includes("paths are ignored by one of your .gitignore files")
    || loweredOutput.includes("the following paths are ignored")
  ) {
    return "目标内容目录被 .gitignore 忽略了，请先调整仓库规则后再试。"
  }

  if (
    loweredOutput.includes("nothing to commit")
    || loweredOutput.includes("no changes added to commit")
  ) {
    return "当前没有可提交的改动。"
  }

  return firstLine ? `${fallbackMessage}\n${firstLine}` : fallbackMessage
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

function runGitCommand(
  cwd: string,
  args: string[],
  fallbackMessage: string,
  onOutput?: (line: string) => void,
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
    })

    let stdout = ""
    let stderr = ""

    const handleChunk = (chunk: Buffer) => {
      const text = chunk.toString("utf8")

      stdout += text
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .forEach((line) => onOutput?.(line))
    }

    childProcess.stdout.on("data", handleChunk)
    childProcess.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8")

      stderr += text
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .forEach((line) => onOutput?.(line))
    })

    childProcess.on("error", (error) => {
      reject(new Error(formatGitSpawnError(error)))
    })

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve({
          stderr,
          stdout,
        })
        return
      }

      reject(new Error(formatGitFailureMessage(`${stdout}\n${stderr}`, fallbackMessage)))
    })
  })
}

async function ensureBotIdentity(gitRootPath: string): Promise<void> {
  await runGitCommand(
    gitRootPath,
    ["config", "--local", "user.name", SYNAPSE_BOT_NAME],
    "无法初始化 Synapse 提交身份。",
  )
  await runGitCommand(
    gitRootPath,
    ["config", "--local", "user.email", SYNAPSE_BOT_EMAIL],
    "无法初始化 Synapse 提交身份。",
  )
}

async function pullWithRebase(
  repository: SynapseRepositoryConfig,
  onProgress?: PushProgressListener,
): Promise<void> {
  onProgress?.("正在拉取最新内容...")
  await runGitCommand(
    repository.localPath,
    ["pull", "--rebase"],
    "同步仓库失败，请检查网络或仓库状态后重试。",
    (line) => {
      onProgress?.(line)
    },
  )
}

async function stagePaths(gitRootPath: string, filePaths: string[]): Promise<void> {
  const relativePaths = filePaths
    .map((filePath) => path.relative(gitRootPath, filePath))
    .filter((relativePath) => relativePath && !relativePath.startsWith(".."))
    .map(toGitPath)

  if (relativePaths.length === 0) {
    throw new Error("当前没有可提交的改动。")
  }

  await runGitCommand(
    gitRootPath,
    ["add", "--", ...relativePaths],
    "暂存本地改动失败。",
  )
}

async function commitChanges(
  gitRootPath: string,
  action: "create" | "update" | "delete",
  result: ContentWriteResult,
): Promise<string> {
  await runGitCommand(
    gitRootPath,
    ["commit", "-m", toCommitMessage(action, result)],
    "提交内容失败。",
  )

  const headCommit = await runGitCommand(
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
  await runGitCommand(
    repository.localPath,
    ["push"],
    "推送到仓库失败。",
    (line) => {
      onProgress?.(line)
    },
  )
}

async function readRepositoryState(repository: SynapseRepositoryConfig) {
  const repositoryState = await repositoryStore.getRepositoryState(repository)

  if (repositoryState.status !== "ready") {
    throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
  }

  if (!repositoryState.isGitRepository || !repositoryState.gitRootPath) {
    throw new Error("当前目录不是 Git 仓库，无法提交内容。")
  }

  return repositoryState
}

class ContentSubmissionService {
  async createRule(payload: SynapseCreateRulePayload): Promise<SynapseContentMutationResult> {
    const identity = await userIdentityService.requireReadyIdentity()
    const writeResult = await contentWriteService.createRule(payload, identity)

    return this.commitAndMaybePush("create", writeResult)
  }

  async createSkill(payload: SynapseCreateSkillPayload): Promise<SynapseContentMutationResult> {
    const identity = await userIdentityService.requireReadyIdentity()
    const writeResult = await contentWriteService.createSkill(payload, identity)

    return this.commitAndMaybePush("create", writeResult)
  }

  async updateRule(payload: SynapseUpdateRulePayload): Promise<SynapseContentMutationResult> {
    const identity = await userIdentityService.requireReadyIdentity()

    return this.updateContent("rule", payload, identity)
  }

  async updateSkill(payload: SynapseUpdateSkillPayload): Promise<SynapseContentMutationResult> {
    const identity = await userIdentityService.requireReadyIdentity()

    return this.updateContent("skill", payload, identity)
  }

  async deleteContent(payload: SynapseDeleteContentPayload): Promise<SynapseContentMutationResult> {
    const identity = await userIdentityService.requireReadyIdentity()
    const repositoryState = await readRepositoryState(
      (await contentWriteService.readLatestHistoryDirname(payload.type, payload.id, identity), await (async () => {
        const configState = await userIdentityService.requireReadyIdentity()
        void configState
        return null
      })()),
    )
    void repositoryState
    return this.deleteWithConflictCheck(payload, identity)
  }

  async readPendingPushState(repository: SynapseRepositoryConfig) {
    return pendingPushesService.readState(repository)
  }

  async flushPendingPushes(
    repository: SynapseRepositoryConfig,
    onProgress?: PushProgressListener,
  ): Promise<void> {
    const pendingState = await pendingPushesService.readState(repository)

    if (pendingState.count === 0) {
      return
    }

    try {
      await pushRepository(repository, onProgress)
      await pendingPushesService.clear(repository)
      await contentIndexService.syncIndex(repository)
    } catch (error) {
      const message = error instanceof Error ? error.message : "推送到仓库失败。"

      if (isNonFastForwardError(message)) {
        await pullWithRebase(repository, onProgress)
        await pushRepository(repository, onProgress)
        await pendingPushesService.clear(repository)
        await contentIndexService.syncIndex(repository)
        return
      }

      await pendingPushesService.markFailure(repository, message)
      throw error
    }
  }

  private async updateContent(
    contentType: SynapseContentType,
    payload: SynapseUpdateRulePayload | SynapseUpdateSkillPayload,
    identity: Awaited<ReturnType<typeof userIdentityService.requireReadyIdentity>>,
  ): Promise<SynapseContentMutationResult> {
    const repositoryContext = await contentWriteService.readLatestHistoryDirname(contentType, payload.id, identity)
    void repositoryContext

    const repositoryConfig = await this.resolveActiveRepositoryFromIdentity(identity)

    await pullWithRebase(repositoryConfig)
    await contentIndexService.syncIndex(repositoryConfig)

    const latestDetail = await contentHistoryService.readCurrentDetail(
      repositoryConfig,
      contentType,
      payload.id,
    )

    if (!latestDetail) {
      throw new Error(contentType === "rule" ? "找不到对应的 Rule 内容。" : "找不到对应的 Skill 内容。")
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

    const writeResult =
      contentType === "rule"
        ? await contentWriteService.updateRule(payload as SynapseUpdateRulePayload, identity)
        : await contentWriteService.updateSkill(payload as SynapseUpdateSkillPayload, identity)

    return this.commitAndMaybePush("update", writeResult)
  }

  private async deleteWithConflictCheck(
    payload: SynapseDeleteContentPayload,
    identity: Awaited<ReturnType<typeof userIdentityService.requireReadyIdentity>>,
  ): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepositoryFromIdentity(identity)

    await pullWithRebase(repository)
    await contentIndexService.syncIndex(repository)

    const latestDetail = await contentHistoryService.readCurrentDetail(
      repository,
      payload.type,
      payload.id,
    )

    if (!latestDetail) {
      throw new Error(payload.type === "rule" ? "找不到对应的 Rule 内容。" : "找不到对应的 Skill 内容。")
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

  private async commitAndMaybePush(
    action: "create" | "update" | "delete",
    writeResult: ContentWriteResult,
  ): Promise<SynapseContentMutationResult> {
    const repository = await this.resolveActiveRepository(writeResult)
    const repositoryState = await readRepositoryState(repository)

    await ensureBotIdentity(repositoryState.gitRootPath ?? repository.localPath)
    await stagePaths(repositoryState.gitRootPath ?? repository.localPath, writeResult.gitPaths)
    const commitHash = await commitChanges(
      repositoryState.gitRootPath ?? repository.localPath,
      action,
      writeResult,
    )
    await contentIndexService.syncIndex(repository)

    let pushed = true

    try {
      await pushRepository(repository)
    } catch (error) {
      const message = error instanceof Error ? error.message : "推送到仓库失败。"

      if (isNonFastForwardError(message)) {
        try {
          await pullWithRebase(repository)
          await pushRepository(repository)
        } catch (retryError) {
          pushed = false
          await pendingPushesService.enqueue(repository, {
            action,
            commitHash,
            targetId: writeResult.id,
            title: writeResult.title,
          })
          logger.warn("Deferred push after non-fast-forward retry failed.", {
            action,
            error: retryError,
            repositoryUuid: repository.uuid,
            writeResult,
          })
        }
      } else {
        pushed = false
        await pendingPushesService.enqueue(repository, {
          action,
          commitHash,
          targetId: writeResult.id,
          title: writeResult.title,
        })
        logger.warn("Deferred push after push failure.", {
          action,
          error,
          repositoryUuid: repository.uuid,
          writeResult,
        })
      }
    }

    const pendingPushState = await pendingPushesService.readState(repository)

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

  private async resolveActiveRepository(writeResult: ContentWriteResult): Promise<SynapseRepositoryConfig> {
    const identity = await userIdentityService.requireReadyIdentity()

    return this.resolveActiveRepositoryFromIdentity(identity, writeResult.type)
  }

  private async resolveActiveRepositoryFromIdentity(
    _identity: Awaited<ReturnType<typeof userIdentityService.requireReadyIdentity>>,
    _contentType?: SynapseContentType,
  ): Promise<SynapseRepositoryConfig> {
    const repositoryState = await contentWriteService.readLatestHistoryDirname("rule", "", _identity).catch(() => null)
    void repositoryState
    const configStoreModule = await import("./config-store")
    const config = await configStoreModule.configStore.load()
    const repository = config.repositories.find((item) => item.uuid === config.activeRepoUuid) ?? null

    if (!repository) {
      throw new Error("当前还没有激活的本地目录。")
    }

    return repository
  }
}

const contentSubmissionService = new ContentSubmissionService()

export { contentSubmissionService }
