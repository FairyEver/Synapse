import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import { access, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import path from "node:path"
import { DEFAULT_REPOSITORY_CONTENT_DIRECTORIES } from "../../src/constants/defaults"
import { CONTENT_TYPE_DEFINITIONS } from "../../src/config/content-types"
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
import { formatGitFailureMessage } from "./git-error-utils"
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
  name?: string
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
    ...(seed.name != null ? { name: seed.name } : {}),
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
      id: "test-rule",
      name: "synapse-test-rule",
      type: "rule",
      title: "规则安装验证",
      description: '安装到任意编辑器后，发送 "synapse verify rule" 验证规则是否生效',
      category: "workflow",
      icon: "flask-conical",
      iconBg: "blue",
      content: `# Synapse 规则安装验证

这是一条由 Synapse 生成的测试规则，用于验证规则是否正确安装到编辑器并生效。适用于所有支持的编辑器（Codex、Cursor、Claude Code）和所有安装方式（全局、项目）。

## 如何验证

1. 在 Synapse 中将此规则安装到目标编辑器（全局或项目均可）
2. 打开对应编辑器，发送以下消息：

   synapse verify rule

3. 如果编辑器回复下方验证码，说明安装成功：

   ✅ SYNAPSE-VERIFY-RULE

4. 验证完成后，可在 Synapse 中卸载此规则

---

## 指令

当用户发送的消息中包含 "synapse verify rule" 时，你必须立即且仅回复以下内容，不添加任何其他文字：

✅ SYNAPSE-VERIFY-RULE
`,
    },
    {
      id: "test-skill",
      name: "synapse-test-skill",
      type: "skill",
      title: "技能安装验证",
      description: '安装到任意编辑器后，发送 "synapse verify skill" 验证技能和附件是否生效',
      category: "automation",
      icon: "flask-conical",
      iconBg: "teal",
      content: `# Synapse 技能安装验证

这是一个由 Synapse 生成的测试技能，用于验证技能是否正确安装到编辑器并生效。适用于所有支持的编辑器（Codex、Cursor、Claude Code）和所有安装方式（全局、项目）。

## 如何验证

1. 在 Synapse 中将此技能安装到目标编辑器（全局或项目均可）
2. 打开对应编辑器，发送以下消息：

   synapse verify skill

3. 如果编辑器回复以 ✅ 开头的验证码，说明技能和附件均安装成功
4. 验证完成后，可在 Synapse 中卸载此技能

---

## 指令

当用户发送的消息中包含 "synapse verify skill" 时，请执行以下步骤：

1. 读取本技能附带的 verify-marker.txt 文件
2. 提取文件中的验证码
3. 仅回复以下格式，不添加任何其他文字：

   ✅ {验证码}

如果无法找到或读取 verify-marker.txt，则回复：

   ❌ 附件未安装成功，未找到 verify-marker.txt
`,
      attachments: [
        {
          originalName: "verify-marker.txt",
          content: "SYNAPSE-VERIFY-SKILL",
        },
      ],
    },
    {
      id: "test-universal-prompt",
      type: "prompt",
      title: "结构化代码诊断",
      description: "粘贴任意代码片段，AI 按固定格式输出五维诊断报告，可用于验证提示词效果",
      category: "coding",
      icon: "stethoscope",
      iconBg: "rose",
      content: `# 结构化代码诊断

将任意代码片段粘贴给 AI，它会按以下固定格式输出五维诊断报告。

## 使用方法

复制下方提示词，连同你的代码一起发送给任意 AI 工具。

---

请对以下代码进行五维结构化诊断，严格按照下方格式输出，不要遗漏任何一个维度，不要添加额外内容：

🔍 问题诊断
（列出代码中存在的 bug 或逻辑错误，没有则写"未发现"）

⚡ 性能隐患
（列出可能的性能问题，没有则写"未发现"）

🛡️ 安全风险
（列出潜在的安全漏洞，没有则写"未发现"）

✨ 改进建议
（列出可读性、可维护性方面的改进建议）

📊 综合评分：X/10

代码如下：
`,
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
    repository.contentDirs.prompt ?? DEFAULT_REPOSITORY_CONTENT_DIRECTORIES.prompt,
    "users",
    "attachments-pool",
  ]
}

class RepositoryStructureService {
  async ensureContentDirectories(localPath: string): Promise<void> {
    const coreMarkers = ["users", "attachments-pool"]
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
    missingDirectories: string[]
    message: string
  }> {
    const requiredDirs = ["rules", "skills", "prompts", "users", "attachments-pool"]
    const missingDirectories: string[] = []

    for (const dir of requiredDirs) {
      const dirPath = path.join(localPath, dir)
      const exists = await pathExists(dirPath)
      if (!exists) {
        missingDirectories.push(dir)
      }
    }

    const isValid = missingDirectories.length === 0

    let message: string
    if (isValid) {
      message = "目录结构验证通过。"
    } else if (missingDirectories.length === requiredDirs.length) {
      message = `该目录不是有效的 Synapse 仓库，缺少必要的目录结构（rules, skills, users, attachments-pool）。`
    } else {
      message = `该目录缺少以下必要目录：${missingDirectories.join(", ")}`
    }

    return {
      isValid,
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
