import { createHash } from "node:crypto"
import type { Stats } from "node:fs"
import { lstat, open, opendir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { parseFrontmatterBlock } from "../../src/definitions/editor/shared-yaml-scalar"
import {
  assertNoRuntimeSkillEnvPath,
  assertUniqueContentAttachmentPaths,
  isRootSkillEnvExamplePath,
  normalizeContentAttachmentPath,
} from "../../src/lib/content-attachments"
import type { SynapseCreateSkillFilePayload } from "../../src/types/content"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { ContentCapabilityError } from "./content-capability-errors"
import {
  CONTENT_SKILL_ATTACHMENT_MAX_COUNT,
  CONTENT_SKILL_ATTACHMENT_MAX_SIZE,
  CONTENT_SKILL_ATTACHMENT_TOTAL_MAX_SIZE,
  CONTENT_SKILL_SOURCE_MAX_DEPTH,
  CONTENT_SKILL_SOURCE_MAX_DIRECTORY_COUNT,
  CONTENT_SKILL_SOURCE_MAX_ENTRIES_PER_DIRECTORY,
} from "./content-skill-attachment-constraints"
import { sanitizeError } from "./error-sanitize"
import { createMainLogger } from "./log-store"
import { assertSkillRuntimeEnvByteLength } from "./skill-env/file-policy"

const logger = createMainLogger("service.content-skill-source")
const SYNAPSE_SKILL_ID_FILE = ".synapse.json"
const SYNAPSE_SKILL_REPOSITORY_ID_FILE = ".synapse.repository.json"
const SKILL_MAIN_FILE_PRIORITY = [
  "SKILL.md",
  "skill.md",
  "README.md",
  "readme.md",
  "index.md",
]
type ContentSkillSourceSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

type ContentSkillSourceDraft = {
  content: string
  files: SynapseCreateSkillFilePayload[]
  mainFilePath: string
  metadata: Record<string, string>
  publishFingerprint: string
  sourceFingerprint: string
  sourceImportSummary: SkillSourceImportSummary
  sourceDirectoryPath: string
}

type SkillSourceReadMode = "install" | "publish"

type SkillSourceImportSummary = {
  controlFilesExcluded: string[]
  fileCount: number
  hiddenEntryCount: number
  runtimeEnvExcluded: boolean
  symlinkCount: number
  totalBytes: number
}

type SkillFileCollectionState = {
  controlFilesExcluded: string[]
  directoryCount: number
  fileCount: number
  files: SynapseCreateSkillFilePayload[]
  hiddenEntryCount: number
  runtimeEnvExcluded: boolean
  symlinkCount: number
  totalSize: number
}

async function resolveSkillMainFile(dirPath: string, maxEntries?: number): Promise<string | null> {
  let children: string[]
  try {
    const entryLimit = maxEntries ?? CONTENT_SKILL_SOURCE_MAX_ENTRIES_PER_DIRECTORY
    children = []
    const directory = await opendir(dirPath)
    for await (const entry of directory) {
      children.push(entry.name)
      if (children.length > entryLimit) {
        if (maxEntries === undefined) {
          throwInvalid("sourceDirectoryPath", `Skill 源目录根层条目超过 ${entryLimit} 个。`)
        }
        break
      }
    }
  } catch (error) {
    if (error instanceof ContentCapabilityError) throw error
    logger.warn("Failed to read skill source directory.", {
      ...sourcePathDiagnostic(dirPath),
      error: sanitizeSkillSourceError(error),
    })
    return null
  }

  for (const candidate of SKILL_MAIN_FILE_PRIORITY) {
    if (children.includes(candidate)) {
      return await resolveTrustedSkillMainFile(dirPath, path.join(dirPath, candidate))
    }
  }

  const mdFiles = children.filter((fileName) => fileName.endsWith(".md")).sort()
  return mdFiles.length > 0 ? await resolveTrustedSkillMainFile(dirPath, path.join(dirPath, mdFiles[0] ?? "")) : null
}

async function resolveRootSkillMainFile(dirPath: string): Promise<string | null> {
  return resolveTrustedSkillMainFile(dirPath, path.join(dirPath, "SKILL.md"))
}

async function resolveTrustedSkillMainFile(dirPath: string, filePath: string): Promise<string | null> {
  let info: Awaited<ReturnType<typeof lstat>>
  try {
    info = await lstat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }
    throw error
  }

  if (info.isSymbolicLink()) {
    throwInvalid("sourceDirectoryPath", `Skill 主文件不能是符号链接：${path.basename(filePath)}`)
  }
  if (!info.isFile()) {
    return null
  }

  const [dirRealPath, fileRealPath] = await Promise.all([
    realpath(dirPath),
    realpath(filePath),
  ])
  if (!isPathInside(dirRealPath, fileRealPath)) {
    throwInvalid("sourceDirectoryPath", "Skill 主文件必须位于 Skill 源目录内。")
  }

  return filePath
}

