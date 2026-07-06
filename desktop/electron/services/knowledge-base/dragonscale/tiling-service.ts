import type { Dirent } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { TextDecoder } from "node:util"

import {
  DragonScaleOllamaEmbeddingProvider,
  resolveDragonScaleOllamaUrl,
  sanitizeDragonScaleOllamaUrl,
} from "./ollama-embedding-provider"
import { createMainLogger } from "../../log-store"
import { errorLogMeta as baseErrorLogMeta } from "../../error-sanitize"
import { splitMarkdownFrontmatter } from "../markdown-frontmatter"
import { normalizeKnowledgeBaseRelativePath as normalizeRelativePath } from "../path-normalize"
import {
  DRAGONSCALE_TILING_DEFAULT_MODEL,
  DRAGONSCALE_TILING_MAX_BODY_BYTES,
  DRAGONSCALE_TILING_MAX_PAIR_COMPARISONS,
  DRAGONSCALE_TILING_MAX_REPORT_PAIRS_PER_BAND,
  DRAGONSCALE_TILING_SCALE_HARD_FAIL_PAGES,
  DRAGONSCALE_TILING_SCALE_WARN_PAGES,
  defaultDragonScaleTilingThresholds,
  type DragonScaleEmbeddingProvider,
  type DragonScaleTilingCache,
  type DragonScaleTilingCacheEntry,
  type DragonScaleTilingCheckOptions,
  type DragonScaleTilingCheckResult,
  type DragonScaleTilingPair,
  type DragonScaleTilingPeekOptions,
  type DragonScaleTilingPeekResult,
  type DragonScaleTilingThresholds,
} from "./tiling-types"

interface TilingPage {
  readonly relativePath: string
  readonly body: string
  readonly hash: string
}

interface PageScanResult {
  readonly pages: readonly TilingPage[]
  readonly scanned: number
  readonly skipped: Record<string, number>
}

interface LoadCacheResult {
  readonly status: "ok" | "cache-corrupt"
  readonly cache: DragonScaleTilingCache
  readonly message?: string
}

interface LoadThresholdsResult {
  readonly status: "ok" | "usage-error"
  readonly thresholds: DragonScaleTilingThresholds
  readonly message?: string
}

type TilingServiceDeps = {
  readonly embeddingProvider?: DragonScaleEmbeddingProvider
  readonly now?: () => Date
  readonly fileSize?: (filePath: string) => Promise<number>
  readonly readFile?: (filePath: string) => Promise<Buffer>
}

type SmallFileAccess = {
  readonly fileSize: (filePath: string) => Promise<number>
  readonly readFile: (filePath: string) => Promise<Buffer>
}

const EXCLUDE_TYPES = new Set(["meta", "fold"])
const EXCLUDE_FILENAMES = new Set([
  "_index.md",
  "index.md",
  "log.md",
  "hot.md",
  "overview.md",
  "dashboard.md",
  "Wiki Map.md",
  "getting-started.md",
])
const EXCLUDE_PATH_PREFIXES = ["wiki/folds/", "wiki/meta/"]
const TYPE_RE = /^type:\s*(\S+)/m
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true })
const vaultLocks = new Map<string, Promise<void>>()
const logger = createMainLogger("knowledge-base.dragonscale.tiling")

export class DragonScaleTilingService {
  private readonly embeddingProvider: DragonScaleEmbeddingProvider
  private readonly now: () => Date
  private readonly fileAccess: SmallFileAccess

  constructor(deps: TilingServiceDeps = {}) {
    this.embeddingProvider = deps.embeddingProvider ?? new DragonScaleOllamaEmbeddingProvider()
    this.now = deps.now ?? (() => new Date())
    this.fileAccess = {
      fileSize: deps.fileSize ?? defaultFileSize,
      readFile: deps.readFile ?? readFile,
    }
  }

