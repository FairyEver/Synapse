import { constants } from "node:fs"
import { access, copyFile, lstat, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import type { SynapseKnowledgeBaseUploadSourcesResult } from "../../../src/types/knowledge-base"
import type { FileConversionResult } from "../file-conversion"
import { sourceFrontmatter } from "../file-conversion/markdown"

type SourceConverter = {
  convert(input: { readonly filePath: string }): Promise<FileConversionResult>
}

export interface StageKnowledgeBaseSourcesInput {
  readonly projectPath: string
  readonly filePaths: readonly string[]
  readonly now: () => Date
  readonly converter: SourceConverter
}

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
): Promise<SynapseKnowledgeBaseUploadSourcesResult> {
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
        const imageTargetPath = await resolveCollisionPath(imageDir, path.basename(sourcePath))
        await copyFile(sourcePath, imageTargetPath)
        const imageRelativePath = normalizeRelativePath(path.relative(projectPath, imageTargetPath))

        const rawRelativeDir = path.join(".raw", "images", ...datePathSegments(input.now()))
        const rawDir = assertInside(projectPath, path.join(projectPath, rawRelativeDir))
        await assertNoSymlinkInRelativePath(projectPath, rawRelativeDir)
        await mkdir(rawDir, { recursive: true })
        const intakePath = await resolveCollisionPath(rawDir, `${path.parse(sourcePath).name}.md`)
        await writeFile(intakePath, imageIntakeMarkdown({
          title: path.parse(sourcePath).name,
          originalPath: filePath,
          attachment: imageRelativePath,
          format: extension.slice(1),
          stagedAt: input.now().toISOString(),
        }), "utf8")
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
        const targetPath = await resolveCollisionPath(targetDir, path.basename(sourcePath))
        await copyFile(sourcePath, targetPath)
        uploaded.push({
          originalPath: filePath,
          relativePath: normalizeRelativePath(path.relative(projectPath, targetPath)),
          name: path.basename(targetPath),
          size: sourceStat.size,
        })
        continue
      }

      if (!CONVERTIBLE_EXTENSIONS.has(extension)) {
        const targetRelativeDir = path.join(".raw", ...datePathSegments(input.now()))
        const targetDir = assertInside(projectPath, path.join(projectPath, targetRelativeDir))
        await assertNoSymlinkInRelativePath(projectPath, targetRelativeDir)
        await mkdir(targetDir, { recursive: true })
        const targetPath = await resolveCollisionPath(targetDir, path.basename(sourcePath))
        await copyFile(sourcePath, targetPath)
        uploaded.push({
          originalPath: filePath,
          relativePath: normalizeRelativePath(path.relative(projectPath, targetPath)),
          name: path.basename(targetPath),
          size: sourceStat.size,
        })
        continue
      }

      const originalRelativeDir = path.join("_attachments", "originals", ...datePathSegments(input.now()))
      const originalDir = assertInside(projectPath, path.join(projectPath, originalRelativeDir))
      await assertNoSymlinkInRelativePath(projectPath, originalRelativeDir)
      await mkdir(originalDir, { recursive: true })
      const originalPath = await resolveCollisionPath(originalDir, path.basename(sourcePath))
      await copyFile(sourcePath, originalPath)
      const originalRelativePath = normalizeRelativePath(path.relative(projectPath, originalPath))

      let converted: FileConversionResult
      try {
        converted = await input.converter.convert({ filePath: sourcePath })
      } catch {
        skipped.push({ path: filePath, reason: "conversion-error" })
        continue
      }

      const rawKindDir = rawDirectoryForKind(converted.kind)
      const rawRelativeDir = path.join(".raw", rawKindDir, ...datePathSegments(input.now()))
      const rawDir = assertInside(projectPath, path.join(projectPath, rawRelativeDir))
      await assertNoSymlinkInRelativePath(projectPath, rawRelativeDir)
      await mkdir(rawDir, { recursive: true })
      const markdownPath = await resolveCollisionPath(rawDir, `${path.parse(sourcePath).name}.md`)
      const markdown = [
        sourceFrontmatter({
          sourceOriginal: originalRelativePath,
          sourceFormat: converted.format,
          convertedAt: input.now().toISOString(),
        }),
        converted.markdown.trim(),
        "",
      ].join("\n")
      await writeFile(markdownPath, markdown, "utf8")
      uploaded.push({
        originalPath: filePath,
        relativePath: normalizeRelativePath(path.relative(projectPath, markdownPath)),
        originalRelativePath,
        name: path.basename(markdownPath),
        size: sourceStat.size,
        conversionWarnings: [...converted.warnings],
      })
    } catch {
      skipped.push({ path: filePath, reason: "read-error" })
    }
  }

  return { projectPath, uploaded, skipped }
}

function rawDirectoryForKind(kind: FileConversionResult["kind"]): string {
  if (kind === "document") return "documents"
  if (kind === "spreadsheet") return "spreadsheets"
  if (kind === "presentation") return "presentations"
  return "pdfs"
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
    `title: "${input.title.replaceAll("\"", "\\\"")}"`,
    `original_file: "${input.originalPath.replaceAll("\"", "\\\"")}"`,
    `attachment: ${input.attachment}`,
    `source_format: ${input.format}`,
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

async function resolveCollisionPath(directoryPath: string, fileName: string): Promise<string> {
  const parsed = path.parse(fileName)
  let candidate = path.join(directoryPath, fileName)
  let index = 2
  while (await pathExists(candidate)) {
    candidate = path.join(directoryPath, `${parsed.name}-${index}${parsed.ext}`)
    index += 1
  }
  return candidate
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
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
