import fs from "node:fs"
import path from "node:path"

export interface UsageFileFingerprint {
  readonly filePath: string
  readonly size: number
  readonly mtimeMs: number
}

export interface UsageJsonlScanOptions {
  readonly maxDepth?: number
  readonly modifiedSinceMs?: number
}

function collectJsonlFilesFromDir(dir: string, out: string[], maxDepth: number, options: UsageJsonlScanOptions): void {
  if (maxDepth <= 0) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (isMissingDirectoryError(error)) return
    throw new Error(`Unable to read usage analysis directory: ${dir}`, { cause: error })
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectJsonlFilesFromDir(fullPath, out, maxDepth - 1, options)
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      if (options.modifiedSinceMs !== undefined && fs.statSync(fullPath).mtimeMs < options.modifiedSinceMs) {
        continue
      }
      out.push(fullPath)
    }
  }
}

function isMissingDirectoryError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : ""
  return code === "ENOENT" || code === "ENOTDIR"
}

export function collectJsonlFiles(roots: string[], options: UsageJsonlScanOptions = {}): string[] {
  const files: string[] = []
  const maxDepth = options.maxDepth ?? 8
  for (const root of roots) {
    collectJsonlFilesFromDir(root, files, maxDepth, options)
  }
  return [...new Set(files)].sort()
}

export function fingerprintFile(filePath: string): UsageFileFingerprint {
  const stat = fs.statSync(filePath)
  return {
    filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  }
}
