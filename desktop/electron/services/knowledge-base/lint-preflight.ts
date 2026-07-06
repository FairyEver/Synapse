import type { Dirent } from "node:fs"
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises"
import path from "node:path"

import { DragonScaleTilingService } from "./dragonscale/tiling-service"
import type { DragonScaleTilingCheckResult, DragonScaleTilingPeekResult } from "./dragonscale/tiling-types"
import {
  KnowledgeBaseAddressLintService,
  type KnowledgeBaseAddressLintResult,
  type KnowledgeBaseLintIssue,
  type KnowledgeBaseLintSeverity,
} from "./lint-addresses"
import { splitMarkdownFrontmatter } from "./markdown-frontmatter"
import { readKnowledgeBaseManifest } from "./manifest"

export interface KnowledgeBaseLintPreflightResult {
  readonly generatedDate: string
  readonly pagesScanned: number
  readonly issues: readonly KnowledgeBaseLintIssue[]
  readonly address: KnowledgeBaseAddressLintResult
  readonly tiling: {
    readonly status: DragonScaleTilingPeekResult["status"] | DragonScaleTilingCheckResult["status"]
    readonly reportPath?: string
    readonly errors: number
    readonly reviews: number
    readonly calibrated?: boolean
    readonly message?: string
  }
}

type KnowledgeBaseLintPreflightDeps = {
  readonly addressLint?: Pick<KnowledgeBaseAddressLintService, "lint">
  readonly tilingService?: Pick<DragonScaleTilingService, "peek" | "check">
  readonly now?: () => Date
}

interface WikiPage {
  readonly relativePath: string
  readonly titleKey: string
  readonly frontmatter: string
  readonly body: string
  readonly system: boolean
}

interface WikiPageReadResult {
  readonly pages: readonly WikiPage[]
  readonly issues: readonly KnowledgeBaseLintIssue[]
}

const SYSTEM_FILENAMES = new Set(["_index.md", "index.md", "log.md", "hot.md", "overview.md", "dashboard.md"])
const REQUIRED_FIELDS = ["type", "title", "created", "updated", "tags", "status"] as const
const LINT_PREFLIGHT_MAX_MARKDOWN_PAGES = 1000
const LINT_PREFLIGHT_MAX_PAGE_BYTES = 128 * 1024
const LINT_PREFLIGHT_MAX_TOTAL_BODY_BYTES = 4 * 1024 * 1024
const LINT_PREFLIGHT_MAX_BASIC_ISSUES = 500

export class KnowledgeBaseLintPreflightService {
  private readonly addressLint: Pick<KnowledgeBaseAddressLintService, "lint">
  private readonly tilingService: Pick<DragonScaleTilingService, "peek" | "check">
  private readonly now: () => Date

  constructor(deps: KnowledgeBaseLintPreflightDeps = {}) {
    this.addressLint = deps.addressLint ?? new KnowledgeBaseAddressLintService()
    this.tilingService = deps.tilingService ?? new DragonScaleTilingService()
    this.now = deps.now ?? (() => new Date())
  }

  async run(projectPath: string): Promise<KnowledgeBaseLintPreflightResult> {
    const root = path.resolve(projectPath)
    const generatedDate = localDateString(this.now())
    const [wiki, address, manifest] = await Promise.all([
      readWikiPages(root),
      this.addressLint.lint(root),
      readKnowledgeBaseManifest(root),
    ])
    const issues: KnowledgeBaseLintIssue[] = [
      ...wiki.issues,
      ...basicWikiIssues(wiki.pages),
      ...manifestIssues(manifest),
      ...address.issues,
    ]
    const tiling = await this.runTiling(root, generatedDate)
    if (tiling.status !== "ok") {
      issues.push({
        severity: tiling.status === "cache-corrupt" || tiling.status === "usage-error" ? "error" : "info",
        code: `tiling.${tiling.status}`,
        message: tiling.message ?? `Semantic tiling status: ${tiling.status}`,
      })
    }
    return {
      generatedDate,
      pagesScanned: wiki.pages.length,
      issues,
      address,
      tiling,
    }
  }

