import { createHash } from "node:crypto"
import { access, mkdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { KnowledgeBaseIngestReport } from "./ingest-report"
import type { KnowledgeBaseIngestTurnState } from "./ingest-turn-store"
import { KnowledgeBaseIngestFinalizer as DefaultAddressFinalizer } from "./ingest-finalizer"
import { readKnowledgeBaseManifest, writeKnowledgeBaseManifest, type KnowledgeBaseManifest } from "./manifest"
import { diffWikiSnapshots, snapshotWikiMarkdown } from "./wiki-snapshot"

export interface KnowledgeBaseManifestFinalizerWarning {
  readonly code: string
  readonly message: string
}

export interface KnowledgeBaseManifestFinalizerInput {
  readonly projectPath: string
  readonly conversationId: string
  readonly turnId: string
  readonly preflight: KnowledgeBaseIngestTurnState
  readonly report: KnowledgeBaseIngestReport
}

export interface KnowledgeBaseManifestFinalizerBatchItem {
  readonly turnId: string
  readonly preflight: KnowledgeBaseIngestTurnState
  readonly report: KnowledgeBaseIngestReport
}

export interface KnowledgeBaseManifestFinalizerBatchInput {
  readonly projectPath: string
  readonly conversationId: string
  readonly batchId: string
  readonly items: readonly KnowledgeBaseManifestFinalizerBatchItem[]
}

export interface KnowledgeBaseManifestFinalizerResult {
  readonly writtenSources: readonly string[]
  readonly warnings: readonly KnowledgeBaseManifestFinalizerWarning[]
}

type AddressFinalizerLike = {
  finalize(
    projectPath: string,
    options?: { readonly writeManifest?: boolean },
  ): Promise<{
    readonly addressMap: Record<string, string>
    readonly skippedReason?: string
  }>
}

const manifestFinalizerLocks = new Map<string, Promise<void>>()

export class KnowledgeBaseManifestFinalizer {
  private readonly addressFinalizer: AddressFinalizerLike
  private readonly now: () => string
  private readonly lockRoot: string | undefined
  private readonly lockTimeoutMs: number
  private readonly lockRetryMs: number

  constructor(deps: {
    readonly addressFinalizer?: AddressFinalizerLike
    readonly now?: () => string
    readonly lockRoot?: string
    readonly lockTimeoutMs?: number
    readonly lockRetryMs?: number
  } = {}) {
    this.addressFinalizer = deps.addressFinalizer ?? new DefaultAddressFinalizer()
    this.now = deps.now ?? (() => new Date().toISOString())
    this.lockRoot = deps.lockRoot
    this.lockTimeoutMs = deps.lockTimeoutMs ?? 30_000
    this.lockRetryMs = deps.lockRetryMs ?? 50
  }

  async finalize(input: KnowledgeBaseManifestFinalizerInput): Promise<KnowledgeBaseManifestFinalizerResult> {
    return this.finalizeBatch({
      projectPath: input.projectPath,
      conversationId: input.conversationId,
      batchId: input.turnId,
      items: [{
        turnId: input.turnId,
        preflight: input.preflight,
        report: input.report,
      }],
    })
  }

  async finalizeBatch(input: KnowledgeBaseManifestFinalizerBatchInput): Promise<KnowledgeBaseManifestFinalizerResult> {
    try {
      return await withProjectManifestFinalizerLock(input.projectPath, {
        lockRoot: this.lockRoot,
        timeoutMs: this.lockTimeoutMs,
        retryMs: this.lockRetryMs,
      }, () => this.finalizeBatchLocked(input))
    } catch (error) {
      if (error instanceof KnowledgeBaseManifestLockTimeoutError) {
        return {
          writtenSources: [],
          warnings: [{ code: "manifest-lock-timeout", message: error.message }],
        }
      }
      throw error
    }
  }

  private async finalizeBatchLocked(input: KnowledgeBaseManifestFinalizerBatchInput): Promise<KnowledgeBaseManifestFinalizerResult> {
    const warnings: KnowledgeBaseManifestFinalizerWarning[] = []
    const readResult = await readKnowledgeBaseManifest(input.projectPath)
    if (readResult.status === "invalid") {
      return {
        writtenSources: [],
        warnings: [{ code: "manifest-invalid", message: readResult.error }],
      }
    }

    const wikiAfter = await snapshotWikiMarkdown(input.projectPath)
    const writtenSources: string[] = []
    const nextSources: KnowledgeBaseManifest["sources"] = { ...readResult.manifest.sources }
    const acceptedSources = new Set<string>()
    const pageOwners = new Map<string, string>()

    for (const item of input.items) {
      const changedByPath = new Map(item.preflight.changedSources.map((source) => [source.relativePath, source]))
      const diff = diffWikiSnapshots(item.preflight.wikiBefore, wikiAfter)
      for (const source of item.report.processedSources) {
        const sourcePath = normalizeRelativePath(source.source)
        if (acceptedSources.has(sourcePath)) {
          warnings.push({ code: "source-duplicate", message: `Source appeared more than once in ingest reports: ${sourcePath}` })
          continue
        }
        const preflightSource = changedByPath.get(sourcePath)
        if (!preflightSource || !isRawSourcePath(sourcePath)) {
          warnings.push({ code: "source-not-in-preflight", message: `Source was not in ingest preflight: ${source.source}` })
          continue
        }
        const currentHash = await hashRawSource(input.projectPath, sourcePath)
        if (currentHash !== preflightSource.hash) {
          warnings.push({ code: "source-hash-changed", message: `Source changed after ingest preflight: ${sourcePath}` })
          continue
        }

        const pagesCreated = await filterExistingWikiPages(
          input.projectPath,
          normalizePageList(source.pagesCreated, diff.created, "created", warnings),
        )
        const pagesUpdated = await filterExistingWikiPages(
          input.projectPath,
          normalizePageList(source.pagesUpdated, diff.updated, "updated", warnings),
        )
        if (pagesCreated.length === 0 && pagesUpdated.length === 0) {
          warnings.push({ code: "source-no-valid-pages", message: `Source produced no validated wiki pages: ${sourcePath}` })
          continue
        }

        warnForDuplicatePageOwners(sourcePath, pagesCreated, pageOwners, warnings)
        warnForDuplicatePageOwners(sourcePath, pagesUpdated, pageOwners, warnings)
        acceptedSources.add(sourcePath)
        nextSources[sourcePath] = {
          hash: preflightSource.hash,
          ingested_at: this.now(),
          pages_created: pagesCreated,
          pages_updated: pagesUpdated,
        }
        writtenSources.push(sourcePath)
      }
    }

    if (writtenSources.length === 0) {
      return {
        writtenSources: [],
        warnings,
      }
    }

    const addressResult = await this.addressFinalizer.finalize(input.projectPath, { writeManifest: false })
    if (addressResult.skippedReason) {
      warnings.push({ code: "address-finalizer-skipped", message: addressResult.skippedReason })
    }

    if (writtenSources.length > 0 || Object.keys(addressResult.addressMap).length > 0) {
      await writeKnowledgeBaseManifest(input.projectPath, {
        ...readResult.manifest,
        sources: nextSources,
        address_map: {
          ...readResult.manifest.address_map,
          ...addressResult.addressMap,
        },
      })
    }

    return {
      writtenSources: writtenSources.sort((a, b) => a.localeCompare(b)),
      warnings,
    }
  }
}

function warnForDuplicatePageOwners(
  sourcePath: string,
  pages: readonly string[],
  pageOwners: Map<string, string>,
  warnings: KnowledgeBaseManifestFinalizerWarning[],
): void {
  for (const page of pages) {
    if (isCanonicalMaintenancePage(page)) continue
    const existingOwner = pageOwners.get(page)
    if (existingOwner && existingOwner !== sourcePath) {
      warnings.push({
        code: "page-owned-by-multiple-sources",
        message: `Page was claimed by multiple ingest sources: ${page}`,
      })
      continue
    }
    pageOwners.set(page, sourcePath)
  }
}

async function withProjectManifestFinalizerLock<T>(
  projectPath: string,
  options: { readonly lockRoot?: string; readonly timeoutMs: number; readonly retryMs: number },
  work: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(projectPath)
  const previous = manifestFinalizerLocks.get(key) ?? Promise.resolve()
  let release: () => void = () => undefined
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.catch(() => undefined).then(() => current)
  manifestFinalizerLocks.set(key, queued)
  await previous.catch(() => undefined)
  const releaseFileLock = await acquireProjectManifestFileLock(projectPath, options)
  try {
    return await work()
  } finally {
    try {
      await releaseFileLock()
    } finally {
      release()
      if (manifestFinalizerLocks.get(key) === queued) {
        manifestFinalizerLocks.delete(key)
      }
    }
  }
}

export function knowledgeBaseManifestLockPath(
  projectPath: string,
  options: { readonly lockRoot?: string } = {},
): string {
  const lockRoot = options.lockRoot ?? path.join(os.tmpdir(), "synapse-kb-manifest-locks")
  const key = createHash("sha256").update(path.resolve(projectPath)).digest("hex")
  return path.join(lockRoot, `${key}.lock`)
}

class KnowledgeBaseManifestLockTimeoutError extends Error {
  constructor(projectPath: string) {
    super(`Timed out waiting for Knowledge Base manifest lock: ${projectPath}`)
    this.name = "KnowledgeBaseManifestLockTimeoutError"
  }
}

async function acquireProjectManifestFileLock(
  projectPath: string,
  options: { readonly lockRoot?: string; readonly timeoutMs: number; readonly retryMs: number },
): Promise<() => Promise<void>> {
  const lockPath = knowledgeBaseManifestLockPath(projectPath, { lockRoot: options.lockRoot })
  await mkdir(path.dirname(lockPath), { recursive: true })
  const startedAt = Date.now()
  while (true) {
    try {
      await mkdir(lockPath)
      return async () => {
        await rm(lockPath, { recursive: true, force: true })
      }
    } catch (error) {
      if (!isPathExistsError(error)) throw error
      if (Date.now() - startedAt >= options.timeoutMs) {
        throw new KnowledgeBaseManifestLockTimeoutError(projectPath)
      }
      await delay(options.retryMs)
    }
  }
}

function isPathExistsError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === "EEXIST"
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizePageList(
  paths: readonly string[],
  allowed: readonly string[],
  kind: "created" | "updated",
  warnings: KnowledgeBaseManifestFinalizerWarning[],
): string[] {
  const allowedSet = new Set(allowed)
  const result: string[] = []
  for (const item of paths) {
    const normalized = normalizeRelativePath(item)
    if (!isWikiPagePath(normalized)) {
      warnings.push({ code: "page-path-invalid", message: `Invalid wiki page path: ${item}` })
      continue
    }
    if (!allowedSet.has(normalized) && !isCanonicalMaintenancePage(normalized)) {
      warnings.push({ code: `page-not-${kind}`, message: `Page was not verified as ${kind}: ${normalized}` })
      continue
    }
    if (!result.includes(normalized)) result.push(normalized)
  }
  return result.sort((a, b) => a.localeCompare(b))
}

async function filterExistingWikiPages(projectPath: string, pages: readonly string[]): Promise<string[]> {
  const root = path.resolve(projectPath)
  const result: string[] = []
  for (const page of pages) {
    const absolutePath = path.resolve(root, page)
    const relative = path.relative(root, absolutePath)
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
    try {
      await access(absolutePath)
      result.push(page)
    } catch (error) {
      if (!isMissingPathError(error)) throw error
    }
  }
  return result
}

function isRawSourcePath(value: string): boolean {
  return value.startsWith(".raw/") && !value.includes("../") && !path.posix.isAbsolute(value)
}

function isWikiPagePath(value: string): boolean {
  return value.startsWith("wiki/")
    && value.endsWith(".md")
    && !value.includes("../")
    && !path.posix.isAbsolute(value)
}

function isCanonicalMaintenancePage(page: string): boolean {
  return page === "wiki/index.md" || page === "wiki/hot.md" || page === "wiki/log.md"
}

function normalizeRelativePath(value: string): string {
  return path.posix.normalize(value.split("\\").join("/"))
}

async function hashRawSource(projectPath: string, sourcePath: string): Promise<string | null> {
  const root = path.resolve(projectPath)
  const absolutePath = path.resolve(root, sourcePath)
  const relative = path.relative(root, absolutePath)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  try {
    return createHash("sha256").update(await readFile(absolutePath)).digest("hex")
  } catch (error) {
    if (isMissingPathError(error)) return null
    throw error
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
