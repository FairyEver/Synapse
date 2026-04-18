import { isUtf8 } from "node:buffer"
import { access, readdir, readFile } from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import { getActiveRepositoryConfig } from "../../src/lib/config"
import type { SynapseRepositoryConfig } from "../../src/types/config"
import type {
  SynapseContentFile,
  SynapseContentType,
  SynapseRuleMeta,
  SynapseSkillMeta,
  SynapseTextContentFile,
} from "../../src/types/content"
import { configStore } from "./config-store"
import { createMainLogger } from "./log-store"

const CONTENT_META_FILE_NAME = "meta.json"
const CONTENT_MAIN_FILE_NAME = "main.md"
const logger = createMainLogger("service.content")

type ActiveRepositoryContext = {
  repository: SynapseRepositoryConfig
  rootPath: string
}

type ParsedMetaBase = Omit<SynapseRuleMeta, "type">

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function getRequiredString(
  record: Record<string, unknown>,
  fieldName: string,
): string | null {
  const value = record[fieldName]

  return isNonEmptyString(value) ? value.trim() : null
}

function compareEntriesByName(left: Dirent, right: Dirent): number {
  return left.name.localeCompare(right.name)
}

function compareRelativePaths(left: string, right: string): number {
  if (left === CONTENT_MAIN_FILE_NAME) {
    return -1
  }

  if (right === CONTENT_MAIN_FILE_NAME) {
    return 1
  }

  const nameCompare = path.basename(left).localeCompare(path.basename(right))

  if (nameCompare !== 0) {
    return nameCompare
  }

  return left.localeCompare(right)
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true })

    return entries.sort(compareEntriesByName)
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return []
    }

    logger.warn("Failed to read content directory.", {
      directoryPath,
      error,
    })

    return []
  }
}

function parseMetaBase(
  rawMeta: unknown,
  expectedType: SynapseContentType,
  directoryPath: string,
): ParsedMetaBase | null {
  if (!isRecord(rawMeta)) {
    logger.warn("Skipping content item because meta.json is not an object.", {
      directoryPath,
      expectedType,
    })
    return null
  }

  const requiredFields = [
    "id",
    "type",
    "title",
    "description",
    "category",
    "icon",
    "iconBg",
    "author",
    "gitUser",
    "createdAt",
  ] as const
  const missingFields = requiredFields.filter((field) => !isNonEmptyString(rawMeta[field]))

  if (missingFields.length > 0) {
    logger.warn("Skipping content item because meta.json is missing required fields.", {
      directoryPath,
      expectedType,
      missingFields,
    })
    return null
  }

  const id = getRequiredString(rawMeta, "id")
  const type = getRequiredString(rawMeta, "type")
  const title = getRequiredString(rawMeta, "title")
  const description = getRequiredString(rawMeta, "description")
  const category = getRequiredString(rawMeta, "category")
  const icon = getRequiredString(rawMeta, "icon")
  const iconBg = getRequiredString(rawMeta, "iconBg")
  const author = getRequiredString(rawMeta, "author")
  const gitUser = getRequiredString(rawMeta, "gitUser")
  const createdAt = getRequiredString(rawMeta, "createdAt")

  if (
    !id
    || !type
    || !title
    || !description
    || !category
    || !icon
    || !iconBg
    || !author
    || !gitUser
    || !createdAt
  ) {
    logger.warn("Skipping content item because meta.json could not be normalized.", {
      directoryPath,
      expectedType,
    })
    return null
  }

  if (type !== expectedType) {
    logger.warn("Skipping content item because meta.json has an unexpected type.", {
      directoryPath,
      expectedType,
      receivedType: type,
    })
    return null
  }

  return {
    id,
    title,
    description,
    category,
    icon,
    iconBg,
    author,
    gitUser,
    createdAt,
  }
}

function createTextFile(relativePath: string, content: string): SynapseTextContentFile {
  return {
    relativePath,
    name: path.basename(relativePath),
    size: Buffer.byteLength(content),
    kind: "text",
    content,
  }
}

