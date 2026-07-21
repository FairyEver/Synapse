import {
  DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION,
  DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION,
  DRIVE_PUBLIC_ASSET_MIME_BY_EXTENSION,
  DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE,
  drivePublicAssetContentKind,
} from "@synapse/shared"

const PUBLIC_ASSET_TYPES: ReadonlyMap<string, string> = new Map(Object.entries(DRIVE_PUBLIC_ASSET_MIME_BY_EXTENSION))
const PUBLIC_ASSET_MIME_TYPES: ReadonlySet<string> = new Set(Object.values(DRIVE_PUBLIC_ASSET_MIME_BY_EXTENSION))
const OFFICE_OPEN_XML_MIME_TYPES: ReadonlySet<string> = new Set([
  DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.docx,
  DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.xlsx,
  DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.pptx,
])
const TEXT_MIME_TYPES: ReadonlySet<string> = new Set([
  DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.txt,
  DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.md,
  DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.csv,
])

export function validatePublicAssetNameAndMime(input: { readonly name: string; readonly mimeType?: string | null }) {
  const mimeType = input.mimeType?.trim().toLowerCase() ?? null
  if (!mimeType || !PUBLIC_ASSET_MIME_TYPES.has(mimeType)) throw new Error(DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE)

  const extension = publicAssetNameExtension(input.name)
  if (!extension) return { extension: null, mimeType }

  const expected = PUBLIC_ASSET_TYPES.get(extension)
  if (!expected) throw new Error(DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE)
  if (mimeType !== expected) throw new Error("文件类型与扩展名不匹配。")
  return { extension, mimeType: expected }
}

export function detectPublicAssetImageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a") {
    return "image/gif"
  }
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp"
  }
  if (bytes.subarray(4, 12).toString("ascii") === "ftypavif") return "image/avif"
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon"
  return null
}

export function matchesPublicAssetContentSignature(bytes: Buffer, mimeType: string): boolean {
  const normalizedMimeType = mimeType.trim().toLowerCase()
  if (drivePublicAssetContentKind(normalizedMimeType) === "image") {
    return detectPublicAssetImageType(bytes) === normalizedMimeType
  }
  if (normalizedMimeType === DRIVE_PUBLIC_ASSET_DOCUMENT_MIME_BY_EXTENSION.pdf) {
    return bytes.subarray(0, 5).toString("ascii") === "%PDF-"
  }
  if (OFFICE_OPEN_XML_MIME_TYPES.has(normalizedMimeType)) {
    return bytes.length >= 4
      && bytes[0] === 0x50
      && bytes[1] === 0x4b
      && bytes[2] === 0x03
      && bytes[3] === 0x04
  }
  if (TEXT_MIME_TYPES.has(normalizedMimeType)) return isUtf8Text(bytes)
  return false
}

function publicAssetNameExtension(name: string): string | null {
  const dotIndex = name.lastIndexOf(".")
  if (dotIndex <= 0 || dotIndex === name.length - 1) return null
  return name.slice(dotIndex + 1).toLowerCase()
}

function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0x00)) return false
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    for (const character of text) {
      const codePoint = character.codePointAt(0) ?? 0
      if (codePoint < 0x20 && character !== "\t" && character !== "\n" && character !== "\r") return false
    }
    return true
  } catch {
    return false
  }
}
