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
  readonly maxFiles?: number
  readonly maxDirectoryEntries?: number
}

export interface UsageJsonlScanResult {
  readonly files: string[]
  readonly truncated: boolean
  readonly visitedEntries: number
}

const DEFAULT_MAX_JSONL_FILES = 20_000
const DEFAULT_MAX_DIRECTORY_ENTRIES = 100_000

type ScanState = {
  files: string[]
  truncated: boolean
  visitedEntries: number
}

type ResolvedUsageJsonlScanOptions = {
  readonly maxDepth: number
  readonly maxFiles: number
  readonly maxDirectoryEntries: number
  readonly modifiedSinceMs?: number
}

function collectJsonlFilesFromDir(dir: string, state: ScanState, maxDepth: number, options: ResolvedUsageJsonlScanOptions): void {
  if (maxDepth <= 0 || state.truncated) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (isMissingDirectoryError(error)) return
    throw new Error(`Unable to read usage analysis directory: ${dir}`, { cause: error })
  }

  for (const entry of entries) {
    if (state.truncated) return
    state.visitedEntries += 1
    if (state.visitedEntries > options.maxDirectoryEntries) {
      state.truncated = true
      return
    }
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectJsonlFilesFromDir(fullPath, state, maxDepth - 1, options)
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      if (options.modifiedSinceMs !== undefined && fs.statSync(fullPath).mtimeMs < options.modifiedSinceMs) {
        continue
      }
      if (state.files.length >= options.maxFiles) {
        state.truncated = true
        return
      }
      state.files.push(fullPath)
    }
  }
}

function isMissingDirectoryError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as NodeJS.ErrnoException).code)
    : ""
  return code === "ENOENT" || code === "ENOTDIR"
}

export function collectJsonlFilesWithStats(roots: string[], options: UsageJsonlScanOptions = {}): UsageJsonlScanResult {
  const scanOptions: ResolvedUsageJsonlScanOptions = {
    maxDepth: options.maxDepth ?? 8,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_JSONL_FILES,
    maxDirectoryEntries: options.maxDirectoryEntries ?? DEFAULT_MAX_DIRECTORY_ENTRIES,
    modifiedSinceMs: options.modifiedSinceMs,
  }
  const state: ScanState = {
    files: [],
    truncated: false,
    visitedEntries: 0,
  }
  for (const root of roots) {
    collectJsonlFilesFromDir(root, state, scanOptions.maxDepth, scanOptions)
    if (state.truncated) break
  }
  return {
    files: [...new Set(state.files)].sort(),
    truncated: state.truncated,
    visitedEntries: state.visitedEntries,
  }
}

export function collectJsonlFiles(roots: string[], options: UsageJsonlScanOptions = {}): string[] {
  return collectJsonlFilesWithStats(roots, options).files
}

export function fingerprintFile(filePath: string): UsageFileFingerprint {
  const stat = fs.statSync(filePath)
  return {
    filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  }
}
