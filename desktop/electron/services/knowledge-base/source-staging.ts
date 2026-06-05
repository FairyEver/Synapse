import { constants } from "node:fs"
import { copyFile, lstat, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { SynapseKnowledgeBaseUploadSourcesResult } from "../../../src/types/knowledge-base"
import { sanitizeUrl } from "../../../src/lib/url-sanitize"
import type { FileConversionInput, FileConversionResult } from "../file-conversion"
import { sourceFrontmatter } from "../file-conversion/markdown"
import { acquireUrlSource, type FetchUrl, type UrlSourceErrorCode } from "../source-acquisition/url-source"
import { knowledgeBaseErrorMeta, knowledgeBaseLogger } from "./logging"

type SourceConverter = {
  convert(input: FileConversionInput): Promise<FileConversionResult>
}

export interface StageKnowledgeBaseSourcesInput {
  readonly projectPath: string
  readonly filePaths: readonly string[]
  readonly now: () => Date
  readonly converter: SourceConverter
}

export interface StageKnowledgeBaseUrlSourceInput {
  readonly projectPath: string
  readonly url: string
  readonly now: () => Date
  readonly fetchUrl: FetchUrl
  readonly signal?: AbortSignal
}

type StageKnowledgeBaseSourcesResult = Omit<SynapseKnowledgeBaseUploadSourcesResult, "projectId">

const TEXT_SOURCE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".xml",
])

const CONVERTIBLE_EXTENSIONS = new Set([".doc", ".docx", ".xlsx", ".pdf", ".ppt", ".pptx"])
const IMAGE_SOURCE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"])

export async function stageKnowledgeBaseSources(
  input: StageKnowledgeBaseSourcesInput,
): Promise<StageKnowledgeBaseSourcesResult> {
  const projectPath = path.resolve(input.projectPath)
  const uploaded: SynapseKnowledgeBaseUploadSourcesResult["uploaded"] = []
  const skipped: SynapseKnowledgeBaseUploadSourcesResult["skipped"] = []

  for (const filePath of input.filePaths) {
    const sourcePath = path.resolve(filePath)
    try {
      const sourceStat = await lstat(sourcePath)
      if (!sourceStat.isFile()) {
        skipped.push({ path: filePath, reason: "not-file" })
        continue
      }

      const extension = path.extname(sourcePath).toLowerCase()
      if (IMAGE_SOURCE_EXTENSIONS.has(extension)) {
        const imageRelativeDir = path.join("_attachments", "images", ...datePathSegments(input.now()))
        const imageDir = assertInside(projectPath, path.join(projectPath, imageRelativeDir))
        await assertNoSymlinkInRelativePath(projectPath, imageRelativeDir)
        await mkdir(imageDir, { recursive: true })
        const imageTargetPath = await copyFileToAvailablePath(sourcePath, imageDir, path.basename(sourcePath))
        const imageRelativePath = normalizeRelativePath(path.relative(projectPath, imageTargetPath))

        const rawRelativeDir = path.join(".raw", "images", ...datePathSegments(input.now()))
        const rawDir = assertInside(projectPath, path.join(projectPath, rawRelativeDir))
        await assertNoSymlinkInRelativePath(projectPath, rawRelativeDir)
        await mkdir(rawDir, { recursive: true })
        const intakePath = await writeUtf8FileToAvailablePath(rawDir, `${path.parse(sourcePath).name}.md`, imageIntakeMarkdown({
          title: path.parse(sourcePath).name,
          originalPath: imageRelativePath,
          attachment: imageRelativePath,
          format: extension.slice(1),
          stagedAt: input.now().toISOString(),
        }))
        uploaded.push({
          originalPath: filePath,
          relativePath: normalizeRelativePath(path.relative(projectPath, intakePath)),
          originalRelativePath: imageRelativePath,
          name: path.basename(intakePath),
          size: sourceStat.size,
        })
        continue
      }
      if (TEXT_SOURCE_EXTENSIONS.has(extension)) {
        const targetRelativeDir = path.join(".raw", ...datePathSegments(input.now()))
        const targetDir = assertInside(projectPath, path.join(projectPath, targetRelativeDir))
        await assertNoSymlinkInRelativePath(projectPath, targetRelativeDir)
        await mkdir(targetDir, { recursive: true })
        const targetPath = await copyFileToAvailablePath(sourcePath, targetDir, path.basename(sourcePath))
        uploaded.push({
          originalPath: filePath,
          relativePath: normalizeRelativePath(path.relative(projectPath, targetPath)),
          name: path.basename(targetPath),
          size: sourceStat.size,
          sourceKind: "file",
        })
        continue
      }

      if (!CONVERTIBLE_EXTENSIONS.has(extension)) {
        knowledgeBaseLogger.warn("Knowledge Base source upload skipped.", {
          extension,
          fileName: path.basename(sourcePath),
          reason: "unsupported",
        })
        skipped.push({ path: filePath, reason: "unsupported" })
        continue
      }

      const originalRelativeDir = path.join("_attachments", "originals", ...datePathSegments(input.now()))
      const originalDir = assertInside(projectPath, path.join(projectPath, originalRelativeDir))
      await assertNoSymlinkInRelativePath(projectPath, originalRelativeDir)
      await mkdir(originalDir, { recursive: true })
      const originalPath = await copyFileToAvailablePath(sourcePath, originalDir, path.basename(sourcePath))
      const originalRelativePath = normalizeRelativePath(path.relative(projectPath, originalPath))

      let converted: FileConversionResult
      try {
        converted = await input.converter.convert({
          filePath: sourcePath,
          ocr: { enabled: true },
          imageHandling: { mode: "omit" },
        })
      } catch (error) {
        knowledgeBaseLogger.warn("Knowledge Base source conversion failed.", {
          extension,
          fileName: path.basename(sourcePath),
          ...knowledgeBaseErrorMeta(error),
        })
        skipped.push({ path: filePath, reason: "conversion-error" })
        continue
      }
      if (hasOcrUnavailableWarning(converted)) {
        knowledgeBaseLogger.warn("Knowledge Base source conversion returned OCR unavailable.", {
          extension,
          fileName: path.basename(sourcePath),
          warningCodes: converted.warnings.map((warning) => warning.code),
        })
        skipped.push({ path: filePath, reason: "conversion-error" })
        continue
      }

      const rawKindDir = rawDirectoryForKind(converted.kind)
      const rawRelativeDir = path.join(".raw", rawKindDir, ...datePathSegments(input.now()))
      const rawDir = assertInside(projectPath, path.join(projectPath, rawRelativeDir))
      await assertNoSymlinkInRelativePath(projectPath, rawRelativeDir)
      await mkdir(rawDir, { recursive: true })
      const markdown = [
        sourceFrontmatter({
          sourceOriginal: originalRelativePath,
          sourceFormat: converted.format,
          convertedAt: input.now().toISOString(),
        }),
        converted.markdown.trim(),
        "",
      ].join("\n")
      const markdownPath = await writeUtf8FileToAvailablePath(rawDir, `${path.parse(sourcePath).name}.md`, markdown)
      uploaded.push({
        originalPath: filePath,
        relativePath: normalizeRelativePath(path.relative(projectPath, markdownPath)),
        originalRelativePath,
        name: path.basename(markdownPath),
        size: sourceStat.size,
        sourceKind: "file",
        conversionWarnings: [...converted.warnings],
      })
    } catch (error) {
      knowledgeBaseLogger.warn("Knowledge Base source staging failed.", {
        fileName: path.basename(sourcePath),
        ...knowledgeBaseErrorMeta(error),
      })
      skipped.push({ path: filePath, reason: "read-error" })
    }
  }

  return { uploaded, skipped }
}

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
      ...knowledgeBaseErrorMeta(result.message),
    })
    return {
      uploaded: [],
      skipped: [urlAcquisitionFailure(input.url, result.code)],
    }
  }

  const rawRelativeDir = path.join(".raw", "web", ...datePathSegments(new Date(result.source.fetchedAt)))
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