async function readSkillDraftFromDirectory(
  sourceDirectoryPath: string,
  security?: ContentSkillSourceSecurityDeps,
  options: { mode?: SkillSourceReadMode } = {},
): Promise<ContentSkillSourceDraft> {
  const dirPath = sourceDirectoryPath
  if (!dirPath.trim()) {
    throwInvalid("sourceDirectoryPath", "sourceDirectoryPath 不能为空。")
  }

  const auditMetadata = { operation: "read-skill-source-directory" }
  await checkSkillSourceReadPermission(security, dirPath, auditMetadata)

  try {
    const directoryInfo = await lstat(dirPath)
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
      throwInvalid("sourceDirectoryPath", "Skill 源路径必须是文件夹。")
    }
    const sourceRealPath = await realpath(dirPath)

    const mainFilePath = await resolveSkillMainFile(dirPath)
    if (!mainFilePath) {
      throwInvalid("sourceDirectoryPath", "未找到 Skill 主文件。")
    }

    const mainFileStat = await inspectSkillMainFile(mainFilePath)
    const content = Buffer.from(await readVerifiedRegularFile(
      sourceRealPath,
      mainFilePath,
      mainFileStat,
      "content",
      "Skill 主文件在读取期间发生变化。",
    )).toString("utf8")
    if (!content.trim()) {
      throwInvalid("content", "Skill 主说明为空。")
    }
    const controlFiles = [SYNAPSE_SKILL_ID_FILE, SYNAPSE_SKILL_REPOSITORY_ID_FILE]
    const skip = new Set<string>([path.basename(mainFilePath), ...controlFiles])
    const state: SkillFileCollectionState = {
      controlFilesExcluded: [],
      directoryCount: 0,
      fileCount: 0,
      files: [],
      hiddenEntryCount: 0,
      runtimeEnvExcluded: false,
      symlinkCount: 0,
      totalSize: mainFileStat.size,
    }
    await collectSkillFiles(dirPath, sourceRealPath, dirPath, skip, state, 0, options.mode ?? "install")
    state.files.sort((a, b) => a.originalName.localeCompare(b.originalName))
    assertUniqueSkillAttachmentPaths(state.files)
    recordSkillSourceAudit(security, dirPath, "allowed", auditMetadata)

    return {
      sourceDirectoryPath: dirPath,
      mainFilePath,
      content,
      files: state.files,
      metadata: parseFrontmatter(content).metadata,
      publishFingerprint: createSkillPublishFingerprint(parseFrontmatter(content).body, state.files),
      sourceFingerprint: createSkillSourceFingerprint(content, state.files),
      sourceImportSummary: {
        controlFilesExcluded: state.controlFilesExcluded.sort(),
        fileCount: state.fileCount + 1,
        hiddenEntryCount: state.hiddenEntryCount,
        runtimeEnvExcluded: state.runtimeEnvExcluded,
        symlinkCount: state.symlinkCount,
        totalBytes: state.totalSize,
      },
    }
  } catch (error) {
    recordSkillSourceAudit(security, dirPath, "failed", auditMetadata)
    throw error
  }
}

async function inspectSkillMainFile(mainFilePath: string): Promise<Stats> {
  let fileStat: Stats
  try {
    fileStat = await lstat(mainFilePath)
  } catch (error) {
    logger.warn("Failed to inspect skill main file.", {
      ...sourcePathDiagnostic(mainFilePath),
      error: sanitizeSkillSourceError(error),
    })
    throwInvalid("content", "无法检查 Skill 主文件。")
  }

  if (fileStat.size > CONTENT_SKILL_ATTACHMENT_MAX_SIZE) {
    throwInvalid("content", "Skill 主文件超过 10MB。")
  }

  return fileStat
}

