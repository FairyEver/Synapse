import { constants } from "node:fs"
import { access, copyFile, lstat, mkdir, readdir, rename } from "node:fs/promises"
import path from "node:path"

import type {
  SynapseKnowledgeBaseRawEntry,
  SynapseKnowledgeBaseRawMutationResult,
} from "../../../src/types/knowledge-base"

type TrashItem = (targetPath: string) => Promise<void>

export interface RawFileManagerDeps {
  readonly trashItem: TrashItem
}

export class KnowledgeBaseRawFileManager {
  private readonly trashItem: TrashItem

  constructor(deps: RawFileManagerDeps) {
    this.trashItem = deps.trashItem
  }

  async list(rawRoot: string, directoryPath: string): Promise<SynapseKnowledgeBaseRawEntry[]> {
    const directory = resolveRawPath(rawRoot, directoryPath)
    await assertNoSymlinkInRawPath(rawRoot, directoryPath)
    const stat = await lstat(directory)
    if (!stat.isDirectory()) throw new Error("目标不是文件夹。")
    const entries = await readdir(directory, { withFileTypes: true })
    const result: SynapseKnowledgeBaseRawEntry[] = []
    for (const entry of entries) {
      if (entry.name === ".manifest.json") continue
      if (entry.isSymbolicLink()) continue
      if (!entry.isFile() && !entry.isDirectory()) continue
      const absolutePath = path.join(directory, entry.name)
      const relativePath = normalizeRelativePath(path.relative(rawRoot, absolutePath))
      const entryStat = await lstat(absolutePath)
      result.push({
        name: entry.name,
        relativePath,
        kind: entry.isDirectory() ? "directory" : "file",
        size: entry.isDirectory() ? null : entryStat.size,
        modifiedAt: entryStat.mtime.toISOString(),
      })
    }
    return sortEntries(result)
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
    for (const filePath of filePaths) {
      try {
        const sourcePath = path.resolve(filePath)
        const sourceStat = await lstat(sourcePath)
        if (!sourceStat.isFile()) {
          skipped.push({ path: filePath, reason: "not-file" })
          continue
        }
        const targetPath = await resolveCollisionPath(targetDirectory, path.basename(sourcePath))
        await copyFile(sourcePath, targetPath)
        entries.push(await entryForPath(rawRoot, targetPath, "file"))
      } catch (error) {
        void error
        skipped.push({ path: filePath, reason: "read-error" })
      }
    }
    return { entries: sortEntries(entries), skipped }
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
  ): Promise<Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">> {
    const targetDirectory = resolveRawPath(rawRoot, targetDirectoryPath)
    await assertNoSymlinkInRawPath(rawRoot, targetDirectoryPath)
    const targetStat = await lstat(targetDirectory)
    if (!targetStat.isDirectory()) throw new Error("目标不是文件夹。")
    const entries: SynapseKnowledgeBaseRawEntry[] = []
    const skipped: SynapseKnowledgeBaseRawMutationResult["skipped"] = []
    for (const relativePath of relativePaths) {
      try {
        const source = resolveRawPath(rawRoot, relativePath)
        await assertNoSymlinkInRawPath(rawRoot, relativePath)
        const sourceStat = await lstat(source)
        if (sourceStat.isDirectory() && isSameOrDescendant(relativePath, targetDirectoryPath)) {
          skipped.push({ path: relativePath, reason: "invalid-path" })
          continue
        }
        const target = path.join(targetDirectory, path.basename(source))
        if (await pathExists(target)) {
          skipped.push({ path: relativePath, reason: "collision" })
          continue
        }
        await rename(source, target)
        entries.push(await entryForPath(rawRoot, target, sourceStat.isDirectory() ? "directory" : "file"))
      } catch (error) {
        void error
        skipped.push({ path: relativePath, reason: "read-error" })
      }
    }
    return { entries: sortEntries(entries), skipped }
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
        entries.push(await entryForPath(rawRoot, target, stat.isDirectory() ? "directory" : "file"))
        await this.trashItem(target)
      } catch (error) {
        void error
        skipped.push({ path: relativePath, reason: "trash-error" })
      }
    }
    return { entries: sortEntries(entries), skipped }
  }
}

function resolveRawPath(rawRoot: string, rawRelativePath: string): string {
  const root = path.resolve(rawRoot)
  const normalized = normalizeRawPath(rawRelativePath)
  const target = path.resolve(root, normalized)
  const relative = path.relative(root, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
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

function validateEntryName(name: string): void {
  const trimmed = name.trim()
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/]/.test(trimmed)) {
    throw new Error("名称不可用。")
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch (error) {
    void error
    return false
  }
}

function isSameOrDescendant(sourcePath: string, targetDirectoryPath: string): boolean {
  const source = normalizeRawPath(sourcePath)
  const target = normalizeRawPath(targetDirectoryPath)
  return target === source || target.startsWith(`${source}/`)
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/")
}
