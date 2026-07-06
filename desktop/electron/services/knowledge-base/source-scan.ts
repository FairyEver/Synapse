import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import type { Dirent } from "node:fs"
import { lstat, readdir } from "node:fs/promises"
import path from "node:path"

import { knowledgeBaseErrorMeta, knowledgeBaseLogger } from "./logging"
import { readKnowledgeBaseManifest, type KnowledgeBaseManifestReadResult } from "./manifest"
import { normalizeKnowledgeBaseRelativePath as normalizeRelativePath } from "./path-normalize"

const SUPPORTED_SOURCE_EXTENSIONS = new Set([
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
const DEFAULT_MAX_SOURCE_BYTES = 16 * 1024 * 1024
const DEFAULT_MAX_SCAN_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_DISCOVERY_ENTRIES = 10_000
const DEFAULT_MAX_DISCOVERY_DEPTH = 32

export type KnowledgeBaseSourceState = "new" | "changed" | "unchanged"

export interface KnowledgeBaseSourceScanItem {
  readonly relativePath: string
  readonly hash: string
  readonly state: KnowledgeBaseSourceState
}

export interface KnowledgeBaseSkippedSource {
  readonly relativePath: string
  readonly reason:
    | "unsupported-extension"
    | "symlink"
    | "read-error"
    | "too-large"
    | "scan-size-limit"
    | "scan-entry-limit"
    | "scan-depth-limit"
}

export interface KnowledgeBaseSourceScanResult {
  readonly manifest: KnowledgeBaseManifestReadResult
  readonly sources: readonly KnowledgeBaseSourceScanItem[]
  readonly skippedSources: readonly KnowledgeBaseSkippedSource[]
}

export async function scanKnowledgeBaseSources(
  projectPath: string,
  options: {
    readonly force?: boolean
    readonly maxScanBytes?: number
    readonly maxSourceBytes?: number
    readonly maxDiscoveryEntries?: number
    readonly maxDiscoveryDepth?: number
  } = {},
): Promise<KnowledgeBaseSourceScanResult> {
  const manifest = await readKnowledgeBaseManifest(projectPath)
  const rawPath = path.join(projectPath, ".raw")
  const maxSourceBytes = options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES
  const maxScanBytes = options.maxScanBytes ?? DEFAULT_MAX_SCAN_BYTES
  const rawDirectory = await inspectRawDirectory(rawPath)
  if (rawDirectory !== "directory") {
    return {
      manifest,
      sources: [],
      skippedSources: rawDirectory === "missing" ? [] : [{ relativePath: ".raw", reason: rawDirectory }],
    }
  }
  const discovered = await walkRawSources(projectPath, rawPath, {
    maxDiscoveryDepth: options.maxDiscoveryDepth ?? DEFAULT_MAX_DISCOVERY_DEPTH,
    maxDiscoveryEntries: options.maxDiscoveryEntries ?? DEFAULT_MAX_DISCOVERY_ENTRIES,
  })
  const sources: KnowledgeBaseSourceScanItem[] = []
  const skippedSources: KnowledgeBaseSkippedSource[] = [...discovered.skippedSources]
  let scannedBytes = 0

  for (const relativePath of [...discovered.relativePaths].sort((a, b) => a.localeCompare(b))) {
    try {
      const absolutePath = path.join(projectPath, relativePath)
      const stat = await lstat(absolutePath)
      if (stat.isSymbolicLink()) {
        skippedSources.push({ relativePath, reason: "symlink" })
        continue
      }
      if (!stat.isFile()) {
        continue
      }
      if (stat.size > maxSourceBytes) {
        skippedSources.push({ relativePath, reason: "too-large" })
        continue
      }
      if (scannedBytes + stat.size > maxScanBytes) {
        skippedSources.push({ relativePath, reason: "scan-size-limit" })
        continue
      }
      const hash = await sha256File(absolutePath)
      scannedBytes += stat.size
      const manifestEntry = manifest.manifest.sources[relativePath]
      sources.push({
        relativePath,
        hash,
        state: options.force
          ? "changed"
          : manifestEntry
            ? manifestEntry.hash === hash ? "unchanged" : "changed"
            : "new",
      })
    } catch (error) {
      knowledgeBaseLogger.warn("Knowledge Base raw source read failed during scan.", {
        relativePath,
        ...knowledgeBaseErrorMeta(error),
      })
      skippedSources.push({ relativePath, reason: "read-error" })
    }
  }

  return {
    manifest,
    sources: sources.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    skippedSources: skippedSources.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  }
}

async function walkRawSources(
  projectPath: string,
  directoryPath: string,
  options: {
    readonly maxDiscoveryDepth: number
    readonly maxDiscoveryEntries: number
  },
  state: {
    discoveredEntries: number
    stopped: boolean
  } = { discoveredEntries: 0, stopped: false },
  depth = 0,
): Promise<{ readonly relativePaths: string[]; readonly skippedSources: KnowledgeBaseSkippedSource[] }> {
  if (state.stopped) {
    return { relativePaths: [], skippedSources: [] }
  }
  if (depth > options.maxDiscoveryDepth) {
    return {
      relativePaths: [],
      skippedSources: [{
        relativePath: normalizeRelativePath(path.relative(projectPath, directoryPath)),
        reason: "scan-depth-limit",
      }],
    }
  }

  let entries: Dirent[]
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    knowledgeBaseLogger.warn("Knowledge Base raw directory read failed during scan.", {
      relativePath: normalizeRelativePath(path.relative(projectPath, directoryPath)),
      ...knowledgeBaseErrorMeta(error),
    })
    return {
      relativePaths: [],
      skippedSources: [{
        relativePath: normalizeRelativePath(path.relative(projectPath, directoryPath)),
        reason: "read-error",
      }],
    }
  }

  const relativePaths: string[] = []
  const skippedSources: KnowledgeBaseSkippedSource[] = []
  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    const relativePath = normalizeRelativePath(path.relative(projectPath, absolutePath))
    state.discoveredEntries += 1
    if (state.discoveredEntries > options.maxDiscoveryEntries) {
      state.stopped = true
      skippedSources.push({ relativePath, reason: "scan-entry-limit" })
      break
    }
    if (entry.isSymbolicLink()) {
      skippedSources.push({ relativePath, reason: "symlink" })
      continue
    }
    if (entry.isDirectory()) {
      const nested = await walkRawSources(projectPath, absolutePath, options, state, depth + 1)
      relativePaths.push(...nested.relativePaths)
      skippedSources.push(...nested.skippedSources)
      continue
    }
    if (!entry.isFile() || isInternalRawSource(relativePath)) continue
    if (!SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      skippedSources.push({ relativePath, reason: "unsupported-extension" })
      continue
    }
    relativePaths.push(relativePath)
  }
  return { relativePaths, skippedSources }
}

function isInternalRawSource(relativePath: string): boolean {
  return relativePath === ".raw/.gitkeep" || relativePath === ".raw/.manifest.json"
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    stream.on("data", (chunk: Buffer | string) => {
      hash.update(chunk)
    })
    stream.on("error", reject)
    stream.on("end", () => {
      resolve(hash.digest("hex"))
    })
  })
}

async function inspectRawDirectory(rawPath: string): Promise<"directory" | "missing" | KnowledgeBaseSkippedSource["reason"]> {
  try {
    const stat = await lstat(rawPath)
    if (stat.isSymbolicLink()) {
      return "symlink"
    }
    return stat.isDirectory() ? "directory" : "read-error"
  } catch (error) {
    if (isMissingPathError(error)) {
      return "missing"
    }
    knowledgeBaseLogger.warn("Knowledge Base raw directory inspect failed.", {
      relativePath: ".raw",
      ...knowledgeBaseErrorMeta(error),
    })
    return "read-error"
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
