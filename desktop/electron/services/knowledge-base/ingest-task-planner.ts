import { createHash } from "node:crypto"
import path from "node:path"

import type { KnowledgeBaseManifest } from "./manifest"
import type { KnowledgeBaseSourceScanItem } from "./source-scan"

export interface KnowledgeBaseIngestWorkerTask {
  readonly taskId: string
  readonly sourcePath: string
  readonly sourceHash: string
  readonly targetPage: string
  readonly mode: "create-or-update-source-page"
}

export interface PlanKnowledgeBaseIngestTasksInput {
  readonly changedSources: readonly KnowledgeBaseSourceScanItem[]
  readonly manifestSources: KnowledgeBaseManifest["sources"]
}

export function planKnowledgeBaseIngestTasks(input: PlanKnowledgeBaseIngestTasksInput): KnowledgeBaseIngestWorkerTask[] {
  const claimed = new Set<string>()
  return input.changedSources.map((source, index) => {
    const reused = existingSourcePage(input.manifestSources[source.relativePath])
    const derived = reused ?? deriveSourceTargetPage(source.relativePath)
    const targetPage = uniqueTargetPage(derived, source.relativePath, claimed)
    claimed.add(targetPage)
    return {
      taskId: `kb-ingest-worker-${String(index + 1).padStart(4, "0")}`,
      sourcePath: source.relativePath,
      sourceHash: source.hash,
      targetPage,
      mode: "create-or-update-source-page",
    }
  })
}

function existingSourcePage(entry: KnowledgeBaseManifest["sources"][string] | undefined): string | undefined {
  const pages = [...(entry?.pages_created ?? []), ...(entry?.pages_updated ?? [])]
  return pages.find((page) => page.startsWith("wiki/sources/") && page.endsWith(".md"))
}

function deriveSourceTargetPage(sourcePath: string): string {
  const withoutRaw = sourcePath.replace(/^\.raw\//, "")
  const parsed = path.posix.parse(withoutRaw)
  const prefix = parsed.dir.split("/").filter(Boolean).join("-")
  const base = slugify(parsed.name)
  return `wiki/sources/${[prefix, base].filter(Boolean).join("-")}.md`
}

function uniqueTargetPage(candidate: string, sourcePath: string, claimed: Set<string>): string {
  if (!claimed.has(candidate)) return candidate
  const parsed = path.posix.parse(candidate)
  const suffix = createHash("sha256").update(sourcePath).digest("hex").slice(0, 8)
  return `${parsed.dir}/${parsed.name}-${suffix}${parsed.ext}`
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return slug || "source"
}
