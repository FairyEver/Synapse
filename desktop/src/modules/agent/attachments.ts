import { formatBytes } from "@synapse/shared"

import {
  AGENT_ATTACHMENT_CONTRACT_VERSION,
  type AgentAttachmentRef,
  type AgentDirectoryAttachmentRef,
  type AgentFileAttachmentRef,
  type AgentImageAttachmentRef,
} from "@/types/agent-attachment"

export type AgentDraftImageAttachment = AgentImageAttachmentRef
export type AgentDraftPathAttachment = AgentFileAttachmentRef | AgentDirectoryAttachmentRef
export type AgentDraftAttachment = AgentAttachmentRef

export function nextImageLabel(index: number): string {
  return `[Image #${index + 1}]`
}

export function createImageAttachment(
  input: {
    readonly id?: string
    readonly attachmentId?: string
    readonly name?: string
    readonly mimeType: AgentImageAttachmentRef["mimeType"]
    readonly size?: number
    readonly byteSize?: number
    readonly previewUrl?: string
    readonly thumbnailUrl?: string
    readonly previewByteSize?: number
    readonly width?: number
    readonly height?: number
    readonly sha256?: string
  },
): AgentDraftImageAttachment {
  const attachmentId = input.attachmentId ?? input.id ?? createAttachmentId()
  return {
    version: AGENT_ATTACHMENT_CONTRACT_VERSION,
    kind: "image",
    attachmentId,
    name: input.name ?? "",
    mimeType: input.mimeType,
    byteSize: input.byteSize ?? input.size ?? 0,
    previewUrl: input.previewUrl ?? `synapse-agent-artifact://local/${attachmentId}/preview`,
    thumbnailUrl: input.thumbnailUrl ?? `synapse-agent-artifact://local/${attachmentId}/thumbnail`,
    ...(input.previewByteSize !== undefined ? { previewByteSize: input.previewByteSize } : {}),
    ...(input.width !== undefined ? { width: input.width } : {}),
    ...(input.height !== undefined ? { height: input.height } : {}),
    sha256: input.sha256 ?? "0".repeat(64),
  }
}

export function createPathAttachment(input: {
  readonly id?: string
  readonly attachmentId?: string
  readonly path: string
  readonly entryType: "file" | "directory"
  readonly name?: string
  readonly size?: number
  readonly byteSize?: number
  readonly mimeType?: string
  readonly sha256?: string
}): AgentDraftPathAttachment {
  const attachmentId = input.attachmentId ?? input.id ?? createAttachmentId()
  const name = input.name ?? input.path.split(/[\\/]/).filter(Boolean).at(-1) ?? input.path
  if (input.entryType === "directory") {
    return {
      version: AGENT_ATTACHMENT_CONTRACT_VERSION,
      kind: "directory",
      attachmentId,
      name,
      byteSize: input.byteSize ?? input.size ?? 0,
    }
  }
  return {
    version: AGENT_ATTACHMENT_CONTRACT_VERSION,
    kind: "file",
    attachmentId,
    name,
    byteSize: input.byteSize ?? input.size ?? 0,
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    sha256: input.sha256 ?? "0".repeat(64),
  }
}

export function formatDraftAttachmentsForMessage(
  text: string,
  attachments: readonly AgentDraftAttachment[],
): string {
  const lines: string[] = []
  let imageIndex = 0
  const files = attachments.filter((item): item is AgentFileAttachmentRef => item.kind === "file")
  const folders = attachments.filter((item): item is AgentDirectoryAttachmentRef => item.kind === "directory")

  for (const attachment of attachments) {
    if (attachment.kind !== "image") continue
    lines.push(nextImageLabel(imageIndex))
    imageIndex += 1
  }
  if (files.length > 0) lines.push("粘贴文件:", ...files.map((item) => item.name))
  if (folders.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("粘贴文件夹:", ...folders.map((item) => item.name))
  }
  const trimmed = text.trim()
  if (trimmed) {
    if (lines.length > 0) lines.push("")
    lines.push(trimmed)
  }
  return lines.join("\n")
}

const FRIENDLY_FORMAT_BY_EXTENSION: Readonly<Record<string, string>> = {
  doc: "Word", docx: "Word", gif: "GIF", jpeg: "JPEG", jpg: "JPEG",
  markdown: "Markdown", md: "Markdown", mdx: "Markdown", pdf: "PDF", png: "PNG",
  ppt: "PowerPoint", pptx: "PowerPoint", webp: "WebP", xls: "Excel", xlsx: "Excel",
}

const FRIENDLY_FORMAT_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  "application/msword": "Word",
  "application/pdf": "PDF",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.ms-powerpoint": "PowerPoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "image/gif": "GIF", "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP",
  "text/markdown": "Markdown",
}

export function attachmentDisplayName(
  attachments: readonly AgentDraftAttachment[],
  attachment: AgentDraftAttachment,
  index: number,
): string {
  if (attachment.kind !== "image") return attachment.name
  return attachment.name.trim() || nextImageLabel(imageIndexAt(attachments, index))
}

export function attachmentMetadata(attachment: AgentDraftAttachment): string {
  if (attachment.kind === "directory") return "文件夹"
  const format = attachmentFormat(attachment.name, attachment.mimeType)
  if (!Number.isFinite(attachment.byteSize) || attachment.byteSize < 0) return format
  return `${format} · ${formatBytes(attachment.byteSize)}`
}

function attachmentFormat(name: string | undefined, mimeType: string | undefined): string {
  const extension = fileExtension(name)
  if (extension) return FRIENDLY_FORMAT_BY_EXTENSION[extension] ?? extension.toUpperCase()
  if (mimeType) return FRIENDLY_FORMAT_BY_MIME_TYPE[mimeType.toLowerCase()] ?? "文件"
  return "文件"
}

function fileExtension(name: string | undefined): string | null {
  if (!name) return null
  const dotIndex = name.lastIndexOf(".")
  if (dotIndex <= 0 || dotIndex === name.length - 1) return null
  return name.slice(dotIndex + 1).toLowerCase()
}

function imageIndexAt(attachments: readonly AgentDraftAttachment[], index: number): number {
  return attachments.slice(0, index + 1).filter((attachment) => attachment.kind === "image").length - 1
}

function createAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
