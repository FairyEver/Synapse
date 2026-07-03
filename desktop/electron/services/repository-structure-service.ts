import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { access, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import path from "node:path"
import { isFileNotFoundError, pathExists } from "./fs-utils"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "../../src/constants/defaults"
import { CONTENT_TYPE_DEFINITIONS } from "../../src/config/content-types"
import { normalizeLocalRepositoryNameInput, validateLocalRepositoryNameInput } from "../../src/lib/repository-name"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseCreateLocalRepositoryPayload,
  SynapseCreateLocalRepositoryResult,
  SynapseRepositoryInitializationOptions,
  SynapseRepositoryInitializationPreview,
  SynapseRepositoryInitializationResult,
} from "../../src/types/repository"
import { contentIndexService } from "./content-index-service"
import { runGitTextCommand } from "./git-command"
import { createMainLogger } from "./log-store"
import { formatGitFailureMessage } from "./git-error-utils"
import { pendingPushesService } from "./pending-pushes-service"
import {
  assertRepositoryInitializationAllowed,
  createInitializationBackupDirectoryName,
  createRepositoryInitializationPreview,
  isInitializationBackupEntry,
} from "./repository-initialization-safety"
import { repositoryStore } from "./repository-store"
import { userProfileService } from "./user-profile-service"

const SYNAPSE_BOT_NAME = "Synapse Bot"
const SYNAPSE_BOT_EMAIL = "bot@synapse.local"
const logger = createMainLogger("service.repository-structure")

function isGitDirectory(entry: Dirent): boolean {
  return entry.name === ".git" && entry.isDirectory()
}

async function readTopLevelEntries(repoRootPath: string): Promise<Dirent[]> {
  return readdir(repoRootPath, { withFileTypes: true })
}

function getNonGitEntries(entries: Dirent[]): Dirent[] {
  return entries.filter((entry) => !isGitDirectory(entry) && !isInitializationBackupEntry(entry.name))
}

function runStructureGitCommand(
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

async function ensureBotIdentity(gitRootPath: string): Promise<void> {
  await runStructureGitCommand(
    gitRootPath,
    ["config", "--local", "user.name", SYNAPSE_BOT_NAME],
    "无法初始化 Synapse 提交身份。",
  )
  await runStructureGitCommand(
    gitRootPath,
    ["config", "--local", "user.email", SYNAPSE_BOT_EMAIL],
    "无法初始化 Synapse 提交身份。",
  )
}

async function stageRepositoryScope(
  gitRootPath: string,
  repository: SynapseRepositoryConfig,
): Promise<void> {
  const relativePath = path.relative(gitRootPath, repository.localPath) || "."
  const normalizedRelativePath = relativePath.split(path.sep).join("/")
  const backupPathspec = normalizedRelativePath === "."
    ? ".synapse-init-backup-*"
    : `${normalizedRelativePath}/.synapse-init-backup-*`

  await runStructureGitCommand(
    gitRootPath,
    ["add", "-A", "--", normalizedRelativePath],
    "暂存仓库结构改动失败。",
  )
  await runStructureGitCommand(
    gitRootPath,
    ["reset", "-q", "--", backupPathspec],
    "排除初始化备份目录失败。",
  )
}

async function commitInitialization(gitRootPath: string): Promise<string> {
  await runStructureGitCommand(
    gitRootPath,
    ["commit", "-m", "[synapse] initialize repository structure"],
    "提交仓库结构改动失败。",
  )

  return runStructureGitCommand(gitRootPath, ["rev-parse", "HEAD"], "读取最新提交失败。")
}

async function pushRepository(repository: SynapseRepositoryConfig): Promise<void> {
  await runStructureGitCommand(
    repository.localPath,
    ["push"],
    "推送到仓库失败。",
  )
}

async function writeGitkeep(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true })
  const temporaryPath = path.join(directoryPath, `.gitkeep.${randomUUID()}.tmp`)
  const targetPath = path.join(directoryPath, ".gitkeep")

  await writeFile(temporaryPath, "", "utf8")
  await rename(temporaryPath, targetPath)
}

