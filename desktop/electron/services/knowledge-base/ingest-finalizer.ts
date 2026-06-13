import { access } from "node:fs/promises"
import path from "node:path"

import type { AgentProjectAfterTurnInput, AgentProjectMessageContext } from "../agent-runtime/project-contributions"
import type { AgentMessage } from "../agent-runtime/types"
import { knowledgeBaseErrorMeta, knowledgeBaseLogger } from "./logging"
import { readKnowledgeBaseManifest, writeKnowledgeBaseManifest, type KnowledgeBaseManifest } from "./manifest"
import { scanKnowledgeBaseSources, type KnowledgeBaseSourceScanItem } from "./source-scan"
import { diffWikiSnapshots, snapshotWikiMarkdown, type WikiSnapshot } from "./wiki-snapshot"

const REPORT_SCHEMA = "synapse.kb.ingest.report.v1"

type IngestPreflight = {
  readonly sources: readonly KnowledgeBaseSourceScanItem[]
  readonly wikiBefore: WikiSnapshot
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
  }) {}

  async prepareTurn(message: AgentMessage, context: AgentProjectMessageContext): Promise<AgentMessage> {
    if (!isIngestMessage(message.content)) return message
    const force = /\b(force|re-ingest|reingest|重新|强制)\b/iu.test(message.content)
    const [scan, wikiBefore] = await Promise.all([
      scanKnowledgeBaseSources(this.deps.projectPath, { force }),
      snapshotWikiMarkdown(this.deps.projectPath),
    ])
    this.preflights.set(context.turnId, {
      sources: scan.sources.filter((source) => source.state !== "unchanged" || force),
      wikiBefore,
    })
    return {
      ...message,
      content: `${message.content}\n\n${buildPreflightAppendix(scan.sources, force)}`,
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
    const nextManifest = await buildFinalManifest(this.deps.projectPath, manifestResult.manifest, preflight, report)
    if (!nextManifest) return
    await writeKnowledgeBaseManifest(this.deps.projectPath, nextManifest)
  }
}

function isIngestMessage(content: string): boolean {
  return /^\/wiki-ingest\b/iu.test(content.trim())
}

function buildPreflightAppendix(sources: readonly KnowledgeBaseSourceScanItem[], force: boolean): string {
  const changedSources = sources.filter((source) => source.state !== "unchanged" || force)
  return [
    "Synapse ingest preflight:",
    "- Do not edit `.raw/.manifest.json`; Synapse writes manifest facts after this turn.",
    "- Process only these changed `.raw/` sources:",
    ...changedSources.map((source) => `  - ${source.relativePath} (${source.hash})`),
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
  return record.schema === REPORT_SCHEMA && Array.isArray(record.processed_sources)
}

async function buildFinalManifest(
  projectPath: string,
  manifest: KnowledgeBaseManifest,
  preflight: IngestPreflight,
  report: IngestReport,
): Promise<KnowledgeBaseManifest | null> {
  const sourceByPath = new Map(preflight.sources.map((source) => [source.relativePath, source]))
  const wikiAfter = await snapshotWikiMarkdown(projectPath)
  const diff = diffWikiSnapshots(preflight.wikiBefore, wikiAfter)
  const sources = { ...manifest.sources }
  let changed = false

  for (const item of report.processed_sources) {
    const source = sourceByPath.get(item.source)
    if (!source || !isSafeRawPath(item.source)) continue
    const pagesCreated = await validatedPages(projectPath, item.pages_created ?? [], diff.created)
    const pagesUpdated = await validatedPages(projectPath, item.pages_updated ?? [], diff.updated)
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
    address_map: { ...manifest.address_map },
  }
}

async function validatedPages(
  projectPath: string,
  values: readonly string[],
  changedPaths: readonly string[],
): Promise<string[]> {
  const changed = new Set(changedPaths)
  const accepted: string[] = []
  for (const value of values) {
    if (!isSafeWikiPagePath(value) || !changed.has(value)) continue
    try {
      await access(path.join(projectPath, value))
      accepted.push(value)
    } catch {
      continue
    }
  }
  return [...new Set(accepted)].sort((a, b) => a.localeCompare(b))
}

function isSafeRawPath(value: string): boolean {
  return value.startsWith(".raw/") && !path.isAbsolute(value) && !value.split(/[\\/]/u).includes("..")
}

function isSafeWikiPagePath(value: string): boolean {
  return value.startsWith("wiki/") && value.endsWith(".md") && !path.isAbsolute(value) && !value.split(/[\\/]/u).includes("..")
}
