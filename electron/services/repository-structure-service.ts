import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { access, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import path from "node:path"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "../../src/constants/defaults"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseContentAttachmentRecord,
  SynapseContentAttachmentsRecord,
  SynapseContentMetaRecord,
  SynapseContentSnapshotRecord,
  SynapseContentType,
} from "../../src/types/content"
import type {
  SynapseCreateLocalRepositoryPayload,
  SynapseCreateLocalRepositoryResult,
  SynapseRepositoryInitializationPreview,
  SynapseRepositoryInitializationResult,
} from "../../src/types/repository"
import { attachmentsPoolService } from "./attachments-pool-service"
import { contentIndexService } from "./content-index-service"
import {
  CONTENT_ATTACHMENTS_FILE_NAME,
  CONTENT_MAIN_FILE_NAME,
  CONTENT_META_FILE_NAME,
  HISTORY_DIRECTORY_NAME,
  resolveContentDirectoryPath,
} from "./content-history-service"
import { runGitTextCommand } from "./git-command"
import { createMainLogger } from "./log-store"
import { pendingPushesService } from "./pending-pushes-service"
import { repositoryStore } from "./repository-store"
import { userProfileService } from "./user-profile-service"

const SYNAPSE_BOT_NAME = "Synapse Bot"
const SYNAPSE_BOT_EMAIL = "bot@synapse.local"
const SYNAPSE_SEED_AUTHOR_ID = "synapse"
const SYNAPSE_SEED_AUTHOR_NAME = "Synapse"
const logger = createMainLogger("service.repository-structure")

type RepositorySeedAttachment = {
  content: string
  originalName: string
}

type RepositorySeedContent = {
  attachments?: RepositorySeedAttachment[]
  category: string
  content: string
  description: string
  icon: string
  iconBg: string
  id: string
  title: string
  type: SynapseContentType
}

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

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false
    }

    throw error
  }
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

function normalizeMarkdownContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function buildHistoryDirname(userId: string, at: Date): string {
  const compactTimestamp = `${at.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`
  const rand6 = randomUUID().replace(/-/g, "").slice(0, 6)

  return `${compactTimestamp}__${userId}__${rand6}`
}

function normalizeRepositoryName(name: string): string {
  const nextName = name.trim()

  if (!nextName) {
    throw new Error("本地仓库名称不能为空。")
  }

  if (nextName === "." || nextName === "..") {
    throw new Error("本地仓库名称不能是 . 或 ..。")
  }

  if (/[\\/]/.test(nextName)) {
    throw new Error("本地仓库名称不能包含斜杠。")
  }

  return nextName
}

function createRepositoryConfig(name: string, localPath: string): SynapseRepositoryConfig {
  return {
    uuid: randomUUID(),
    name,
    localPath,
    contentDirs: { ...DEFAULT_REPOSITORY_CONTENT_DIRECTORIES },
  }
}

function createMetaRecord(
  contentId: string,
  contentType: SynapseContentType,
  createdAt: string,
): SynapseContentMetaRecord {
  return {
    schemaVersion: 1,
    id: contentId,
    type: contentType,
    createdBy: SYNAPSE_SEED_AUTHOR_ID,
    createdByDisplayName: SYNAPSE_SEED_AUTHOR_NAME,
    createdAt,
  }
}

function createSnapshotRecord(
  seed: RepositorySeedContent,
  modifiedAt: string,
): SynapseContentSnapshotRecord {
  return {
    schemaVersion: 1,
    title: seed.title,
    description: seed.description,
    category: seed.category,
    icon: seed.icon,
    iconBg: seed.iconBg,
    modifiedBy: SYNAPSE_SEED_AUTHOR_ID,
    modifiedByDisplayName: SYNAPSE_SEED_AUTHOR_NAME,
    modifiedAt,
    deleted: false,
  }
}

function createAttachmentsRecord(
  files: SynapseContentAttachmentRecord[],
): SynapseContentAttachmentsRecord {
  return {
    schemaVersion: 1,
    files,
  }
}