async function moveExistingEntriesToInitializationBackup(
  repositoryPath: string,
  entries: Dirent[],
): Promise<string | null> {
  const movableEntries = getNonGitEntries(entries)
  if (movableEntries.length === 0) return null

  const backupPath = path.join(repositoryPath, createInitializationBackupDirectoryName(new Date()))
  await mkdir(backupPath, { recursive: false })
  const movedEntries: string[] = []

  try {
    for (const entry of movableEntries) {
      await rename(path.join(repositoryPath, entry.name), path.join(backupPath, entry.name))
      movedEntries.push(entry.name)
    }
    return backupPath
  } catch (error) {
    const rollbackFailures: Array<{ readonly entryName: string; readonly error: unknown }> = []
    for (const entryName of [...movedEntries].reverse()) {
      try {
        await rename(path.join(backupPath, entryName), path.join(repositoryPath, entryName))
      } catch (rollbackError) {
        rollbackFailures.push({ entryName, error: rollbackError })
      }
    }
    if (rollbackFailures.length > 0) {
      logger.error("Failed to roll back partial repository initialization backup move.", {
        backupName: path.basename(backupPath),
        movedEntries,
        rollbackFailures,
        error,
      })
      throw new Error(
        `备份旧目录内容失败，且自动恢复部分旧内容失败。请从 ${path.basename(backupPath)} 手动恢复：${movedEntries.join(", ")}`,
        { cause: error },
      )
    }
    await rm(backupPath, { recursive: true, force: true }).catch((cleanupError) => {
      logger.warn("Failed to remove empty initialization backup after rollback.", {
        backupName: path.basename(backupPath),
        error: cleanupError,
      })
    })
    logger.error("Failed to move repository contents into initialization backup.", {
      backupName: path.basename(backupPath),
      movedEntries,
      error,
    })
    throw new Error("备份旧目录内容失败，未初始化。", { cause: error })
  }
}

function getTopLevelSkeletonDirectories(repository: SynapseRepositoryConfig): string[] {
  return Array.from(new Set(
    getRepositorySkeletonDirectories(repository)
      .map((directoryName) => directoryName.split(path.sep).filter(Boolean)[0])
      .filter((directoryName): directoryName is string => Boolean(directoryName)),
  ))
}

async function containsOnlyInitializationScaffold(directoryPath: string): Promise<boolean> {
  const entries = await readdir(directoryPath, { withFileTypes: true }).catch((error: unknown) => {
    if (isFileNotFoundError(error)) return []
    throw error
  })

  for (const entry of entries) {
    if (entry.name === ".gitkeep" && entry.isFile()) {
      continue
    }

    if (entry.isDirectory() && await containsOnlyInitializationScaffold(path.join(directoryPath, entry.name))) {
      continue
    }

    return false
  }

  return true
}

async function removeInitializationScaffold(repositoryPath: string, repository: SynapseRepositoryConfig): Promise<void> {
  for (const directoryName of getTopLevelSkeletonDirectories(repository)) {
    const directoryPath = path.join(repositoryPath, directoryName)
    if (!await containsOnlyInitializationScaffold(directoryPath)) {
      continue
    }

    await rm(directoryPath, { recursive: true, force: true })
  }
}

async function restoreInitializationBackup(repositoryPath: string, backupPath: string): Promise<void> {
  const backupEntries = await readdir(backupPath, { withFileTypes: true })

  for (const entry of backupEntries) {
    const restoreTargetPath = path.join(repositoryPath, entry.name)
    if (await pathExists(restoreTargetPath)) {
      throw new Error(`无法恢复 "${entry.name}"，目标位置已存在。`)
    }

    await rename(path.join(backupPath, entry.name), restoreTargetPath)
  }

  await rm(backupPath, { recursive: true, force: true })
}

async function rollbackInitializationBackup(
  repository: SynapseRepositoryConfig,
  backupPath: string,
  cause: unknown,
): Promise<void> {
  try {
    await removeInitializationScaffold(repository.localPath, repository)
    await restoreInitializationBackup(repository.localPath, backupPath)
    logger.warn("Rolled back repository initialization backup after failure.", {
      backupName: path.basename(backupPath),
      repositoryUuid: repository.uuid,
      cause,
    })
  } catch (rollbackError) {
    logger.error("Failed to roll back repository initialization backup.", {
      backupName: path.basename(backupPath),
      repositoryUuid: repository.uuid,
      error: rollbackError,
      cause,
    })
    throw new Error(
      `初始化失败，且自动恢复旧目录内容失败。请从 ${path.basename(backupPath)} 手动恢复。`,
      { cause: rollbackError },
    )
  }
}

