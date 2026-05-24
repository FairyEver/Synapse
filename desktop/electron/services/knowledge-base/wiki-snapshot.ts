import { createHash } from "node:crypto"
import type { Dirent } from "node:fs"
import { lstat, readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

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

export async function snapshotWikiMarkdown(projectPath: string): Promise<WikiSnapshot> {
  const root = path.resolve(projectPath)
  const files: Record<string, WikiSnapshotFile> = {}
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
    const content = await readFile(absolutePath)
    const fileStat = await stat(absolutePath)
    files[relativePath] = {
      path: relativePath,
      hash: createHash("sha256").update(content).digest("hex"),
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
    }
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, path.resolve(target))
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/")
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
