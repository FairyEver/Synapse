const WINDOWS_RESERVED_BASENAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const WINDOWS_UNSAFE_CHARS_PATTERN = /[<>:"|?*\u0000-\u001F]/gu

function normalizeContentAttachmentPath(originalName: string): string {
  return originalName
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

function toWindowsSafeSegment(segment: string): string {
  const cleaned = segment
    .replace(WINDOWS_UNSAFE_CHARS_PATTERN, "_")
    .replace(/[. ]+$/u, "")

  if (!cleaned) {
    return ""
  }

  return WINDOWS_RESERVED_BASENAME_PATTERN.test(cleaned) ? `_${cleaned}` : cleaned
}

export { normalizeContentAttachmentPath, normalizeContentAttachmentSegment }
