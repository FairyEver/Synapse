import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { access, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseContentType,
  SynapseContentWriteResult,
  SynapseCreateRulePayload,
  SynapseCreateSkillFilePayload,
  SynapseCreateSkillPayload,
  SynapseRuleMeta,
  SynapseSkillMeta,
} from "../../src/types/content"
import { configStore } from "./config-store"
import { createMainLogger } from "./log-store"
import { repositoryStore } from "./repository-store"

const CONTENT_META_FILE_NAME = "meta.json"
const CONTENT_MAIN_FILE_NAME = "main.md"
const logger = createMainLogger("service.content-create")

type ActiveRepositoryWriteContext = {
  author: string
  gitUser: string
  repository: SynapseRepositoryConfig
}

type SkillAttachmentWriteTarget = {
  relativePath: string
  size: number
  bytes: Uint8Array
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0
}

function isPathInsideDirectory(rootPath: string, targetPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath)

  return relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

function formatCompactTimestamp(date = new Date()): string {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ]

  return parts.join("")
}

function createContentId(date = new Date()): string {
  return `${randomUUID()}_${formatCompactTimestamp(date)}`
}

function normalizeMarkdownContent(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`
}

function assertRequiredCreateFields(
  payload: SynapseCreateRulePayload | SynapseCreateSkillPayload,
): void {
  const requiredFields = [
    payload.title,
    payload.description,
    payload.category,
    payload.icon,
    payload.iconBg,
    payload.content,
  ]

  if (requiredFields.some((value) => !isNonEmptyString(value))) {
    throw new Error("创建内容缺少必要字段，请先补全表单。")
  }
}

function resolveContentRootPath(
  repository: SynapseRepositoryConfig,
  contentType: SynapseContentType,
): string {
  const repositoryRootPath = path.resolve(repository.localPath)
  const configuredRoot = contentType === "rule" ? repository.rulesDir : repository.skillsDir
  const contentRootPath = path.resolve(repositoryRootPath, configuredRoot)

  if (!isPathInsideDirectory(repositoryRootPath, contentRootPath)) {
    throw new Error("当前仓库的内容目录配置无效，请先到 Settings 检查目录设置。")
  }

  return contentRootPath
}

function normalizeSkillAttachmentPath(relativePath: string): string {
  if (relativePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    throw new Error(`Skill 附件路径无效：${relativePath}`)
  }

  return relativePath
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .join("/")
}

function resolveSkillAttachmentTarget(file: SynapseCreateSkillFilePayload): SkillAttachmentWriteTarget {
  const normalizedRelativePath = normalizeSkillAttachmentPath(file.relativePath)

  if (!isNonEmptyString(normalizedRelativePath)) {
    throw new Error("Skill 附件路径不能为空。")
  }

  if (file.bytes.byteLength !== file.size) {
    throw new Error(`Skill 附件大小校验失败：${file.relativePath}`)
  }

  const segments = normalizedRelativePath.split("/")

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Skill 附件路径无效：${file.relativePath}`)
  }

  if (normalizedRelativePath === CONTENT_META_FILE_NAME || normalizedRelativePath === CONTENT_MAIN_FILE_NAME) {
    throw new Error(`Skill 附件不能覆盖 ${normalizedRelativePath}。`)
  }

  return {
    relativePath: normalizedRelativePath,
    size: file.size,
    bytes: file.bytes,
  }
}

function runGitValue(cwd: string, args: string[]): Promise<string | null> {
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

    childProcess.on("error", reject)

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim() || null)
        return
      }

      const message = stderr.trim() || stdout.trim()
      reject(new Error(message || "Git 命令执行失败。"))
    })
  })
}

async function resolveGitUser(localPath: string): Promise<string> {
  try {
    const gitEmail = await runGitValue(localPath, ["config", "--get", "user.email"])

    if (gitEmail) {
      return gitEmail
    }
  } catch {
    logger.warn("Git user.email is unavailable for content creation.", { localPath })
  }

  try {
    const gitName = await runGitValue(localPath, ["config", "--get", "user.name"])

    if (gitName) {
      return gitName
    }
  } catch {
    logger.warn("Git user.name is unavailable for content creation.", { localPath })
  }

  throw new Error("当前仓库还没有可用的 Git 身份，请先配置 git user.email 或 git user.name。")
}

