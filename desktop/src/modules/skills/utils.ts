import type {
  CreateSkillPayload,
  SkillCreateFilePayloadDraft,
  SkillCreateFieldErrors,
} from "@/modules/skills/types"
import { normalizeContentAttachmentPath } from "@/lib/content-attachments"
import { normalizePathForCompare } from "@/lib/path-compare"
import { normalizeSkillNameInput, validateSkillNameInput } from "@/lib/skill-name-input"
import type { SynapseCreateSkillFilePayload } from "@/types/content"
import {
  createEmptyContentPayload,
  normalizeContentPayload,
  validateContentPayload,
} from "@/modules/content/lib/content-payload"

const MAX_SKILL_ATTACHMENT_SIZE = 10 * 1024 * 1024
const MAX_SKILL_ATTACHMENT_COUNT = 100
const MAX_SKILL_ATTACHMENT_TOTAL_SIZE = 50 * 1024 * 1024

const SKILL_CONFIG = {
  labels: {
    title: "请输入中文名称。",
    description: "请输入简介。",
    content: "请输入主说明。",
  },
}

function appendErrorMessage(current: string | undefined, next: string): string {
  return current ? `${current} ${next}` : next
}

function formatAttachmentList(paths: string[]): string {
  if (paths.length <= 3) {
    return paths.join("、")
  }

  return `${paths.slice(0, 3).join("、")} 等 ${paths.length} 项`
}

function normalizeSkillAttachmentName(originalName: string): string {
  return normalizeContentAttachmentPath(originalName)
}

function normalizeSkillAttachmentCompareKey(originalName: string): string {
  return normalizePathForCompare(originalName, { platform: "win32" })
}

function createSkillFileDraftsFromFiles(
  files: Iterable<File>,
  limit = MAX_SKILL_ATTACHMENT_COUNT + 1,
): SkillCreateFilePayloadDraft[] {
  const drafts: SkillCreateFilePayloadDraft[] = []
  const iterator = files[Symbol.iterator]()
  while (drafts.length < limit) {
    const next = iterator.next()
    if (next.done) break
    const file = next.value
    drafts.push({
      originalName: normalizeSkillAttachmentName(file.webkitRelativePath || file.name),
      size: file.size,
      file,
    })
  }
  return drafts
}

function normalizeCreateSkillFilePayload(
  file: SkillCreateFilePayloadDraft,
): SkillCreateFilePayloadDraft {
  return {
    ...file,
    originalName: normalizeSkillAttachmentName(file.originalName),
    size: file.size,
  }
}

function compareCreateSkillFiles(
  left: SkillCreateFilePayloadDraft,
  right: SkillCreateFilePayloadDraft,
): number {
  return left.originalName.localeCompare(right.originalName, "zh-CN")
}

function createEmptySkillPayload(): CreateSkillPayload {
  return createEmptyContentPayload<CreateSkillPayload>({
    name: "",
    files: [],
  })
}

function normalizeCreateSkillPayload(payload: CreateSkillPayload): CreateSkillPayload {
  const base = normalizeContentPayload(payload)
  return {
    ...base,
    name: normalizeSkillNameInput(payload.name),
    files: payload.files
      .map((file) => normalizeCreateSkillFilePayload(file))
      .sort(compareCreateSkillFiles),
  }
}

function validateCreateSkillPayload(payload: CreateSkillPayload): SkillCreateFieldErrors {
  const baseErrors = validateContentPayload(payload, SKILL_CONFIG)
  const errors: SkillCreateFieldErrors = baseErrors
  const normalizedPayload = normalizeCreateSkillPayload(payload)
  const seenOriginalNames = new Set<string>()
  const duplicatedNames: string[] = []
  const oversizedNames: string[] = []

  const nameError = validateSkillNameInput(normalizedPayload.name)
  if (nameError) {
    errors.name = nameError
  }

  for (const file of normalizedPayload.files) {
    if (!file.originalName) {
      errors.files = appendErrorMessage(errors.files, "附件文件名不能为空。")
      continue
    }

    const compareKey = normalizeSkillAttachmentCompareKey(file.originalName)
    if (seenOriginalNames.has(compareKey)) {
      duplicatedNames.push(file.originalName)
      continue
    }

    seenOriginalNames.add(compareKey)

    if (file.size > MAX_SKILL_ATTACHMENT_SIZE) {
      oversizedNames.push(file.originalName)
    }
  }

  if (duplicatedNames.length > 0) {
    errors.files = appendErrorMessage(
      errors.files,
      `附件文件名重复：${formatAttachmentList(duplicatedNames)}。`,
    )
  }

  if (oversizedNames.length > 0) {
    errors.files = appendErrorMessage(
      errors.files,
      `以下附件超过 10MB：${formatAttachmentList(oversizedNames)}。`,
    )
  }

  return errors
}

