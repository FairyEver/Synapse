import { createHash } from "node:crypto"
import path from "node:path"
import { TextDecoder } from "node:util"
import { BadRequestException } from "@nestjs/common"
import {
  contentStoreSkillMaxFileBytes,
  contentStoreSkillMaxFileCount,
  contentStoreSkillMaxTotalBytes,
  contentStoreTextMaxBytes,
} from "./content-store.constants"
import type { ContentStoreFileInput, NormalizedContentStoreFile } from "./content-store.types"

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

export function normalizeSkillFiles(files: readonly ContentStoreFileInput[]): NormalizedContentStoreFile[] {
  if (files.length === 0) throw new BadRequestException("Skill 文件不能为空。")
  if (files.length > contentStoreSkillMaxFileCount) throw new BadRequestException("Skill 文件数量超过 200 个。")

  const seen = new Set<string>()
  let total = 0
  const normalized = files.map((file) => {
    const relativePath = normalizeContentStorePath(file.path)
    const key = relativePath.toLowerCase()
    if (seen.has(key)) throw new BadRequestException("Skill 文件路径重复。")
    seen.add(key)

    if (file.bytes.length > contentStoreSkillMaxFileBytes) throw new BadRequestException("Skill 单文件超过 20MB。")
    total += file.bytes.length
    if (total > contentStoreSkillMaxTotalBytes) throw new BadRequestException("Skill 文件总大小超过 50MB。")

    return normalizeFile(relativePath, file.bytes, file.mimeType ?? null)
  })

  const skillFile = normalized.find((file) => file.path === "SKILL.md")
  if (!skillFile || skillFile.kind !== "text" || !skillFile.text?.trim()) {
    throw new BadRequestException("Skill 必须包含非空 SKILL.md。")
  }

  return normalized
}

export function normalizeRuleBody(body: string): NormalizedContentStoreFile {
  return normalizeTextBody("RULE.md", body, "Rule 正文不能为空。")
}

export function normalizePromptBody(body: string): string {
  const bytes = Buffer.from(body, "utf8")
  if (!body.trim()) throw new BadRequestException("Prompt 正文不能为空。")
  if (bytes.length > contentStoreTextMaxBytes) throw new BadRequestException("Prompt 正文超过 1MB。")
  return body
}

export function normalizeContentStorePath(input: string): string {
  const trimmed = input.trim().replace(/\\/gu, "/")
  if (!trimmed) throw new BadRequestException("文件路径不能为空。")
  if (trimmed.startsWith("/") || /^[a-zA-Z]:\//u.test(trimmed)) {
    throw new BadRequestException("文件路径必须是相对路径。")
  }
  if (trimmed.split("/").includes("..")) throw new BadRequestException("文件路径不能包含上级目录。")

  const normalized = path.posix.normalize(trimmed)
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new BadRequestException("文件路径不能包含上级目录。")
  }

  return normalized
}

export function detectContentStoreFileKind(
  relativePath: string,
  bytes: Buffer,
): { readonly kind: "text" | "binary"; readonly text: string | null } {
  const extension = path.posix.extname(relativePath).toLowerCase()
  if (obviousBinaryExtensions.has(extension)) return { kind: "binary", text: null }
  if (textExtensions.has(extension)) return decodeUtf8(bytes) ?? { kind: "binary", text: null }
  return decodeUtf8(bytes) ?? { kind: "binary", text: null }
}

function normalizeTextBody(pathName: string, body: string, emptyMessage: string): NormalizedContentStoreFile {
  const bytes = Buffer.from(body, "utf8")
  if (!body.trim()) throw new BadRequestException(emptyMessage)
  if (bytes.length > contentStoreTextMaxBytes) throw new BadRequestException("正文超过 1MB。")
  return normalizeFile(pathName, bytes, "text/markdown")
}

function normalizeFile(relativePath: string, bytes: Buffer, mimeType: string | null): NormalizedContentStoreFile {
  const detected = detectContentStoreFileKind(relativePath, bytes)
  return {
    path: relativePath,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    kind: detected.kind,
    mimeType,
    text: detected.text,
    bytes,
  }
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
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controls += 1
  }
  if (controls > Math.max(4, text.length * 0.02)) return null

  return { kind: "text", text }
}
