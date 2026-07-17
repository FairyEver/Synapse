import { normalizePathForCompare } from "./path-compare"

const WINDOWS_RESERVED_BASENAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const WINDOWS_UNSAFE_CHARS = new Set(["<", ">", ":", "\"", "|", "?", "*", "/", "\\"])
const SKILL_ENV_EXAMPLE_PATH = ".env.example"
const SKILL_RUNTIME_ENV_PATH = ".env"
const SKILL_ATTACHMENT_RESERVED_INSTALL_PATHS = new Set(
  ["SKILL.md", ".synapse.json", ".synapse.repository.json"]
    .map((value) => normalizePathForCompare(value, { platform: "win32" })),
)

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

function normalizeContentFileNameSegment(originalName: string, maxLength = 100): string {
  const clipped = originalName.normalize("NFC").trim().slice(0, maxLength)
  return toWindowsSafeSegment(clipped) || "download"
}

function assertUniqueContentAttachmentPaths(originalNames: readonly string[]): void {
  const seen = new Set<string>()

  for (const originalName of originalNames) {
    const normalized = normalizeContentAttachmentPath(originalName)
    if (!normalized) {
      throw new Error("附件文件名不能为空。")
    }
    const windowsPathKey = normalizePathForCompare(normalized, { platform: "win32" })
    if (SKILL_ATTACHMENT_RESERVED_INSTALL_PATHS.has(windowsPathKey)) {
      throw new Error(`附件路径不能使用 Skill 安装保留文件：${normalized}`)
    }
    if (seen.has(windowsPathKey)) {
      throw new Error(`附件文件名重复：${normalized}`)
    }
    seen.add(windowsPathKey)
  }
}

function assertNoRuntimeSkillEnvPath(originalNames: readonly string[]): void {
  if (originalNames.some(isRuntimeSkillEnvPath)) {
    throw new Error("Skill 源目录不能包含 .env，请只提交 .env.example。")
  }
}

function assertNoPublishRuntimeEnvPath(originalNames: readonly string[]): void {
  if (originalNames.some(isRuntimeSkillEnvPath)) {
    throw new Error("Skill 发布内容不能包含运行时 .env 文件，请只提交根目录 .env.example。")
  }
}

function isRuntimeSkillEnvPath(originalName: string): boolean {
  const normalized = normalizeContentAttachmentPath(originalName).toLowerCase()
  if (normalized === SKILL_ENV_EXAMPLE_PATH) return false
  const basename = normalized.split("/").at(-1) ?? ""
  return basename === SKILL_RUNTIME_ENV_PATH || basename.startsWith(`${SKILL_RUNTIME_ENV_PATH}.`)
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
  assertNoRuntimeSkillEnvPath,
  assertNoPublishRuntimeEnvPath,
  assertUniqueContentAttachmentPaths,
  normalizeContentAttachmentPath,
  normalizeContentAttachmentSegment,
  normalizeContentFileNameSegment,
  SKILL_ENV_EXAMPLE_PATH,
  SKILL_RUNTIME_ENV_PATH,
}