function assertConfirmedInitializationToken(
  preview: SynapseRepositoryInitializationPreview,
  options: SynapseRepositoryInitializationOptions,
): void {
  if (preview.isEmpty) return
  if (!options.confirmedOperationToken || options.confirmedOperationToken !== preview.operationToken) {
    throw new Error("目录内容已变化，请重新确认初始化清单。")
  }
}

function normalizeRepositoryName(name: string): string {
  const error = validateLocalRepositoryNameInput(name)
  if (error) {
    throw new Error(error)
  }

  return normalizeLocalRepositoryNameInput(name)
}

function createRepositoryConfig(name: string, localPath: string): SynapseRepositoryConfig {
  return {
    uuid: randomUUID(),
    name,
    localPath,
    contentDirs: { ...DEFAULT_REPOSITORY_CONTENT_DIRECTORIES },
  }
}

async function scaffoldNewLocalRepository(repository: SynapseRepositoryConfig): Promise<void> {
  for (const directoryName of getRepositorySkeletonDirectories(repository)) {
    await mkdir(path.join(repository.localPath, directoryName), { recursive: true })
  }
}

function getRepositorySkeletonDirectories(repository: SynapseRepositoryConfig): string[] {
  return [
    repository.contentDirs.rule ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.rule,
    repository.contentDirs.skill ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.skill,
    repository.contentDirs.prompt ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.prompt,
    "system",
    path.join("system", "blobs"),
    path.join("system", "users"),
  ]
}

class RepositoryStructureService {
  async ensureContentDirectories(localPath: string): Promise<void> {
    const coreMarkers = [path.join("system", "users"), path.join("system", "blobs")]
    const hasCoreStructure = (await Promise.all(
      coreMarkers.map((dir) => pathExists(path.join(localPath, dir))),
    )).some(Boolean)

    if (!hasCoreStructure) {
      return
    }

    for (const definition of CONTENT_TYPE_DEFINITIONS) {
      await mkdir(path.join(localPath, definition.repositoryDir.defaultDirectoryName), { recursive: true })
    }
  }

  async validateDirectoryStructure(localPath: string): Promise<{
    isValid: boolean
    initializationPreview: SynapseRepositoryInitializationPreview
    missingDirectories: string[]
    message: string
  }> {
    const requiredDirs = ["rules", "skills", "prompts", path.join("system", "users"), path.join("system", "blobs")]
    const missingDirectories: string[] = []

    for (const dir of requiredDirs) {
      const dirPath = path.join(localPath, dir)
      const exists = await pathExists(dirPath)
      if (!exists) {
        missingDirectories.push(dir)
      }
    }

    const isValid = missingDirectories.length === 0
    const entries = await readTopLevelEntries(localPath)
    const initializationPreview = await createRepositoryInitializationPreview({
      localPath,
      entries,
    })

    let message: string
    if (isValid) {
      message = "目录结构验证通过。"
    } else if (missingDirectories.length === requiredDirs.length) {
      message = `该目录不是有效的 Synapse 仓库，缺少必要的目录结构（rules, skills, system/users, system/blobs）。`
    } else {
      message = `该目录缺少以下必要目录：${missingDirectories.join(", ")}`
    }

    return {
      isValid,
      initializationPreview,
      missingDirectories,
      message,
    }
  }

