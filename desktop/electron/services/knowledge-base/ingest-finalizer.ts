import { readFile } from "node:fs/promises"
import path from "node:path"

import type { AgentProjectAfterTurnInput, AgentProjectMessageContext } from "../agent-runtime/project-contributions"
import type { AgentMessage } from "../agent-runtime/types"
import { atomicWriteTextFile } from "./atomic-write"
import { DragonScaleAddressService } from "./dragonscale/address-service"
import { knowledgeBaseErrorMeta, knowledgeBaseLogger } from "./logging"
import { readKnowledgeBaseManifest, writeKnowledgeBaseManifest, type KnowledgeBaseManifest } from "./manifest"
import { scanKnowledgeBaseSources, type KnowledgeBaseSourceScanItem } from "./source-scan"
import { snapshotWikiMarkdown, type WikiSnapshot } from "./wiki-snapshot"
import { withKnowledgeBaseManifestMutationLock } from "./manifest-mutation-lock"

const REPORT_SCHEMA = "synapse.kb.ingest.report.v1"
const ADDRESS_PATTERN = /^[cl]-\d{6}$/u
const PREFLIGHT_SOURCE_LIST_MAX_ITEMS = 100
const ADDRESS_EXCLUDED_FILENAMES = new Set([
  "_index.md",
  "index.md",
  "log.md",
  "hot.md",
  "overview.md",
  "dashboard.md",
  "Wiki Map.md",
  "getting-started.md",
])
const ADDRESS_EXCLUDED_PREFIXES = ["wiki/folds/", "wiki/meta/"]

type IngestPreflight = {
  readonly sources: readonly KnowledgeBaseSourceScanItem[]
}

type IngestReport = {
  readonly schema: typeof REPORT_SCHEMA
  readonly processed_sources: readonly {
    readonly source: string
    readonly pages_created?: readonly string[]
    readonly pages_updated?: readonly string[]
  }[]
}

export class KnowledgeBaseIngestCoordinator {
  private readonly preflights = new Map<string, IngestPreflight>()

  constructor(private readonly deps: {
    readonly projectId: string
    readonly projectPath: string
    readonly addressService?: Pick<DragonScaleAddressService, "allocate">
  }) {}

  async prepareTurn(message: AgentMessage, context: AgentProjectMessageContext): Promise<AgentMessage> {
    if (!isIngestMessage(message.content)) return message
    const force = /\b(force|re-ingest|reingest|重新|强制)\b/iu.test(message.content)
    const scan = await scanKnowledgeBaseSources(this.deps.projectPath, { force })
    if (scan.manifest.status === "invalid") {
      knowledgeBaseLogger.warn("Knowledge Base ingest preflight blocked invalid manifest.", {
        boundary: "knowledge-base.ingest-finalizer",
        projectId: this.deps.projectId,
        turnId: context.turnId,
        warningCode: "invalid-manifest",
        ...knowledgeBaseErrorMeta(scan.manifest.error),
      })
      throw new Error("知识库资料清单 .raw/.manifest.json 已损坏，请修复后再运行 /wiki-ingest。")
    }
    const changedSources = scan.sources.filter((source) => source.state !== "unchanged" || force)
    const listedSources = selectListedPreflightSources(changedSources)
    this.preflights.set(context.turnId, {
      sources: listedSources,
    })
    return {
      ...message,
      content: `${message.content}\n\n${buildPreflightAppendix(changedSources, listedSources)}`,
    }
  }

  async finalizeTurn(input: AgentProjectAfterTurnInput): Promise<void> {
    const preflight = this.preflights.get(input.turnId)
    this.preflights.delete(input.turnId)
    if (!preflight) return
    const report = parseReport(input.result.resultText)
    if (!report) {
      knowledgeBaseLogger.warn("Knowledge Base ingest finalizer skipped missing report.", {
        boundary: "knowledge-base.ingest-finalizer",
        projectId: this.deps.projectId,
        conversationId: input.conversationId,
        turnId: input.turnId,
        warningCode: "missing-report",
      })
      return
    }
    await withKnowledgeBaseManifestMutationLock(this.deps.projectPath, async () => {
      const manifestResult = await readKnowledgeBaseManifest(this.deps.projectPath)
      if (manifestResult.status === "invalid") {
        knowledgeBaseLogger.warn("Knowledge Base ingest finalizer skipped invalid manifest.", {
          boundary: "knowledge-base.ingest-finalizer",
          projectId: this.deps.projectId,
          conversationId: input.conversationId,
          turnId: input.turnId,
          warningCode: "invalid-manifest",
          ...knowledgeBaseErrorMeta(manifestResult.error),
        })
        return
      }
      const nextManifest = await buildFinalManifest(
        this.deps.projectPath,
        manifestResult.manifest,
        preflight,
        report,
        this.deps.addressService ?? new DragonScaleAddressService(),
      )
      if (!nextManifest) return
      await writeKnowledgeBaseManifest(this.deps.projectPath, nextManifest)
    })
  }
}

