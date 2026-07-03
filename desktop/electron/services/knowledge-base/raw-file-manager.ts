import { constants, type Dirent } from "node:fs"
import { access, copyFile, lstat, mkdir, readdir, realpath, rename } from "node:fs/promises"
import path from "node:path"

import type {
  SynapseKnowledgeBaseRawEntry,
  SynapseKnowledgeBaseRawMutationResult,
} from "../../../src/types/knowledge-base"
import { isPathInsideDirectory } from "../../../src/lib/path-compare"
import { validateKnowledgeBaseRawEntryNameInput } from "../../../src/lib/knowledge-base-raw-entry-name"
import {
  KNOWLEDGE_BASE_RAW_EXPORT_MAX_DEPTH,
  KNOWLEDGE_BASE_RAW_EXPORT_MAX_ENTRIES,
  KNOWLEDGE_BASE_RAW_EXPORT_MAX_FILES,
  KNOWLEDGE_BASE_RAW_EXPORT_MAX_FILE_BYTES,
  KNOWLEDGE_BASE_RAW_EXPORT_MAX_TOTAL_BYTES,
  KNOWLEDGE_BASE_RAW_UPLOAD_MAX_DEPTH,
  KNOWLEDGE_BASE_RAW_UPLOAD_MAX_FILE_BYTES,
  KNOWLEDGE_BASE_RAW_UPLOAD_MAX_FILES,
  KNOWLEDGE_BASE_RAW_UPLOAD_MAX_TOTAL_BYTES,
} from "../../../config"
import { knowledgeBaseErrorMeta, knowledgeBaseLogger } from "./logging"

type TrashItem = (targetPath: string) => Promise<void>
type RawUploadSkipReason = SynapseKnowledgeBaseRawMutationResult["skipped"][number]["reason"]
type RawUploadLimits = {
  readonly maxFiles: number
  readonly maxDepth: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
}
type RawExportLimits = RawUploadLimits & {
  readonly maxEntries: number
}
type RawUploadBudget = {
  copiedFiles: number
  copiedBytes: number
  stopped: boolean
  stopReason?: RawUploadSkipReason
}
type RawExportBudget = {
  copiedFiles: number
  copiedBytes: number
}
type RawEntryListOptions = {
  readonly entryKind?: "all" | "directory"
  readonly query?: string
  readonly offset?: number
  readonly limit?: number
}
type RawEntryListPage = {
  readonly entries: SynapseKnowledgeBaseRawEntry[]
  readonly totalCount: number
  readonly offset: number
  readonly limit?: number
  readonly hasMore: boolean
}
export type SynapseKnowledgeBaseRawMoveResult = Omit<SynapseKnowledgeBaseRawMutationResult, "projectId"> & {
  readonly moved: Array<{
    readonly from: string
    readonly to: string
  }>
}

export interface RawFileManagerDeps {
  readonly trashItem: TrashItem
  readonly uploadLimits?: Partial<RawUploadLimits>
  readonly exportLimits?: Partial<RawExportLimits>
}

export class KnowledgeBaseRawFileManager {
  private readonly trashItem: TrashItem
  private readonly uploadLimits: RawUploadLimits
  private readonly exportLimits: RawExportLimits

  constructor(deps: RawFileManagerDeps) {
    this.trashItem = deps.trashItem
    this.uploadLimits = {
      maxFiles: KNOWLEDGE_BASE_RAW_UPLOAD_MAX_FILES,
      maxDepth: KNOWLEDGE_BASE_RAW_UPLOAD_MAX_DEPTH,
      maxFileBytes: KNOWLEDGE_BASE_RAW_UPLOAD_MAX_FILE_BYTES,
      maxTotalBytes: KNOWLEDGE_BASE_RAW_UPLOAD_MAX_TOTAL_BYTES,
      ...deps.uploadLimits,
    }
    this.exportLimits = {
      maxEntries: KNOWLEDGE_BASE_RAW_EXPORT_MAX_ENTRIES,
      maxFiles: KNOWLEDGE_BASE_RAW_EXPORT_MAX_FILES,
      maxDepth: KNOWLEDGE_BASE_RAW_EXPORT_MAX_DEPTH,
      maxFileBytes: KNOWLEDGE_BASE_RAW_EXPORT_MAX_FILE_BYTES,
      maxTotalBytes: KNOWLEDGE_BASE_RAW_EXPORT_MAX_TOTAL_BYTES,
      ...deps.exportLimits,
    }
  }