  async peek(projectPath: string, options: DragonScaleTilingPeekOptions = {}): Promise<DragonScaleTilingPeekResult> {
    const root = path.resolve(projectPath)
    const model = options.model ?? DRAGONSCALE_TILING_DEFAULT_MODEL
    let ollamaUrl: string
    try {
      ollamaUrl = resolveDragonScaleOllamaUrl(options)
    } catch (error) {
      const rawOllamaUrl = options.ollamaUrl ?? process.env.OLLAMA_URL ?? ""
      return {
        status: "usage-error",
        vaultPath: root,
        ollamaUrl: sanitizeDragonScaleOllamaUrl(rawOllamaUrl),
        ollamaReachable: false,
        modelRequested: model,
        modelPresent: false,
        ...await inspectCacheAndThresholds(root),
        message: error instanceof Error ? error.message : String(error),
      }
    }
    const displayOllamaUrl = sanitizeDragonScaleOllamaUrl(ollamaUrl)

    const ollamaReachable = await this.embeddingProvider.isReachable(ollamaUrl)
    const modelPresent = ollamaReachable
      ? await this.embeddingProvider.hasModel(ollamaUrl, model)
      : false
    const diagnostics = await inspectCacheAndThresholds(root)
    return {
      status: statusFromDiagnostics(ollamaReachable, modelPresent, diagnostics),
      vaultPath: root,
      ollamaUrl: displayOllamaUrl,
      ollamaReachable,
      modelRequested: model,
      modelPresent,
      ...diagnostics,
    }
  }

