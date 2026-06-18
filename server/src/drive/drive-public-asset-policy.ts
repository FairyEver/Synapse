import { DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION } from "@synapse/shared"

const PUBLIC_ASSET_TYPES: ReadonlyMap<string, string> = new Map(Object.entries(DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION))

export function validatePublicAssetNameAndMime(input: { readonly name: string; readonly mimeType?: string | null }) {
  const extension = input.name.split(".").pop()?.toLowerCase()
  if (!extension || !PUBLIC_ASSET_TYPES.has(extension)) throw new Error("仅支持图片。")
  const expected = PUBLIC_ASSET_TYPES.get(extension)!
  if (input.mimeType !== expected) throw new Error("文件类型与扩展名不匹配。")
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