function rawDirectoryForKind(kind: FileConversionResult["kind"]): string {
  if (kind === "document") return "documents"
  if (kind === "spreadsheet") return "spreadsheets"
  if (kind === "presentation") return "presentations"
  if (kind === "image") return "images"
  return "pdfs"
}

function hasOcrUnavailableWarning(result: FileConversionResult): boolean {
  return result.warnings.some((warning) => warning.code === "ocr_unavailable")
}

function urlAcquisitionFailure(
  url: string,
  reason: UrlSourceErrorCode,
): SynapseKnowledgeBaseUploadSourcesResult["skipped"][number] {
  return { path: sanitizeUrl(url), reason }
}

function imageIntakeMarkdown(input: {
  readonly title: string
  readonly originalPath: string
  readonly attachment: string
  readonly format: string
  readonly stagedAt: string
}): string {
  return [
    "---",
    "source_type: image",
    `title: ${yamlDoubleQuotedScalar(input.title)}`,
    `original_file: ${yamlDoubleQuotedScalar(input.originalPath)}`,
    `attachment: ${yamlDoubleQuotedScalar(input.attachment)}`,
    `source_format: ${yamlDoubleQuotedScalar(input.format)}`,
    `staged_at: ${input.stagedAt}`,
    "---",
    "",
    `# Image Intake: ${input.title}`,
    "",
    `Attachment: ![[${input.attachment}]]`,
    "",
    "Synapse image intake record. During `/wiki ingest`, read the attachment image and create the durable visual/OCR description under `wiki/sources/`.",
    "",
  ].join("\n")
}

function yamlDoubleQuotedScalar(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`
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

async function copyFileToAvailablePath(sourcePath: string, directoryPath: string, fileName: string): Promise<string> {
  return writeToAvailablePath(directoryPath, fileName, async (candidate) => {
    await copyFile(sourcePath, candidate, constants.COPYFILE_EXCL)
  })
}

async function writeUtf8FileToAvailablePath(directoryPath: string, fileName: string, content: string): Promise<string> {
  return writeToAvailablePath(directoryPath, fileName, async (candidate) => {
    await writeFile(candidate, content, { encoding: "utf8", flag: "wx" })
  })
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
  return slug || "source"
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
  const relative = path.relative(root, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
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
