import type { Dirent } from "node:fs"
import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import path from "node:path"

import { DragonScaleAddressService } from "./dragonscale/address-service"
import { frontmatterField, splitMarkdownFrontmatter } from "./markdown-frontmatter"
import { readKnowledgeBaseManifest } from "./manifest"

export type KnowledgeBaseLintSeverity = "error" | "warning" | "info"

export interface KnowledgeBaseLintIssue {
  readonly severity: KnowledgeBaseLintSeverity
  readonly code: string
  readonly path?: string
  readonly message: string
}

export interface KnowledgeBaseAddressLintResult {
  readonly counter: number | null
  readonly highestCAddress: string | null
  readonly postRolloutPagesChecked: number
  readonly legacyPagesPendingBackfill: number
  readonly issues: readonly KnowledgeBaseLintIssue[]
}

type KnowledgeBaseAddressLintDeps = {
  readonly addressService?: Pick<DragonScaleAddressService, "peek">
}

interface LintPage {
  readonly relativePath: string
  readonly absolutePath: string
  readonly frontmatter: string
  readonly titleKey: string
  readonly type?: string
  readonly created?: string
  readonly address?: string
}

interface LegacyConfig {
  readonly rolloutDate: string
  readonly legacyPages: ReadonlySet<string>
}

const DEFAULT_ROLLOUT_DATE = "2026-04-23"
const EXCLUDED_FILENAMES = new Set([
  "_index.md",
  "index.md",
  "log.md",
  "hot.md",
  "overview.md",
  "dashboard.md",
  "Wiki Map.md",
  "getting-started.md",
])
const EXCLUDED_PREFIXES = ["wiki/folds/", "wiki/meta/"]

export class KnowledgeBaseAddressLintService {
  private readonly addressService: Pick<DragonScaleAddressService, "peek">

  constructor(deps: KnowledgeBaseAddressLintDeps = {}) {
    this.addressService = deps.addressService ?? new DragonScaleAddressService()
  }

  async lint(projectPath: string): Promise<KnowledgeBaseAddressLintResult> {
    const root = path.resolve(projectPath)
    const [pages, legacy, manifestResult] = await Promise.all([
      readLintPages(root),
      readLegacyConfig(root),
      readKnowledgeBaseManifest(root),
    ])
    const issues: KnowledgeBaseLintIssue[] = []
    const addressToPages = new Map<string, string[]>()
    let highestCAddressNumber = 0
    let postRolloutPagesChecked = 0
    let legacyPagesPendingBackfill = 0

    for (const page of pages) {
      if (isAddressExcluded(page)) continue
      const legacyPage = isLegacyPage(page, legacy)
      if (!legacyPage) postRolloutPagesChecked += 1
      if (page.address) {
        if (!/^(c|l)-[0-9]{6}$/.test(page.address)) {
          issues.push({
            severity: "error",
            code: "address.invalid-format",
            path: page.relativePath,
            message: `Invalid address format: ${page.address}`,
          })
        }
        const list = addressToPages.get(page.address) ?? []
        list.push(page.relativePath)
        addressToPages.set(page.address, list)
        if (/^c-[0-9]{6}$/.test(page.address)) {
          highestCAddressNumber = Math.max(highestCAddressNumber, Number(page.address.slice(2)))
        }
        continue
      }

      if (legacyPage) {
        legacyPagesPendingBackfill += 1
        issues.push({
          severity: "info",
          code: "address.legacy-pending-backfill",
          path: page.relativePath,
          message: "Legacy page has no address and is pending optional backfill.",
        })
      } else {
        issues.push({
          severity: "error",
          code: "address.missing-post-rollout",
          path: page.relativePath,
          message: "Post-rollout page is missing address frontmatter.",
        })
      }
    }

    for (const [address, paths] of addressToPages.entries()) {
      if (paths.length <= 1) continue
      for (const pagePath of paths) {
        issues.push({
          severity: "error",
          code: "address.duplicate",
          path: pagePath,
          message: `Address ${address} is shared by: ${paths.join(", ")}`,
        })
      }
    }

    let counter: number | null = null
    try {
      counter = await this.addressService.peek(root)
      if (highestCAddressNumber >= counter) {
        issues.push({
          severity: "error",
          code: "address.counter-drift",
          message: `Highest c-address c-${String(highestCAddressNumber).padStart(6, "0")} is not below counter ${counter}.`,
        })
      }
    } catch (error) {
      issues.push({
        severity: "error",
        code: "address.counter-unreadable",
        message: error instanceof Error ? error.message : String(error),
      })
    }

    const pagesByPath = new Map(pages.map((page) => [page.relativePath, page]))
    if (manifestResult.status !== "invalid") {
      for (const [pagePath, mappedAddress] of Object.entries(manifestResult.manifest.address_map)) {
        const normalizedPath = normalizeRelativePath(pagePath)
        const page = pagesByPath.get(normalizedPath)
        if (!page) {
          issues.push({
            severity: "error",
            code: "address-map.missing-page",
            path: normalizedPath,
            message: `.raw/.manifest.json maps missing page ${normalizedPath}.`,
          })
          continue
        }
        if (page.address !== mappedAddress) {
          issues.push({
            severity: "error",
            code: "address-map.mismatch",
            path: normalizedPath,
            message: `Manifest maps ${mappedAddress} but page has ${page.address ?? "no address"}.`,
          })
        }
      }
    } else {
      issues.push({
        severity: "error",
        code: "manifest.invalid",
        message: manifestResult.error,
      })
    }

    return {
      counter,
      highestCAddress: highestCAddressNumber > 0 ? `c-${String(highestCAddressNumber).padStart(6, "0")}` : null,
      postRolloutPagesChecked,
      legacyPagesPendingBackfill,
      issues,
    }
  }
}

