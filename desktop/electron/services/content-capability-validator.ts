import { getAllContentTypeIds, getContentTypeDefinition } from "../../src/config/content-types"
import {
  DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE,
  SYNAPSE_CONTENT_COLOR_OPTIONS,
  SYNAPSE_CONTENT_ICON_OPTION_DATA,
} from "../../src/lib/content-appearance-options"
import {
  assertUniqueContentAttachmentPaths,
  normalizeContentAttachmentPath,
} from "../../src/lib/content-attachments"
import {
  CONTENT_NAME_MAX_LENGTH,
  CONTENT_NAME_PATTERN,
  normalizeContentNameInput,
  validateContentNameInput,
} from "../../src/lib/content-name-input"
import {
  SKILL_NAME_MAX_LENGTH,
  SKILL_NAME_PATTERN,
  normalizeSkillNameInput,
  validateSkillNameInput,
} from "../../src/lib/skill-name-input"
import type {
  SynapseContentIconType,
  SynapseContentType,
  SynapseCreateContentPayload,
  SynapseCreateSkillFilePayload,
  SynapseUpdateContentPayload,
} from "../../src/types/content"
import { ContentCapabilityError } from "./content-capability-errors"
import {
  CONTENT_SKILL_ATTACHMENT_MAX_COUNT,
  CONTENT_SKILL_ATTACHMENT_MAX_SIZE,
  CONTENT_SKILL_ATTACHMENT_TOTAL_MAX_SIZE,
  CONTENT_SKILL_SOURCE_MAX_DEPTH,
  CONTENT_SKILL_SOURCE_MAX_DIRECTORY_COUNT,
} from "./content-skill-attachment-constraints"

type ContentToolParams = Record<string, unknown>

type ContentSkillFileInput = {
  contentBase64?: unknown
  contentText?: unknown
  path?: unknown
}

type ContentTypeDescription = {
  appearance: {
    backgroundColors: typeof SYNAPSE_CONTENT_COLOR_OPTIONS
    defaultBackgroundColor: string
    icons: typeof SYNAPSE_CONTENT_ICON_OPTION_DATA
  }
  constraints: {
    iconImageMaxBytes: number
    skillAttachmentMaxBytes: number
    skillAttachmentMaxCount: number
    skillAttachmentTotalMaxBytes: number
    skillSourceMaxDepth: number
    skillSourceMaxDirectoryCount: number
  }
  types: Array<{
    categories: Array<{
      description: string
      id: string
      label: string
    }>
    id: SynapseContentType
    nameConstraints: {
      allowsDots?: boolean
      description: string
      maxLength?: number
      pattern?: string
      rejectsWindowsReservedNames?: boolean
      required: boolean
    }
    requiresFilesInPayload: boolean
  }>
}

type NormalizedDeleteContentParams = {
  baseHistoryDirname: string
  id: string
  type: SynapseContentType
}

const CONTENT_ICON_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const VALID_ICON_TYPES = new Set<SynapseContentIconType>(["icon", "image"])
const VALID_CONTENT_TYPES = new Set<SynapseContentType>(getAllContentTypeIds())
const SKILL_INLINE_REQUIRED_FIELDS = ["name", "title", "description", "category", "content"] as const
const SKILL_INLINE_FIELDS_TEXT = SKILL_INLINE_REQUIRED_FIELDS.join("/")

const CONTENT_NAME_CONSTRAINTS: Record<SynapseContentType, ContentTypeDescription["types"][number]["nameConstraints"]> = {
  rule: {
    required: true,
    maxLength: CONTENT_NAME_MAX_LENGTH,
    pattern: CONTENT_NAME_PATTERN.source,
    allowsDots: true,
    rejectsWindowsReservedNames: true,
    description: "Rule name: lowercase letters, numbers, hyphens, and dots; max 64 chars; must start and end with a letter or number; Windows reserved names are rejected, including reserved segments before a dot.",
  },
  skill: {
    required: true,
    maxLength: SKILL_NAME_MAX_LENGTH,
    pattern: SKILL_NAME_PATTERN.source,
    allowsDots: false,
    rejectsWindowsReservedNames: true,
    description: "Skill name: lowercase letters, numbers, and hyphens; max 64 chars; must start and end with a letter or number; dots and Windows reserved names are rejected.",
  },
  prompt: {
    required: false,
    description: "Prompts do not use a stable name field; use title, description, category, content, and appearance fields.",
  },
}

