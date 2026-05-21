import { readFile } from "node:fs/promises"
import path from "node:path"

export interface KnowledgeBaseManifestSourceEntry {
  readonly hash: string
  readonly ingested_at?: string
  readonly pages_created?: readonly string[]
  readonly pages_updated?: readonly string[]
}

export interface KnowledgeBaseManifest {
  readonly version: 1
  readonly sources: Record<string, KnowledgeBaseManifestSourceEntry>
}

export type KnowledgeBaseManifestReadResult =
  | { readonly status: "missing"; readonly manifest: KnowledgeBaseManifest }
  | { readonly status: "valid"; readonly manifest: KnowledgeBaseManifest }
  | { readonly status: "invalid"; readonly error: string; readonly manifest: KnowledgeBaseManifest }

export async function readKnowledgeBaseManifest(projectPath: string): Promise<KnowledgeBaseManifestReadResult> {
  const manifestPath = path.join(projectPath, ".raw", ".manifest.json")
  try {
    const raw = await readFile(manifestPath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    const manifest = parseKnowledgeBaseManifest(parsed)
    return { status: "valid", manifest }
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: "missing", manifest: emptyManifest() }
    }
    return {
      status: "invalid",
      error: error instanceof Error ? error.message : String(error),
      manifest: emptyManifest(),
    }
  }
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
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    if (typeof source.hash !== "string" || source.hash.length === 0) continue
    sources[sourcePath] = {
      hash: source.hash,
      ...(typeof source.ingested_at === "string" ? { ingested_at: source.ingested_at } : undefined),
      ...(Array.isArray(source.pages_created) ? { pages_created: source.pages_created.filter(isString) } : undefined),
      ...(Array.isArray(source.pages_updated) ? { pages_updated: source.pages_updated.filter(isString) } : undefined),
    }
  }
  return { version: 1, sources }
}

function emptyManifest(): KnowledgeBaseManifest {
  return { version: 1, sources: {} }
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