function createSeedContents(): RepositorySeedContent[] {
  return [
    {
      id: "example-rule",
      type: "rule",
      title: "示例 Rule",
      description: "展示 Rule 在本地仓库里的目录结构和历史文件组织方式。",
      category: "workflow",
      icon: "shield-check",
      iconBg: "graphite",
      content: `# 目标

- 让团队里的内容格式更统一
- 让新成员能快速看懂这类仓库怎么组织

# 建议

1. 标题直接写结论，不写空话
2. 规则要能落地，尽量写成可检查的要求
3. 需要改动时直接更新历史，不要另起一套格式

# 结构

- \`meta.json\` 记录内容 ID、类型和创建者
- \`history/<版本目录>/snapshot.json\` 记录当前标题、简介和元数据
- \`history/<版本目录>/main.md\` 存正文
- \`history/<版本目录>/attachments.json\` 存附件引用
`,
    },
    {
      id: "example-skill",
      type: "skill",
      title: "示例 Skill",
      description: "展示 Skill 的主说明、历史版本和附件引用是怎么组合的。",
      category: "development",
      icon: "wrench",
      iconBg: "teal",
      content: `# 用途

这个示例 Skill 用来演示 Synapse 里 Skill 内容的基础结构。

# 结构

- 当前说明来自 \`main.md\`
- 安装到编辑器时会生成 \`SKILL.md\`
- 附件内容通过 \`attachments.json\` 引用仓库根目录的 \`attachments-pool/\`

# 附件

安装这个示例 Skill 时，会一起带上 \`templates/checklist.md\`。
`,
      attachments: [
        {
          originalName: "templates/checklist.md",
          content: `# 示例检查清单

- 明确输入
- 明确输出
- 明确边界
`,
        },
      ],
    },
  ]
}

async function writeSeedContent(
  repository: SynapseRepositoryConfig,
  seed: RepositorySeedContent,
): Promise<void> {
  const createdAt = new Date().toISOString()
  const historyDirname = buildHistoryDirname(SYNAPSE_SEED_AUTHOR_ID, new Date(createdAt))
  const contentDirectoryPath = resolveContentDirectoryPath(repository, seed.type, seed.id)
  const historyDirectoryPath = path.join(contentDirectoryPath, HISTORY_DIRECTORY_NAME, historyDirname)
  const attachments =
    seed.attachments && seed.attachments.length > 0
      ? await attachmentsPoolService.writeAttachments(
        repository.localPath,
        seed.attachments.map((attachment) => {
          const bytes = Buffer.from(attachment.content, "utf8")

          return {
            originalName: attachment.originalName,
            size: bytes.byteLength,
            bytes,
          }
        }),
      )
      : {
        records: [] as SynapseContentAttachmentRecord[],
      }

  await mkdir(historyDirectoryPath, { recursive: true })
  await writeJsonFile(
    path.join(contentDirectoryPath, CONTENT_META_FILE_NAME),
    createMetaRecord(seed.id, seed.type, createdAt),
  )
  await writeJsonFile(
    path.join(historyDirectoryPath, "snapshot.json"),
    createSnapshotRecord(seed, createdAt),
  )
  await writeFile(
    path.join(historyDirectoryPath, CONTENT_MAIN_FILE_NAME),
    normalizeMarkdownContent(seed.content),
    "utf8",
  )
  await writeJsonFile(
    path.join(historyDirectoryPath, CONTENT_ATTACHMENTS_FILE_NAME),
    createAttachmentsRecord(attachments.records),
  )
}

async function scaffoldNewLocalRepository(repository: SynapseRepositoryConfig): Promise<void> {
  for (const directoryName of getRepositorySkeletonDirectories(repository)) {
    await mkdir(path.join(repository.localPath, directoryName), { recursive: true })
  }

  for (const seed of createSeedContents()) {
    await writeSeedContent(repository, seed)
  }
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
  async createLocalRepository(
    payload: SynapseCreateLocalRepositoryPayload,
  ): Promise<SynapseCreateLocalRepositoryResult> {
    const repositoryName = normalizeRepositoryName(payload.name)
    const parentPath = payload.parentPath.trim()

    if (!parentPath) {
      throw new Error("先选择保存位置。")
    }

    const parentStats = await stat(parentPath).catch((error: unknown) => {
      if (isFileNotFoundError(error)) {
        throw new Error("保存位置不存在，请重新选择。")
      }

      throw error
    })

    if (!parentStats.isDirectory()) {
      throw new Error("保存位置不是文件夹，请重新选择。")
    }

    await access(parentPath, fsConstants.W_OK)

    const targetPath = path.join(parentPath, repositoryName)

    if (await pathExists(targetPath)) {
      throw new Error("目标目录已存在，请换个名称或位置。")
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
