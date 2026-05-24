import { randomUUID } from "node:crypto"
import { lstat, realpath } from "node:fs/promises"
import path from "node:path"

import { KnowledgeBaseIngestFinalizer, type KnowledgeBaseIngestFinalizerResult } from "./ingest-finalizer"
import { parseKnowledgeBaseIngestReport, type KnowledgeBaseIngestReportProcessedSource } from "./ingest-report"
import { readKnowledgeBaseManifest, type KnowledgeBaseManifestReadResult, writeKnowledgeBaseManifest } from "./manifest"
import {
  scanKnowledgeBaseSources,
  type KnowledgeBaseSkippedSource,
  type KnowledgeBaseSourceScanItem,
} from "./source-scan"

export interface PrepareKnowledgeBaseIngestTurnInput {
  readonly projectPath: string
  readonly force: boolean
}

export interface FinalizeKnowledgeBaseIngestTurnInput {
  readonly projectPath: string
  readonly preflightId: string
  readonly assistantText: string
}

export interface KnowledgeBaseIngestPreflight {
  readonly id: string
  readonly projectPath: string
  readonly manifest: KnowledgeBaseManifestReadResult
  readonly sources: readonly KnowledgeBaseSourceScanItem[]
  readonly skippedSources: readonly KnowledgeBaseSkippedSource[]
}

export interface KnowledgeBaseIngestFinalizeResult {
  readonly acceptedSources: readonly string[]
  readonly warnings: readonly string[]
  readonly finalizer?: KnowledgeBaseIngestFinalizerResult
}

type KnowledgeBaseIngestCoordinatorDeps = {
  readonly now?: () => Date
  readonly ingestFinalizer?: Pick<KnowledgeBaseIngestFinalizer, "finalize">
}

interface KnowledgeBaseIngestPreflightSnapshot {
  readonly projectPath: string
  readonly sources: ReadonlyMap<string, KnowledgeBaseSourceScanItem>
}

const MAX_PREFLIGHT_SNAPSHOTS = 20

export class KnowledgeBaseIngestCoordinator {
  private readonly now: () => Date
  private readonly ingestFinalizer: Pick<KnowledgeBaseIngestFinalizer, "finalize">
  private readonly preflights = new Map<string, KnowledgeBaseIngestPreflightSnapshot>()

  constructor(deps: KnowledgeBaseIngestCoordinatorDeps = {}) {
    this.now = deps.now ?? (() => new Date())
    this.ingestFinalizer = deps.ingestFinalizer ?? new KnowledgeBaseIngestFinalizer()
  }

  async prepareTurn(input: PrepareKnowledgeBaseIngestTurnInput): Promise<KnowledgeBaseIngestPreflight> {
    const projectPath = path.resolve(input.projectPath)
    const scan = await scanKnowledgeBaseSources(projectPath, { force: input.force })
    const id = randomUUID()
    this.rememberPreflight(id, {
      projectPath,
      sources: new Map(scan.sources.map((source) => [source.relativePath, source])),
    })

    return {
      id,
      projectPath,
      manifest: scan.manifest,
      sources: scan.sources,
      skippedSources: scan.skippedSources,
    }
  }

  async finalizeTurn(input: FinalizeKnowledgeBaseIngestTurnInput): Promise<KnowledgeBaseIngestFinalizeResult> {
    const projectPath = path.resolve(input.projectPath)
    const snapshot = this.preflights.get(input.preflightId)
    if (!snapshot || snapshot.projectPath !== projectPath) {
      return { acceptedSources: [], warnings: ["Ingest preflight snapshot was not found."] }
    }

    const report = parseKnowledgeBaseIngestReport(input.assistantText)
    if (!report.ok) {
      return {
        acceptedSources: [],
        warnings: [`Ingest report was not accepted: ${report.message}`],
      }
    }

    const accepted = await this.acceptProcessedSources(projectPath, snapshot, report.processedSources)
    if (accepted.entries.length === 0) {
      return {
        acceptedSources: [],
        warnings: [...accepted.warnings, "No accepted ingest sources were reported."],
      }
    }

    const manifestRead = await readKnowledgeBaseManifest(projectPath)
    if (manifestRead.status === "invalid") {
      return {
        acceptedSources: [],
        warnings: [...accepted.warnings, `Manifest is invalid: ${manifestRead.error}`],
      }
    }

    await writeKnowledgeBaseManifest(projectPath, {
      ...manifestRead.manifest,
      sources: {
        ...manifestRead.manifest.sources,
        ...Object.fromEntries(accepted.entries.map((entry) => [entry.source, {
          hash: entry.hash,
          ingested_at: this.now().toISOString(),
          pages_created: entry.pagesCreated,
          pages_updated: entry.pagesUpdated,
        }])),
      },
    })
    const finalizer = await this.ingestFinalizer.finalize(projectPath)

    return {
      acceptedSources: accepted.entries.map((entry) => entry.source),
      warnings: accepted.warnings,
      finalizer,
    }
  }