  private async runTiling(root: string, generatedDate: string): Promise<KnowledgeBaseLintPreflightResult["tiling"]> {
    const peek = await this.tilingService.peek(root)
    if (peek.status !== "ok") {
      return {
        status: peek.status,
        errors: 0,
        reviews: 0,
        calibrated: peek.thresholdsCalibrated,
        message: peek.message ?? tilingStatusMessage(peek.status),
      }
    }
    const reportPath = `wiki/meta/tiling-report-${generatedDate}.md`
    const check = await this.tilingService.check(root, { reportPath })
    return {
      status: check.status,
      reportPath: check.reportPath ? normalizeRelativePath(path.relative(root, check.reportPath)) : reportPath,
      errors: check.errors.length,
      reviews: check.reviews.length,
      calibrated: check.thresholds.calibrated,
      message: check.message,
    }
  }
}

export function formatKnowledgeBaseLintPreflightAppendix(result: KnowledgeBaseLintPreflightResult): string {
  const counts = countIssues(result.issues)
  return [
    "## Synapse 确定性预检",
    "",
    "- 以下结果由 Synapse 内部服务生成；不要重新运行 DragonScale 脚本，也不要编造地址或 tiling 结果。",
    `- 日期：${result.generatedDate}`,
    `- 页面扫描：${result.pagesScanned}`,
    `- 问题统计：error=${counts.error}，warning=${counts.warning}，info=${counts.info}`,
    "",
    "### Address Validation",
    "",
    `- Counter state: ${result.address.counter ?? "unavailable"}`,
    `- Highest c-address observed: ${result.address.highestCAddress ?? "none"}`,
    `- Post-rollout pages checked: ${result.address.postRolloutPagesChecked}`,
    `- Legacy pages pending backfill: ${result.address.legacyPagesPendingBackfill}`,
    ...formatIssues(result.address.issues),
    "",
    "### Semantic Tiling",
    "",
    `- Status: ${result.tiling.status}`,
    ...(result.tiling.reportPath ? [`- Report: ${result.tiling.reportPath}`] : []),
    `- Errors: ${result.tiling.errors}`,
    `- Review: ${result.tiling.reviews}`,
    ...(result.tiling.calibrated !== undefined ? [`- Calibrated: ${String(result.tiling.calibrated)}`] : []),
    ...(result.tiling.message ? [`- Message: ${result.tiling.message}`] : []),
    "",
    "### Preflight Issues",
    "",
    ...formatIssues(result.issues),
  ].join("\n")
}

async function readWikiPages(root: string): Promise<WikiPageReadResult> {
  const rootRealPath = await resolveExistingPath(root)
  const scan = createMarkdownScanState()
  await walkMarkdown(root, rootRealPath, path.join(root, "wiki"), scan)
  const pages: WikiPage[] = []
  const issues: KnowledgeBaseLintIssue[] = [...scan.issues]
  let totalBodyBytes = 0
  for (const absolutePath of scan.paths.sort((left, right) => left.localeCompare(right))) {
    const relativePath = normalizeRelativePath(path.relative(root, absolutePath))
    let stat: Awaited<ReturnType<typeof lstat>>
    try {
      stat = await lstat(absolutePath)
    } catch (error) {
      issues.push({
        severity: "error",
        code: "preflight.page-unreadable",
        path: relativePath,
        message: error instanceof Error ? error.message : "Page could not be read.",
      })
      continue
    }
    if (stat.size > LINT_PREFLIGHT_MAX_PAGE_BYTES) {
      issues.push({
        severity: "warning",
        code: "preflight.page-too-large",
        path: relativePath,
        message: `Page exceeds ${LINT_PREFLIGHT_MAX_PAGE_BYTES} bytes and was skipped.`,
      })
      continue
    }
    let content: string
    try {
      content = await readFile(absolutePath, "utf8")
    } catch (error) {
      issues.push({
        severity: "error",
        code: "preflight.page-unreadable",
        path: relativePath,
        message: error instanceof Error ? error.message : "Page could not be read.",
      })
      continue
    }
    const contentBytes = Buffer.byteLength(content, "utf8")
    if (totalBodyBytes + contentBytes > LINT_PREFLIGHT_MAX_TOTAL_BODY_BYTES) {
      issues.push({
        severity: "error",
        code: "preflight.scale-exceeded",
        path: relativePath,
        message: `Wiki preflight stopped after reaching ${LINT_PREFLIGHT_MAX_TOTAL_BODY_BYTES} retained body bytes.`,
      })
      break
    }
    totalBodyBytes += contentBytes
    const { frontmatter, body } = parseFrontmatter(content)
    pages.push({
      relativePath,
      titleKey: path.parse(absolutePath).name,
      frontmatter,
      body,
      system: isSystemPage(relativePath),
    })
  }
  return { pages, issues }
}