  async check(projectPath: string, options: DragonScaleTilingCheckOptions = {}): Promise<DragonScaleTilingCheckResult> {
    const root = path.resolve(projectPath)
    const model = options.model ?? DRAGONSCALE_TILING_DEFAULT_MODEL
    const now = options.now ?? this.now()
    const generated = isoSeconds(now)
    const defaultThresholds = defaultDragonScaleTilingThresholds(model)
    let ollamaUrl: string
    try {
      ollamaUrl = resolveDragonScaleOllamaUrl(options)
    } catch (error) {
      const rawOllamaUrl = options.ollamaUrl ?? process.env.OLLAMA_URL ?? ""
      return emptyCheckResult({
        status: "usage-error",
        generated,
        model,
        ollamaUrl: sanitizeDragonScaleOllamaUrl(rawOllamaUrl),
        thresholds: defaultThresholds,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    const displayOllamaUrl = sanitizeDragonScaleOllamaUrl(ollamaUrl)

    const reportPath = validateReportPath(root, options.reportPath)
    if (reportPath.status === "usage-error") {
      return emptyCheckResult({
        status: "usage-error",
        generated,
        model,
        ollamaUrl: displayOllamaUrl,
        thresholds: defaultThresholds,
        message: reportPath.message,
      })
    }

    if (!await wikiDirectoryExists(root)) {
      return emptyCheckResult({ status: "ok", generated, model, ollamaUrl: displayOllamaUrl, thresholds: defaultThresholds })
    }

    if (!await this.embeddingProvider.isReachable(ollamaUrl)) {
      return emptyCheckResult({ status: "ollama-unreachable", generated, model, ollamaUrl: displayOllamaUrl, thresholds: defaultThresholds })
    }
    if (!await this.embeddingProvider.hasModel(ollamaUrl, model)) {
      return emptyCheckResult({ status: "model-missing", generated, model, ollamaUrl: displayOllamaUrl, thresholds: defaultThresholds })
    }

    const thresholdsResult = await loadThresholds(root, model)
    if (thresholdsResult.status === "usage-error") {
      return emptyCheckResult({
        status: "usage-error",
        generated,
        model,
        ollamaUrl: displayOllamaUrl,
        thresholds: thresholdsResult.thresholds,
        message: thresholdsResult.message,
      })
    }

    return this.withVaultLock(root, async () => {
      const scan = await scanPages(root, model, this.fileAccess)
      const warnings: string[] = []
      if (scan.scanned > DRAGONSCALE_TILING_SCALE_HARD_FAIL_PAGES) {
        return emptyCheckResult({
          status: "scale-exceeded",
          generated,
          model,
          ollamaUrl: displayOllamaUrl,
          thresholds: thresholdsResult.thresholds,
          scanned: scan.scanned,
          skipped: scan.skipped,
          message: `${scan.scanned} pages exceed hard-fail limit ${DRAGONSCALE_TILING_SCALE_HARD_FAIL_PAGES}.`,
        })
      }
      if (scan.scanned > DRAGONSCALE_TILING_SCALE_WARN_PAGES) {
        warnings.push(`${scan.scanned} pages; cold-cache embed will issue about ${scan.scanned} POSTs to Ollama.`)
      }

      const cacheResult = await loadCache(root, model, options.rebuildCache === true)
      if (cacheResult.status === "cache-corrupt") {
        return emptyCheckResult({
          status: "cache-corrupt",
          generated,
          model,
          ollamaUrl: displayOllamaUrl,
          thresholds: thresholdsResult.thresholds,
          scanned: scan.scanned,
          skipped: scan.skipped,
          message: cacheResult.message,
        })
      }

      const cache = mutableCache(cacheResult.cache)
      const embeddedPages: { path: string; embedding: readonly number[] }[] = []
      let cacheHits = 0
      let recomputed = 0
      const skipped = { ...scan.skipped }
      const livePaths = new Set(scan.pages.map((page) => page.relativePath))

      for (const page of scan.pages) {
        const cached = cache.embeddings[page.relativePath]
        if (isUsableCacheEntry(cached) && cached.hash === page.hash) {
          embeddedPages.push({ path: page.relativePath, embedding: cached.embedding })
          cacheHits += 1
          continue
        }
        try {
          const embedding = await this.embeddingProvider.embed({ url: ollamaUrl, model, text: page.body })
          const entry: DragonScaleTilingCacheEntry = {
            hash: page.hash,
            embedding,
            computed_at: generated,
          }
          cache.embeddings[page.relativePath] = entry
          embeddedPages.push({ path: page.relativePath, embedding })
          recomputed += 1
        } catch (error) {
          logger.warn("DragonScale tiling embed failed", {
            pagePath: page.relativePath,
            model,
            ollamaUrl: displayOllamaUrl,
            ...errorLogMeta(error),
          })
          skipped.embed_error = (skipped.embed_error ?? 0) + 1
        }
      }

      let orphansPruned = 0
      for (const key of Object.keys(cache.embeddings)) {
        if (!livePaths.has(key)) {
          delete cache.embeddings[key]
          orphansPruned += 1
        }
      }

      await saveCache(root, cache)
      const pairComparisons = pairCount(embeddedPages.length)
      if (pairComparisons > DRAGONSCALE_TILING_MAX_PAIR_COMPARISONS) {
        return emptyCheckResult({
          status: "scale-exceeded",
          generated,
          model,
          ollamaUrl,
          thresholds: thresholdsResult.thresholds,
          scanned: scan.scanned,
          embedded: embeddedPages.length,
          skipped,
          cacheHits,
          recomputed,
          orphansPruned,
          message: `${embeddedPages.length} embedded pages require ${pairComparisons} pair comparisons, exceeding limit ${DRAGONSCALE_TILING_MAX_PAIR_COMPARISONS}.`,
        })
      }
      const { errors, reviews, pairWarnings } = scorePairs(embeddedPages, thresholdsResult.thresholds)
      warnings.push(...pairWarnings)
      const reportMarkdown = formatReport({
        generated,
        model,
        ollamaUrl: displayOllamaUrl,
        thresholds: thresholdsResult.thresholds,
        scanned: scan.scanned,
        embedded: embeddedPages.length,
        skipped,
        cacheHits,
        recomputed,
        orphansPruned,
        errors,
        reviews,
      })
      if (reportPath.path) {
        await writeReport(root, reportPath.path, reportMarkdown)
      }
      return {
        status: "ok",
        generated,
        model,
        ollamaUrl: displayOllamaUrl,
        thresholds: thresholdsResult.thresholds,
        scanned: scan.scanned,
        embedded: embeddedPages.length,
        skipped,
        cacheHits,
        recomputed,
        orphansPruned,
        errors,
        reviews,
        reportMarkdown,
        ...(reportPath.path ? { reportPath: reportPath.path } : undefined),
        warnings,
      }
    })
  }

  private async withVaultLock<T>(vaultPath: string, work: () => Promise<T>): Promise<T> {
    const key = path.resolve(vaultPath)
    const previous = vaultLocks.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => current)
    vaultLocks.set(key, queued)
    await previous.catch(() => undefined)
    try {
      return await work()
    } finally {
      release()
      if (vaultLocks.get(key) === queued) {
        vaultLocks.delete(key)
      }
    }
  }
}

export function dragonScaleTilingBodyHash(body: string, model: string): string {
  const hash = createHash("sha256")
  hash.update(`model=${model}\n`, "utf8")
  hash.update(body, "utf8")
  return hash.digest("hex")
}

async function scanPages(root: string, model: string, fileAccess: SmallFileAccess): Promise<PageScanResult> {
  const rootRealPath = await resolveExistingPath(root)
  const markdownPaths = await collectMarkdownPaths(root, rootRealPath, path.join(root, "wiki"))
  const skipped: Record<string, number> = {}
  const pages: TilingPage[] = []

  for (const filePath of markdownPaths.paths) {
    const relativePath = normalizeRelativePath(path.relative(root, filePath))
    const read = await readSmallUtf8(filePath, fileAccess)
    if (!read.ok) {
      if (read.reason === "read_error") {
        logger.warn("DragonScale tiling page read failed", {
          pagePath: relativePath,
          reason: read.reason,
          ...errorLogMeta(read.error),
        })
      }
      increment(skipped, read.reason)
      continue
    }
    const { frontmatter, body } = parseFrontmatter(read.content)
    const type = parseType(frontmatter)
    const included = includePage(relativePath, type)
    if (!included.ok) {
      increment(skipped, included.reason)
      continue
    }
    pages.push({
      relativePath,
      body,
      hash: dragonScaleTilingBodyHash(body, model),
    })
  }

  return {
    pages,
    scanned: markdownPaths.scanned,
    skipped: { ...markdownPaths.skipped, ...skipped },
  }
}

async function collectMarkdownPaths(
  root: string,
  rootRealPath: string,
  directoryPath: string,
): Promise<{ readonly paths: readonly string[]; readonly scanned: number; readonly skipped: Record<string, number> }> {
  let entries: Dirent[]
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return { paths: [], scanned: 0, skipped: {} }
    throw error
  }

  const paths: string[] = []
  const skipped: Record<string, number> = {}
  let scanned = 0
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directoryPath, entry.name)
    if (entry.isSymbolicLink()) {
      if (entry.name.endsWith(".md")) {
        scanned += 1
        increment(skipped, "symlink")
      }
      continue
    }
    if (entry.isDirectory()) {
      const child = await collectMarkdownPaths(root, rootRealPath, entryPath)
      paths.push(...child.paths)
      scanned += child.scanned
      mergeCounts(skipped, child.skipped)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    scanned += 1
    const stat = await lstat(entryPath)
    if (stat.isSymbolicLink()) {
      increment(skipped, "symlink")
      continue
    }
    const resolved = await resolveExistingPath(entryPath)
    if (!isInside(rootRealPath, resolved) || !isInside(root, entryPath)) {
      increment(skipped, "escapes vault")
      continue
    }
    paths.push(entryPath)
  }
  return { paths, scanned, skipped }
}

