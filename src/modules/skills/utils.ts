import type {
  CreateSkillFilePayload,
  CreateSkillPayload,
  SkillCreateFieldErrors,
} from "@/modules/skills/types"

const MAX_SKILL_ATTACHMENT_SIZE = 10 * 1024 * 1024

const EMPTY_CREATE_SKILL_PAYLOAD: CreateSkillPayload = {
  title: "",
  description: "",
  category: "",
  icon: "",
  iconBg: "",
  content: "",
  files: [],
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

function normalizeSkillAttachmentPath(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment.length > 0)
    .join("/")
}

function normalizeCreateSkillFilePayload(file: CreateSkillFilePayload): CreateSkillFilePayload {
  return {
    ...file,
    relativePath: normalizeSkillAttachmentPath(file.relativePath),
    size: file.size,
  }
}

function compareCreateSkillFiles(
  left: CreateSkillFilePayload,
  right: CreateSkillFilePayload,
): number {
  return left.relativePath.localeCompare(right.relativePath, "zh-CN")
}

function createEmptySkillPayload(): CreateSkillPayload {
  return {
    ...EMPTY_CREATE_SKILL_PAYLOAD,
    files: [],
  }
}

function normalizeCreateSkillPayload(payload: CreateSkillPayload): CreateSkillPayload {
  return {
    ...payload,
    title: payload.title.trim(),
    description: payload.description.trim(),
    content: payload.content.trim(),
    files: payload.files
      .map((file) => normalizeCreateSkillFilePayload(file))
      .sort(compareCreateSkillFiles),
  }
}

function validateCreateSkillPayload(payload: CreateSkillPayload): SkillCreateFieldErrors {
  const normalizedPayload = normalizeCreateSkillPayload(payload)
  const errors: SkillCreateFieldErrors = {}
  const seenRelativePaths = new Set<string>()
  const duplicatedPaths: string[] = []
  const oversizedPaths: string[] = []

  if (!normalizedPayload.title) {
    errors.title = "请输入标题。"
  }

  if (!normalizedPayload.description) {
    errors.description = "请输入简介。"
  }

  if (!normalizedPayload.category) {
    errors.category = "请选择分类。"
  }

  if (!normalizedPayload.icon) {
    errors.icon = "请选择图标。"
  }

  if (!normalizedPayload.iconBg) {
    errors.iconBg = "请选择背景色。"
  }

  if (!normalizedPayload.content) {
    errors.content = "请输入主说明。"
  }

  for (const file of normalizedPayload.files) {
    if (!file.relativePath) {
      errors.files = appendErrorMessage(errors.files, "附件路径不能为空。")
      continue
    }

    if (seenRelativePaths.has(file.relativePath)) {
      duplicatedPaths.push(file.relativePath)
      continue
    }

    seenRelativePaths.add(file.relativePath)

    if (file.size > MAX_SKILL_ATTACHMENT_SIZE) {
      oversizedPaths.push(file.relativePath)
    }
  }

  if (duplicatedPaths.length > 0) {
    errors.files = appendErrorMessage(
      errors.files,
      `附件路径重复：${formatAttachmentList(duplicatedPaths)}。`,
    )
  }

  if (oversizedPaths.length > 0) {
    errors.files = appendErrorMessage(
      errors.files,
      `以下附件超过 10MB：${formatAttachmentList(oversizedPaths)}。`,
    )
  }

  return errors
}

function isCreateSkillPayloadDirty(payload: CreateSkillPayload): boolean {
  return (
    payload.title !== ""
    || payload.description !== ""
    || payload.category !== ""
    || payload.icon !== ""
    || payload.iconBg !== ""
    || payload.content !== ""
    || payload.files.length > 0
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
  currentFiles: CreateSkillFilePayload[],
  incomingFiles: CreateSkillFilePayload[],
): { files: CreateSkillFilePayload[]; rejectedMessages: string[] } {
  const normalizedCurrentFiles = currentFiles.map((file) => normalizeCreateSkillFilePayload(file))
  const nextFilesByPath = new Map(
    normalizedCurrentFiles.map((file) => [file.relativePath, file] as const),
  )
  const duplicatePaths: string[] = []
  const oversizedPaths: string[] = []
  const invalidPaths: string[] = []

  for (const incomingFile of incomingFiles) {
    const normalizedFile = normalizeCreateSkillFilePayload(incomingFile)

    if (!normalizedFile.relativePath) {
      invalidPaths.push(incomingFile.file.name || "未命名文件")
      continue
    }

    if (normalizedFile.size > MAX_SKILL_ATTACHMENT_SIZE) {
      oversizedPaths.push(normalizedFile.relativePath)
      continue
    }

    if (nextFilesByPath.has(normalizedFile.relativePath)) {
      duplicatePaths.push(normalizedFile.relativePath)
      continue
    }

    nextFilesByPath.set(normalizedFile.relativePath, normalizedFile)
  }

  const rejectedMessages: string[] = []

  if (invalidPaths.length > 0) {
    rejectedMessages.push(`以下附件缺少有效路径，已跳过：${formatAttachmentList(invalidPaths)}。`)
  }

  if (duplicatePaths.length > 0) {
    rejectedMessages.push(`以下附件路径重复，已跳过：${formatAttachmentList(duplicatePaths)}。`)
  }

  if (oversizedPaths.length > 0) {
    rejectedMessages.push(`以下附件超过 10MB，已跳过：${formatAttachmentList(oversizedPaths)}。`)
  }

  return {
    files: Array.from(nextFilesByPath.values()).sort(compareCreateSkillFiles),
    rejectedMessages,
  }
}

export {
  createEmptySkillPayload,
  formatSkillAttachmentSize,
  isCreateSkillPayloadDirty,
  MAX_SKILL_ATTACHMENT_SIZE,
  mergeCreateSkillFiles,
  normalizeCreateSkillPayload,
  normalizeSkillAttachmentPath,
  validateCreateSkillPayload,
}
