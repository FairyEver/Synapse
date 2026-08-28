export const AGENT_ATTACHMENT_CONTRACT_VERSION = 2 as const
export const AGENT_ATTACHMENT_REFERENCE_PREFIX = "synapse-agent-attachment://local/"

export function agentAttachmentReference(attachmentId: string): string {
  return `${AGENT_ATTACHMENT_REFERENCE_PREFIX}${encodeURIComponent(attachmentId)}`
}

export function parseAgentAttachmentReference(reference: string): string | null {
  if (!reference.startsWith(AGENT_ATTACHMENT_REFERENCE_PREFIX)) return null
  const encodedId = reference.slice(AGENT_ATTACHMENT_REFERENCE_PREFIX.length)
  if (!encodedId || encodedId.includes("/")) return null
  try {
    const attachmentId = decodeURIComponent(encodedId)
    return attachmentId.includes("/") ? null : attachmentId
  } catch {
    return null
  }
}

export const AGENT_ATTACHMENT_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const

export type AgentAttachmentImageMimeType = typeof AGENT_ATTACHMENT_IMAGE_MIME_TYPES[number]

interface AgentAttachmentRefBase {
  readonly version: typeof AGENT_ATTACHMENT_CONTRACT_VERSION
  readonly attachmentId: string
  readonly name: string
  readonly byteSize: number
}

export interface AgentImageAttachmentRef extends AgentAttachmentRefBase {
  readonly kind: "image"
  readonly mimeType: AgentAttachmentImageMimeType
  readonly previewUrl: string
  readonly thumbnailUrl: string
  readonly previewByteSize?: number
  readonly width?: number
  readonly height?: number
  readonly sha256: string
}

export interface AgentFileAttachmentRef extends AgentAttachmentRefBase {
  readonly kind: "file"
  readonly mimeType?: string
  readonly sha256: string
}

export interface AgentDirectoryAttachmentRef extends AgentAttachmentRefBase {
  readonly kind: "directory"
}

export type AgentAttachmentRef =
  | AgentImageAttachmentRef
  | AgentFileAttachmentRef
  | AgentDirectoryAttachmentRef

export interface StagedAttachment {
  readonly version: typeof AGENT_ATTACHMENT_CONTRACT_VERSION
  readonly lifecycle: "staged"
  readonly ref: AgentAttachmentRef
  readonly draftScopeId: string
  readonly stagedAt: string
  readonly expiresAt: string
}

export interface CommittedAttachment {
  readonly version: typeof AGENT_ATTACHMENT_CONTRACT_VERSION
  readonly lifecycle: "committed"
  readonly ref: AgentAttachmentRef
  readonly projectId: string
  readonly conversationId: string
  readonly turnId: string
  readonly committedAt: string
}