async function readSmallUtf8(filePath: string, fileAccess: SmallFileAccess): Promise<
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: string; readonly error?: unknown }
> {
  try {
    const size = await fileAccess.fileSize(filePath)
    if (size > DRAGONSCALE_TILING_MAX_BODY_BYTES) {
      return { ok: false, reason: "too_large" }
    }
    const bytes = await fileAccess.readFile(filePath)
    if (bytes.byteLength > DRAGONSCALE_TILING_MAX_BODY_BYTES) {
      return { ok: false, reason: "too_large" }
    }
    return { ok: true, content: UTF8_DECODER.decode(bytes) }
  } catch (error) {
    return { ok: false, reason: "read_error", error }
  }
}

async function defaultFileSize(filePath: string): Promise<number> {
  return (await lstat(filePath)).size
}

function parseFrontmatter(content: string): { readonly frontmatter: string; readonly body: string } {
  return splitMarkdownFrontmatter(content)
}

function parseType(frontmatter: string): string | undefined {
  return TYPE_RE.exec(frontmatter)?.[1]?.trim().replace(/^["']|["']$/g, "")
}

function includePage(relativePath: string, type: string | undefined): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (EXCLUDE_FILENAMES.has(path.basename(relativePath))) return { ok: false, reason: "excluded filename" }
  const prefix = EXCLUDE_PATH_PREFIXES.find((candidate) => relativePath.startsWith(candidate))
  if (prefix) return { ok: false, reason: `under ${prefix}` }
  if (type && EXCLUDE_TYPES.has(type)) return { ok: false, reason: `type=${type}` }
  return { ok: true }
}

async function loadThresholds(root: string, model: string): Promise<LoadThresholdsResult> {
  const thresholdsPath = path.join(root, ".vault-meta", "tiling-thresholds.json")
  try {
    const raw = await readFile(thresholdsPath, "utf8")
    return { status: "ok", thresholds: parseThresholds(JSON.parse(raw) as unknown, model) }
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: "ok", thresholds: defaultDragonScaleTilingThresholds(model) }
    }
    return {
      status: "usage-error",
      thresholds: defaultDragonScaleTilingThresholds(model),
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

function parseThresholds(value: unknown, fallbackModel: string): DragonScaleTilingThresholds {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.bands)) {
    throw new Error("DragonScale tiling thresholds must be version 1 with bands.")
  }
  const error = value.bands.error
  const review = value.bands.review
  if (!isValidBand(error) || !isValidBand(review) || review > error) {
    throw new Error("DragonScale tiling threshold bands are invalid.")
  }
  return {
    version: 1,
    model: typeof value.model === "string" ? value.model : fallbackModel,
    bands: { error, review },
    calibrated: value.calibrated === true,
    calibrationPairsLabeled: typeof value.calibration_pairs_labeled === "number"
      ? value.calibration_pairs_labeled
      : 0,
  }
}