function formatSkillAttachmentSize(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function mergeCreateSkillFiles(
  currentFiles: SkillCreateFilePayloadDraft[],
  incomingFiles: SkillCreateFilePayloadDraft[],
): { files: SkillCreateFilePayloadDraft[]; rejectedMessages: string[] } {
  const normalizedCurrentFiles = currentFiles.map((file) => normalizeCreateSkillFilePayload(file))
  const nextFilesByPath = new Map(
    normalizedCurrentFiles.map((file) => [normalizeSkillAttachmentCompareKey(file.originalName), file] as const),
  )
  const duplicateNames: string[] = []
  const oversizedNames: string[] = []
  const invalidNames: string[] = []
  let countLimitReached = false
  let totalSizeLimitReached = false

  for (const incomingFile of incomingFiles) {
    const normalizedFile = normalizeCreateSkillFilePayload(incomingFile)

    if (!normalizedFile.originalName) {
      invalidNames.push(incomingFile.file?.name || "未命名文件")
      continue
    }

    if (normalizedFile.size > MAX_SKILL_ATTACHMENT_SIZE) {
      oversizedNames.push(normalizedFile.originalName)
      continue
    }

    const compareKey = normalizeSkillAttachmentCompareKey(normalizedFile.originalName)
    if (nextFilesByPath.has(compareKey)) {
      duplicateNames.push(normalizedFile.originalName)
      continue
    }

    if (nextFilesByPath.size >= MAX_SKILL_ATTACHMENT_COUNT) {
      countLimitReached = true
      break
    }

    const currentTotalSize = Array.from(nextFilesByPath.values()).reduce((sum, f) => sum + f.size, 0)
    if (currentTotalSize + normalizedFile.size > MAX_SKILL_ATTACHMENT_TOTAL_SIZE) {
      totalSizeLimitReached = true
      break
    }

    nextFilesByPath.set(compareKey, normalizedFile)
  }

  const rejectedMessages: string[] = []

  if (invalidNames.length > 0) {
    rejectedMessages.push(`以下附件缺少有效文件名，已跳过：${formatAttachmentList(invalidNames)}。`)
  }

  if (duplicateNames.length > 0) {
    rejectedMessages.push(`以下附件文件名重复，已跳过：${formatAttachmentList(duplicateNames)}。`)
  }

  if (oversizedNames.length > 0) {
    rejectedMessages.push(`以下附件超过 10MB，已跳过：${formatAttachmentList(oversizedNames)}。`)
  }

  if (countLimitReached) {
    rejectedMessages.push(`附件数量已达上限（${MAX_SKILL_ATTACHMENT_COUNT} 个），多余文件已跳过。`)
  }

  if (totalSizeLimitReached) {
    rejectedMessages.push(`附件总大小已达上限（50MB），多余文件已跳过。`)
  }

  return {
    files: Array.from(nextFilesByPath.values()).sort(compareCreateSkillFiles),
    rejectedMessages,
  }
}

async function serializeCreateSkillFiles(
  files: SkillCreateFilePayloadDraft[],
): Promise<SynapseCreateSkillFilePayload[]> {
  const results: SynapseCreateSkillFilePayload[] = []
  for (const file of files) {
    if (file.textDirty && file.textContent !== undefined) {
      const bytes = new TextEncoder().encode(file.textContent)
      results.push({
        originalName: file.originalName,
        size: bytes.byteLength,
        bytes,
      })
      continue
    }

    results.push({
      originalName: file.originalName,
      sha256: file.sha256,
      size: file.size,
      bytes: file.file
        ? new Uint8Array(await file.file.arrayBuffer())
        : file.bytes,
    })
  }
  return results
}

export {
  createSkillFileDraftsFromFiles,
  createEmptySkillPayload,
  formatSkillAttachmentSize,
  MAX_SKILL_ATTACHMENT_COUNT,
  MAX_SKILL_ATTACHMENT_SIZE,
  mergeCreateSkillFiles,
  normalizeCreateSkillPayload,
  normalizeSkillAttachmentName,
  serializeCreateSkillFiles,
  validateCreateSkillPayload,
}
