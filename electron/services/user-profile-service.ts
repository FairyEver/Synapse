import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseRepoProfileState,
  SynapseUserProfile,
} from "../../src/types/identity"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { configStore } from "./config-store"
import { createMainLogger } from "./log-store"
import { pendingPushesService } from "./pending-pushes-service"
import { repositoryStore } from "./repository-store"
import {
  parseUserProfile,
  resolveUserProfilePath,
  userProfileCache,
} from "./user-profile-cache"

const USER_PROFILE_SCHEMA_VERSION = 1 as const
const SYNAPSE_BOT_NAME = "Synapse Bot"
const SYNAPSE_BOT_EMAIL = "bot@synapse.local"
const logger = createMainLogger("service.user-profile")

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function createUserProfile(userId: string, displayName: string): SynapseUserProfile {
  return {
    schemaVersion: USER_PROFILE_SCHEMA_VERSION,
    userId,
    displayName: displayName.trim(),
    updatedAt: new Date().toISOString(),
  }
}

function formatGitSpawnError(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return "当前系统没有可用的 git 命令，请先安装 Git 并确保命令行可访问。"
  }

  return error instanceof Error ? error.message : "启动 Git 命令失败。"
}

function formatGitFailureMessage(output: string, fallbackMessage: string): string {
  const normalizedOutput = output.trim().toLowerCase()

  if (
    normalizedOutput.includes("authentication failed")
    || normalizedOutput.includes("could not read username")
    || normalizedOutput.includes("permission denied")
    || normalizedOutput.includes("could not read from remote repository")
    || normalizedOutput.includes("could not resolve host")
    || normalizedOutput.includes("failed to connect")
    || normalizedOutput.includes("network is unreachable")
  ) {
    return "无法同步仓库，请检查网络后重试。"
  }

  return fallbackMessage
}

function runGitCommand(
  cwd: string,
  args: string[],
  fallbackMessage: string,
): Promise<string> {
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

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    childProcess.on("error", (error) => {
      reject(new Error(formatGitSpawnError(error)))
    })

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim())
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

async function pullWithRebase(repository: SynapseRepositoryConfig): Promise<void> {
  await runGitCommand(
    repository.localPath,
    ["pull", "--rebase"],
    "同步仓库失败，请检查网络或仓库状态后重试。",
  )
}

async function stageProfilePath(
  gitRootPath: string,
  repository: SynapseRepositoryConfig,
  userId: string,
): Promise<void> {
  const relativePath = path.relative(
    gitRootPath,
    resolveUserProfilePath(repository.localPath, userId),
  )
  const normalizedRelativePath = relativePath.split(path.sep).join("/")

  await runGitCommand(
    gitRootPath,
    ["add", "--", normalizedRelativePath],
    "暂存用户资料失败。",
  )
}

async function commitProfileChange(
  gitRootPath: string,
  userId: string,
  action: "join" | "rename",
): Promise<string> {
  await runGitCommand(
    gitRootPath,
    ["commit", "-m", `[synapse] user ${userId.slice(0, 8)} ${action}`],
    "提交用户资料失败。",
  )

  return runGitCommand(gitRootPath, ["rev-parse", "HEAD"], "读取最新提交失败。")
}

async function pushRepository(repository: SynapseRepositoryConfig): Promise<void> {
  await runGitCommand(
    repository.localPath,
    ["push"],
    "推送到仓库失败。",
  )
}

async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })

  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  )

  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  await rename(temporaryPath, filePath)
}

async function readProfileFile(
  repository: SynapseRepositoryConfig,
  userId: string,
): Promise<SynapseUserProfile | null> {
  const profilePath = resolveUserProfilePath(repository.localPath, userId)

  try {
    const rawProfile = JSON.parse(await readFile(profilePath, "utf8")) as unknown

    return parseUserProfile(rawProfile, userId)
  } catch (error) {
    if (isFileNotFoundError(error) || error instanceof SyntaxError) {
      return null
    }

    throw error
  }
}

async function resolveRepository(repoId: string): Promise<SynapseRepositoryConfig> {
  const config = await configStore.load()
  const repository = config.repositories.find((item) => item.uuid === repoId)

  if (!repository) {
    throw new Error("找不到对应的仓库配置。")
  }

  return repository
}

class UserProfileService {
  async loadRepoProfileState(
    repoId: string,
    userId: string,
  ): Promise<SynapseRepoProfileState> {
    const profiles = await userProfileCache.get(repoId)
    const profile = profiles.get(userId)

    if (!profile || profile.displayName.trim().length === 0) {
      return {
        status: "needs-onboarding",
        repoId,
        userId,
      }
    }

    return {
      status: "ready",
      profile,
    }
  }

  async listRepoProfiles(repoId: string): Promise<ReadonlyMap<string, SynapseUserProfile>> {
    return userProfileCache.get(repoId)
  }

  async refreshRepoProfiles(repoId: string): Promise<ReadonlyMap<string, SynapseUserProfile>> {
    return userProfileCache.rebuild(repoId)
  }

  clearRepoProfiles(repoId: string): void {
    userProfileCache.clear(repoId)
  }

  async updateDisplayName(
    repoId: string,
    userId: string,
    displayName: string,
  ): Promise<SynapseUserProfile> {
    const nextDisplayName = displayName.trim()

    if (!nextDisplayName) {
      throw new Error("显示名称不能为空。")
    }

    const repository = await resolveRepository(repoId)
    const repositoryState = await repositoryStore.getRepositoryState(repository)

    if (repositoryState.status !== "ready") {
      throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
    }

    const existingProfile = await readProfileFile(repository, userId)

    if (repositoryState.isGitRepository) {
      if (existingProfile) {
        await pullWithRebase(repository)
      }

      await ensureBotIdentity(repositoryState.gitRootPath ?? repository.localPath)
    }

    const profile = createUserProfile(userId, nextDisplayName)
    const profilePath = resolveUserProfilePath(repository.localPath, userId)

    await writeJsonFileAtomically(profilePath, profile)

    if (repositoryState.isGitRepository) {
      const gitRootPath = repositoryState.gitRootPath ?? repository.localPath
      const action = existingProfile ? "rename" : "join"

      await stageProfilePath(gitRootPath, repository, userId)
      const commitHash = await commitProfileChange(gitRootPath, userId, action)

      try {
        await pushRepository(repository)
      } catch (error) {
        const pendingState = await pendingPushesService.enqueue(repository, {
          action: "profile",
          commitHash,
          targetId: userId,
          title: profile.displayName,
        })

        logger.warn("Profile change saved locally and queued for push.", {
          pendingPushCount: pendingState.count,
          repoId,
          userId,
        })
      }
    }

    await userProfileCache.rebuild(repoId)
    return profile
  }
}

const userProfileService = new UserProfileService()

export {
  userProfileService,
}
