import { randomUUID } from "node:crypto"
import { app } from "electron"
import { mkdir, rename, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { existsSync } from "node:fs"
import type {
  SynapseLocalIdentity,
  SynapseLocalIdentityState,
} from "../../src/types/identity"
import { configStore } from "./config-store"
import { runGitCommand } from "./git-command"
import { createMainLogger } from "./log-store"
import { userProfileService } from "./user-profile-service"
import {
  parseUserProfile,
  resolveUserProfilePath,
} from "./user-profile-cache"
import { repositoryStore } from "./repository-store"
import { JsonNamespace } from "../runtime/data-repo/backends/json"

const USER_IDENTITY_FILE_NAME = "user-identity.json"
const CORE_IDENTITY_NAMESPACE = "core.identity"
const USER_IDENTITY_SCHEMA_VERSION = 2 as const
import { isFileNotFoundError } from "./fs-utils"

const logger = createMainLogger("service.user-identity")

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

function runIdentityGitCommand(cwd: string, args: string[], fallbackMessage: string): Promise<void> {
  return runGitCommand({
    args,
    cwd,
    fallbackMessage,
  }).then(() => undefined)
}

class UserIdentityService {
  private readonly identityNamespace: JsonNamespace<SynapseLocalIdentity>

  constructor() {
    const userDataPath = app.getPath("userData")
    const dataV1Path = path.join(userDataPath, "data-v1")
    const filePath = path.join(dataV1Path, `${CORE_IDENTITY_NAMESPACE}.json`)
    this.identityNamespace = new JsonNamespace({
      name: CORE_IDENTITY_NAMESPACE,
      schemaVersion: USER_IDENTITY_SCHEMA_VERSION,
      backend: "json",
      filePath,
    })
  }

  private getLegacyFilePath(): string {
    return path.join(app.getPath("userData"), USER_IDENTITY_FILE_NAME)
  }

  /**
   * Migrate identity from legacy user-identity.json to the namespace store.
   * Called once during loadLocalIdentity when the namespace is empty and the
   * legacy file exists. After successful migration the legacy file is renamed
   * to prevent re-migration.
   */
  private async migrateFromLegacy(): Promise<SynapseLocalIdentity | null> {
    const legacyPath = this.getLegacyFilePath()
    if (!existsSync(legacyPath)) return null

    try {
      const content = await readFile(legacyPath, "utf8")
      const parsed = JSON.parse(content) as unknown
      const identity = normalizeIdentity(parsed)
      if (!identity) return null

      // Ensure directory exists before writing
      const userDataPath = app.getPath("userData")
      const nsDir = path.join(userDataPath, "data-v1")
      await mkdir(nsDir, { recursive: true })
      await this.identityNamespace.setSingleton(identity)

      // Rename legacy file to prevent re-migration
      try {
        await rename(legacyPath, `${legacyPath}.migrated`)
      } catch {
        // Non-critical; the next launch will attempt migration again
      }

      logger.info("Migrated identity from legacy file to namespace store.", { userId: identity.userId })
      return identity
    } catch {
      return null
    }
  }

  async loadLocalIdentity(): Promise<SynapseLocalIdentityState> {
    try {
      // Try reading from namespace store first
      let identity = await this.identityNamespace.getSingleton()

      if (!identity) {
        // Namespace is empty — try migrating from legacy file
        identity = await this.migrateFromLegacy()
      }

      if (!identity) {
        // No existing identity — create a new one
        identity = createIdentity()
        await this.identityNamespace.setSingleton(identity)
        logger.info("Generated new user identity for first launch.", {
          userId: identity.userId,
        })
        return {
          status: "ready",
          identity,
        }
      }

      // Re-persist to ensure data integrity on each load
      await this.identityNamespace.setSingleton(identity)

      return {
        status: "ready",
        identity,
      }
    } catch (error) {
      // If the namespace data is corrupt, try to read as raw JSON for recovery
      try {
        const legacyPath = this.getLegacyFilePath()
        const fileContent = await readFile(legacyPath, "utf8")
        const parsedValue = JSON.parse(fileContent) as unknown
        const recovered = normalizeIdentity(parsedValue)

        if (!recovered) {
          const invalidUserId =
            isRecord(parsedValue) && typeof parsedValue.userId === "string"
              ? parsedValue.userId
              : null
          return {
            status: "needs-recovery",
            invalidUserId,
          }
        }

        await this.identityNamespace.setSingleton(recovered)
        return {
          status: "ready",
          identity: recovered,
        }
      } catch {
        const filePath = this.getLegacyFilePath()
        if (isFileNotFoundError(error)) {
          const identity = createIdentity()
          await this.identityNamespace.setSingleton(identity)
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
          await runIdentityGitCommand(
            repository.localPath,
            ["fetch"],
            "无法同步仓库，请检查网络后重试。",
        )
      } catch {
        throw new Error("无法同步仓库，请检查网络后重试。")
      }
    }

    const missingProfileErrorMessage = repositoryState.isGitRepository
      ? "这个 ID 还没有出现在当前仓库的本地副本里。先同步仓库后再试。"
      : "这个 ID 在当前仓库里不存在，无法接续。"

    const profilePath = resolveUserProfilePath(repository.localPath, nextUserId)

    try {
      const rawProfile = JSON.parse(await readFile(profilePath, "utf8")) as unknown
      const profile = parseUserProfile(rawProfile, nextUserId)

      if (!profile) {
        throw new Error(missingProfileErrorMessage)
      }
    } catch (error) {
      if (isFileNotFoundError(error) || error instanceof SyntaxError) {
        throw new Error(missingProfileErrorMessage)
      }

      if (error instanceof Error && error.message) {
        throw error
      }

      throw new Error(missingProfileErrorMessage)
    }

    const nextIdentity: SynapseLocalIdentity = {
      schemaVersion: USER_IDENTITY_SCHEMA_VERSION,
      userId: nextUserId,
      generatedAt: new Date().toISOString(),
    }

    await this.identityNamespace.setSingleton(nextIdentity)

    return {
      status: "ready",
      identity: nextIdentity,
    }
  }

  async generateNewIdentity(): Promise<SynapseLocalIdentityState> {
    const nextIdentity = createIdentity()

    await this.identityNamespace.setSingleton(nextIdentity)

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

    await this.identityNamespace.setSingleton(nextIdentity)

    return {
      status: "ready",
      identity: nextIdentity,
    }
  }
}

export {
  generateUserId,
  normalizeUserId,
  normalizeIdentity,
  userIdentityService,
}

const userIdentityService = new UserIdentityService()