function describeContentTypes(contentType?: unknown): ContentTypeDescription {
  const selectedTypes = isNonEmptyString(contentType)
    ? [assertContentType(contentType)]
    : getAllContentTypeIds()

  return {
    types: selectedTypes.map((type) => {
      const definition = getContentTypeDefinition(type)

      return {
        id: type,
        requiresFilesInPayload: definition.requiresFilesInPayload,
        nameConstraints: CONTENT_NAME_CONSTRAINTS[type],
        categories: definition.categories.map((category) => ({
          id: category.id,
          label: category.label,
          description: category.description,
        })),
      }
    }),
    appearance: {
      icons: SYNAPSE_CONTENT_ICON_OPTION_DATA,
      backgroundColors: SYNAPSE_CONTENT_COLOR_OPTIONS,
      defaultBackgroundColor: DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE,
    },
    constraints: {
      iconImageMaxBytes: CONTENT_ICON_IMAGE_MAX_BYTES,
      skillAttachmentMaxBytes: CONTENT_SKILL_ATTACHMENT_MAX_SIZE,
      skillAttachmentMaxCount: CONTENT_SKILL_ATTACHMENT_MAX_COUNT,
      skillAttachmentTotalMaxBytes: CONTENT_SKILL_ATTACHMENT_TOTAL_MAX_SIZE,
      skillSourceMaxDepth: CONTENT_SKILL_SOURCE_MAX_DEPTH,
      skillSourceMaxDirectoryCount: CONTENT_SKILL_SOURCE_MAX_DIRECTORY_COUNT,
    },
  }
}

function normalizeCreateContentParams<T extends SynapseContentType>(
  contentType: T,
  params: ContentToolParams,
): SynapseCreateContentPayload<T> {
  const payload = normalizeContentPayload(contentType, params, false)
  return payload as SynapseCreateContentPayload<T>
}

function normalizeUpdateContentParams<T extends SynapseContentType>(
  contentType: T,
  params: ContentToolParams,
): SynapseUpdateContentPayload<T> {
  assertNoForce(params)
  const payload = normalizeContentPayload(contentType, params, true)
  return payload as SynapseUpdateContentPayload<T>
}

function normalizeDeleteContentParams(
  contentType: SynapseContentType,
  params: ContentToolParams,
): NormalizedDeleteContentParams {
  assertContentType(contentType)
  assertNoForce(params)

  return {
    type: contentType,
    id: requireTrimmedString(params.id, "id"),
    baseHistoryDirname: requireTrimmedString(params.baseHistoryDirname, "baseHistoryDirname"),
  }
}

function assertNoForce(params: ContentToolParams): void {
  if ("force" in params) {
    throwInvalid("force", "MCP 内容发布不支持 force。")
  }
}

function assertSkillInlineFieldsOrSource(
  contentType: SynapseContentType,
  params: ContentToolParams,
  isUpdate: boolean,
): void {
  if (contentType !== "skill" || optionalTrimmedString(params.sourceDirectoryPath)) {
    return
  }

  const missingFields = SKILL_INLINE_REQUIRED_FIELDS.filter((field) => !optionalTrimmedString(params[field]))
  if (missingFields.length === 0) {
    return
  }

  const message = `${isUpdate ? "更新" : "创建"} Skill 请提供完整字段 ${SKILL_INLINE_FIELDS_TEXT}，或提供 sourceDirectoryPath。`
  throw new ContentCapabilityError("CONTENT_INVALID_INPUT", message, {
    fields: Object.fromEntries(missingFields.map((field) => [field, message])),
  })
}

function normalizeContentPayload(
  contentType: SynapseContentType,
  params: ContentToolParams,
  isUpdate: boolean,
): SynapseCreateContentPayload | SynapseUpdateContentPayload {
  assertContentType(contentType)
  assertSkillInlineFieldsOrSource(contentType, params, isUpdate)

  const basePayload = {
    ...(isUpdate ? {
      id: requireTrimmedString(params.id, "id"),
      baseHistoryDirname: requireTrimmedString(params.baseHistoryDirname, "baseHistoryDirname"),
    } : {}),
    title: requireTrimmedString(params.title, "title"),
    usage: optionalTrimmedString(params.usage),
    description: requireTrimmedString(params.description, "description"),
    category: normalizeCategory(contentType, params.category),
    content: requireTrimmedString(params.content, "content"),
    ...normalizeIconFields(params, isUpdate),
  }

  if (contentType === "prompt") {
    return basePayload as SynapseCreateContentPayload | SynapseUpdateContentPayload
  }

  const namedPayload = {
    ...basePayload,
    name: normalizeName(contentType, params.name),
  }

  if (contentType === "rule") {
    return namedPayload as SynapseCreateContentPayload | SynapseUpdateContentPayload
  }

  return {
    ...namedPayload,
    files: normalizeSkillFiles(params),
  } as SynapseCreateContentPayload | SynapseUpdateContentPayload
}

