import { createHash } from "node:crypto"
import path from "node:path"

export type SessionAttachmentKind = "image" | "file" | "audio"

export type SessionAttachmentInput = {
  kind: SessionAttachmentKind
  name?: string
  mimeType?: string
  bytes?: Uint8Array
  size?: number
  format?: string
}

export type SessionAttachmentRecord = {
  kind: SessionAttachmentKind
  name: string
  mimeType: string
  size: number
  sha256: string | null
  hasInlineData: boolean
  localRef: string
  sendEnabled: boolean
}

export type SessionAttachmentManifest = {
  records: SessionAttachmentRecord[]
  prompt: string
  issues: string[]
}

const CC_ATTACHMENT_DIR = ".cc-connect/attachments"
const WECOM_MEDIA_MAX_BYTES = 20 << 20

function bytesOf(input: SessionAttachmentInput): Uint8Array | null {
  return input.bytes ?? null
}

function sanitizeName(name: string | undefined, fallback: string): string {
  const base = path.basename(name?.trim() || fallback)
  return base && base !== "." ? base : fallback
}

function sizeOf(input: SessionAttachmentInput): number {
  return input.bytes?.byteLength ?? input.size ?? 0
}

function sha256(bytes: Uint8Array | null): string | null {
  return bytes ? createHash("sha256").update(bytes).digest("hex") : null
}

function detectMimeByMagic(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.byteLength < 4) {
    return null
  }

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return "image/png"
  }
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    return "image/jpeg"
  }
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf"
  }

  return null
}

function mimeByExtension(name: string): string | null {
  switch (path.extname(name).toLowerCase()) {
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".gif":
      return "image/gif"
    case ".pdf":
      return "application/pdf"
    case ".txt":
    case ".md":
      return "text/plain"
    case ".mp3":
      return "audio/mpeg"
    case ".wav":
      return "audio/wav"
    case ".ogg":
    case ".opus":
      return "audio/ogg"
    case ".amr":
      return "audio/amr"
    case ".silk":
      return "audio/silk"
    default:
      return null
  }
}

function defaultNameFor(input: SessionAttachmentInput, index: number): string {
  if (input.kind === "image") {
    return `image_${index}.bin`
  }
  if (input.kind === "audio") {
    return `voice_${index}.${input.format?.trim() || "bin"}`
  }
  return `file_${index}`
}

function detectMime(input: SessionAttachmentInput, name: string): string {
  return input.mimeType?.trim()
    || detectMimeByMagic(bytesOf(input))
    || mimeByExtension(name)
    || (input.kind === "image" ? "image/jpeg" : input.kind === "audio" ? "audio/octet-stream" : "application/octet-stream")
}

function appendFileRefs(prompt: string, refs: string[]): string {
  if (refs.length === 0) {
    return prompt
  }

  const base = prompt || "Please analyze the attached file(s)."
  return `${base}\n\n(Files saved locally, please read them: ${refs.join(", ")})`
}

export function createSessionAttachmentManifest(
  prompt: string,
  inputs: readonly SessionAttachmentInput[],
  options: { attachmentSend?: "on" | "off"; maxBytes?: number } = {},
): SessionAttachmentManifest {
  const maxBytes = options.maxBytes ?? WECOM_MEDIA_MAX_BYTES
  const sendEnabled = options.attachmentSend !== "off"
  const issues: string[] = []
  const names = new Set<string>()
  const records: SessionAttachmentRecord[] = []

  inputs.forEach((input, index) => {
    const name = sanitizeName(input.name, defaultNameFor(input, index + 1))
    const size = sizeOf(input)

    if (names.has(name)) {
      issues.push(`duplicate attachment name: ${name}`)
      return
    }
    names.add(name)

    if (size > maxBytes) {
      issues.push(`attachment ${name} exceeds ${maxBytes} bytes`)
      return
    }

    records.push({
      kind: input.kind,
      name,
      mimeType: detectMime(input, name),
      size,
      sha256: sha256(bytesOf(input)),
      hasInlineData: Boolean(input.bytes && input.bytes.byteLength > 0),
      localRef: path.posix.join(CC_ATTACHMENT_DIR, name),
      sendEnabled,
    })
  })

  return {
    records,
    prompt: appendFileRefs(prompt, records.filter((record) => record.kind === "file").map((record) => record.localRef)),
    issues,
  }
}

export function normalizeWeComAesKey(value: string): Uint8Array | null {
  let normalized = value.trim().replace(/\s+/g, "")
  if (!normalized) {
    return null
  }

  if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return Buffer.from(normalized, "hex")
  }

  normalized = normalized.replace(/-/g, "+").replace(/_/g, "/")
  const remainder = normalized.length % 4
  if (remainder === 2) {
    normalized += "=="
  } else if (remainder === 3) {
    normalized += "="
  } else if (remainder !== 0) {
    return null
  }

  const decoded = Buffer.from(normalized, "base64")
  return decoded.byteLength >= 32 ? decoded.subarray(0, 32) : null
}