async function readLintPages(root: string): Promise<readonly LintPage[]> {
  const rootRealPath = await resolveExistingPath(root)
  const paths = await walkMarkdown(root, rootRealPath, path.join(root, "wiki"))
  const pages: LintPage[] = []
  for (const absolutePath of paths.sort((left, right) => left.localeCompare(right))) {
    const relativePath = normalizeRelativePath(path.relative(root, absolutePath))
    let content: string
    try {
      content = await readFile(absolutePath, "utf8")
    } catch {
      continue
    }
    const frontmatter = parseFrontmatter(content)
    pages.push({
      relativePath,
      absolutePath,
      frontmatter,
      titleKey: path.parse(absolutePath).name,
      ...field("type", frontmatter),
      ...field("created", frontmatter),
      ...field("address", frontmatter),
    })
  }
  return pages
}

async function walkMarkdown(root: string, rootRealPath: string, directoryPath: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
  const paths: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      paths.push(...await walkMarkdown(root, rootRealPath, entryPath))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const stat = await lstat(entryPath)
    if (stat.isSymbolicLink()) continue
    const resolved = await resolveExistingPath(entryPath)
    if (!isInside(rootRealPath, resolved) || !isInside(root, entryPath)) continue
    paths.push(entryPath)
  }
  return paths
}

async function readLegacyConfig(root: string): Promise<LegacyConfig> {
  try {
    const content = await readFile(path.join(root, ".vault-meta", "legacy-pages.txt"), "utf8")
    let rolloutDate = DEFAULT_ROLLOUT_DATE
    const legacyPages = new Set<string>()
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const rollout = trimmed.match(/^#\s*rollout:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/)
      if (rollout?.[1]) {
        rolloutDate = rollout[1]
        continue
      }
      if (trimmed.startsWith("#")) continue
      legacyPages.add(normalizeRelativePath(trimmed))
    }
    return { rolloutDate, legacyPages }
  } catch (error) {
    if (isMissingPathError(error)) {
      return { rolloutDate: DEFAULT_ROLLOUT_DATE, legacyPages: new Set() }
    }
    throw error
  }
}

function isAddressExcluded(page: LintPage): boolean {
  if (EXCLUDED_FILENAMES.has(path.basename(page.relativePath))) return true
  if (EXCLUDED_PREFIXES.some((prefix) => page.relativePath.startsWith(prefix))) return true
  return page.type === "meta" || page.type === "fold"
}

function isLegacyPage(page: LintPage, legacy: LegacyConfig): boolean {
  if (legacy.legacyPages.has(page.relativePath)) return true
  return Boolean(page.created && page.created < legacy.rolloutDate)
}

function parseFrontmatter(content: string): string {
  return splitMarkdownFrontmatter(content).frontmatter
}

function field(key: "type" | "created" | "address", frontmatter: string): Record<string, string> {
  const value = frontmatterField(frontmatter, key)
  return value ? { [key]: value } : {}
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

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/").split("\\").join("/")
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
