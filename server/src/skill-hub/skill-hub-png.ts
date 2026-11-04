import { crc32, inflateSync } from "node:zlib"
import { SKILL_HUB_LIMITS as limits } from "@synapse/shared/skill-hub-contracts"

const signature = Buffer.from("89504e470d0a1a0a", "hex")
const colorMetadata: Record<string, number> = { sRGB: 1, gAMA: 4, cHRM: 32, pHYs: 9, cICP: 4 }

export function assertSkillHubIcon(bytes: Buffer): void {
  const invalid = () => new Error("Skill 图标必须是有效的 256 × 256 PNG")
  if (bytes.length > limits.iconBytes || !bytes.subarray(0, 8).equals(signature)) throw invalid()

  let cursor = 8
  let stride = 0
  const idat: Buffer[] = []
  const seen = new Set<string>()
  for (let count = 0; count < 128 && cursor + 12 <= bytes.length; count++) {
    const length = bytes.readUInt32BE(cursor)
    const type = bytes.toString("ascii", cursor + 4, cursor + 8)
    const start = cursor + 8
    const end = start + length
    if (end + 4 > bytes.length || crc32(bytes.subarray(cursor + 4, end)) !== bytes.readUInt32BE(end)) throw invalid()
    if (!count && type !== "IHDR") throw invalid()
    if (type !== "IDAT" && seen.has(type)) throw invalid()
    if (type === "IHDR") {
      if (length !== 13 || bytes.readUInt32BE(start) !== limits.iconSize || bytes.readUInt32BE(start + 4) !== limits.iconSize
        || bytes[start + 8] !== 8 || ![2, 6].includes(bytes[start + 9])
        || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] !== 0) throw invalid()
      stride = limits.iconSize * (bytes[start + 9] === 6 ? 4 : 3) + 1
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(start, end))
    } else if (type === "IEND") {
      if (length || end + 4 !== bytes.length || !stride || !idat.length) throw invalid()
      const compressed = Buffer.concat(idat)
      const maxOutputLength = stride * limits.iconSize
      // The sync Node type declares only Buffer, even with info: true.
      const result = inflateSync(compressed, { maxOutputLength, info: true }) as unknown as {
        buffer: Buffer; engine: { bytesWritten: number }
      }
      if (result.engine.bytesWritten !== compressed.length || result.buffer.length !== maxOutputLength) throw invalid()
      for (let offset = 0; offset < maxOutputLength; offset += stride) if (result.buffer[offset] > 4) throw invalid()
      return
    } else if (!Object.hasOwn(colorMetadata, type) || colorMetadata[type] !== length || idat.length) {
      // Normalizers emit truecolor PNG. Do not accept embedded profiles, text or animations.
      throw invalid()
    }
    seen.add(type)
    cursor = end + 4
  }
  throw invalid()
}
