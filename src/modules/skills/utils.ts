import type {
  CreateSkillPayload,
  SkillCreateFilePayloadDraft,
  SkillCreateFieldErrors,
} from "@/modules/skills/types"
import { DEFAULT_SYNAPSE_CONTENT_COLOR_VALUE } from "@/lib/content-appearance"
import { normalizeContentAttachmentPath } from "@/lib/content-attachments"
import { normalizeSkillNameInput, validateSkillNameInput } from "@/lib/skill-name-input"
import type { SynapseCreateSkillFilePayload } from "@/types/content"
import {
  createEmptyContentPayload,
  isContentPayloadDirty as isContentPayloadDirtyBase,
  normalizeContentPayload,
  validateContentPayload,
} from "@/modules/content/lib/content-payload"

const MAX_SKILL_ATTACHMENT_SIZE = 10 * 1024 * 1024

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

    if (seenOriginalNames.has(file.originalName)) {
      duplicatedNames.push(file.originalName)
      continue
    }

    seenOriginalNames.add(file.originalName)

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

function isCreateSkillPayloadDirty(payload: CreateSkillPayload): boolean {
  return isContentPayloadDirtyBase(payload, (p) =>
    p.name !== "" || p.files.length > 0,
  )
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
    normalizedCurrentFiles.map((file) => [file.originalName, file] as const),
  )
  const duplicateNames: string[] = []
  const oversizedNames: string[] = []
  const invalidNames: string[] = []

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

    if (nextFilesByPath.has(normalizedFile.originalName)) {
      duplicateNames.push(normalizedFile.originalName)
      continue
    }

    nextFilesByPath.set(normalizedFile.originalName, normalizedFile)
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

  return {
    files: Array.from(nextFilesByPath.values()).sort(compareCreateSkillFiles),
    rejectedMessages,
  }
}

async function serializeCreateSkillFiles(
  files: SkillCreateFilePayloadDraft[],
): Promise<SynapseCreateSkillFilePayload[]> {
  return Promise.all(
    files.map(async (file) => ({
      originalName: file.originalName,
      sha256: file.sha256,
      size: file.size,
      bytes: file.file ? new Uint8Array(await file.file.arrayBuffer()) : undefined,
    })),
  )
}

export {
  createEmptySkillPayload,
  formatSkillAttachmentSize,
  isCreateSkillPayloadDirty,
  MAX_SKILL_ATTACHMENT_SIZE,
  mergeCreateSkillFiles,
  normalizeCreateSkillPayload,
  normalizeSkillAttachmentName,
  serializeCreateSkillFiles,
  validateCreateSkillPayload,
}