  async createLocalRepository(
    payload: SynapseCreateLocalRepositoryPayload,
  ): Promise<SynapseCreateLocalRepositoryResult> {
    const repositoryName = normalizeRepositoryName(payload.name)
    const parentPath = payload.parentPath.trim()

    if (!parentPath) {
      throw new Error("请先选择保存位置。")
    }

    const parentStats = await stat(parentPath).catch((error: unknown) => {
      if (isFileNotFoundError(error)) {
        throw new Error(`保存位置 "${parentPath}" 不存在，请重新选择。`)
      }

      throw error
    })

    if (!parentStats.isDirectory()) {
      throw new Error(`"${parentPath}" 不是文件夹，请选择一个目录。`)
    }

    await access(parentPath, fsConstants.W_OK)

    const targetPath = path.join(parentPath, repositoryName)

    if (await pathExists(targetPath)) {
      throw new Error(`文件夹 "${repositoryName}" 在 "${parentPath}" 下已存在，请更换仓库名称或选择其他位置。`)
    }

    const stagingPath = await mkdtemp(path.join(parentPath, ".synapse-local-repository-"))
    const repository = createRepositoryConfig(repositoryName, stagingPath)
    const createdAt = new Date().toISOString()

    try {
      await scaffoldNewLocalRepository(repository)
      await rename(stagingPath, targetPath)

      return {
        createdAt,
        message: "本地仓库已创建。",
        repository: {
          ...repository,
          localPath: targetPath,
        },
      }
    } catch (error) {
      await rm(stagingPath, { recursive: true, force: true }).catch((err) => logger.warn("Failed to clean up staging path", err))
      logger.error("Failed to create local repository scaffold.", {
        error,
        parentPath,
        repositoryName,
      })
      throw error
    }
  }

  async checkInitializationPreview(
    repository: SynapseRepositoryConfig,
  ): Promise<SynapseRepositoryInitializationPreview> {
    const repositoryState = await repositoryStore.getRepositoryState(repository)

    if (repositoryState.status !== "ready") {
      throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
    }

    const entries = await readTopLevelEntries(repository.localPath)

    return createRepositoryInitializationPreview({
      repositoryUuid: repository.uuid,
      localPath: repository.localPath,
      entries,
    })
  }

  async initializeStructure(
    repository: SynapseRepositoryConfig,
    options: SynapseRepositoryInitializationOptions = {},
  ): Promise<SynapseRepositoryInitializationResult> {
    const repositoryState = await repositoryStore.getRepositoryState(repository)

    if (repositoryState.status !== "ready") {
      throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
    }

    await access(repository.localPath, fsConstants.W_OK)

    const entries = await readTopLevelEntries(repository.localPath)
    const preview = await createRepositoryInitializationPreview({
      repositoryUuid: repository.uuid,
      localPath: repository.localPath,
      entries,
    })

    assertRepositoryInitializationAllowed(preview)
    assertConfirmedInitializationToken(preview, options)

    const backupPath = await moveExistingEntriesToInitializationBackup(repository.localPath, entries)

    try {
      if (backupPath) {
        logger.info("Moved repository contents into initialization backup.", {
          backupName: path.basename(backupPath),
          repositoryUuid: repository.uuid,
        })
      }

      for (const directoryName of getRepositorySkeletonDirectories(repository)) {
        await writeGitkeep(path.join(repository.localPath, directoryName))
      }

      let pendingPushCount = 0

      if (repositoryState.isGitRepository) {
        const gitRootPath = repositoryState.gitRootPath ?? repository.localPath

        await ensureBotIdentity(gitRootPath)
        await stageRepositoryScope(gitRootPath, repository)
        const commitHash = await commitInitialization(gitRootPath)

        try {
          await pushRepository(repository)
        } catch {
          const pendingState = await pendingPushesService.enqueue(repository, {
            action: "initialize",
            commitHash,
            targetId: repository.uuid,
            title: repository.name,
          })

          pendingPushCount = pendingState.count
          logger.warn("Repository initialization queued for later push.", {
            pendingPushCount,
            repositoryUuid: repository.uuid,
          })
        }
      }

      await contentIndexService.clearIndex(repository)
      userProfileService.clearRepoProfiles(repository.uuid)
      await contentIndexService.rebuildIndex(repository)

      return {
        initializedAt: new Date().toISOString(),
        message: pendingPushCount > 0 ? "初始化完成，等待同步。" : "初始化完成。",
        pendingPushCount,
        repository: await repositoryStore.getRepositoryState(repository),
      }
    } catch (error) {
      if (backupPath) {
        await rollbackInitializationBackup(repository, backupPath, error)
      }
      throw error
    }
  }
}

const repositoryStructureService = new RepositoryStructureService()

export {
  RepositoryStructureService,
  repositoryStructureService,
}