async function getActiveRepositoryWriteContext(): Promise<ActiveRepositoryWriteContext> {
  const config = await configStore.load()
  const repository = getActiveRepositoryConfig(config)

  if (!repository) {
    throw new Error("当前还没有激活的本地目录。")
  }

  const repositoryState = await repositoryStore.getRepositoryState(repository)

  if (repositoryState.status !== "ready") {
    throw new Error("当前目录不存在，不能写入内容。")
  }

  if (!repositoryState.isGitRepository) {
    throw new Error("当前目录不是 Git 仓库，不能创建内容。")
  }

  const author = config.global.displayName.trim()

  if (!author) {
    throw new Error("请先到 Settings 填写显示昵称，再创建内容。")
  }

  const gitUser = await resolveGitUser(repository.localPath)

  return {
    author,
    gitUser,
    repository,
  }
}

async function stageContentDirectory(
  rootPath: string,
  contentId: string,
  meta: SynapseRuleMeta | SynapseSkillMeta,
  mainContent: string,
  attachments: SkillAttachmentWriteTarget[] = [],
): Promise<void> {
  await mkdir(rootPath, { recursive: true })

  const targetPath = path.join(rootPath, contentId)

  if (await pathExists(targetPath)) {
    throw new Error("生成内容目录时发现同名 ID，请重试。")
  }

  const tempDirectoryPath = await mkdtemp(path.join(rootPath, ".synapse-create-"))

  try {
    await writeFile(
      path.join(tempDirectoryPath, CONTENT_META_FILE_NAME),
      `${JSON.stringify(meta, null, 2)}\n`,
      "utf8",
    )
    await writeFile(
      path.join(tempDirectoryPath, CONTENT_MAIN_FILE_NAME),
      normalizeMarkdownContent(mainContent),
      "utf8",
    )

    for (const attachment of attachments) {
      const attachmentPath = path.join(tempDirectoryPath, ...attachment.relativePath.split("/"))

      if (!isPathInsideDirectory(tempDirectoryPath, attachmentPath)) {
        throw new Error(`Skill 附件路径越界：${attachment.relativePath}`)
      }

      await mkdir(path.dirname(attachmentPath), { recursive: true })
      await writeFile(attachmentPath, attachment.bytes)
    }

    await rename(tempDirectoryPath, targetPath)
  } catch (error) {
    await rm(tempDirectoryPath, { recursive: true, force: true })
    throw error
  }
}

class ContentCreateService {
  async createRule(payload: SynapseCreateRulePayload): Promise<SynapseContentWriteResult> {
    assertRequiredCreateFields(payload)
    const context = await getActiveRepositoryWriteContext()
    const createdAt = new Date().toISOString()
    const id = createContentId()
    const meta: SynapseRuleMeta = {
      id,
      type: "rule",
      title: payload.title.trim(),
      description: payload.description.trim(),
      category: payload.category,
      icon: payload.icon,
      iconBg: payload.iconBg,
      author: context.author,
      gitUser: context.gitUser,
      createdAt,
    }
    const rootPath = resolveContentRootPath(context.repository, "rule")

    logger.info("Creating rule content on disk.", {
      id,
      repositoryUuid: context.repository.uuid,
      rootPath,
    })

    await stageContentDirectory(rootPath, id, meta, payload.content)

    return {
      id,
      type: "rule",
      title: meta.title,
      createdAt,
    }
  }

  async createSkill(payload: SynapseCreateSkillPayload): Promise<SynapseContentWriteResult> {
    assertRequiredCreateFields(payload)
    const context = await getActiveRepositoryWriteContext()
    const createdAt = new Date().toISOString()
    const id = createContentId()
    const rootPath = resolveContentRootPath(context.repository, "skill")
    const seenRelativePaths = new Set<string>()
    const attachments = payload.files.map((file) => {
      const target = resolveSkillAttachmentTarget(file)

      if (seenRelativePaths.has(target.relativePath)) {
        throw new Error(`Skill 附件路径重复：${target.relativePath}`)
      }

      seenRelativePaths.add(target.relativePath)

      return target
    })
    const meta: SynapseSkillMeta = {
      id,
      type: "skill",
      title: payload.title.trim(),
      description: payload.description.trim(),
      category: payload.category,
      icon: payload.icon,
      iconBg: payload.iconBg,
      author: context.author,
      gitUser: context.gitUser,
      createdAt,
      files: attachments.map((file) => file.relativePath),
    }

    logger.info("Creating skill content on disk.", {
      attachmentCount: attachments.length,
      id,
      repositoryUuid: context.repository.uuid,
      rootPath,
    })

    await stageContentDirectory(rootPath, id, meta, payload.content, attachments)

    return {
      id,
      type: "skill",
      title: meta.title,
      createdAt,
    }
  }
}

export const contentCreateService = new ContentCreateService()
