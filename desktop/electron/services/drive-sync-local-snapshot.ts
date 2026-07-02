import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, readdir } from "node:fs/promises"
import path from "node:path"
import type { DriveSyncExcludeRulesDto } from "@synapse/shared" with { "resolution-mode": "import" }
import { isDriveSyncExcluded } from "./drive-sync-excludes"
import { resolveBindingChildPath, toDriveSyncRelativePath } from "./drive-sync-paths"

export interface DriveSyncLocalSnapshotEntry {
  readonly relativePath: string
  readonly kind: "file" | "folder"
  readonly size: number | null
  readonly mtimeMs: number | null
  readonly hash: string | null
}

export interface DriveSyncLocalSnapshotHashCacheEntry {
  readonly kind: "file" | "folder"
  readonly size: number | null
  readonly mtimeMs: number | null
  readonly hash: string | null
}

export async function inspectDriveSyncLocalPath(
  targetPath: string,
): Promise<{ readonly kind: "missing" | "file" | "folder" | "other"; readonly empty: boolean | null }> {
  try {
    const stats = await lstat(targetPath)
    if (stats.isFile()) return { kind: "file", empty: null }
    if (stats.isDirectory()) {
      const entries = await readdir(targetPath)
      return { kind: "folder", empty: entries.length === 0 }
    }
    return { kind: "other", empty: null }
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return { kind: "missing", empty: null }
    throw error
  }
}

export async function scanDriveSyncLocalTree(input: {
  readonly rootPath: string
  readonly rules: DriveSyncExcludeRulesDto
  readonly hashFiles?: boolean
  readonly hashCache?: ReadonlyMap<string, DriveSyncLocalSnapshotHashCacheEntry>
}): Promise<readonly DriveSyncLocalSnapshotEntry[]> {
  const rootPath = path.resolve(input.rootPath)
  const result: DriveSyncLocalSnapshotEntry[] = []

  async function walk(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = resolveBindingChildPath(rootPath, toDriveSyncRelativePath(rootPath, path.join(directoryPath, entry.name)))
      const relativePath = toDriveSyncRelativePath(rootPath, absolutePath)
      if (isDriveSyncExcluded(relativePath, input.rules)) continue
      const stats = await lstat(absolutePath)
      if (stats.isSymbolicLink()) continue
      if (stats.isDirectory()) {
        result.push({
          relativePath,
          kind: "folder",
          size: null,
          mtimeMs: stats.mtimeMs,
          hash: null,
        })
        await walk(absolutePath)
      } else if (stats.isFile()) {
        result.push({
          relativePath,
          kind: "file",
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          hash: await resolveDriveSyncFileHash(input, absolutePath, relativePath, stats.size, stats.mtimeMs),
        })
      }
    }
  }

  await walk(rootPath)
  return result.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function resolveDriveSyncFileHash(
  input: {
    readonly hashFiles?: boolean
    readonly hashCache?: ReadonlyMap<string, DriveSyncLocalSnapshotHashCacheEntry>
  },
  absolutePath: string,
  relativePath: string,
  size: number,
  mtimeMs: number,
): Promise<string | null> {
  if (!input.hashFiles) return null
  const cached = input.hashCache?.get(relativePath)
  if (
    cached?.kind === "file"
    && cached.size === size
    && cached.mtimeMs === mtimeMs
    && cached.hash
  ) {
    return cached.hash
  }
  return hashDriveSyncFile(absolutePath)
}

export function hashDriveSyncFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`))
  })
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code
}
