import { createHash } from "node:crypto"
import type { Dirent, Stats } from "node:fs"
import { lstat, readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { normalizeKnowledgeBaseRelativePath as normalizeRelativePath } from "./path-normalize"

export interface WikiSnapshotFile {
  readonly path: string
  readonly hash: string
  readonly size: number
  readonly mtimeMs: number
}

export interface WikiSnapshot {
  readonly files: Record<string, WikiSnapshotFile>
}

export interface WikiSnapshotDiff {
  readonly created: readonly string[]
  readonly updated: readonly string[]
}

export interface WikiSnapshotOptions {
  readonly paths?: readonly string[]
}

export async function snapshotWikiMarkdown(projectPath: string, options: WikiSnapshotOptions = {}): Promise<WikiSnapshot> {
  const root = path.resolve(projectPath)
  const files: Record<string, WikiSnapshotFile> = {}
  const candidatePaths = normalizeCandidateWikiPaths(root, options.paths)
  if (candidatePaths) {
    for (const relativePath of candidatePaths) {
      const file = await snapshotMarkdownFile(root, path.join(root, relativePath))
      if (file) files[file.path] = file
    }
    return { files }
  }
  await walk(root, path.join(root, "wiki"), files)
  return { files }
}

export function diffWikiSnapshots(before: WikiSnapshot, after: WikiSnapshot): WikiSnapshotDiff {
  const created: string[] = []
  const updated: string[] = []
  for (const [relativePath, afterFile] of Object.entries(after.files)) {
    const beforeFile = before.files[relativePath]
    if (!beforeFile) {
      created.push(relativePath)
      continue
    }
    if (beforeFile.hash !== afterFile.hash) {
      updated.push(relativePath)
    }
  }
  return {
    created: created.sort((a, b) => a.localeCompare(b)),
    updated: updated.sort((a, b) => a.localeCompare(b)),
  }
}

async function walk(root: string, directoryPath: string, files: Record<string, WikiSnapshotFile>): Promise<void> {
  let entries: Dirent[]
  try {
    const directoryStat = await lstat(directoryPath)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return
    throw error
  }

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    const relativePath = normalizeRelativePath(path.relative(root, absolutePath))
    if (!isInside(root, absolutePath)) continue
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      await walk(root, absolutePath, files)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const file = await snapshotMarkdownFile(root, absolutePath)
    if (file) files[relativePath] = file
  }
}

async function snapshotMarkdownFile(root: string, absolutePath: string): Promise<WikiSnapshotFile | null> {
  if (!isInside(root, absolutePath)) return null
  let fileStat: Stats
  try {
    fileStat = await lstat(absolutePath)
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null
  const relativePath = normalizeRelativePath(path.relative(root, absolutePath))
  if (!isSafeWikiMarkdownPath(relativePath)) return null
  const content = await readFile(absolutePath)
  return {
    path: relativePath,
    hash: createHash("sha256").update(content).digest("hex"),
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
  }
}

function normalizeCandidateWikiPaths(root: string, paths: readonly string[] | undefined): readonly string[] | null {
  if (!paths) return null
  const normalized = new Set<string>()
  for (const value of paths) {
    const relativePath = normalizeRelativePath(value)
    if (!isSafeWikiMarkdownPath(relativePath)) continue
    const absolutePath = path.resolve(root, relativePath)
    if (!isInside(root, absolutePath)) continue
    normalized.add(normalizeRelativePath(path.relative(root, absolutePath)))
  }
  return [...normalized].sort((a, b) => a.localeCompare(b))
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, path.resolve(target))
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function isSafeWikiMarkdownPath(value: string): boolean {
  return value.startsWith("wiki/") && value.endsWith(".md") && !path.isAbsolute(value) && !value.split("/").includes("..")
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