  async list(rawRoot: string, directoryPath: string): Promise<SynapseKnowledgeBaseRawEntry[]> {
    return (await this.listPage(rawRoot, directoryPath)).entries
  }

  async listPage(rawRoot: string, directoryPath: string, options: RawEntryListOptions = {}): Promise<RawEntryListPage> {
    const directory = resolveRawPath(rawRoot, directoryPath)
    await assertNoSymlinkInRawPath(rawRoot, directoryPath)
    const stat = await lstat(directory)
    if (!stat.isDirectory()) throw new Error("目标不是文件夹。")
    const query = options.query?.trim().toLowerCase() ?? ""
    const entryKind = options.entryKind ?? "all"
    const offset = Math.max(0, options.offset ?? 0)
    const limit = options.limit === undefined ? undefined : Math.max(1, options.limit)
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => {
        if (entry.isSymbolicLink()) return false
        if (!entry.isFile() && !entry.isDirectory()) return false
        if (entryKind === "directory" && !entry.isDirectory()) return false
        const relativePath = normalizeRelativePath(path.join(normalizeRawPath(directoryPath), entry.name))
        if (isRootInternalRawFile(relativePath)) return false
        if (!query) return true
        return `${entry.name}\n${relativePath}`.toLowerCase().includes(query)
      })
      .sort(compareRawDirents)
    const totalCount = entries.length
    const pageEntries = limit === undefined ? entries.slice(offset) : entries.slice(offset, offset + limit)
    const result = await mapWithConcurrency(pageEntries, 32, async (entry) => {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = normalizeRelativePath(path.relative(rawRoot, absolutePath))
      const entryStat = await lstat(absolutePath)
      const kind: SynapseKnowledgeBaseRawEntry["kind"] = entry.isDirectory() ? "directory" : "file"
      return {
        name: entry.name,
        relativePath,
        kind,
        size: kind === "directory" ? null : entryStat.size,
        modifiedAt: entryStat.mtime.toISOString(),
      }
    })
    return {
      entries: result,
      totalCount,
      offset,
      limit,
      hasMore: limit !== undefined && offset + limit < totalCount,
    }
  }

  async createFolder(rawRoot: string, parentDirectoryPath: string, name: string): Promise<SynapseKnowledgeBaseRawEntry> {
    validateEntryName(name)
    const parent = resolveRawPath(rawRoot, parentDirectoryPath)
    await assertNoSymlinkInRawPath(rawRoot, parentDirectoryPath)
    const target = resolveRawPath(rawRoot, joinRawPath(parentDirectoryPath, name))
    if (await pathExists(target)) throw new Error("文件夹已存在。")
    await mkdir(parent, { recursive: true })
    await mkdir(target)
    return entryForPath(rawRoot, target, "directory")
  }

  async uploadFiles(
    rawRoot: string,
    targetDirectoryPath: string,
    filePaths: readonly string[],
  ): Promise<Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">> {
    const targetDirectory = resolveRawPath(rawRoot, targetDirectoryPath)
    await assertNoSymlinkInRawPath(rawRoot, targetDirectoryPath)
    await mkdir(targetDirectory, { recursive: true })
    const entries: SynapseKnowledgeBaseRawEntry[] = []
    const skipped: SynapseKnowledgeBaseRawMutationResult["skipped"] = []
    const budget: RawUploadBudget = { copiedFiles: 0, copiedBytes: 0, stopped: false }
    for (const filePath of filePaths) {
      if (budget.stopped) {
        skipped.push({ path: filePath, reason: budget.stopReason ?? "too-large" })
        continue
      }
      try {
        const sourcePath = path.resolve(filePath)
        const sourceStat = await lstat(sourcePath)
        if (!sourceStat.isFile()) {
          knowledgeBaseLogger.warn("Knowledge Base raw file upload skipped.", {
            fileName: path.basename(filePath),
            reason: "not-file",
          })
          skipped.push({ path: filePath, reason: "not-file" })
          continue
        }
        const sourceName = path.basename(sourcePath)
        if (!isValidUploadEntryName(sourceName)) {
          knowledgeBaseLogger.warn("Knowledge Base raw file upload skipped.", {
            fileName: sourceName,
            reason: "invalid-name",
          })
          skipped.push({ path: filePath, reason: "invalid-name" })
          continue
        }
        const nextBudget = { ...budget }
        const budgetFailure = reserveRawUploadFileBudget(sourceStat.size, nextBudget, this.uploadLimits)
        if (budgetFailure) {
          commitRawUploadBudget(budget, nextBudget)
          knowledgeBaseLogger.warn("Knowledge Base raw file upload skipped.", {
            fileName: path.basename(filePath),
            reason: budgetFailure,
            copiedFiles: budget.copiedFiles,
            copiedBytes: budget.copiedBytes,
          })
          skipped.push({ path: filePath, reason: budgetFailure })
          continue
        }
        const targetPath = await copyFileToAvailablePath(sourcePath, targetDirectory, sourceName)
        commitRawUploadBudget(budget, nextBudget)
        entries.push(await entryForPath(rawRoot, targetPath, "file"))
      } catch (error) {
        knowledgeBaseLogger.warn("Knowledge Base raw file upload skipped.", {
          fileName: path.basename(filePath),
          reason: "read-error",
          ...knowledgeBaseErrorMeta(error),
        })
        skipped.push({ path: filePath, reason: "read-error" })
      }
    }
    return { entries: sortEntries(entries), skipped }
  }

  async uploadItems(
    rawRoot: string,
    targetDirectoryPath: string,
    itemPaths: readonly string[],
  ): Promise<Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">> {
    const targetDirectory = resolveRawPath(rawRoot, targetDirectoryPath)
    await assertNoSymlinkInRawPath(rawRoot, targetDirectoryPath)
    await mkdir(targetDirectory, { recursive: true })
    const entries: SynapseKnowledgeBaseRawEntry[] = []
    const skipped: SynapseKnowledgeBaseRawMutationResult["skipped"] = []
    const budget: RawUploadBudget = { copiedFiles: 0, copiedBytes: 0, stopped: false }
    for (const itemPath of itemPaths) {
      if (budget.stopped) {
        skipped.push({ path: itemPath, reason: budget.stopReason ?? "too-large" })
        continue
      }
      await this.copyExternalItem(rawRoot, itemPath, targetDirectory, entries, skipped, budget, 0)
    }
    return { entries: sortEntries(entries), skipped }
  }

  private async copyExternalItem(
    rawRoot: string,
    sourcePath: string,
    targetDirectory: string,
    entries: SynapseKnowledgeBaseRawEntry[],
    skipped: SynapseKnowledgeBaseRawMutationResult["skipped"],
    budget: RawUploadBudget,
    depth: number,
  ): Promise<void> {
    try {
      if (budget.stopped) {
        skipped.push({ path: sourcePath, reason: budget.stopReason ?? "too-large" })
        return
      }
      const resolvedSource = path.resolve(sourcePath)
      const sourceStat = await lstat(resolvedSource)
      const sourceName = path.basename(resolvedSource)
      if (isSystemNoiseFile(sourceName)) {
        knowledgeBaseLogger.warn("Knowledge Base raw item upload skipped.", {
          itemName: sourceName,
          reason: "system-noise",
        })
        skipped.push({ path: sourcePath, reason: "system-noise" })
        return
      }
      if (sourceStat.isSymbolicLink()) {
        knowledgeBaseLogger.warn("Knowledge Base raw item upload skipped.", {
          itemName: sourceName,
          reason: "symlink",
        })
        skipped.push({ path: sourcePath, reason: "symlink" })
        return
      }
      if (!isValidUploadEntryName(sourceName)) {
        knowledgeBaseLogger.warn("Knowledge Base raw item upload skipped.", {
          itemName: sourceName,
          reason: "invalid-name",
        })
        skipped.push({ path: sourcePath, reason: "invalid-name" })
        return
      }
      if (sourceStat.isFile()) {
        const nextBudget = { ...budget }
        const budgetFailure = reserveRawUploadFileBudget(sourceStat.size, nextBudget, this.uploadLimits)
        if (budgetFailure) {
          commitRawUploadBudget(budget, nextBudget)
          knowledgeBaseLogger.warn("Knowledge Base raw item upload skipped.", {
            itemName: path.basename(sourcePath),
            reason: budgetFailure,
            copiedFiles: budget.copiedFiles,
            copiedBytes: budget.copiedBytes,
          })
          skipped.push({ path: sourcePath, reason: budgetFailure })
          return
        }
        const targetPath = await copyFileToAvailablePath(resolvedSource, targetDirectory, sourceName)
        commitRawUploadBudget(budget, nextBudget)
        entries.push(await entryForPath(rawRoot, targetPath, "file"))
        return
      }
      if (sourceStat.isDirectory()) {
        if (depth > this.uploadLimits.maxDepth) {
          knowledgeBaseLogger.warn("Knowledge Base raw item upload skipped.", {
            itemName: path.basename(sourcePath),
            reason: "too-deep",
          })
          skipped.push({ path: sourcePath, reason: "too-deep" })
          return
        }
        await this.copyExternalDirectory(rawRoot, resolvedSource, targetDirectory, entries, skipped, budget, depth)
        return
      }
      knowledgeBaseLogger.warn("Knowledge Base raw item upload skipped.", {
        itemName: path.basename(sourcePath),
        reason: "read-error",
      })
      skipped.push({ path: sourcePath, reason: "read-error" })
    } catch (error) {
      knowledgeBaseLogger.warn("Knowledge Base raw item upload skipped.", {
        itemName: path.basename(sourcePath),
        reason: "read-error",
        ...knowledgeBaseErrorMeta(error),
      })
      skipped.push({ path: sourcePath, reason: "read-error" })
    }
  }

  private async copyExternalDirectory(
    rawRoot: string,
    sourceDirectory: string,
    targetDirectory: string,
    entries: SynapseKnowledgeBaseRawEntry[],
    skipped: SynapseKnowledgeBaseRawMutationResult["skipped"],
    budget: RawUploadBudget,
    depth: number,
  ): Promise<void> {
    const children = await readdir(sourceDirectory, { withFileTypes: true })
    const targetPath = await createAvailableDirectoryPath(targetDirectory, path.basename(sourceDirectory))
    entries.push(await entryForPath(rawRoot, targetPath, "directory"))
    for (const child of children) {
      const childPath = path.join(sourceDirectory, child.name)
      if (budget.stopped) {
        skipped.push({ path: childPath, reason: budget.stopReason ?? "too-large" })
        break
      }
      await this.copyExternalItem(rawRoot, childPath, targetPath, entries, skipped, budget, depth + 1)
    }
  }

  async renameEntry(rawRoot: string, relativePath: string, newName: string): Promise<SynapseKnowledgeBaseRawEntry> {
    validateEntryName(newName)
    const source = resolveRawPath(rawRoot, relativePath)
    await assertNoSymlinkInRawPath(rawRoot, relativePath)
    const sourceStat = await lstat(source)
    const targetRelativePath = joinRawPath(path.posix.dirname(normalizeRawPath(relativePath)), newName)
    const target = resolveRawPath(rawRoot, targetRelativePath)
    if (await pathExists(target)) throw new Error("目标已存在。")
    await rename(source, target)
    return entryForPath(rawRoot, target, sourceStat.isDirectory() ? "directory" : "file")
  }

  async moveEntries(
    rawRoot: string,
    relativePaths: readonly string[],
    targetDirectoryPath: string,
  ): Promise<SynapseKnowledgeBaseRawMoveResult> {
    const targetDirectory = resolveRawPath(rawRoot, targetDirectoryPath)
    await assertNoSymlinkInRawPath(rawRoot, targetDirectoryPath)
    const targetStat = await lstat(targetDirectory)
    if (!targetStat.isDirectory()) throw new Error("目标不是文件夹。")
    const entries: SynapseKnowledgeBaseRawEntry[] = []
    const skipped: SynapseKnowledgeBaseRawMutationResult["skipped"] = []
    const moved: SynapseKnowledgeBaseRawMoveResult["moved"] = []
    for (const relativePath of relativePaths) {
      try {
        const source = resolveRawPath(rawRoot, relativePath)
        await assertNoSymlinkInRawPath(rawRoot, relativePath)
        const sourceStat = await lstat(source)
        if (sourceStat.isDirectory() && isSameOrDescendant(relativePath, targetDirectoryPath)) {
          knowledgeBaseLogger.warn("Knowledge Base raw entry move skipped.", {
            reason: "invalid-path",
            relativePath,
            targetDirectoryPath,
          })
          skipped.push({ path: relativePath, reason: "invalid-path" })
          continue
        }
        const target = path.join(targetDirectory, path.basename(source))
        if (await pathExists(target)) {
          knowledgeBaseLogger.warn("Knowledge Base raw entry move skipped.", {
            reason: "collision",
            relativePath,
            targetDirectoryPath,
          })
          skipped.push({ path: relativePath, reason: "collision" })
          continue
        }
        await rename(source, target)
        const entry = await entryForPath(rawRoot, target, sourceStat.isDirectory() ? "directory" : "file")
        entries.push(entry)
        moved.push({ from: relativePath, to: entry.relativePath })
      } catch (error) {
        const reason = isInvalidRawPathError(error) ? "invalid-path" : "read-error"
        knowledgeBaseLogger.warn("Knowledge Base raw entry move skipped.", {
          reason,
          relativePath,
          ...knowledgeBaseErrorMeta(error),
        })
        skipped.push({
          path: relativePath,
          reason,
        })
      }
    }
    return { entries: sortEntries(entries), skipped, moved }
  }

  async trashEntries(
    rawRoot: string,
    relativePaths: readonly string[],
  ): Promise<Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">> {
    const entries: SynapseKnowledgeBaseRawEntry[] = []
    const skipped: SynapseKnowledgeBaseRawMutationResult["skipped"] = []
    for (const relativePath of relativePaths) {
      try {
        const target = resolveRawPath(rawRoot, relativePath)
        await assertNoSymlinkInRawPath(rawRoot, relativePath)
        const stat = await lstat(target)
        const entry = await entryForPath(rawRoot, target, stat.isDirectory() ? "directory" : "file")
        await this.trashItem(target)
        entries.push(entry)
      } catch (error) {
        const reason = isInvalidRawPathError(error) ? "invalid-path" : "trash-error"
        knowledgeBaseLogger.warn("Knowledge Base raw entry trash skipped.", {
          reason,
          relativePath,
          ...knowledgeBaseErrorMeta(error),
        })
        skipped.push({
          path: relativePath,
          reason,
        })
      }
    }
    return { entries: sortEntries(entries), skipped }
  }

  async exportEntries(
    rawRoot: string,
    relativePaths: readonly string[],
    targetDirectoryPath: string,
  ): Promise<Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">> {
    const targetDirectory = path.resolve(targetDirectoryPath)
    await assertRawExportTargetOutsideRawRoot(rawRoot, targetDirectory)
    await mkdir(targetDirectory, { recursive: true })
    const entries: SynapseKnowledgeBaseRawEntry[] = []
    const skipped: SynapseKnowledgeBaseRawMutationResult["skipped"] = []
    let budget: RawExportBudget = { copiedFiles: 0, copiedBytes: 0 }
    const uniqueRelativePaths = Array.from(new Set(relativePaths))
    for (const [index, relativePath] of uniqueRelativePaths.entries()) {
      try {
        if (index >= this.exportLimits.maxEntries) {
          skipped.push({ path: relativePath, reason: "too-many-files" })
          continue
        }
        const source = resolveRawPath(rawRoot, relativePath)
        await assertNoSymlinkInRawPath(rawRoot, relativePath)
        const nextBudget = { ...budget }
        const budgetFailure = await this.reserveRawEntryForExport(rawRoot, source, nextBudget, 0)
        if (budgetFailure) {
          knowledgeBaseLogger.warn("Knowledge Base raw entry export skipped.", {
            reason: budgetFailure,
            relativePath,
            copiedFiles: budget.copiedFiles,
            copiedBytes: budget.copiedBytes,
          })
          skipped.push({ path: relativePath, reason: budgetFailure })
          continue
        }
        await this.copyRawEntryForExport(rawRoot, source, targetDirectory, entries, skipped)
        budget = nextBudget
      } catch (error) {
        const reason = isInvalidRawPathError(error) ? "invalid-path" : "export-error"
        knowledgeBaseLogger.warn("Knowledge Base raw entry export skipped.", {
          reason,
          relativePath,
          ...knowledgeBaseErrorMeta(error),
        })
        skipped.push({ path: relativePath, reason })
      }
    }
    return { entries: sortEntries(entries), skipped }
  }

  private async reserveRawEntryForExport(
    rawRoot: string,
    sourcePath: string,
    budget: RawExportBudget,
    depth: number,
  ): Promise<RawUploadSkipReason | null> {
    const sourceStat = await lstat(sourcePath)
    const relativePath = normalizeRelativePath(path.relative(rawRoot, sourcePath))
    if (isRootInternalRawFile(relativePath)) {
      return null
    }
    if (isSystemNoiseFile(path.basename(sourcePath)) || sourceStat.isSymbolicLink()) {
      return null
    }
    if (sourceStat.isFile()) {
      return reserveRawExportFileBudget(sourceStat.size, budget, this.exportLimits)
    }
    if (!sourceStat.isDirectory()) {
      return null
    }
    if (depth > this.exportLimits.maxDepth) {
      return "too-deep"
    }
    const children = await readdir(sourcePath, { withFileTypes: true })
    for (const child of children) {
      const failure = await this.reserveRawEntryForExport(rawRoot, path.join(sourcePath, child.name), budget, depth + 1)
      if (failure) return failure
    }
    return null
  }

  private async copyRawEntryForExport(
    rawRoot: string,
    sourcePath: string,
    targetDirectory: string,
    entries: SynapseKnowledgeBaseRawEntry[],
    skipped: SynapseKnowledgeBaseRawMutationResult["skipped"],
  ): Promise<void> {
    const sourceStat = await lstat(sourcePath)
    const relativePath = normalizeRelativePath(path.relative(rawRoot, sourcePath))
    if (isRootInternalRawFile(relativePath)) {
      return
    }
    if (isSystemNoiseFile(path.basename(sourcePath))) {
      knowledgeBaseLogger.warn("Knowledge Base raw entry export skipped.", {
        reason: "system-noise",
        relativePath,
      })
      skipped.push({ path: relativePath, reason: "system-noise" })
      return
    }
    if (sourceStat.isSymbolicLink()) {
      knowledgeBaseLogger.warn("Knowledge Base raw entry export skipped.", {
        reason: "symlink",
        relativePath,
      })
      skipped.push({ path: relativePath, reason: "symlink" })
      return
    }
    if (sourceStat.isFile()) {
      await copyFileToAvailablePath(sourcePath, targetDirectory, path.basename(sourcePath))
      entries.push(await entryForPath(rawRoot, sourcePath, "file"))
      return
    }
    if (!sourceStat.isDirectory()) {
      knowledgeBaseLogger.warn("Knowledge Base raw entry export skipped.", {
        reason: "export-error",
        relativePath,
      })
      skipped.push({ path: relativePath, reason: "export-error" })
      return
    }
    const targetPath = await createAvailableDirectoryPath(targetDirectory, path.basename(sourcePath))
    entries.push(await entryForPath(rawRoot, sourcePath, "directory"))
    const children = await readdir(sourcePath, { withFileTypes: true })
    for (const child of children) {
      await this.copyRawEntryForExport(rawRoot, path.join(sourcePath, child.name), targetPath, entries, skipped)
    }
  }
}

