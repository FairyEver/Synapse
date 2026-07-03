import { lstat, mkdir, readFile } from "node:fs/promises"
import path from "node:path"

import { isPathInsideDirectory } from "../../../src/lib/path-compare"
import { atomicWriteTextFile } from "./atomic-write"
import { knowledgeBaseErrorMeta, knowledgeBaseLogger } from "./logging"

const UTF8_BOM = "\uFEFF"

export interface KnowledgeBaseManifestSourceEntry {
  readonly hash: string
  readonly ingested_at?: string
  readonly pages_created?: readonly string[]
  readonly pages_updated?: readonly string[]
}

export interface KnowledgeBaseManifest {
  readonly version: 1
  readonly created?: string
  readonly description?: string
  readonly sources: Record<string, KnowledgeBaseManifestSourceEntry>
  readonly address_map: Record<string, string>
}

export type KnowledgeBaseManifestReadResult =
  | { readonly status: "missing"; readonly manifest: KnowledgeBaseManifest }
  | { readonly status: "valid"; readonly manifest: KnowledgeBaseManifest }
  | { readonly status: "invalid"; readonly error: string; readonly manifest: KnowledgeBaseManifest }

export async function readKnowledgeBaseManifest(projectPath: string): Promise<KnowledgeBaseManifestReadResult> {
  const manifestPath = path.join(projectPath, ".raw", ".manifest.json")
  try {
    const raw = await readFile(manifestPath, "utf8")
    const normalizedRaw = raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw
    const parsed = JSON.parse(normalizedRaw) as unknown
    const manifest = parseKnowledgeBaseManifest(parsed)
    if (normalizedRaw !== raw) {
      await assertNoSymlinkInPath(path.resolve(projectPath), ".raw/.manifest.json")
      await atomicWriteTextFile(manifestPath, normalizedRaw)
      knowledgeBaseLogger.info("Knowledge Base manifest UTF-8 BOM repaired.", {
        manifestPath: ".raw/.manifest.json",
      })
    }
    return { status: "valid", manifest }
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: "missing", manifest: emptyManifest() }
    }
    knowledgeBaseLogger.warn("Knowledge Base manifest read failed.", {
      manifestPath: ".raw/.manifest.json",
      ...knowledgeBaseErrorMeta(error),
    })
    return {
      status: "invalid",
      error: error instanceof Error ? error.message : String(error),
      manifest: emptyManifest(),
    }
  }
}

export async function writeKnowledgeBaseManifest(
  projectPath: string,
  manifest: KnowledgeBaseManifest,
): Promise<void> {
  const root = path.resolve(projectPath)
  const rawPath = assertInside(root, path.join(root, ".raw"))
  const manifestPath = assertInside(root, path.join(rawPath, ".manifest.json"))
  await assertNoSymlinkInPath(root, ".raw")
  await assertNoSymlinkInPath(root, ".raw/.manifest.json")
  await mkdir(rawPath, { recursive: true })
  await atomicWriteTextFile(manifestPath, `${JSON.stringify(normalizeManifest(manifest), null, 2)}\n`)
}

function parseKnowledgeBaseManifest(value: unknown): KnowledgeBaseManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Manifest must be an object.")
  }
  const record = value as Record<string, unknown>
  if (record.version !== 1) {
    throw new Error("Manifest version must be 1.")
  }
  if (!record.sources || typeof record.sources !== "object" || Array.isArray(record.sources)) {
    throw new Error("Manifest sources must be an object.")
  }
  const sources: Record<string, KnowledgeBaseManifestSourceEntry> = {}
  for (const [sourcePath, item] of Object.entries(record.sources as Record<string, unknown>)) {
    const entry = parseSourceEntry(item)
    if (!entry) continue
    sources[sourcePath] = entry
  }
  return {
    version: 1,
    ...(typeof record.created === "string" ? { created: record.created } : undefined),
    ...(typeof record.description === "string" ? { description: record.description } : undefined),
    sources,
    address_map: parseAddressMap(record.address_map),
  }
}

function emptyManifest(): KnowledgeBaseManifest {
  return { version: 1, sources: {}, address_map: {} }
}

function parseSourceEntry(value: unknown): KnowledgeBaseManifestSourceEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  const source = value as Record<string, unknown>
  if (typeof source.hash !== "string" || source.hash.length === 0) {
    return null
  }
  return {
    hash: source.hash,
    ...(typeof source.ingested_at === "string" ? { ingested_at: source.ingested_at } : undefined),
    ...(Array.isArray(source.pages_created) ? { pages_created: source.pages_created.filter(isString) } : undefined),
    ...(Array.isArray(source.pages_updated) ? { pages_updated: source.pages_updated.filter(isString) } : undefined),
  }
}

function parseAddressMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }
  const addressMap: Record<string, string> = {}
  for (const [pagePath, address] of Object.entries(value as Record<string, unknown>)) {
    if (typeof address === "string" && address.length > 0) {
      addressMap[pagePath.split("\\").join("/")] = address
    }
  }
  return addressMap
}

function normalizeManifest(manifest: KnowledgeBaseManifest): KnowledgeBaseManifest {
  return {
    version: 1,
    ...(manifest.created ? { created: manifest.created } : undefined),
    ...(manifest.description ? { description: manifest.description } : undefined),
    sources: manifest.sources,
    address_map: Object.fromEntries(
      Object.entries(manifest.address_map)
        .map(([pagePath, address]) => [pagePath.split("\\").join("/"), address] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  }
}

function assertInside(rootPath: string, targetPath: string): string {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  if (!isPathInsideDirectory(root, target, { resolvePath: path.resolve })) {
    throw new Error("目标路径不在项目目录中。")
  }
  return target
}

async function assertNoSymlinkInPath(projectPath: string, relativePath: string): Promise<void> {
  let currentPath = projectPath
  for (const segment of relativePath.split(/[\\/]/)) {
    currentPath = path.join(currentPath, segment)
    try {
      const stat = await lstat(currentPath)
      if (stat.isSymbolicLink()) {
        throw new Error(`知识库路径不能包含符号链接：${path.relative(projectPath, currentPath)}`)
      }
    } catch (error) {
      if (isMissingPathError(error)) return
      throw error
    }
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