async function collectSkillFiles(
  baseDir: string,
  baseRealPath: string,
  currentDir: string,
  skip: Set<string>,
  state: SkillFileCollectionState,
  depth: number,
  mode: SkillSourceReadMode,
): Promise<void> {
  let directory
  try {
    directory = await opendir(currentDir)
  } catch (error) {
    logger.warn("Failed to list skill source files.", {
      ...sourcePathDiagnostic(currentDir, baseDir),
      error: sanitizeSkillSourceError(error),
    })
    throwInvalid("files", `无法读取 Skill 附件目录：${formatSkillSourceRelativePath(baseDir, currentDir)}`)
  }

  let entryCount = 0
  try {
    for await (const entry of directory) {
      entryCount += 1
      if (entryCount > CONTENT_SKILL_SOURCE_MAX_ENTRIES_PER_DIRECTORY) {
        throwInvalid(
          "files",
          `Skill 附件目录条目超过 ${CONTENT_SKILL_SOURCE_MAX_ENTRIES_PER_DIRECTORY} 个：${formatSkillSourceRelativePath(baseDir, currentDir)}`,
        )
      }
      const name = entry.name
      if (currentDir === baseDir && mode === "install") {
        try {
          assertNoRuntimeSkillEnvPath([name])
        } catch (error) {
          throwInvalid("files", getErrorMessage(error))
        }
      }
      const normalizedHiddenName = name.toLowerCase()
      const isRootEnvExample = currentDir === baseDir && isRootSkillEnvExamplePath(name)
      if (
        !isRootEnvExample
        && (normalizedHiddenName === ".env" || normalizedHiddenName.startsWith(".env."))
      ) {
        state.runtimeEnvExcluded = true
        continue
      }
      if (currentDir === baseDir && skip.has(name)) {
        if (controlFileName(name)) state.controlFilesExcluded.push(name)
        continue
      }
      if (name.startsWith(".") && !isRootEnvExample) {
        state.hiddenEntryCount += 1
        continue
      }

      const fullPath = path.join(currentDir, name)
      let fileStat: Stats
      try {
        fileStat = await lstat(fullPath)
      } catch (error) {
        logger.warn("Failed to inspect skill source file.", {
          ...sourcePathDiagnostic(fullPath, baseDir),
          error: sanitizeSkillSourceError(error),
        })
        throwInvalid("files", `无法检查 Skill 附件：${formatSkillSourceRelativePath(baseDir, fullPath)}`)
      }

      if (fileStat.isSymbolicLink()) {
        state.symlinkCount += 1
        continue
      }

      if (fileStat.isDirectory()) {
        const nextDepth = depth + 1
        if (nextDepth > CONTENT_SKILL_SOURCE_MAX_DEPTH) {
          throwInvalid("files", `Skill 附件目录深度超过 ${CONTENT_SKILL_SOURCE_MAX_DEPTH} 层。`)
        }
        state.directoryCount += 1
        if (state.directoryCount > CONTENT_SKILL_SOURCE_MAX_DIRECTORY_COUNT) {
          throwInvalid("files", `Skill 附件目录数量超过 ${CONTENT_SKILL_SOURCE_MAX_DIRECTORY_COUNT} 个。`)
        }
        await collectSkillFiles(baseDir, baseRealPath, fullPath, skip, state, nextDepth, mode)
        continue
      }

      if (!fileStat.isFile()) continue
      await collectSkillFile(baseDir, baseRealPath, fullPath, fileStat, state)
    }
  } catch (error) {
    if (error instanceof ContentCapabilityError) throw error
    logger.warn("Failed to list skill source files.", {
      ...sourcePathDiagnostic(currentDir, baseDir),
      error: sanitizeSkillSourceError(error),
    })
    throwInvalid("files", `无法读取 Skill 附件目录：${formatSkillSourceRelativePath(baseDir, currentDir)}`)
  }
}