function resolveRawPath(rawRoot: string, rawRelativePath: string): string {
  const root = path.resolve(rawRoot)
  const normalized = normalizeRawPath(rawRelativePath)
  const target = path.resolve(root, normalized)
  if (!isPathInsideDirectory(root, target, { resolvePath: path.resolve })) {
    throw new Error("目标路径不在资料目录中。")
  }
  return target
}

function normalizeRawPath(value: string): string {
  return value.split("\\").join("/").replace(/^\/+/, "").replace(/\/+$/g, "")
}

function joinRawPath(parent: string, name: string): string {
  const normalizedParent = normalizeRawPath(parent)
  return normalizedParent && normalizedParent !== "." ? `${normalizedParent}/${name}` : name
}

function isSystemNoiseFile(name: string): boolean {
  return name === ".DS_Store" || name === "Thumbs.db" || name === "desktop.ini"
}

function isValidUploadEntryName(name: string): boolean {
  return validateKnowledgeBaseRawEntryNameInput(name) === null
}

function reserveRawUploadFileBudget(size: number, budget: RawUploadBudget, limits: RawUploadLimits): RawUploadSkipReason | null {
  if (size > limits.maxFileBytes) return "file-too-large"
  if (budget.copiedFiles + 1 > limits.maxFiles) {
    budget.stopped = true
    budget.stopReason = "too-many-files"
    return "too-many-files"
  }
  if (budget.copiedBytes + size > limits.maxTotalBytes) {
    budget.stopped = true
    budget.stopReason = "too-large"
    return "too-large"
  }
  budget.copiedFiles += 1
  budget.copiedBytes += size
  return null
}

