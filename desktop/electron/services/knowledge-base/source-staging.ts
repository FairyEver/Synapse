import { randomUUID } from "node:crypto"
import { link, lstat, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type { SynapseKnowledgeBaseUploadSourcesResult } from "../../../src/types/knowledge-base"
import { isPathInsideDirectory } from "../../../src/lib/path-compare"
import { validateKnowledgeBaseRawEntryNameInput } from "../../../src/lib/knowledge-base-raw-entry-name"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"
import { acquireUrlSource, type FetchUrl, type UrlSourceErrorCode } from "../source-acquisition/url-source"
import { knowledgeBaseErrorMeta, knowledgeBaseLogger } from "./logging"

export interface StageKnowledgeBaseUrlSourceInput {
  readonly projectPath: string
  readonly targetDirectoryPath?: string
  readonly url: string
  readonly now: () => Date
  readonly fetchUrl: FetchUrl
  readonly signal?: AbortSignal
}

type StageKnowledgeBaseSourcesResult = Omit<SynapseKnowledgeBaseUploadSourcesResult, "projectId">

export async function stageKnowledgeBaseUrlSource(
  input: StageKnowledgeBaseUrlSourceInput,
): Promise<StageKnowledgeBaseSourcesResult> {
  const projectPath = path.resolve(input.projectPath)
  const result = await acquireUrlSource({
    url: input.url,
    fetchUrl: input.fetchUrl,
    now: input.now,
    signal: input.signal,
  })

  if (!result.ok) {
    knowledgeBaseLogger.warn("Knowledge Base URL source acquisition failed.", {
      code: result.code,
      url: sanitizeUrl(input.url),
      ...knowledgeBaseErrorMeta(result.message),
    })
    return {
      uploaded: [],
      skipped: [urlAcquisitionFailure(input.url, result.code)],
    }
  }

  const rawRelativeDir = input.targetDirectoryPath === undefined
    ? path.join(".raw", "web", ...datePathSegments(new Date(result.source.fetchedAt)))
    : path.join(".raw", normalizeRawDirectoryPath(input.targetDirectoryPath))
  const rawDir = assertInside(projectPath, path.join(projectPath, rawRelativeDir))
  await assertNoSymlinkInRelativePath(projectPath, rawRelativeDir)
  await mkdir(rawDir, { recursive: true })

  const fileName = `${slugFromUrl(result.source.finalUrl)}.md`
  const targetPath = await writeUtf8FileToAvailablePath(rawDir, fileName, result.source.markdown)

  return {
    uploaded: [{
      originalPath: result.source.originalUrl,
      relativePath: normalizeRelativePath(path.relative(projectPath, targetPath)),
      name: path.basename(targetPath),
      size: Buffer.byteLength(result.source.markdown, "utf8"),
      sourceKind: "url",
      sourceUrl: result.source.originalUrl,
    }],
    skipped: [],
  }
}

function urlAcquisitionFailure(
  url: string,
  reason: UrlSourceErrorCode,
): SynapseKnowledgeBaseUploadSourcesResult["skipped"][number] {
  return { path: sanitizeUrl(url), reason }
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/")
}

function datePathSegments(date: Date): string[] {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ]
}

function normalizeRawDirectoryPath(value: string): string {
  const normalized = value.split("\\").join("/").replace(/^\/+/, "").replace(/\/+$/g, "")
  if (!normalized) return ""
  const segments = normalized.split("/").filter(Boolean)
  for (const segment of segments) {
    if (segment === "." || segment === ".." || validateKnowledgeBaseRawEntryNameInput(segment) !== null) {
      throw new Error("目标路径不在资料目录中。")
    }
  }
  return segments.join("/")
}

async function writeUtf8FileToAvailablePath(directoryPath: string, fileName: string, content: string): Promise<string> {
  return writeToAvailablePath(directoryPath, fileName, async (candidate) => {
    await writeUtf8FileToNewPathAtomically(candidate, content)
  })
}

async function writeUtf8FileToNewPathAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    await writeFile(temporaryPath, content, "utf8")
    await link(temporaryPath, filePath)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function writeToAvailablePath(
  directoryPath: string,
  fileName: string,
  writeCandidate: (candidate: string) => Promise<void>,
): Promise<string> {
  const parsed = path.parse(fileName)
  let candidate = path.join(directoryPath, fileName)
  let index = 2
  while (true) {
    try {
      await writeCandidate(candidate)
      return candidate
    } catch (error) {
      if (!isFileExistsError(error)) throw error
      candidate = path.join(directoryPath, `${parsed.name}-${index}${parsed.ext}`)
      index += 1
    }
  }
}

function slugFromUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  const baseName = path.posix.basename(url.pathname) || url.hostname
  const withoutExtension = baseName.replace(/\.[a-z0-9]{1,8}$/i, "")
  const decoded = safeDecodeURIComponent(withoutExtension)
  const slug = decoded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return toWindowsSafeMarkdownBaseName(slug || "source")
}

function toWindowsSafeMarkdownBaseName(baseName: string): string {
  if (validateKnowledgeBaseRawEntryNameInput(`${baseName}.md`) === null) return baseName
  return `${baseName}-source`
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function assertInside(rootPath: string, targetPath: string): string {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  if (!isPathInsideDirectory(root, target, { resolvePath: path.resolve })) {
    throw new Error("目标路径不在项目目录中。")
  }
  return target
}

async function assertNoSymlinkInRelativePath(projectPath: string, relativePath: string): Promise<void> {
  let currentPath = projectPath
  for (const segment of relativePath.split(/[\\/]/)) {
    currentPath = path.join(currentPath, segment)
    try {
      const stat = await lstat(currentPath)
      if (stat.isSymbolicLink()) {
        throw new Error(`知识库路径不能包含符号链接：${path.relative(projectPath, currentPath)}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return
      }
      throw error
    }
  }
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === "EEXIST"
}
