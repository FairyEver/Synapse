import { createHash } from "node:crypto"
import path from "node:path"
import { TextDecoder } from "node:util"
import { BadRequestException } from "@nestjs/common"
import {
  skillRepositoryMaxFileBytes,
  skillRepositoryMaxFileCount,
  skillRepositoryMaxTotalBytes,
  skillRepositoryRootFilePath,
} from "@synapse/shared"

export type NormalizedSkillRepositoryFile = {
  readonly path: string
  readonly pathKey: string
  readonly size: number
  readonly sha256: string
  readonly kind: "text" | "binary"
  readonly mimeType: string | null
  readonly text: string | null
  readonly bytes: Buffer
}

export type SkillRepositoryFileInput = {
  readonly path: string
  readonly contentBase64: string
  readonly mimeType?: string | null
}

const obviousBinaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".zip",
  ".gz",
  ".tar",
  ".pdf",
  ".exe",
  ".dll",
  ".dylib",
  ".so",
])

const textExtensions = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".sh",
  ".css",
  ".html",
  ".xml",
  ".toml",
  ".ini",
])

const windowsReservedPathNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
const windowsHostilePathSegmentChars = /[<>:"|?*\u0000-\u001f]/u
const strictBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u

export function normalizeSkillRepositoryFiles(files: readonly SkillRepositoryFileInput[]): NormalizedSkillRepositoryFile[] {
  if (files.length === 0) throw new BadRequestException("Skill 文件不能为空。")
  if (files.length > skillRepositoryMaxFileCount) throw new BadRequestException("Skill 文件数量超过 200 个。")

  const seen = new Set<string>()
  let total = 0
  const normalized = files.map((file) => {
    const normalizedFile = normalizeSkillRepositoryFile(file)
    const pathKey = normalizedFile.pathKey
    if (seen.has(pathKey)) throw new BadRequestException("Skill 文件路径重复。")
    seen.add(pathKey)

    total += normalizedFile.size
    if (total > skillRepositoryMaxTotalBytes) throw new BadRequestException("Skill 文件总大小超过 50MB。")

    return normalizedFile
  })

  const skillFile = normalized.find((file) => isSkillRepositoryRootPath(file.path))
  if (!skillFile || skillFile.kind !== "text" || !skillFile.text?.trim()) {
    throw new BadRequestException("Skill 必须包含非空 SKILL.md。")
  }

  return normalized
}

export function normalizeSkillRepositoryFile(file: SkillRepositoryFileInput): NormalizedSkillRepositoryFile {
  const relativePath = normalizeSkillRepositoryPath(file.path)
  const pathKey = relativePath.toLowerCase()
  const bytes = decodeStrictBase64(file.contentBase64)
  if (bytes.length > skillRepositoryMaxFileBytes) throw new BadRequestException("Skill 单文件超过 20MB。")
  return normalizeFile(relativePath, pathKey, bytes, normalizeMimeType(file.mimeType))
}

export function isSkillRepositoryRootPath(relativePath: string): boolean {
  return relativePath.toLowerCase() === skillRepositoryRootFilePath.toLowerCase()
}

export function normalizeSkillRepositoryPath(input: string): string {
  const slashed = input.replace(/\\/gu, "/")
  if (!slashed.trim()) throw new BadRequestException("文件路径不能为空。")
  if (slashed.startsWith("/") || /^[a-zA-Z]:\//u.test(slashed)) {
    throw new BadRequestException("文件路径必须是相对路径。")
  }
  if (slashed.split("/").includes("..")) throw new BadRequestException("文件路径不能包含上级目录。")
  validateSkillRepositoryPathSegments(slashed)

  const normalized = path.posix.normalize(slashed)
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new BadRequestException("文件路径不能包含上级目录。")
  }
  if (normalized.length > 1024) throw new BadRequestException("文件路径不能超过 1024 个字符。")

  return normalized
}

function decodeStrictBase64(contentBase64: string): Buffer {
  if (!strictBase64Pattern.test(contentBase64)) throw new BadRequestException("文件内容不是有效的 base64。")
  const bytes = Buffer.from(contentBase64, "base64")
  if (bytes.toString("base64") !== contentBase64) throw new BadRequestException("文件内容不是有效的 base64。")
  return bytes
}

function normalizeFile(relativePath: string, pathKey: string, bytes: Buffer, mimeType: string | null): NormalizedSkillRepositoryFile {
  const detected = detectSkillRepositoryFileKind(relativePath, bytes)
  return {
    path: relativePath,
    pathKey,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    kind: detected.kind,
    mimeType,
    text: detected.text,
    bytes,
  }
}

function normalizeMimeType(mimeType: string | null | undefined): string | null {
  const trimmed = mimeType?.trim()
  if (!trimmed) return null
  if (trimmed.length > 255) throw new BadRequestException("文件 MIME 类型不能超过 255 个字符。")
  return trimmed
}

function detectSkillRepositoryFileKind(
  relativePath: string,
  bytes: Buffer,
): { readonly kind: "text"; readonly text: string } | { readonly kind: "binary"; readonly text: null } {
  const extension = path.posix.extname(relativePath).toLowerCase()
  if (obviousBinaryExtensions.has(extension)) return { kind: "binary", text: null }
  if (textExtensions.has(extension)) return decodeUtf8(bytes) ?? { kind: "binary", text: null }
  return decodeUtf8(bytes) ?? { kind: "binary", text: null }
}

function decodeUtf8(bytes: Buffer): { readonly kind: "text"; readonly text: string } | null {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  if (text.includes("\u0000")) return null

  let controls = 0
  let printable = 0
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controls += 1
    } else if (code >= 32) {
      printable += 1
    }
  }
  if (controls > 0 && printable === 0) return null
  if (controls > Math.max(4, text.length * 0.02)) return null

  return { kind: "text", text }
}

function validateSkillRepositoryPathSegments(relativePath: string): void {
  for (const segment of relativePath.split("/")) {
    if (!segment || segment === ".") continue
    if (windowsHostilePathSegmentChars.test(segment)) {
      throw new BadRequestException("文件路径包含非法字符。")
    }
    if (windowsReservedPathNames.test(segment)) {
      throw new BadRequestException("文件路径不能使用 Windows 保留名称。")
    }
    if (segment.endsWith(".") || segment.endsWith(" ")) {
      throw new BadRequestException("文件路径片段不能以点或空格结尾。")
    }
  }
}