function commitRawUploadBudget(budget: RawUploadBudget, nextBudget: RawUploadBudget): void {
  budget.copiedFiles = nextBudget.copiedFiles
  budget.copiedBytes = nextBudget.copiedBytes
  budget.stopped = nextBudget.stopped
  budget.stopReason = nextBudget.stopReason
}

function reserveRawExportFileBudget(size: number, budget: RawExportBudget, limits: RawExportLimits): RawUploadSkipReason | null {
  if (size > limits.maxFileBytes) return "file-too-large"
  if (budget.copiedFiles + 1 > limits.maxFiles) return "too-many-files"
  if (budget.copiedBytes + size > limits.maxTotalBytes) return "too-large"
  budget.copiedFiles += 1
  budget.copiedBytes += size
  return null
}

function isRootInternalRawFile(relativePath: string): boolean {
  return relativePath === ".gitkeep" || relativePath === ".manifest.json"
}

function validateEntryName(name: string): void {
  const error = validateKnowledgeBaseRawEntryNameInput(name)
  if (error) {
    throw new Error(error)
  }
}

async function assertNoSymlinkInRawPath(rawRoot: string, rawRelativePath: string): Promise<void> {
  const normalized = normalizeRawPath(rawRelativePath)
  if (!normalized) return
  let current = path.resolve(rawRoot)
  for (const segment of normalized.split("/")) {
    current = path.join(current, segment)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) throw new Error("资料路径不能包含符号链接。")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      throw error
    }
  }
}

