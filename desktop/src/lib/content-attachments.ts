import { normalizePathForCompare } from "./path-compare"

const WINDOWS_RESERVED_BASENAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const WINDOWS_UNSAFE_CHARS = new Set(["<", ">", ":", "\"", "|", "?", "*"])

function normalizeContentAttachmentPath(originalName: string): string {
  return originalName
    .normalize("NFC")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .map(toWindowsSafeSegment)
    .filter((segment) => segment.length > 0)
    .join("/")
}

function normalizeContentAttachmentSegment(originalName: string): string {
  const normalized = normalizeContentAttachmentPath(originalName)
  const segments = normalized.split("/").filter(Boolean)

  return segments.at(-1) ?? ""
}

function assertUniqueContentAttachmentPaths(originalNames: readonly string[]): void {
  const seen = new Set<string>()

  for (const originalName of originalNames) {
    const normalized = normalizeContentAttachmentPath(originalName)
    if (!normalized) {
      throw new Error("附件文件名不能为空。")
    }
    const windowsPathKey = normalizePathForCompare(normalized, { platform: "win32" })
    if (seen.has(windowsPathKey)) {
      throw new Error(`附件文件名重复：${normalized}`)
    }
    seen.add(windowsPathKey)
  }
}

function toWindowsSafeSegment(segment: string): string {
  const cleaned = segment
    .split("")
    .map((char) => isWindowsUnsafeChar(char) ? "_" : char)
    .join("")
    .replace(/[. ]+$/u, "")

  if (!cleaned) {
    return ""
  }

  return WINDOWS_RESERVED_BASENAME_PATTERN.test(cleaned) ? `_${cleaned}` : cleaned
}

function isWindowsUnsafeChar(char: string): boolean {
  const codePoint = char.codePointAt(0)
  return WINDOWS_UNSAFE_CHARS.has(char)
    || (codePoint !== undefined && codePoint <= 0x1f)
}

export {
  assertUniqueContentAttachmentPaths,
  normalizeContentAttachmentPath,
  normalizeContentAttachmentSegment,
}
