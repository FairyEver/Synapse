import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { access, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import path from "node:path"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "../../src/constants/defaults"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseRepositoryInitializationPreview,
  SynapseRepositoryInitializationResult,
} from "../../src/types/repository"
import { contentIndexService } from "./content-index-service"
import { runGitTextCommand } from "./git-command"
import { createMainLogger } from "./log-store"
import { pendingPushesService } from "./pending-pushes-service"
import { repositoryStore } from "./repository-store"
import { userProfileService } from "./user-profile-service"

const SYNAPSE_BOT_NAME = "Synapse Bot"
const SYNAPSE_BOT_EMAIL = "bot@synapse.local"
const logger = createMainLogger("service.repository-structure")

function isGitDirectory(entry: Dirent): boolean {
  return entry.name === ".git" && entry.isDirectory()
}

function formatTopLevelEntryName(entry: Dirent): string {
  return entry.isDirectory() ? `${entry.name}/` : entry.name
}

async function readTopLevelEntries(repoRootPath: string): Promise<Dirent[]> {
  return readdir(repoRootPath, { withFileTypes: true })
}

function getNonGitEntries(entries: Dirent[]): Dirent[] {
  return entries.filter((entry) => !isGitDirectory(entry))
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

  await runStructureGitCommand(
    gitRootPath,
    ["add", "-A", "--", normalizedRelativePath],
    "暂存仓库结构改动失败。",
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

function getRepositorySkeletonDirectories(repository: SynapseRepositoryConfig): string[] {
  return [
    repository.contentDirs.rule ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.rule,
    repository.contentDirs.skill ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.skill,
    "users",
    "attachments-pool",
  ]
}

class RepositoryStructureService {
  async checkInitializationPreview(
    repository: SynapseRepositoryConfig,
  ): Promise<SynapseRepositoryInitializationPreview> {
    const repositoryState = await repositoryStore.getRepositoryState(repository)

    if (repositoryState.status !== "ready") {
      throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
    }

    const entries = await readTopLevelEntries(repository.localPath)
    const nonGitEntries = getNonGitEntries(entries)

    return {
      isEmpty: nonGitEntries.length === 0,
      nonGitEntries: nonGitEntries.map(formatTopLevelEntryName),
    }
  }

  async initializeStructure(
    repository: SynapseRepositoryConfig,
  ): Promise<SynapseRepositoryInitializationResult> {
    const repositoryState = await repositoryStore.getRepositoryState(repository)

    if (repositoryState.status !== "ready") {
      throw new Error("当前目录不存在，请先在 Settings 里重新选择本地目录。")
    }

    await access(repository.localPath, fsConstants.W_OK)

    const entries = await readTopLevelEntries(repository.localPath)
    const nonGitEntries = getNonGitEntries(entries)

    for (const entry of nonGitEntries) {
      await rm(path.join(repository.localPath, entry.name), {
        force: true,
        recursive: true,
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
      } catch (error) {
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
  }
}

const repositoryStructureService = new RepositoryStructureService()

export {
  repositoryStructureService,
}
