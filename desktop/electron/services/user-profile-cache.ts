import type { Dirent } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import type { SynapseUserProfile } from "../../src/types/identity"
import { configStore } from "./config-store"
import { createMainLogger } from "./log-store"
import { repositoryStore } from "./repository-store"

const USER_PROFILE_SCHEMA_VERSION = 1 as const
const USERS_DIRECTORY_PATH = path.join("system", "users")
const USER_PROFILE_FILE_NAME = "profile.json"
const logger = createMainLogger("service.user-profile-cache")

import { isFileNotFoundError } from "./fs-utils"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isValidUserId(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value)
}

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  try {
    return await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return []
    }

    throw error
  }
}

function resolveUsersRootPath(repoRootPath: string): string {
  return path.join(repoRootPath, USERS_DIRECTORY_PATH)
}

function resolveUserProfileRelativePath(userId: string): string {
  return path.join(USERS_DIRECTORY_PATH, userId, USER_PROFILE_FILE_NAME)
}

function resolveUserProfilePath(repoRootPath: string, userId: string): string {
  return path.join(repoRootPath, resolveUserProfileRelativePath(userId))
}

function parseUserProfile(
  rawValue: unknown,
  expectedUserId?: string,
): SynapseUserProfile | null {
  if (!isRecord(rawValue)) {
    return null
  }

  const rawUserId = typeof rawValue.userId === "string" ? rawValue.userId.trim() : ""

  if (
    rawValue.schemaVersion !== USER_PROFILE_SCHEMA_VERSION
    || !isValidUserId(rawUserId)
    || (expectedUserId !== undefined && rawUserId !== expectedUserId)
    || typeof rawValue.displayName !== "string"
    || typeof rawValue.updatedAt !== "string"
    || rawValue.updatedAt.trim().length === 0
  ) {
    return null
  }

  return {
    schemaVersion: USER_PROFILE_SCHEMA_VERSION,
    userId: rawUserId,
    displayName: rawValue.displayName.trim(),
    updatedAt: rawValue.updatedAt.trim(),
  }
}

class UserProfileCache {
  private cache = new Map<string, ReadonlyMap<string, SynapseUserProfile>>()

  async get(repoId: string): Promise<ReadonlyMap<string, SynapseUserProfile>> {
    const cachedProfiles = this.cache.get(repoId)

    if (cachedProfiles) {
      return cachedProfiles
    }

    return this.rebuild(repoId)
  }

  async rebuild(repoId: string): Promise<ReadonlyMap<string, SynapseUserProfile>> {
    const config = await configStore.load()
    const repository = config.repositories.find((item) => item.uuid === repoId)

    if (!repository) {
      throw new Error("找不到对应的仓库配置。")
    }

    const repositoryState = await repositoryStore.getRepositoryState(repository)

    if (repositoryState.status !== "ready") {
      const emptyProfiles = new Map<string, SynapseUserProfile>()

      this.cache.set(repoId, emptyProfiles)
      return emptyProfiles
    }

    const usersRootPath = resolveUsersRootPath(repository.localPath)
    const entries = await readDirectoryEntries(usersRootPath)
    const nextProfiles = new Map<string, SynapseUserProfile>()

    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidUserId(entry.name)) {
        continue
      }

      const profilePath = resolveUserProfilePath(repository.localPath, entry.name)

      try {
        const rawProfile = JSON.parse(await readFile(profilePath, "utf8")) as unknown
        const profile = parseUserProfile(rawProfile, entry.name)

        if (!profile) {
          logger.warn("Skipping invalid repository user profile.", {
            profilePath,
            repoId,
          })
          continue
        }

        nextProfiles.set(profile.userId, profile)
      } catch (error) {
        if (error instanceof SyntaxError || isFileNotFoundError(error)) {
          logger.warn("Skipping unreadable repository user profile.", {
            error,
            profilePath,
            repoId,
          })
          continue
        }

        throw error
      }
    }

    this.cache.set(repoId, nextProfiles)
    return nextProfiles
  }

  clear(repoId: string): void {
    this.cache.delete(repoId)
  }

  clearAll(): void {
    this.cache.clear()
  }
}

const userProfileCache = new UserProfileCache()

export {
  USER_PROFILE_FILE_NAME,
  USERS_DIRECTORY_PATH,
  parseUserProfile,
  resolveUserProfilePath,
  resolveUserProfileRelativePath,
  resolveUsersRootPath,
  userProfileCache,
}