async function collectSkillFile(
  baseDir: string,
  baseRealPath: string,
  fullPath: string,
  fileStat: Stats,
  state: SkillFileCollectionState,
): Promise<void> {
  const relativeName = normalizeContentAttachmentPath(toPortableRelativePath(path.relative(baseDir, fullPath)))
  if (!relativeName) return

  if (isRootSkillEnvExamplePath(relativeName)) {
    try {
      assertSkillRuntimeEnvByteLength(fileStat.size)
    } catch (error) {
      throwInvalid("files", getErrorMessage(error))
    }
  }

  if (fileStat.size > CONTENT_SKILL_ATTACHMENT_MAX_SIZE) {
    throwInvalid("files", `附件超过 10MB：${relativeName}`)
  }

  state.fileCount += 1
  if (state.fileCount > CONTENT_SKILL_ATTACHMENT_MAX_COUNT) {
    throwInvalid("files", `附件数量超过 ${CONTENT_SKILL_ATTACHMENT_MAX_COUNT} 个。`)
  }

  state.totalSize += fileStat.size
  if (state.totalSize > CONTENT_SKILL_ATTACHMENT_TOTAL_MAX_SIZE) {
    throwInvalid("files", "Skill 文件总大小超过 50MB。")
  }

  try {
    const bytes = await readVerifiedRegularFile(
      baseRealPath,
      fullPath,
      fileStat,
      "files",
      `Skill 附件在读取期间发生变化：${relativeName}`,
    )
    state.files.push({
      originalName: relativeName,
      size: bytes.byteLength,
      bytes,
    })
  } catch (error) {
    if (error instanceof ContentCapabilityError) throw error
    logger.warn("Failed to read skill source attachment.", {
      ...sourcePathDiagnostic(fullPath, baseDir),
      error: sanitizeSkillSourceError(error),
    })
    throwInvalid("files", `无法读取 Skill 附件：${relativeName}`)
  }
}

async function readVerifiedRegularFile(
  baseRealPath: string,
  filePath: string,
  expected: Stats,
  field: "content" | "files",
  changedMessage: string,
): Promise<Uint8Array> {
  const resolvedPath = await realpath(filePath)
  if (!isPathInside(baseRealPath, resolvedPath)) {
    throwInvalid(field, changedMessage)
  }
  const handle = await open(filePath, "r")
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || !sameFileSnapshot(expected, opened)) {
      throwInvalid(field, changedMessage)
    }

    const buffer = Buffer.allocUnsafe(expected.size + 1)
    let offset = 0
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }

    const [afterRead, pathAfterRead] = await Promise.all([
      handle.stat(),
      lstat(filePath),
    ])
    if (
      offset !== expected.size
      || pathAfterRead.isSymbolicLink()
      || !pathAfterRead.isFile()
      || !sameFileSnapshot(expected, afterRead)
      || !sameFileSnapshot(expected, pathAfterRead)
    ) {
      throwInvalid(field, changedMessage)
    }
    return Uint8Array.from(buffer.subarray(0, offset))
  } finally {
    await handle.close()
  }
}

function sameFileSnapshot(
  expected: Stats,
  actual: Stats,
): boolean {
  return expected.dev === actual.dev
    && expected.ino === actual.ino
    && expected.mode === actual.mode
    && expected.size === actual.size
    && expected.mtimeMs === actual.mtimeMs
    && expected.ctimeMs === actual.ctimeMs
}

function controlFileName(name: string): boolean {
  return name === SYNAPSE_SKILL_ID_FILE || name === SYNAPSE_SKILL_REPOSITORY_ID_FILE
}

function createSkillSourceFingerprint(
  content: string,
  files: SynapseCreateSkillFilePayload[],
): string {
  const hash = createHash("sha256")
  hash.update(content.replace(/\r\n/g, "\n").trim())
  for (const file of files) {
    if (!file.bytes) throwInvalid("files", `无法读取 Skill 附件：${file.originalName}`)
    hash.update("\0")
    hash.update(file.originalName)
    hash.update("\0")
    hash.update(file.bytes)
  }
  return `sha256:${hash.digest("hex")}`
}

function createSkillPublishFingerprint(
  content: string,
  files: readonly Pick<SynapseCreateSkillFilePayload, "bytes" | "originalName">[],
): string {
  const hash = createHash("sha256")
  hash.update(normalizePublishContent(content))
  for (const file of [...files].sort((left, right) => left.originalName.localeCompare(right.originalName))) {
    if (!file.bytes) throwInvalid("files", `无法读取 Skill 附件：${file.originalName}`)
    hash.update("\0")
    hash.update(file.originalName)
    hash.update("\0")
    hash.update(createHash("sha256").update(file.bytes).digest("hex"))
  }
  return `sha256:${hash.digest("hex")}`
}

