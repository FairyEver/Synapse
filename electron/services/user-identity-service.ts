import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { app } from "electron"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseLocalIdentity,
  SynapseLocalIdentityState,
} from "../../src/types/identity"
import { configStore } from "./config-store"
import { createMainLogger } from "./log-store"
import { userProfileService } from "./user-profile-service"
import {
  parseUserProfile,
  resolveUserProfilePath,
} from "./user-profile-cache"
import { repositoryStore } from "./repository-store"

const USER_IDENTITY_FILE_NAME = "user-identity.json"
const USER_IDENTITY_SCHEMA_VERSION = 2 as const
const logger = createMainLogger("service.user-identity")

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function generateUserId(): string {
  return randomUUID().replace(/-/g, "")
}

function normalizeUserId(input: string): string | null {
  const cleaned = input.trim().toLowerCase().replace(/-/g, "")

  if (!/^[0-9a-f]{32}$/.test(cleaned)) {
    return null
  }

  return cleaned
}

function createIdentity(): SynapseLocalIdentity {
  return {
    schemaVersion: USER_IDENTITY_SCHEMA_VERSION,
    userId: generateUserId(),
    generatedAt: new Date().toISOString(),
  }
}

function normalizeIdentity(rawValue: unknown): SynapseLocalIdentity | null {
  if (!isRecord(rawValue)) {
    return null
  }

  const userId = typeof rawValue.userId === "string" ? normalizeUserId(rawValue.userId) : null

  if (!userId) {
    return null
  }

  const generatedAt =
    typeof rawValue.generatedAt === "string" && rawValue.generatedAt.trim().length > 0
      ? rawValue.generatedAt
      : new Date().toISOString()

  return {
    schemaVersion: USER_IDENTITY_SCHEMA_VERSION,
    userId,
    generatedAt,
  }
}

function formatGitSpawnError(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return "当前系统没有可用的 git 命令，请先安装 Git 并确保命令行可访问。"
  }

  return error instanceof Error ? error.message : "启动 Git 命令失败。"
}

function runGitCommand(cwd: string, args: string[], fallbackMessage: string): Promise<void> {
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
        resolve()
        return
      }

      reject(new Error((stderr.trim() || stdout.trim()) || fallbackMessage))
    })
  })
}

class UserIdentityService {
  getFilePath(): string {
    return path.join(app.getPath("userData"), USER_IDENTITY_FILE_NAME)
  }

  async loadLocalIdentity(): Promise<SynapseLocalIdentityState> {
    const filePath = this.getFilePath()

    await mkdir(path.dirname(filePath), { recursive: true })

    try {
      const fileContent = await readFile(filePath, "utf8")
      const parsedValue = JSON.parse(fileContent) as unknown
      const identity = normalizeIdentity(parsedValue)

      if (!identity) {
        logger.warn("User identity file is invalid.", { filePath })
        const invalidUserId =
          isRecord(parsedValue) && typeof parsedValue.userId === "string"
            ? parsedValue.userId
            : null

        return {
          status: "needs-recovery",
          invalidUserId,
        }
      }

      await this.persist(identity)

      return {
        status: "ready",
        identity,
      }
    } catch (error) {
      if (isFileNotFoundError(error)) {
        const identity = createIdentity()
        await this.persist(identity)

        logger.info("Generated new user identity for first launch.", {
          userId: identity.userId,
        })

        return {
          status: "ready",
          identity,
        }
      }

      if (error instanceof SyntaxError) {
        logger.warn("User identity file contains invalid JSON.", { filePath })
        return {
          status: "needs-recovery",
          invalidUserId: null,
        }
      }

      throw error
    }
  }

  async requireReadyRepoProfile(repoId: string): Promise<{ displayName: string; userId: string }> {
    const state = await this.loadLocalIdentity()

    if (state.status === "needs-recovery") {
      throw new Error("身份 ID 无法读取，请先在设置页恢复身份。")
    }

    const repoProfileState = await userProfileService.loadRepoProfileState(
      repoId,
      state.identity.userId,
    )

    if (repoProfileState.status !== "ready") {
      throw new Error("请先在当前仓库完成身份设置。")
    }

    return {
      userId: state.identity.userId,
      displayName: repoProfileState.profile.displayName,
    }
  }

  async exportIdentity(): Promise<SynapseLocalIdentity> {
    const state = await this.loadLocalIdentity()

    if (state.status === "needs-recovery") {
      throw new Error("身份无法读取，请先恢复身份后再导出。")
    }

    return state.identity
  }

  async adoptExistingUserId(
    rawUserId: string,
    repoId: string,
  ): Promise<SynapseLocalIdentityState> {
    const nextUserId = normalizeUserId(rawUserId)

    if (!nextUserId) {
      throw new Error("ID 格式不对，应为 32 位十六进制字符。")
    }

    const config = await configStore.load()
    const repository = config.repositories.find((item) => item.uuid === repoId)

    if (!repository) {
      throw new Error("找不到当前仓库，无法接续身份。")
    }

    const repositoryState = await repositoryStore.getRepositoryState(repository)

    if (repositoryState.status !== "ready") {
      throw new Error("当前仓库不可用，无法接续身份。")
    }

    if (repositoryState.isGitRepository) {
      try {
        await runGitCommand(
          repository.localPath,
          ["fetch"],
          "无法同步仓库，请检查网络后重试。",
        )
      } catch {
        throw new Error("无法同步仓库，请检查网络后重试。")
      }
    }

    const profilePath = resolveUserProfilePath(repository.localPath, nextUserId)

    try {
      const rawProfile = JSON.parse(await readFile(profilePath, "utf8")) as unknown
      const profile = parseUserProfile(rawProfile, nextUserId)

      if (!profile) {
        throw new Error("这个 ID 在当前仓库里不存在，无法接续。")
      }
    } catch (error) {
      if (isFileNotFoundError(error) || error instanceof SyntaxError) {
        throw new Error("这个 ID 在当前仓库里不存在，无法接续。")
      }

      if (error instanceof Error && error.message) {
        throw error
      }

      throw new Error("这个 ID 在当前仓库里不存在，无法接续。")
    }

    const nextIdentity: SynapseLocalIdentity = {
      schemaVersion: USER_IDENTITY_SCHEMA_VERSION,
      userId: nextUserId,
      generatedAt: new Date().toISOString(),
    }

    await this.persist(nextIdentity)

    return {
      status: "ready",
      identity: nextIdentity,
    }
  }

  async generateNewIdentity(): Promise<SynapseLocalIdentityState> {
    const nextIdentity = createIdentity()

    await this.persist(nextIdentity)

    return {
      status: "ready",
      identity: nextIdentity,
    }
  }

  async importIdentity(rawIdentity: unknown): Promise<SynapseLocalIdentityState> {
    const nextIdentity = normalizeIdentity(rawIdentity)

    if (!nextIdentity) {
      throw new Error("备份文件里的身份格式不对。")
    }

    await this.persist(nextIdentity)

    return {
      status: "ready",
      identity: nextIdentity,
    }
  }

  private async persist(identity: SynapseLocalIdentity): Promise<void> {
    const filePath = this.getFilePath()

    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, `${JSON.stringify(identity, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
  }
}

export {
  generateUserId,
  normalizeUserId,
  normalizeIdentity,
  userIdentityService,
}

const userIdentityService = new UserIdentityService()
