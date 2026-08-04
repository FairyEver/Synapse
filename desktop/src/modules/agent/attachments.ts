import { formatBytes } from "@synapse/shared"

export type AgentDraftImageAttachment = {
  readonly kind: "image"
  readonly id: string
  readonly name?: string
  readonly mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
  readonly size: number
  readonly bytes: ArrayBuffer
}

export type AgentDraftPathAttachment = {
  readonly kind: "path"
  readonly id: string
  readonly path: string
  readonly entryType: "file" | "directory"
  readonly name: string
  readonly size?: number
  readonly mimeType?: string
}

export type AgentDraftAttachment = AgentDraftImageAttachment | AgentDraftPathAttachment

export function nextImageLabel(index: number): string {
  return `[Image #${index + 1}]`
}

export function createImageAttachment(input: Omit<AgentDraftImageAttachment, "kind">): AgentDraftImageAttachment {
  return { ...input, kind: "image" }
}

export function createPathAttachment(
  input: Omit<AgentDraftPathAttachment, "kind" | "name"> & { readonly name?: string },
): AgentDraftPathAttachment {
  return {
    ...input,
    kind: "path",
    name: input.name ?? input.path.split(/[\\/]/).filter(Boolean).at(-1) ?? input.path,
  }
}

export function formatDraftAttachmentsForMessage(
  text: string,
  attachments: readonly AgentDraftAttachment[],
): string {
  const lines: string[] = []
  let imageIndex = 0
  const files = attachments.filter(
    (item): item is AgentDraftPathAttachment => item.kind === "path" && item.entryType === "file",
  )
  const folders = attachments.filter(
    (item): item is AgentDraftPathAttachment => item.kind === "path" && item.entryType === "directory",
  )

  for (const attachment of attachments) {
    if (attachment.kind !== "image") continue
    lines.push(nextImageLabel(imageIndex))
    imageIndex += 1
  }
  if (files.length > 0) {
    lines.push("粘贴文件:", ...files.map((item) => item.path))
  }
  if (folders.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("粘贴文件夹:", ...folders.map((item) => item.path))
  }
  const trimmed = text.trim()
  if (trimmed) {
    if (lines.length > 0) lines.push("")
    lines.push(trimmed)
  }
  return lines.join("\n")
}

const FRIENDLY_FORMAT_BY_EXTENSION: Readonly<Record<string, string>> = {
  doc: "Word",
  docx: "Word",
  gif: "GIF",
  jpeg: "JPEG",
  jpg: "JPEG",
  markdown: "Markdown",
  md: "Markdown",
  mdx: "Markdown",
  pdf: "PDF",
  png: "PNG",
  ppt: "PowerPoint",
  pptx: "PowerPoint",
  webp: "WebP",
  xls: "Excel",
  xlsx: "Excel",
}

const FRIENDLY_FORMAT_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  "application/msword": "Word",
  "application/pdf": "PDF",
  "application/vnd.ms-excel": "Excel",
  "application/vnd.ms-powerpoint": "PowerPoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "image/gif": "GIF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "text/markdown": "Markdown",
}

export function attachmentDisplayName(
  attachments: readonly AgentDraftAttachment[],
  attachment: AgentDraftAttachment,
  index: number,
): string {
  if (attachment.kind === "path") return attachment.name
  return attachment.name?.trim() || nextImageLabel(imageIndexAt(attachments, index))
}

export function attachmentMetadata(attachment: AgentDraftAttachment): string {
  if (attachment.kind === "path" && attachment.entryType === "directory") return "文件夹"
  const format = attachmentFormat(attachment.name, attachment.mimeType)
  const size = attachment.size
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return format
  return `${format} · ${formatBytes(size)}`
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