function isIngestMessage(content: string): boolean {
  return /^\/wiki-ingest\b/iu.test(content.trim())
}

function selectListedPreflightSources(
  changedSources: readonly KnowledgeBaseSourceScanItem[],
): readonly KnowledgeBaseSourceScanItem[] {
  return changedSources.slice(0, PREFLIGHT_SOURCE_LIST_MAX_ITEMS)
}

function buildPreflightAppendix(
  changedSources: readonly KnowledgeBaseSourceScanItem[],
  listedSources: readonly KnowledgeBaseSourceScanItem[],
): string {
  const sourceLines: string[] = []
  for (const source of listedSources) {
    const line = `  - ${source.relativePath} (${source.hash})`
    sourceLines.push(line)
  }
  const omittedCount = changedSources.length - sourceLines.length
  return [
    "Synapse ingest preflight:",
    "- Do not edit `.raw/.manifest.json`; Synapse writes manifest facts after this turn.",
    "- Process only these changed `.raw/` sources:",
    ...sourceLines,
    ...(omittedCount > 0
      ? [
          `- ${omittedCount} additional changed \`.raw/\` sources were omitted from this prompt to keep the ingest turn bounded.`,
          "- Process only the listed sources in this turn; run `/wiki-ingest` again after this batch to continue remaining sources.",
        ]
      : []),
    "- End with exactly one fenced block tagged `synapse_kb_ingest_report` containing schema `synapse.kb.ingest.report.v1`.",
  ].join("\n")
}

function parseReport(text: string): IngestReport | null {
  const match = /```synapse_kb_ingest_report\s*([\s\S]*?)```/u.exec(text)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1] ?? "") as unknown
    if (!isReport(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function isReport(value: unknown): value is IngestReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.schema === REPORT_SCHEMA
    && Array.isArray(record.processed_sources)
    && record.processed_sources.every(isReportProcessedSource)
}

function isReportProcessedSource(value: unknown): value is IngestReport["processed_sources"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.source === "string"
    && record.source.trim().length > 0
    && isOptionalStringArray(record.pages_created)
    && isOptionalStringArray(record.pages_updated)
}

function isOptionalStringArray(value: unknown): value is readonly string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"))
}

async function buildFinalManifest(
  projectPath: string,
  manifest: KnowledgeBaseManifest,
  preflight: IngestPreflight,
  report: IngestReport,
  addressService: Pick<DragonScaleAddressService, "allocate">,
): Promise<KnowledgeBaseManifest | null> {
  const sourceByPath = new Map(preflight.sources.map((source) => [source.relativePath, source]))
  const wikiAfter = await snapshotWikiMarkdown(projectPath, { paths: reportedWikiPages(report) })
  const sources = { ...manifest.sources }
  const addressMap = { ...manifest.address_map }
  let changed = false

  for (const item of report.processed_sources) {
    const source = sourceByPath.get(item.source)
    if (!source || !isSafeRawPath(item.source)) continue
    const pagesCreated = validatedPages(item.pages_created ?? [], wikiAfter)
    const pagesUpdated = validatedPages(item.pages_updated ?? [], wikiAfter)
    await ensureAddressesForReportedPages(projectPath, [...pagesCreated, ...pagesUpdated], addressService)
    await syncAddressMapFromPages(projectPath, addressMap, [...pagesCreated, ...pagesUpdated])
    sources[item.source] = {
      hash: source.hash,
      ingested_at: new Date().toISOString(),
      pages_created: pagesCreated,
      pages_updated: pagesUpdated,
    }
    changed = true
  }

  if (!changed) return null
  return {
    ...manifest,
    sources,
    address_map: addressMap,
  }
}

async function ensureAddressesForReportedPages(
  projectPath: string,
  pages: readonly string[],
  addressService: Pick<DragonScaleAddressService, "allocate">,
): Promise<void> {
  for (const pagePath of [...new Set(pages)].sort((a, b) => a.localeCompare(b))) {
    await ensurePageAddress(projectPath, pagePath, addressService)
  }
}