async function entryForPath(
  rawRoot: string,
  absolutePath: string,
  kind: SynapseKnowledgeBaseRawEntry["kind"],
): Promise<SynapseKnowledgeBaseRawEntry> {
  const stat = await lstat(absolutePath)
  return {
    name: path.basename(absolutePath),
    relativePath: normalizeRelativePath(path.relative(rawRoot, absolutePath)),
    kind,
    size: kind === "directory" ? null : stat.size,
    modifiedAt: stat.mtime.toISOString(),
  }
}

function sortEntries(entries: SynapseKnowledgeBaseRawEntry[]): SynapseKnowledgeBaseRawEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1
    return left.name.localeCompare(right.name, "zh-CN")
  })
}

function compareRawDirents(left: Dirent, right: Dirent): number {
  if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
  return left.name.localeCompare(right.name, "zh-CN")
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index]!)
    }
  }))
  return results
}

async function copyFileToAvailablePath(sourcePath: string, directoryPath: string, fileName: string): Promise<string> {
  const parsed = path.parse(fileName)
  let candidate = path.join(directoryPath, fileName)
  let index = 2
  while (true) {
    try {
      await copyFile(sourcePath, candidate, constants.COPYFILE_EXCL)
      return candidate
    } catch (error) {
      if (!isFileExistsError(error)) throw error
      candidate = path.join(directoryPath, `${parsed.name}-${index}${parsed.ext}`)
      index += 1
    }
  }
}

