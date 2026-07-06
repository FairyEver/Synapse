import type { Dirent } from "node:fs"
import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import { TextDecoder } from "node:util"

import { errorLogMeta as baseErrorLogMeta } from "../../error-sanitize"
import { createMainLogger } from "../../log-store"
import { splitMarkdownFrontmatter } from "../markdown-frontmatter"
import {
  DRAGONSCALE_BOUNDARY_DEFAULT_TOP,
  DRAGONSCALE_BOUNDARY_HALFLIFE_DAYS,
  DRAGONSCALE_BOUNDARY_MAX_BODY_BYTES,
  type DragonScaleBoundaryScoreOptions,
  type DragonScaleBoundaryScoreReport,
  type DragonScaleBoundaryScoreResult,
} from "./boundary-types"

interface BoundaryPage {
  readonly title: string
  readonly titleKey: string
  readonly pageKey: string
  readonly path: string
  readonly body: string
  readonly updated?: string
  readonly created?: string
}

interface BoundaryPageScanResult {
  readonly pages: Map<string, BoundaryPage>
  readonly skipped: Record<string, number>
}

interface ParsedFrontmatter {
  readonly type?: string
  readonly updated?: string
  readonly created?: string
  readonly title?: string
}

type BoundaryServiceDeps = {
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
const UPDATED_RE = /^updated:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/m
const CREATED_RE = /^created:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/m
const TITLE_RE = /^title:\s*"?([^"\n]+?)"?\s*$/m
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g
const FENCE_RE = /^(\s*)(`{3,}|~{3,})/
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true })
const logger = createMainLogger("knowledge-base.dragonscale.boundary")

export class DragonScaleBoundaryService {
  private readonly fileAccess: SmallFileAccess

  constructor(deps: BoundaryServiceDeps = {}) {
    this.fileAccess = {
      fileSize: deps.fileSize ?? defaultFileSize,
      readFile: deps.readFile ?? readFile,
    }
  }

  async score(
    projectPath: string,
    options: DragonScaleBoundaryScoreOptions = {},
  ): Promise<DragonScaleBoundaryScoreReport> {
    const top = options.top ?? DRAGONSCALE_BOUNDARY_DEFAULT_TOP
    if (!Number.isInteger(top) || top < 1) {
      throw new Error("DragonScale boundary score top must be >= 1.")
    }

    const root = path.resolve(projectPath)
    const today = options.today ?? localDateString(new Date())
    const scan = await collectPages(root, this.fileAccess)
    const pages = scan.pages
    const { outEdges, inEdges } = buildGraph(pages)
    let results = [...pages.values()].map((page) => scorePage(page, outEdges, inEdges, today))

    if (options.page) {
      const pageFilter = normalizeRelativePath(options.page)
      const key = path.parse(pageFilter).name
      results = results.filter((result) => result.titleKey === key || result.path === pageFilter)
      if (results.length === 0) {
        throw new Error(`No scoreable DragonScale page matches '${options.page}'.`)
      }
    } else {
      if (options.includeScoreZero !== true) {
        results = results.filter((result) => result.score > 0)
      }
      results.sort((left, right) =>
        right.score - left.score
        || left.titleKey.localeCompare(right.titleKey)
        || left.path.localeCompare(right.path))
      results = results.slice(0, top)
    }

    return {
      generated: generatedTimestamp(),
      halflifeDays: DRAGONSCALE_BOUNDARY_HALFLIFE_DAYS,
      pageCountScoreable: pages.size,
      skipped: scan.skipped,
      results,
    }
  }
}

async function collectPages(root: string, fileAccess: SmallFileAccess): Promise<BoundaryPageScanResult> {
  const wikiPath = path.join(root, "wiki")
  const rootRealPath = await resolveExistingPath(root)
  const markdownPaths = await collectMarkdownPaths(root, rootRealPath, wikiPath)
  markdownPaths.sort((left, right) => normalizeRelativePath(path.relative(root, left)).localeCompare(
    normalizeRelativePath(path.relative(root, right)),
  ))

  const pages = new Map<string, BoundaryPage>()
  const skipped: Record<string, number> = {}
  for (const markdownPath of markdownPaths) {
    const relativePath = normalizeRelativePath(path.relative(root, markdownPath))
    const read = await readSmallUtf8(markdownPath, fileAccess)
    if (!read.ok) {
      if (read.reason === "read_error") {
        logger.warn("DragonScale boundary page read failed.", {
          pagePath: relativePath,
          reason: read.reason,
          ...errorLogMeta(read.error),
        })
      }
      increment(skipped, read.reason)
      continue
    }
    const content = read.content
    const { frontmatter, body } = parseFrontmatter(content)
    const parsed = parseFrontmatterFields(frontmatter)
    if (!included(relativePath, parsed)) continue
    const titleKey = path.parse(markdownPath).name
    const pageKey = relativePath
    pages.set(pageKey, {
      title: parsed.title ?? titleKey,
      titleKey,
      pageKey,
      path: relativePath,
      body,
      ...(parsed.updated ? { updated: parsed.updated } : undefined),
      ...(parsed.created ? { created: parsed.created } : undefined),
    })
  }
  return { pages, skipped }
}

async function collectMarkdownPaths(root: string, rootRealPath: string, directoryPath: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }

  const results: string[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue
    const entryPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      results.push(...await collectMarkdownPaths(root, rootRealPath, entryPath))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const stat = await lstat(entryPath)
    if (stat.isSymbolicLink()) continue
    const resolved = await resolveExistingPath(entryPath)
    if (!isInside(rootRealPath, resolved)) continue
    if (!isInside(root, entryPath)) continue
    results.push(entryPath)
  }
  return results
}

async function readSmallUtf8(filePath: string, fileAccess: SmallFileAccess): Promise<
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: "too_large" | "read_error"; readonly error?: unknown }
> {
  try {
    const size = await fileAccess.fileSize(filePath)
    if (size > DRAGONSCALE_BOUNDARY_MAX_BODY_BYTES) return { ok: false, reason: "too_large" }
    const bytes = await fileAccess.readFile(filePath)
    if (bytes.byteLength > DRAGONSCALE_BOUNDARY_MAX_BODY_BYTES) return { ok: false, reason: "too_large" }
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

function parseFrontmatterFields(frontmatter: string): ParsedFrontmatter {
  return {
    ...pickField("type", frontmatter, TYPE_RE),
    ...pickField("updated", frontmatter, UPDATED_RE),
    ...pickField("created", frontmatter, CREATED_RE),
    ...pickField("title", frontmatter, TITLE_RE),
  }
}

function pickField<K extends keyof ParsedFrontmatter>(
  key: K,
  frontmatter: string,
  regex: RegExp,
): Pick<ParsedFrontmatter, K> | Record<string, never> {
  const match = regex.exec(frontmatter)
  const value = match?.[1]?.trim().replace(/^["']|["']$/g, "")
  return value ? { [key]: value } as Pick<ParsedFrontmatter, K> : {}
}

function included(relativePath: string, frontmatter: ParsedFrontmatter): boolean {
  if (!relativePath.startsWith("wiki/")) return false
  if (EXCLUDE_FILENAMES.has(path.basename(relativePath))) return false
  if (EXCLUDE_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return false
  return !frontmatter.type || !EXCLUDE_TYPES.has(frontmatter.type)
}

function buildGraph(pages: Map<string, BoundaryPage>): {
  readonly outEdges: Map<string, Set<string>>
  readonly inEdges: Map<string, Set<string>>
} {
  const outEdges = new Map<string, Set<string>>()
  const inEdges = new Map<string, Set<string>>()
  const pagesByTitleKey = pagesByStem(pages)
  for (const pageKey of pages.keys()) {
    outEdges.set(pageKey, new Set())
    inEdges.set(pageKey, new Set())
  }

  for (const [sourceKey, page] of pages.entries()) {
    for (const targetKey of extractWikilinks(page.body)) {
      const targets = pagesByTitleKey.get(targetKey) ?? []
      if (targets.length !== 1) continue
      const target = targets[0]
      if (!target || target.pageKey === sourceKey) continue
      outEdges.get(sourceKey)?.add(target.pageKey)
      inEdges.get(target.pageKey)?.add(sourceKey)
    }
  }

  return { outEdges, inEdges }
}

function pagesByStem(pages: Map<string, BoundaryPage>): Map<string, BoundaryPage[]> {
  const result = new Map<string, BoundaryPage[]>()
  for (const page of pages.values()) {
    result.set(page.titleKey, [...result.get(page.titleKey) ?? [], page])
  }
  return result
}

function extractWikilinks(body: string): Set<string> {
  const cleaned: string[] = []
  let fenceChar: string | null = null
  let fenceLength = 0

  for (const line of body.split(/\r?\n/)) {
    const fence = FENCE_RE.exec(line)
    if (fence?.[2]) {
      const char = fence[2][0]
      const length = fence[2].length
      if (fenceChar === null) {
        fenceChar = char
        fenceLength = length
        continue
      }
      if (char === fenceChar && length >= fenceLength) {
        fenceChar = null
        fenceLength = 0
        continue
      }
    }
    if (fenceChar !== null) continue
    cleaned.push(line)
  }

  const results = new Set<string>()
  for (const match of cleaned.join("\n").matchAll(WIKILINK_RE)) {
    const raw = match[1]?.trim()
    if (!raw) continue
    const stem = raw.split("/").at(-1)
    if (stem) results.add(stem)
  }
  return results
}

function scorePage(
  page: BoundaryPage,
  outEdges: Map<string, Set<string>>,
  inEdges: Map<string, Set<string>>,
  today: string,
): DragonScaleBoundaryScoreResult {
  const outDegree = outEdges.get(page.pageKey)?.size ?? 0
  const inDegree = inEdges.get(page.pageKey)?.size ?? 0
  const ageDays = daysSince(page.updated ?? page.created, today)
  const recencyWeight = round4(Math.exp(-ageDays / DRAGONSCALE_BOUNDARY_HALFLIFE_DAYS))
  return {
    title: page.title,
    titleKey: page.titleKey,
    path: page.path,
    outDegree,
    inDegree,
    ageDays,
    recencyWeight,
    score: round4((outDegree - inDegree) * recencyWeight),
  }
}

function daysSince(dateString: string | undefined, today: string): number {
  const day = parseDateOnly(dateString)
  const now = parseDateOnly(today)
  if (!day || !now) return 10_000
  return Math.max(0, Math.floor((now.getTime() - day.getTime()) / 86_400_000))
}

function parseDateOnly(value: string | undefined): Date | null {
  if (!value || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }
  return date
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function errorLogMeta(error: unknown): Record<string, unknown> {
  return baseErrorLogMeta(error, { includeMessage: true })
}

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function generatedTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/").split("\\").join("/")
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

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
