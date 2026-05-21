import { createHash } from "node:crypto"
import type { Dirent } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { readKnowledgeBaseManifest, type KnowledgeBaseManifestReadResult } from "./manifest"

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

export type KnowledgeBaseSourceState = "new" | "changed" | "unchanged"

export interface KnowledgeBaseSourceScanItem {
  readonly relativePath: string
  readonly hash: string
  readonly state: KnowledgeBaseSourceState
}

export interface KnowledgeBaseSkippedSource {
  readonly relativePath: string
  readonly reason: "unsupported-extension" | "symlink" | "read-error"
}

export interface KnowledgeBaseSourceScanResult {
  readonly manifest: KnowledgeBaseManifestReadResult
  readonly sources: readonly KnowledgeBaseSourceScanItem[]
  readonly skippedSources: readonly KnowledgeBaseSkippedSource[]
}

export async function scanKnowledgeBaseSources(
  projectPath: string,
  options: { readonly force?: boolean } = {},
): Promise<KnowledgeBaseSourceScanResult> {
  const manifest = await readKnowledgeBaseManifest(projectPath)
  const rawPath = path.join(projectPath, ".raw")
  const discovered = await walkRawSources(projectPath, rawPath)
  const sources: KnowledgeBaseSourceScanItem[] = []
  const skippedSources: KnowledgeBaseSkippedSource[] = [...discovered.skippedSources]

  for (const relativePath of discovered.relativePaths) {
    try {
      const absolutePath = path.join(projectPath, relativePath)
      const hash = sha256(await readFile(absolutePath))
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
    } catch {
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
): Promise<{ readonly relativePaths: string[]; readonly skippedSources: KnowledgeBaseSkippedSource[] }> {
  let entries: Dirent[]
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch {
    return { relativePaths: [], skippedSources: [] }
  }

  const relativePaths: string[] = []
  const skippedSources: KnowledgeBaseSkippedSource[] = []
  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    const relativePath = normalizeRelativePath(path.relative(projectPath, absolutePath))
    if (entry.isSymbolicLink()) {
      skippedSources.push({ relativePath, reason: "symlink" })
      continue
    }
    if (entry.isDirectory()) {
      const nested = await walkRawSources(projectPath, absolutePath)
      relativePaths.push(...nested.relativePaths)
      skippedSources.push(...nested.skippedSources)
      continue
    }
    if (!entry.isFile() || relativePath === ".raw/.manifest.json") continue
    if (!SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      skippedSources.push({ relativePath, reason: "unsupported-extension" })
      continue
    }
    relativePaths.push(relativePath)
  }
  return { relativePaths, skippedSources }
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/")
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex")
}