  private rememberPreflight(id: string, snapshot: KnowledgeBaseIngestPreflightSnapshot): void {
    this.preflights.set(id, snapshot)
    if (this.preflights.size <= MAX_PREFLIGHT_SNAPSHOTS) return
    const oldest = this.preflights.keys().next().value
    if (oldest) {
      this.preflights.delete(oldest)
    }
  }

  private async acceptProcessedSources(
    projectPath: string,
    snapshot: KnowledgeBaseIngestPreflightSnapshot,
    processedSources: readonly KnowledgeBaseIngestReportProcessedSource[],
  ): Promise<{
      readonly entries: readonly {
        readonly source: string
        readonly hash: string
        readonly pagesCreated: readonly string[]
        readonly pagesUpdated: readonly string[]
      }[]
      readonly warnings: readonly string[]
    }> {
    const entries: {
      source: string
      hash: string
      pagesCreated: string[]
      pagesUpdated: string[]
    }[] = []
    const warnings: string[] = []
    const seen = new Set<string>()

    for (const source of processedSources) {
      const normalizedSource = normalizeRelativePath(source.source)
      if (!isValidRelativePath(projectPath, normalizedSource, ".raw/")) {
        warnings.push(`Invalid ingest source path was ignored: ${source.source}`)
        continue
      }
      const preflightSource = snapshot.sources.get(normalizedSource)
      if (!preflightSource) {
        warnings.push(`Unknown ingest source was ignored: ${normalizedSource}`)
        continue
      }
      if (seen.has(normalizedSource)) {
        warnings.push(`Duplicate ingest source was ignored: ${normalizedSource}`)
        continue
      }

      const pagePaths = await validateWikiPagePaths(projectPath, normalizedSource, [
        ...source.pagesCreated,
        ...source.pagesUpdated,
      ])
      warnings.push(...pagePaths.warnings)
      if (!pagePaths.ok) continue

      seen.add(normalizedSource)
      entries.push({
        source: normalizedSource,
        hash: preflightSource.hash,
        pagesCreated: source.pagesCreated.map(normalizeRelativePath),
        pagesUpdated: source.pagesUpdated.map(normalizeRelativePath),
      })
    }

    return { entries, warnings }
  }
}

async function validateWikiPagePaths(
  projectPath: string,
  sourcePath: string,
  pagePaths: readonly string[],
): Promise<{ readonly ok: boolean; readonly warnings: readonly string[] }> {
  const warnings: string[] = []
  for (const pagePath of pagePaths) {
    const normalized = normalizeRelativePath(pagePath)
    if (!isValidRelativePath(projectPath, normalized, "wiki/") || !normalized.endsWith(".md")) {
      warnings.push(`Invalid wiki page path was ignored for ${sourcePath}: ${pagePath}`)
      return { ok: false, warnings }
    }
    const pagePathStatus = await validateProjectFilePath(projectPath, normalized)
    if (pagePathStatus === "invalid") {
      warnings.push(`Invalid wiki page path was ignored for ${sourcePath}: ${normalized}`)
      return { ok: false, warnings }
    }
    if (pagePathStatus === "missing") {
      warnings.push(`Listed wiki page does not exist for ${sourcePath}: ${normalized}`)
      return { ok: false, warnings }
    }
  }
  return { ok: true, warnings }
}

function normalizeRelativePath(value: string): string {
  return path.posix.normalize(value.split("\\").join("/"))
}

function isValidRelativePath(projectPath: string, relativePath: string, requiredPrefix: string): boolean {
  if (relativePath.startsWith("/") || !relativePath.startsWith(requiredPrefix)) {
    return false
  }
  const targetPath = path.resolve(projectPath, ...relativePath.split("/"))
  const relative = path.relative(projectPath, targetPath)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function validateProjectFilePath(
  projectPath: string,
  relativePath: string,
): Promise<"valid" | "missing" | "invalid"> {
  const segments = relativePath.split("/")
  let currentPath = projectPath
  let finalStat
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment)
    try {
      const stat = await lstat(currentPath)
      if (stat.isSymbolicLink()) {
        return "invalid"
      }
      finalStat = stat
    } catch (error) {
      if (isMissingPathError(error)) return "missing"
      throw error
    }
  }

  if (!finalStat?.isFile()) {
    return "missing"
  }

  try {
    return isPathInside(await realpath(projectPath), await realpath(currentPath)) ? "valid" : "invalid"
  } catch (error) {
    if (isMissingPathError(error)) return "missing"
    throw error
  }
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
