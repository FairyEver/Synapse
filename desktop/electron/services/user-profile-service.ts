import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseRepoProfileState,
  SynapseUserProfile,
} from "../../src/types/identity"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import { configStore } from "./config-store"
import { runGitTextCommand } from "./git-command"
import { createMainLogger } from "./log-store"
import { formatGitFailureMessage } from "./git-error-utils"
import { pendingPushesService } from "./pending-pushes-service"
import {
  commitRepositoryPaths,
  pullRepositoryWithSafeRebase,
} from "./repository-git-mutation-service"
import { repositoryStore } from "./repository-store"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import {
  parseUserProfile,
  resolveUserProfilePath,
  userProfileCache,
} from "./user-profile-cache"

const USER_PROFILE_SCHEMA_VERSION = 1 as const
import { isFileNotFoundError } from "./fs-utils"

const logger = createMainLogger("service.user-profile")

type UserProfileWriteSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

function createUserProfile(userId: string, displayName: string): SynapseUserProfile {
  return {
    schemaVersion: USER_PROFILE_SCHEMA_VERSION,
    userId,
    displayName: displayName.trim(),
    updatedAt: new Date().toISOString(),
  }
}


function runProfileGitCommand(
  cwd: string,
  args: string[],
  fallbackMessage: string,
): Promise<string> {
  return runGitTextCommand({
    args,
    cwd,
    fallbackMessage,
    formatFailureMessage: formatGitFailureMessage,
  })
}

async function commitProfileChange(
  gitRootPath: string,
  profilePath: string,
  userId: string,
  action: "join" | "rename",
): Promise<string> {
  return commitRepositoryPaths({
    fallbackMessage: "提交用户资料失败。",
    filePaths: [profilePath],
    gitRootPath,
    message: `[synapse] user ${userId.slice(0, 8)} ${action}`,
  })
}

async function pushRepository(repository: SynapseRepositoryConfig): Promise<void> {
  await runProfileGitCommand(
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

async function restoreProfileFile(
  profilePath: string,
  existingProfile: SynapseUserProfile | null,
): Promise<void> {
  if (existingProfile) {
    await writeJsonFileAtomically(profilePath, existingProfile)
    return
  }

  await rm(profilePath, { force: true })
}

async function checkProfileWritePermission(
  deps: UserProfileWriteSecurityDeps | undefined,
  profilePath: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps) return

  const permission = await deps.permissionGuard.check({
    action: "fs.write",
    actor: deps.actor,
    context: metadata,
    resource: profilePath,
  })

  if (permission.allowed) return

  deps.auditSink.record({
    action: "fs.write",
    actor: deps.actor,
    metadata: {
      ...metadata,
      policyId: permission.policyId,
      reason: permission.reason,
    },
    outcome: "denied",
    resource: profilePath,
  })

  throw new Error(permission.reason)
}

function recordProfileWriteAudit(
  deps: UserProfileWriteSecurityDeps | undefined,
  profilePath: string,
  outcome: "allowed" | "failed",
  metadata: Record<string, unknown>,
): void {
  deps?.auditSink.record({
    action: "fs.write",
    actor: deps.actor,
    metadata,
    outcome,
    resource: profilePath,
  })
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
    const profiles = await this.listRepoProfiles(repoId)
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
    return userProfileCache.rebuild(repoId)
  }

  async refreshRepoProfiles(repoId: string): Promise<ReadonlyMap<string, SynapseUserProfile>> {
    return this.listRepoProfiles(repoId)
  }

  clearRepoProfiles(repoId: string): void {
    userProfileCache.clear(repoId)
  }

  async updateDisplayName(
    repoId: string,
    userId: string,
    displayName: string,
    security?: UserProfileWriteSecurityDeps,
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
    let rollbackProfile = existingProfile
    const profilePath = resolveUserProfilePath(repository.localPath, userId)
    const auditMetadata = {
      operation: "user-profile.updateDisplayName",
      repoId,
      userId,
    }

    await checkProfileWritePermission(security, profilePath, auditMetadata)

    if (repositoryState.isGitRepository) {
      if (existingProfile) {
        await pullRepositoryWithSafeRebase(repository)
        rollbackProfile = await readProfileFile(repository, userId)
      }
    }

    const profile = createUserProfile(userId, nextDisplayName)

    try {
      await writeJsonFileAtomically(profilePath, profile)
      recordProfileWriteAudit(security, profilePath, "allowed", auditMetadata)
    } catch (error) {
      recordProfileWriteAudit(security, profilePath, "failed", {
        ...auditMetadata,
        errorLength: String(error).length,
        errorName: error instanceof Error ? error.name : typeof error,
      })
      throw error
    }

    if (repositoryState.isGitRepository) {
      const gitRootPath = repositoryState.gitRootPath ?? repository.localPath
      const action = existingProfile ? "rename" : "join"

      let commitHash: string
      try {
        commitHash = await commitProfileChange(gitRootPath, profilePath, userId, action)
      } catch (error) {
        await restoreProfileFile(profilePath, rollbackProfile).catch((rollbackError: unknown) => {
          logger.warn("Failed to roll back profile after git commit failure.", {
            errorName: rollbackError instanceof Error ? rollbackError.name : typeof rollbackError,
            repoId,
            userId,
          })
        })
        throw error
      }

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