function looksBinaryFile(fileBuffer: Buffer): boolean {
  if (fileBuffer.length === 0) {
    return false
  }

  if (fileBuffer.includes(0)) {
    return true
  }

  return !isUtf8(fileBuffer)
}

async function collectRelativeFilePaths(rootPath: string, currentPath = rootPath): Promise<string[]> {
  const entries = await readDirectoryEntries(currentPath)
  const relativePaths: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name)

    if (entry.isDirectory()) {
      relativePaths.push(...(await collectRelativeFilePaths(rootPath, entryPath)))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    relativePaths.push(path.relative(rootPath, entryPath))
  }

  return relativePaths
}

async function readContentMeta(
  directoryPath: string,
  expectedType: SynapseContentType,
): Promise<ParsedMetaBase | null> {
  const metaPath = path.join(directoryPath, CONTENT_META_FILE_NAME)

  try {
    const rawMeta = JSON.parse(await readFile(metaPath, "utf8")) as unknown

    return parseMetaBase(rawMeta, expectedType, directoryPath)
  } catch (error) {
    if (isFileNotFoundError(error)) {
      logger.warn("Skipping content item because meta.json is missing.", {
        directoryPath,
        expectedType,
      })
      return null
    }

    if (error instanceof SyntaxError) {
      logger.warn("Skipping content item because meta.json cannot be parsed.", {
        directoryPath,
        expectedType,
        error: error.message,
      })
      return null
    }

    logger.warn("Skipping content item because meta.json could not be read.", {
      directoryPath,
      expectedType,
      error,
    })
    return null
  }
}

async function ensureMainFileExists(
  directoryPath: string,
  expectedType: SynapseContentType,
): Promise<boolean> {
  const mainFilePath = path.join(directoryPath, CONTENT_MAIN_FILE_NAME)
  const exists = await pathExists(mainFilePath)

  if (!exists) {
    logger.warn("Skipping content item because main.md is missing.", {
      directoryPath,
      expectedType,
    })
  }

  return exists
}

async function getActiveRepositoryContext(
  contentType: SynapseContentType,
): Promise<ActiveRepositoryContext | null> {
  const config = await configStore.load()
  const repository = getActiveRepositoryConfig(config)

  if (!repository) {
    return null
  }

  return {
    repository,
    rootPath: path.join(
      repository.localPath,
      contentType === "rule" ? repository.rulesDir : repository.skillsDir,
    ),
  }
}

async function resolveContentDirectory(
  repository: SynapseRepositoryConfig,
  contentType: SynapseContentType,
  contentId: string,
): Promise<string | null> {
  const rootPath = path.join(
    repository.localPath,
    contentType === "rule" ? repository.rulesDir : repository.skillsDir,
  )
  const directPath = path.join(rootPath, contentId)

  if (await pathExists(directPath)) {
    return directPath
  }

  const entries = await readDirectoryEntries(rootPath)

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const directoryPath = path.join(rootPath, entry.name)
    const meta = await readContentMeta(directoryPath, contentType)

    if (meta?.id === contentId) {
      return directoryPath
    }
  }

  return null
}

async function readTextFileFromDirectory(
  directoryPath: string,
  relativePath: string,
): Promise<SynapseTextContentFile> {
  const filePath = path.join(directoryPath, relativePath)
  const content = await readFile(filePath, "utf8")

  return createTextFile(relativePath, content)
}