async function ensurePageAddress(
  projectPath: string,
  pagePath: string,
  addressService: Pick<DragonScaleAddressService, "allocate">,
): Promise<void> {
  if (isAddressExcludedPath(pagePath)) return
  const filePath = path.join(projectPath, pagePath)
  let content: string
  try {
    content = await readFile(filePath, "utf8")
  } catch {
    return
  }
  const frontmatter = parsePageFrontmatter(content)
  const type = frontmatterField(frontmatter, "type")
  if (type === "meta" || type === "fold") return
  const existing = frontmatterField(frontmatter, "address")
  if (existing && ADDRESS_PATTERN.test(existing)) return

  const { address } = await addressService.allocate(projectPath)
  await atomicWriteTextFile(filePath, addPageAddress(content, address))
}

function reportedWikiPages(report: IngestReport): string[] {
  const pages: string[] = []
  for (const item of report.processed_sources) {
    pages.push(...(item.pages_created ?? []), ...(item.pages_updated ?? []))
  }
  return [...new Set(pages)].sort((a, b) => a.localeCompare(b))
}

function validatedPages(
  values: readonly string[],
  snapshot: WikiSnapshot,
): string[] {
  const accepted: string[] = []
  for (const value of values) {
    if (!isSafeWikiPagePath(value) || !snapshot.files[value]) continue
    accepted.push(value)
  }
  return [...new Set(accepted)].sort((a, b) => a.localeCompare(b))
}

function isSafeRawPath(value: string): boolean {
  return value.startsWith(".raw/") && !path.isAbsolute(value) && !value.split(/[\\/]/u).includes("..")
}

function isSafeWikiPagePath(value: string): boolean {
  return value.startsWith("wiki/") && value.endsWith(".md") && !path.isAbsolute(value) && !value.split(/[\\/]/u).includes("..")
}

async function syncAddressMapFromPages(
  projectPath: string,
  addressMap: Record<string, string>,
  pages: readonly string[],
): Promise<void> {
  for (const pagePath of [...new Set(pages)].sort((a, b) => a.localeCompare(b))) {
    const address = await readPageAddress(projectPath, pagePath)
    if (!address) continue
    for (const [mappedPath, mappedAddress] of Object.entries(addressMap)) {
      if (mappedPath !== pagePath && mappedAddress === address) {
        delete addressMap[mappedPath]
      }
    }
    addressMap[pagePath] = address
  }
}

async function readPageAddress(projectPath: string, pagePath: string): Promise<string | null> {
  if (isAddressExcludedPath(pagePath)) return null
  let content: string
  try {
    content = await readFile(path.join(projectPath, pagePath), "utf8")
  } catch {
    return null
  }
  const frontmatter = parsePageFrontmatter(content)
  const type = frontmatterField(frontmatter, "type")
  if (type === "meta" || type === "fold") return null
  const address = frontmatterField(frontmatter, "address")
  return address && ADDRESS_PATTERN.test(address) ? address : null
}

function isAddressExcludedPath(pagePath: string): boolean {
  if (ADDRESS_EXCLUDED_FILENAMES.has(path.basename(pagePath))) return true
  return ADDRESS_EXCLUDED_PREFIXES.some((prefix) => pagePath.startsWith(prefix))
}

function parsePageFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return ""
  const end = content.indexOf("\n---", 4)
  return end === -1 ? "" : content.slice(4, end)
}

function addPageAddress(content: string, address: string): string {
  if (!content.startsWith("---\n")) {
    return `---\naddress: ${address}\n---\n${content}`
  }
  const end = content.indexOf("\n---", 4)
  if (end === -1) {
    return `---\naddress: ${address}\n---\n${content}`
  }
  const frontmatter = content.slice(4, end)
  if (/^address:\s*.+$/mu.test(frontmatter)) {
    return `${content.slice(0, 4)}${frontmatter.replace(/^address:\s*.+$/mu, `address: ${address}`)}${content.slice(end)}`
  }
  return `${content.slice(0, 4)}address: ${address}\n${content.slice(4)}`
}

function frontmatterField(frontmatter: string, key: "address" | "type"): string | null {
  const match = new RegExp(`^${key}:\\s*([^\\n]+)`, "mu").exec(frontmatter)
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || null
}