function normalizeIconFields(params: ContentToolParams, isUpdate: boolean): {
  icon: string
  iconBg: string
  iconImage: string
  iconType: SynapseContentIconType
} {
  const rawIconType = optionalTrimmedString(params.iconType) || "icon"

  if (!VALID_ICON_TYPES.has(rawIconType as SynapseContentIconType)) {
    throwInvalid("iconType", "iconType 必须是 icon 或 image。")
  }

  const iconType = rawIconType as SynapseContentIconType
  const iconImagePath = optionalTrimmedString(params.iconImagePath)
  const iconImageBase64 = optionalTrimmedString(params.iconImageBase64)

  if (iconImagePath && iconImageBase64) {
    throwInvalid("iconImage", "iconImagePath 和 iconImageBase64 只能提供一个。")
  }

  if (iconType === "image") {
    if (!iconImagePath && !iconImageBase64) {
      const iconImage = optionalTrimmedString(params.iconImage)
      if (isUpdate && iconImage === "icon.png") {
        return {
          iconType,
          icon: "",
          iconBg: "",
          iconImage,
        }
      }
      throwInvalid("iconImage", "使用图片背景时必须提供 iconImagePath 或 iconImageBase64。")
    }
    if (iconImageBase64) {
      validateBase64Size(iconImageBase64, CONTENT_ICON_IMAGE_MAX_BYTES, "iconImageBase64")
    }

    return {
      iconType,
      icon: "",
      iconBg: "",
      iconImage: "icon.png",
    }
  }

  if (iconImagePath || iconImageBase64) {
    throwInvalid("iconImage", "iconType 为 icon 时不能提供图片。")
  }

  const icon = requireTrimmedString(params.icon, "icon")
  const iconBg = optionalTrimmedString(params.iconBg) || DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE

  if (!SYNAPSE_CONTENT_ICON_OPTION_DATA.some((option) => option.value === icon)) {
    throwInvalid("icon", `不支持的图标：${icon}`)
  }
  if (!SYNAPSE_CONTENT_COLOR_OPTIONS.some((option) => option.value === iconBg)) {
    throwInvalid("iconBg", `不支持的背景颜色：${iconBg}`)
  }

  return {
    iconType,
    icon,
    iconBg,
    iconImage: "",
  }
}

function normalizeSkillFiles(params: ContentToolParams): SynapseCreateSkillFilePayload[] {
  const files = Array.isArray(params.files) ? params.files : []
  const sourceDirectoryPath = optionalTrimmedString(params.sourceDirectoryPath)

  if (files.length > 0 && sourceDirectoryPath) {
    throwInvalid("files", "files 和 sourceDirectoryPath 只能提供一个。")
  }

  if (files.length === 0) {
    return []
  }

  if (files.length > CONTENT_SKILL_ATTACHMENT_MAX_COUNT) {
    throwInvalid("files", `附件最多 ${CONTENT_SKILL_ATTACHMENT_MAX_COUNT} 个。`)
  }

  const normalizedPaths = files.map((file) => {
    if (!isObjectRecord(file)) {
      throwInvalid("files", "每个附件都必须是对象。")
    }
    return normalizeSkillFilePath(file.path)
  })
  assertUniqueAttachmentPaths(normalizedPaths)

  let totalSize = 0
  const normalizedFiles = files.map((file, index) => {
    if (!isObjectRecord(file)) {
      throwInvalid("files", "每个附件都必须是对象。")
    }

    const bytes = normalizeSkillFileBytes(file as ContentSkillFileInput, index)
    const originalName = normalizedPaths[index] ?? ""
    totalSize += bytes.byteLength

    if (bytes.byteLength > CONTENT_SKILL_ATTACHMENT_MAX_SIZE) {
      throwInvalid("files", `附件 ${originalName} 超过大小限制。`)
    }

    return {
      originalName,
      size: bytes.byteLength,
      bytes,
    }
  })

  if (totalSize > CONTENT_SKILL_ATTACHMENT_TOTAL_MAX_SIZE) {
    throwInvalid("files", "附件总大小超过限制。")
  }

  return normalizedFiles
}