async function loadCache(root: string, model: string, rebuild: boolean): Promise<LoadCacheResult> {
  if (rebuild) {
    return { status: "ok", cache: emptyCache(model) }
  }
  const cachePath = path.join(root, ".vault-meta", "tiling-cache.json")
  try {
    const raw = await readFile(cachePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.embeddings)) {
      throw new Error("DragonScale tiling cache is structurally invalid.")
    }
    if (parsed.model !== model) {
      return { status: "ok", cache: emptyCache(model) }
    }
    const embeddings: Record<string, DragonScaleTilingCacheEntry> = {}
    for (const [key, entry] of Object.entries(parsed.embeddings)) {
      if (isUsableCacheEntry(entry)) {
        embeddings[normalizeRelativePath(key)] = entry
      }
    }
    return { status: "ok", cache: { version: 1, model, embeddings } }
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: "ok", cache: emptyCache(model) }
    }
    logger.warn("DragonScale tiling cache corrupt", {
      cachePath,
      model,
      ...errorLogMeta(error),
    })
    return {
      status: "cache-corrupt",
      cache: emptyCache(model),
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function saveCache(root: string, cache: DragonScaleTilingCache): Promise<void> {
  await assertNoSymlinkInPath(root, ".vault-meta/tiling-cache.json")
  const metaPath = path.join(root, ".vault-meta")
  await mkdir(metaPath, { recursive: true })
  const cachePath = path.join(metaPath, "tiling-cache.json")
  const tempPath = path.join(metaPath, `tiling-cache.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(tempPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8")
  await rename(tempPath, cachePath)
}

function scorePairs(
  pages: readonly { readonly path: string; readonly embedding: readonly number[] }[],
  thresholds: DragonScaleTilingThresholds,
): {
  readonly errors: readonly DragonScaleTilingPair[]
  readonly reviews: readonly DragonScaleTilingPair[]
  readonly pairWarnings: readonly string[]
} {
  const errors: DragonScaleTilingPair[] = []
  const reviews: DragonScaleTilingPair[] = []
  const pairWarnings: string[] = []
  for (let i = 0; i < pages.length; i += 1) {
    for (let j = i + 1; j < pages.length; j += 1) {
      const left = pages[i]
      const right = pages[j]
      if (!left || !right) continue
      const similarity = cosine(left.embedding, right.embedding)
      if (similarity === null) {
        pushPairWarning(pairWarnings, `cosine skip (${left.path}, ${right.path}): dimension mismatch`)
        continue
      }
      const pair = { similarity, leftPath: left.path, rightPath: right.path }
      if (similarity >= thresholds.bands.error) {
        pushRankedPair(errors, pair)
      } else if (similarity >= thresholds.bands.review) {
        pushRankedPair(reviews, pair)
      }
    }
  }
  return {
    errors,
    reviews,
    pairWarnings,
  }
}

function pairCount(count: number): number {
  return count <= 1 ? 0 : (count * (count - 1)) / 2
}

function comparePairs(left: DragonScaleTilingPair, right: DragonScaleTilingPair): number {
  return right.similarity - left.similarity
    || left.leftPath.localeCompare(right.leftPath)
    || left.rightPath.localeCompare(right.rightPath)
}

function pushRankedPair(pairs: DragonScaleTilingPair[], pair: DragonScaleTilingPair): void {
  pairs.push(pair)
  pairs.sort(comparePairs)
  if (pairs.length > DRAGONSCALE_TILING_MAX_REPORT_PAIRS_PER_BAND) pairs.pop()
}

function pushPairWarning(warnings: string[], warning: string): void {
  const limit = 50
  if (warnings.length < limit) {
    warnings.push(warning)
    return
  }
  if (!warnings.includes("Additional cosine warnings omitted.")) {
    warnings.push("Additional cosine warnings omitted.")
  }
}

function cosine(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length) return null
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }
  if (leftNorm === 0 || rightNorm === 0) return 0
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function formatReport(input: {
  readonly generated: string
  readonly model: string
  readonly ollamaUrl: string
  readonly thresholds: DragonScaleTilingThresholds
  readonly scanned: number
  readonly embedded: number
  readonly skipped: Record<string, number>
  readonly cacheHits: number
  readonly recomputed: number
  readonly orphansPruned: number
  readonly errors: readonly DragonScaleTilingPair[]
  readonly reviews: readonly DragonScaleTilingPair[]
}): string {
  const lines: string[] = []
  lines.push("# Semantic Tiling Report")
  lines.push("")
  lines.push(`- generated: ${input.generated}`)
  lines.push(`- model: ${input.model}`)
  lines.push(`- ollama_url: ${input.ollamaUrl}`)
  lines.push(`- thresholds: error>=${input.thresholds.bands.error}, review=${input.thresholds.bands.review}-${input.thresholds.bands.error}`)
  lines.push(`- calibrated: ${String(input.thresholds.calibrated)}${input.thresholds.calibrated ? "" : " (using uncalibrated defaults)"}`)
  lines.push(`- pages scanned: ${input.scanned}; embedded: ${input.embedded}; skipped: ${sumCounts(input.skipped)}`)
  if (Object.keys(input.skipped).length > 0) {
    lines.push(`- skipped reasons: ${Object.entries(input.skipped).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join(", ")}`)
  }
  lines.push(`- cache hits: ${input.cacheHits}; recomputed: ${input.recomputed}; orphans pruned: ${input.orphansPruned}`)
  lines.push("")
  lines.push(`## Errors (similarity >= ${input.thresholds.bands.error})`)
  lines.push("")
  appendPairs(lines, input.errors)
  lines.push("")
  lines.push(`## Review (${input.thresholds.bands.review} <= similarity < ${input.thresholds.bands.error})`)
  lines.push("")
  appendPairs(lines, input.reviews)
  return `${lines.join("\n")}\n`
}

function appendPairs(lines: string[], pairs: readonly DragonScaleTilingPair[]): void {
  if (pairs.length === 0) {
    lines.push("- none")
    return
  }
  for (const pair of pairs) {
    lines.push(`- \`${pair.similarity.toFixed(4)}\` ${pair.leftPath} -- ${pair.rightPath}`)
  }
}

function validateReportPath(
  root: string,
  reportPath: string | undefined,
): { readonly status: "ok"; readonly path?: string } | { readonly status: "usage-error"; readonly message: string } {
  if (!reportPath) return { status: "ok" }
  const absolutePath = path.isAbsolute(reportPath) ? path.resolve(reportPath) : path.resolve(root, reportPath)
  if (!isInside(root, absolutePath)) {
    return { status: "usage-error", message: `Report path escapes vault root: ${reportPath}` }
  }
  return { status: "ok", path: absolutePath }
}

async function writeReport(root: string, reportPath: string, markdown: string): Promise<void> {
  await assertNoSymlinkInPath(root, path.relative(root, reportPath))
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, markdown, "utf8")
}

async function assertNoSymlinkInPath(root: string, relativePath: string): Promise<void> {
  let currentPath = root
  for (const segment of normalizeRelativePath(relativePath).split("/")) {
    if (!segment) continue
    currentPath = path.join(currentPath, segment)
    try {
      const stat = await lstat(currentPath)
      if (stat.isSymbolicLink()) {
        throw new Error(`Knowledge base path must not contain symlinks: ${normalizeRelativePath(path.relative(root, currentPath))}`)
      }
    } catch (error) {
      if (isMissingPathError(error)) return
      throw error
    }
  }
}

async function wikiDirectoryExists(root: string): Promise<boolean> {
  try {
    const stat = await lstat(path.join(root, "wiki"))
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch (error) {
    if (isMissingPathError(error)) return false
    throw error
  }
}

async function inspectCacheAndThresholds(root: string): Promise<Omit<
  DragonScaleTilingPeekResult,
  "status" | "vaultPath" | "ollamaUrl" | "ollamaReachable" | "modelRequested" | "modelPresent" | "message"
>> {
  const cachePath = path.join(root, ".vault-meta", "tiling-cache.json")
  const thresholdsPath = path.join(root, ".vault-meta", "tiling-thresholds.json")
  const cache = await inspectCache(cachePath)
  const thresholds = await inspectThresholds(thresholdsPath)
  return { ...cache, ...thresholds }
}

async function inspectCache(cachePath: string): Promise<Pick<
  DragonScaleTilingPeekResult,
  "cachePresent" | "cacheReadable" | "cacheEntries" | "cacheModel" | "cacheError"
>> {
  try {
    const raw = await readFile(cachePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.embeddings)) {
      throw new Error("Cache is structurally invalid.")
    }
    return {
      cachePresent: true,
      cacheReadable: true,
      cacheEntries: Object.keys(parsed.embeddings).length,
      cacheModel: typeof parsed.model === "string" ? parsed.model : null,
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      return { cachePresent: false, cacheReadable: false, cacheEntries: 0, cacheModel: null }
    }
    return {
      cachePresent: true,
      cacheReadable: false,
      cacheEntries: 0,
      cacheModel: null,
      cacheError: error instanceof Error ? error.message : String(error),
    }
  }
}

async function inspectThresholds(thresholdsPath: string): Promise<Pick<
  DragonScaleTilingPeekResult,
  "thresholdsPresent" | "thresholdsReadable" | "thresholdsCalibrated" | "thresholdsBands"
>> {
  try {
    const raw = await readFile(thresholdsPath, "utf8")
    const thresholds = parseThresholds(JSON.parse(raw) as unknown, DRAGONSCALE_TILING_DEFAULT_MODEL)
    return {
      thresholdsPresent: true,
      thresholdsReadable: true,
      thresholdsCalibrated: thresholds.calibrated,
      thresholdsBands: thresholds.bands,
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      return { thresholdsPresent: false, thresholdsReadable: false }
    }
    return { thresholdsPresent: true, thresholdsReadable: false }
  }
}

function statusFromDiagnostics(
  ollamaReachable: boolean,
  modelPresent: boolean,
  diagnostics: Pick<DragonScaleTilingPeekResult, "cachePresent" | "cacheReadable">,
) {
  if (!ollamaReachable) return "ollama-unreachable"
  if (!modelPresent) return "model-missing"
  if (diagnostics.cachePresent && !diagnostics.cacheReadable) return "cache-corrupt"
  return "ok"
}

function emptyCheckResult(input: {
  readonly status: DragonScaleTilingCheckResult["status"]
  readonly generated: string
  readonly model: string
  readonly ollamaUrl: string
  readonly thresholds: DragonScaleTilingThresholds
  readonly scanned?: number
  readonly embedded?: number
  readonly skipped?: Record<string, number>
  readonly cacheHits?: number
  readonly recomputed?: number
  readonly orphansPruned?: number
  readonly message?: string
}): DragonScaleTilingCheckResult {
  return {
    status: input.status,
    generated: input.generated,
    model: input.model,
    ollamaUrl: input.ollamaUrl,
    thresholds: input.thresholds,
    scanned: input.scanned ?? 0,
    embedded: input.embedded ?? 0,
    skipped: input.skipped ?? {},
    cacheHits: input.cacheHits ?? 0,
    recomputed: input.recomputed ?? 0,
    orphansPruned: input.orphansPruned ?? 0,
    errors: [],
    reviews: [],
    warnings: [],
    ...(input.message ? { message: input.message } : undefined),
  }
}

function emptyCache(model: string): DragonScaleTilingCache {
  return { version: 1, model, embeddings: {} }
}

function mutableCache(cache: DragonScaleTilingCache): DragonScaleTilingCache {
  return {
    version: 1,
    model: cache.model,
    embeddings: { ...cache.embeddings },
  }
}

function isUsableCacheEntry(value: unknown): value is DragonScaleTilingCacheEntry {
  return isRecord(value)
    && typeof value.hash === "string"
    && Array.isArray(value.embedding)
    && value.embedding.every((item) => typeof item === "number" && Number.isFinite(item))
    && typeof value.computed_at === "string"
}

function isValidBand(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value
  }
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0)
}

async function resolveExistingPath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath)
  } catch (error) {
    if (isMissingPathError(error)) return path.resolve(filePath)
    throw error
  }
}

function isInside(rootPath: string, targetPath: string): boolean {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}

function errorLogMeta(error: unknown): Record<string, unknown> {
  return baseErrorLogMeta(error, { includeMessage: true })
}