function basicWikiIssues(pages: readonly WikiPage[]): KnowledgeBaseLintIssue[] {
  const issues: KnowledgeBaseLintIssue[] = []
  const pagesByStem = groupPagesByStem(pages)
  const inbound = new Map<string, number>()
  for (const page of pages) inbound.set(page.relativePath, 0)

  for (const page of pages) {
    for (const link of extractWikilinks(page.body)) {
      const targets = pagesByStem.get(link) ?? []
      if (targets.length === 0) {
        pushBasicIssue(issues, {
          severity: "warning",
          code: "wikilink.dead",
          path: page.relativePath,
          message: `Dead wikilink: [[${link}]]`,
        })
        continue
      }
      if (targets.length > 1) {
        pushBasicIssue(issues, {
          severity: "warning",
          code: "wikilink.ambiguous",
          path: page.relativePath,
          message: `Ambiguous wikilink: [[${link}]]`,
        })
        continue
      }
      const target = targets[0]
      if (target && target.relativePath !== page.relativePath) {
        inbound.set(target.relativePath, (inbound.get(target.relativePath) ?? 0) + 1)
      }
    }

    if (!page.system) {
      for (const field of REQUIRED_FIELDS) {
        if (!new RegExp(`^${field}:\\s*`, "m").test(page.frontmatter)) {
          pushBasicIssue(issues, {
            severity: "warning",
            code: "frontmatter.missing-field",
            path: page.relativePath,
            message: `Missing frontmatter field: ${field}`,
          })
        }
      }
      for (const heading of emptyHeadings(page.body)) {
        pushBasicIssue(issues, {
          severity: "warning",
          code: "section.empty",
          path: page.relativePath,
          message: `Empty section: ${heading}`,
        })
      }
    }
  }

  for (const page of pages) {
    if (!page.system && (inbound.get(page.relativePath) ?? 0) === 0) {
      pushBasicIssue(issues, {
        severity: "info",
        code: "page.orphan",
        path: page.relativePath,
        message: "Page has no inbound wikilinks.",
      })
    }
  }
  return issues
}

function pushBasicIssue(issues: KnowledgeBaseLintIssue[], issue: KnowledgeBaseLintIssue): void {
  if (issues.length < LINT_PREFLIGHT_MAX_BASIC_ISSUES) {
    issues.push(issue)
    return
  }
  if (issues.some((item) => item.code === "preflight.issue-limit")) return
  issues.push({
    severity: "warning",
    code: "preflight.issue-limit",
    message: `Basic wiki lint stopped after ${LINT_PREFLIGHT_MAX_BASIC_ISSUES} issues.`,
  })
}

function groupPagesByStem(pages: readonly WikiPage[]): Map<string, WikiPage[]> {
  const result = new Map<string, WikiPage[]>()
  for (const page of pages) {
    result.set(page.titleKey, [...result.get(page.titleKey) ?? [], page])
  }
  return result
}