async function readSkillContentFiles(directoryPath: string): Promise<SynapseContentFile[]> {
  const relativePaths = (await collectRelativeFilePaths(directoryPath))
    .filter((relativePath) => relativePath !== CONTENT_META_FILE_NAME)
    .sort(compareRelativePaths)
  const files: SynapseContentFile[] = []

  for (const relativePath of relativePaths) {
    const filePath = path.join(directoryPath, relativePath)

    try {
      const fileBuffer = await readFile(filePath)
      const baseFile = {
        relativePath,
        name: path.basename(relativePath),
        size: fileBuffer.byteLength,
      }

      if (looksBinaryFile(fileBuffer)) {
        files.push({
          ...baseFile,
          kind: "binary",
        })
        continue
      }

      files.push({
        ...baseFile,
        kind: "text",
        content: fileBuffer.toString("utf8"),
      })
    } catch (error) {
      logger.warn("Skipping unreadable skill file during preview scan.", {
        directoryPath,
        relativePath,
        error,
      })
    }
  }

  return files
}

class ContentService {
  async getRules(): Promise<SynapseRuleMeta[]> {
    const context = await getActiveRepositoryContext("rule")

    if (!context) {
      return []
    }

    const entries = await readDirectoryEntries(context.rootPath)
    const rules: SynapseRuleMeta[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const directoryPath = path.join(context.rootPath, entry.name)
      const meta = await readContentMeta(directoryPath, "rule")

      if (!meta) {
        continue
      }

      if (!(await ensureMainFileExists(directoryPath, "rule"))) {
        continue
      }

      if (meta.id !== entry.name) {
        logger.warn("Rule meta id does not match its directory name.", {
          directoryPath,
          directoryName: entry.name,
          metaId: meta.id,
        })
      }

      rules.push({
        ...meta,
        type: "rule",
      })
    }

    return rules
  }

  async getSkills(): Promise<SynapseSkillMeta[]> {
    const context = await getActiveRepositoryContext("skill")

    if (!context) {
      return []
    }

    const entries = await readDirectoryEntries(context.rootPath)
    const skills: SynapseSkillMeta[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      const directoryPath = path.join(context.rootPath, entry.name)
      const meta = await readContentMeta(directoryPath, "skill")

      if (!meta) {
        continue
      }

      if (!(await ensureMainFileExists(directoryPath, "skill"))) {
        continue
      }

      if (meta.id !== entry.name) {
        logger.warn("Skill meta id does not match its directory name.", {
          directoryPath,
          directoryName: entry.name,
          metaId: meta.id,
        })
      }

      const files = (await collectRelativeFilePaths(directoryPath))
        .filter(
          (relativePath) =>
            relativePath !== CONTENT_META_FILE_NAME && relativePath !== CONTENT_MAIN_FILE_NAME,
        )
        .sort(compareRelativePaths)

      skills.push({
        ...meta,
        type: "skill",
        files,
      })
    }

    return skills
  }

  async getRuleContent(ruleId: string): Promise<SynapseTextContentFile> {
    const context = await getActiveRepositoryContext("rule")

    if (!context) {
      throw new Error("当前还没有激活的本地目录。")
    }

    const directoryPath = await resolveContentDirectory(context.repository, "rule", ruleId)

    if (!directoryPath) {
      throw new Error("找不到对应的 Rule 内容。")
    }

    return readTextFileFromDirectory(directoryPath, CONTENT_MAIN_FILE_NAME)
  }

  async getSkillContent(skillId: string): Promise<SynapseTextContentFile> {
    const context = await getActiveRepositoryContext("skill")

    if (!context) {
      throw new Error("当前还没有激活的本地目录。")
    }

    const directoryPath = await resolveContentDirectory(context.repository, "skill", skillId)

    if (!directoryPath) {
      throw new Error("找不到对应的 Skill 内容。")
    }

    return readTextFileFromDirectory(directoryPath, CONTENT_MAIN_FILE_NAME)
  }

  async getSkillFiles(skillId: string): Promise<SynapseContentFile[]> {
    const context = await getActiveRepositoryContext("skill")

    if (!context) {
      throw new Error("当前还没有激活的本地目录。")
    }

    const directoryPath = await resolveContentDirectory(context.repository, "skill", skillId)

    if (!directoryPath) {
      throw new Error("找不到对应的 Skill 内容。")
    }

    return readSkillContentFiles(directoryPath)
  }
}

export const contentService = new ContentService()