function normalizeSkillFilePath(value: unknown): string {
  const rawPath = requireTrimmedString(value, "files.path")
  const normalizedPath = normalizeContentAttachmentPath(rawPath)

  if (!normalizedPath) {
    throwInvalid("files.path", "附件路径不能为空。")
  }

  return normalizedPath
}

function normalizeSkillFileBytes(file: ContentSkillFileInput, index: number): Uint8Array {
  const contentText = typeof file.contentText === "string" ? file.contentText : undefined
  const contentBase64 = typeof file.contentBase64 === "string" ? file.contentBase64.trim() : undefined

  if (contentText !== undefined && contentBase64) {
    throwInvalid("files", `附件 ${index + 1} 的 contentText 和 contentBase64 只能提供一个。`)
  }

  if (contentText !== undefined) {
    return Buffer.from(contentText, "utf8")
  }

  if (contentBase64) {
    return decodeBase64(contentBase64, `files.${index}.contentBase64`)
  }

  return new Uint8Array()
}

function normalizeCategory(contentType: SynapseContentType, value: unknown): string {
  const category = requireTrimmedString(value, "category")
  const definition = getContentTypeDefinition(contentType)

  if (!definition.categories.some((item) => item.id === category)) {
    throwInvalid("category", `不支持的分类：${category}`)
  }

  return category
}

function normalizeName(contentType: Exclude<SynapseContentType, "prompt">, value: unknown): string {
  const rawName = requireTrimmedString(value, "name")
  const name = contentType === "skill"
    ? normalizeSkillNameInput(rawName)
    : normalizeContentNameInput(rawName)
  const error = contentType === "skill"
    ? validateSkillNameInput(name)
    : validateContentNameInput(name)

  if (error) {
    throwInvalid("name", error)
  }

  return name
}

function assertContentType(value: unknown): SynapseContentType {
  if (!isNonEmptyString(value) || !VALID_CONTENT_TYPES.has(value as SynapseContentType)) {
    throw new ContentCapabilityError("CONTENT_INVALID_INPUT", "不支持的内容类型。", {
      fields: { contentType: "不支持的内容类型。" },
    })
  }

  return value as SynapseContentType
}

function assertUniqueAttachmentPaths(paths: string[]): void {
  try {
    assertUniqueContentAttachmentPaths(paths)
  } catch (error) {
    throw new ContentCapabilityError("CONTENT_INVALID_INPUT", getErrorMessage(error), {
      fields: { files: getErrorMessage(error) },
      cause: error,
    })
  }
}

function validateBase64Size(value: string, maxBytes: number, field: string): void {
  const bytes = decodeBase64(value, field)

  if (bytes.byteLength > maxBytes) {
    throwInvalid(field, `${field} 超过大小限制。`)
  }
}

function decodeBase64(value: string, field: string): Uint8Array {
  if (!isValidBase64(value)) {
    throwInvalid(field, `${field} 不是有效的 base64。`)
  }

  try {
    return Buffer.from(value, "base64")
  } catch (error) {
    throw new ContentCapabilityError("CONTENT_INVALID_INPUT", `${field} 不是有效的 base64。`, {
      fields: { [field]: `${field} 不是有效的 base64。` },
      cause: error,
    })
  }
}

function isValidBase64(value: string): boolean {
  if (!value || value.length % 4 === 1) {
    return false
  }

  return /^[A-Za-z0-9+/]+={0,2}$/u.test(value)
}

function requireTrimmedString(value: unknown, field: string): string {
  const text = optionalTrimmedString(value)

  if (!text) {
    throwInvalid(field, `${field} 不能为空。`)
  }

  return text
}

function optionalTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function throwInvalid(field: string, message: string): never {
  throw new ContentCapabilityError("CONTENT_INVALID_INPUT", message, {
    fields: { [field]: message },
  })
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export {
  CONTENT_ICON_IMAGE_MAX_BYTES,
  describeContentTypes,
  normalizeCreateContentParams,
  normalizeDeleteContentParams,
  normalizeUpdateContentParams,
  type ContentToolParams,
  type ContentTypeDescription,
  type NormalizedDeleteContentParams,
}
