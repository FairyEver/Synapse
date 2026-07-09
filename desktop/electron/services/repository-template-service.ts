import { app } from "electron"
import type { Dirent } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { isFileNotFoundError, pathExists } from "./fs-utils"
import { getContentTypeDefinition } from "../../src/config/content-types"
import type { SynapseContentType } from "../../src/types/content"

type RepositorySeedAttachment = {
  bytes: Uint8Array
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
  usage?: string
}

type RepositoryTemplateMeta = Omit<RepositorySeedContent, "attachments" | "content" | "type">

function getTemplateRootPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "templates")
  }

  return path.join(app.getAppPath(), "resources", "templates")
}

function assertStringField(
  value: unknown,
  fieldName: keyof RepositoryTemplateMeta,
  templateDirectoryPath: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`模板 ${templateDirectoryPath} 的 ${fieldName} 必须是非空字符串。`)
  }

  return value
}

function parseTemplateMeta(
  raw: unknown,
  type: SynapseContentType,
  templateDirectoryPath: string,
): RepositoryTemplateMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`模板 ${templateDirectoryPath} 的 meta.json 必须是对象。`)
  }

  const record = raw as Record<string, unknown>
  const name = record.name

  if (name != null && (typeof name !== "string" || !name.trim())) {
    throw new Error(`模板 ${templateDirectoryPath} 的 name 必须是非空字符串。`)
  }

  if ((type === "rule" || type === "skill") && typeof name !== "string") {
    throw new Error(`模板 ${templateDirectoryPath} 缺少 name。`)
  }

  const usage = record.usage

  if (usage != null && (typeof usage !== "string" || !usage.trim())) {
    throw new Error(`模板 ${templateDirectoryPath} 的 usage 必须是非空字符串。`)
  }

  const category = assertStringField(record.category, "category", templateDirectoryPath)
  const categoryExists = getContentTypeDefinition(type).categories.some((item) => item.id === category)

  if (!categoryExists) {
    throw new Error(`模板 ${templateDirectoryPath} 的 category "${category}" 不存在于 ${type} 分类定义中。`)
  }

  return {
    id: assertStringField(record.id, "id", templateDirectoryPath),
    ...(typeof name === "string" ? { name } : {}),
    title: assertStringField(record.title, "title", templateDirectoryPath),
    ...(typeof usage === "string" ? { usage } : {}),
    description: assertStringField(record.description, "description", templateDirectoryPath),
    category,
    icon: assertStringField(record.icon, "icon", templateDirectoryPath),
    iconBg: assertStringField(record.iconBg, "iconBg", templateDirectoryPath),
  }
}

async function listTemplateDirectories(rootPath: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(rootPath, { withFileTypes: true })
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return []
    }
    throw error
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

async function collectTemplateAttachments(
  attachmentsDirectoryPath: string,
  relativePrefix = "",
): Promise<RepositorySeedAttachment[]> {
  const entries = await readdir(attachmentsDirectoryPath, { withFileTypes: true })
  const attachments: RepositorySeedAttachment[] = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryRelativePath = relativePrefix
      ? path.posix.join(relativePrefix, entry.name)
      : entry.name
    const entryPath = path.join(attachmentsDirectoryPath, entry.name)

    if (entry.isDirectory()) {
      attachments.push(...await collectTemplateAttachments(entryPath, entryRelativePath))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    attachments.push({
      originalName: entryRelativePath,
      bytes: await readFile(entryPath),
    })
  }

  return attachments
}

async function readSeedContent(
  type: SynapseContentType,
  templateRootPath: string,
  templateDirectoryName: string,
): Promise<RepositorySeedContent> {
  const templateDirectoryPath = path.join(
    templateRootPath,
    getContentTypeDefinition(type).repositoryDir.defaultDirectoryName,
    templateDirectoryName,
  )
  const [metaRaw, content] = await Promise.all([
    readFile(path.join(templateDirectoryPath, "meta.json"), "utf8"),
    readFile(path.join(templateDirectoryPath, "content.md"), "utf8"),
  ])
  const attachmentsDirectoryPath = path.join(templateDirectoryPath, "files")
  const attachments = await pathExists(attachmentsDirectoryPath)
    ? await collectTemplateAttachments(attachmentsDirectoryPath)
    : []
  const meta = parseTemplateMeta(JSON.parse(metaRaw), type, templateDirectoryPath)

  return {
    ...meta,
    type,
    content,
    ...(attachments.length > 0 ? { attachments } : {}),
  }
}

function validateSeedUniqueness(seeds: readonly RepositorySeedContent[]): void {
  const usedIds = new Map<string, SynapseContentType>()
  const usedNames = new Map<string, SynapseContentType>()

  for (const seed of seeds) {
    const existingIdType = usedIds.get(seed.id)

    if (existingIdType) {
      throw new Error(`模板内容 id "${seed.id}" 重复，涉及 ${existingIdType} 与 ${seed.type}。`)
    }

    usedIds.set(seed.id, seed.type)

    if (seed.name == null) {
      continue
    }

    const existingNameType = usedNames.get(seed.name)

    if (existingNameType) {
      throw new Error(`模板内容 name "${seed.name}" 重复，涉及 ${existingNameType} 与 ${seed.type}。`)
    }

    usedNames.set(seed.name, seed.type)
  }
}

async function readRepositorySeedContents(): Promise<RepositorySeedContent[]> {
  const seeds: RepositorySeedContent[] = []
  const templateRootPath = getTemplateRootPath()

  for (const type of ["rule", "skill", "prompt"] as const) {
    const typeRootPath = path.join(
      templateRootPath,
      getContentTypeDefinition(type).repositoryDir.defaultDirectoryName,
    )
    const templateDirectoryNames = await listTemplateDirectories(typeRootPath)

    for (const templateDirectoryName of templateDirectoryNames) {
      seeds.push(await readSeedContent(type, templateRootPath, templateDirectoryName))
    }
  }

  validateSeedUniqueness(seeds)

  return seeds
}

export {
  readRepositorySeedContents,
  type RepositorySeedAttachment,
  type RepositorySeedContent,
}