async function createAvailableDirectoryPath(directoryPath: string, directoryName: string): Promise<string> {
  let candidate = path.join(directoryPath, directoryName)
  let index = 2
  while (true) {
    try {
      await mkdir(candidate)
      return candidate
    } catch (error) {
      if (!isFileExistsError(error)) throw error
      candidate = path.join(directoryPath, `${directoryName}-${index}`)
      index += 1
    }
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch (error) {
    if (!isMissingPathError(error)) {
      knowledgeBaseLogger.warn("Knowledge Base raw path existence check failed.", {
        targetName: path.basename(targetPath),
        ...knowledgeBaseErrorMeta(error),
      })
    }
    return false
  }
}

function isSameOrDescendant(sourcePath: string, targetDirectoryPath: string): boolean {
  const source = normalizeRawPath(sourcePath)
  const target = normalizeRawPath(targetDirectoryPath)
  return isPathInsideDirectory(source, target, { platform: "linux" })
}

async function assertRawExportTargetOutsideRawRoot(rawRoot: string, targetDirectory: string): Promise<void> {
  const resolvedRawRoot = path.resolve(rawRoot)
  const resolvedTarget = path.resolve(targetDirectory)
  if (isAbsoluteSameOrDescendant(resolvedRawRoot, resolvedTarget)) {
    throw new Error("导出目标不能位于知识库资料目录内。")
  }

  const realRawRoot = await realpath(resolvedRawRoot).catch(() => resolvedRawRoot)
  const realTarget = await realpath(resolvedTarget).catch((error: unknown) => {
    if (isMissingPathError(error)) return null
    throw error
  })
  if (realTarget && isAbsoluteSameOrDescendant(realRawRoot, realTarget)) {
    throw new Error("导出目标不能位于知识库资料目录内。")
  }
}

function isAbsoluteSameOrDescendant(parentPath: string, candidatePath: string): boolean {
  return isPathInsideDirectory(parentPath, candidatePath, { resolvePath: path.resolve })
}

function isInvalidRawPathError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes("目标路径不在资料目录中")
    || error.message.includes("资料路径不能包含符号链接")
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === "EEXIST"
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/")
}