function createStoredSkillPublishFingerprint(
  content: string,
  files: readonly { originalName: string; sha256: string }[],
): string {
  const hash = createHash("sha256")
  hash.update(normalizePublishContent(content))
  for (const file of [...files].sort((left, right) => left.originalName.localeCompare(right.originalName))) {
    hash.update("\0")
    hash.update(file.originalName)
    hash.update("\0")
    hash.update(file.sha256)
  }
  return `sha256:${hash.digest("hex")}`
}

function normalizePublishContent(content: string): string {
  return content.replace(/\r\n?/gu, "\n").trim()
}

function parseFrontmatter(text: string): { metadata: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { metadata: {}, body: text }

  const endIndex = text.indexOf("\n---", 3)
  if (endIndex === -1) return { metadata: {}, body: text }

  const block = text.slice(4, endIndex)
  const { metadata } = parseFrontmatterBlock(block)
  return { metadata, body: text.slice(endIndex + 4).trim() }
}

function assertUniqueSkillAttachmentPaths(files: SynapseCreateSkillFilePayload[]): void {
  try {
    assertUniqueContentAttachmentPaths(files.map((file) => file.originalName))
  } catch (error) {
    throw new ContentCapabilityError("CONTENT_INVALID_INPUT", getErrorMessage(error), {
      fields: { files: getErrorMessage(error) },
      cause: error,
    })
  }
}

async function checkSkillSourceReadPermission(
  deps: ContentSkillSourceSecurityDeps | undefined,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps) return
  const permission = await deps.permissionGuard.check({
    action: "fs.read.outside-userdata",
    actor: deps.actor,
    context: metadata,
    resource,
  })
  if (!permission.allowed) {
    deps.auditSink.record({
      action: "fs.read.outside-userdata",
      actor: deps.actor,
      metadata: {
        ...metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
      outcome: "denied",
      resource,
    })
    throw new ContentCapabilityError("CONTENT_FORBIDDEN", permission.reason)
  }
}

function recordSkillSourceAudit(
  deps: ContentSkillSourceSecurityDeps | undefined,
  resource: string,
  outcome: "allowed" | "failed",
  metadata: Record<string, unknown>,
): void {
  deps?.auditSink.record({
    action: "fs.read.outside-userdata",
    actor: deps.actor,
    metadata,
    outcome,
    resource,
  })
}

async function assertDirectoryExists(dirPath: string): Promise<void> {
  const info = await stat(dirPath)
  if (!info.isDirectory()) {
    throwInvalid("sourceDirectoryPath", "Skill 源路径必须是文件夹。")
  }
}

function toPortableRelativePath(relativeName: string): string {
  return relativeName.split(path.sep).join("/")
}

function formatSkillSourceRelativePath(baseDir: string, targetPath: string): string {
  return normalizeContentAttachmentPath(toPortableRelativePath(path.relative(baseDir, targetPath))) || "."
}

function sourcePathDiagnostic(targetPath: string, baseDir?: string): Record<string, unknown> {
  if (!baseDir) {
    return {
      sourcePathLength: targetPath.length,
    }
  }
  const relativePath = formatSkillSourceRelativePath(baseDir, targetPath)
  return {
    relativePathHash: hashLogPath(relativePath),
    relativePathLength: relativePath.length,
    sourcePathLength: targetPath.length,
  }
}

function hashLogPath(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12)
}

function sanitizeSkillSourceError(error: unknown): string {
  return sanitizeError(getErrorMessage(error))
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function throwInvalid(field: string, message: string): never {
  throw new ContentCapabilityError("CONTENT_INVALID_INPUT", message, {
    fields: { [field]: message },
  })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export {
  assertDirectoryExists,
  createStoredSkillPublishFingerprint,
  readSkillDraftFromDirectory,
  resolveRootSkillMainFile,
  resolveSkillMainFile,
  SYNAPSE_SKILL_ID_FILE,
  SYNAPSE_SKILL_REPOSITORY_ID_FILE,
  type ContentSkillSourceDraft,
  type ContentSkillSourceSecurityDeps,
  type SkillSourceImportSummary,
  type SkillSourceReadMode,
}