function manifestIssues(manifest: Awaited<ReturnType<typeof readKnowledgeBaseManifest>>): KnowledgeBaseLintIssue[] {
  if (manifest.status === "invalid") {
    return [{ severity: "error", code: "manifest.invalid", message: manifest.error }]
  }
  const issues: KnowledgeBaseLintIssue[] = []
  for (const [sourcePath, entry] of Object.entries(manifest.manifest.sources)) {
    if (!sourcePath.startsWith(".raw/")) {
      issues.push({ severity: "error", code: "manifest.source-key", path: sourcePath, message: "Manifest source key must start with .raw/." })
    }
    if (!entry.hash) {
      issues.push({ severity: "error", code: "manifest.source-hash", path: sourcePath, message: "Manifest source is missing hash." })
    }
  }
  return issues
}

interface MarkdownScanState {
  readonly paths: string[]
  readonly issues: KnowledgeBaseLintIssue[]
  stopped: boolean
}

function createMarkdownScanState(): MarkdownScanState {
  return { paths: [], issues: [], stopped: false }
}

async function walkMarkdown(root: string, rootRealPath: string, directoryPath: string, state: MarkdownScanState): Promise<void> {
  if (state.stopped) return
  let entries: Dirent[]
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return
    throw error
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (state.stopped) return
    const entryPath = path.join(directoryPath, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      await walkMarkdown(root, rootRealPath, entryPath, state)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const stat = await lstat(entryPath)
    if (stat.isSymbolicLink()) continue
    const resolved = await resolveExistingPath(entryPath)
    if (!isInside(rootRealPath, resolved) || !isInside(root, entryPath)) continue
    if (state.paths.length >= LINT_PREFLIGHT_MAX_MARKDOWN_PAGES) {
      state.issues.push({
        severity: "error",
        code: "preflight.scale-exceeded",
        path: normalizeRelativePath(path.relative(root, entryPath)),
        message: `Wiki preflight stopped after ${LINT_PREFLIGHT_MAX_MARKDOWN_PAGES} Markdown pages.`,
      })
      state.stopped = true
      return
    }
    state.paths.push(entryPath)
  }
}

function parseFrontmatter(content: string): { readonly frontmatter: string; readonly body: string } {
  return splitMarkdownFrontmatter(content)
}

function extractWikilinks(body: string): readonly string[] {
  return [...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)]
    .map((match) => match[1]?.trim().split("/").at(-1) ?? "")
    .filter(Boolean)
}

function emptyHeadings(body: string): readonly string[] {
  const lines = body.split(/\r?\n/)
  const headings: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index] ?? "")
    if (!heading?.[2]) continue
    let hasContent = false
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? ""
      if (/^#{1,6}\s+/.test(line)) break
      if (line.trim()) {
        hasContent = true
        break
      }
    }
    if (!hasContent) headings.push(heading[2])
  }
  return headings
}

function formatIssues(issues: readonly KnowledgeBaseLintIssue[]): string[] {
  if (issues.length === 0) return ["- none"]
  return issues.map((issue) =>
    `- [${issue.severity}] ${issue.code}${issue.path ? ` \`${issue.path}\`` : ""}: ${issue.message}`)
}

function countIssues(issues: readonly KnowledgeBaseLintIssue[]): Record<KnowledgeBaseLintSeverity, number> {
  return {
    error: issues.filter((issue) => issue.severity === "error").length,
    warning: issues.filter((issue) => issue.severity === "warning").length,
    info: issues.filter((issue) => issue.severity === "info").length,
  }
}

function tilingStatusMessage(status: string): string {
  switch (status) {
    case "ollama-unreachable":
      return "Ollama is not reachable; semantic tiling skipped."
    case "model-missing":
      return "Embedding model is missing; run ollama pull nomic-embed-text to enable semantic tiling."
    case "cache-corrupt":
      return "Semantic tiling cache is corrupt."
    default:
      return `Semantic tiling status: ${status}`
  }
}

function isSystemPage(relativePath: string): boolean {
  return SYSTEM_FILENAMES.has(path.basename(relativePath))
    || relativePath.startsWith("wiki/meta/")
    || relativePath.startsWith("wiki/folds/")
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

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
