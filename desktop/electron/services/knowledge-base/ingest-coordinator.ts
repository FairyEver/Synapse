import type { RegisteredPromptCommandOutput } from "../agent-runtime/command-router"
import { KNOWLEDGE_BASE_INGEST_REPORT_SCHEMA, parseKnowledgeBaseIngestReport } from "./ingest-report"
import { KnowledgeBaseIngestTurnStore } from "./ingest-turn-store"
import { KnowledgeBaseManifestFinalizer } from "./manifest-finalizer"
import type { KnowledgeBaseManifestFinalizer as ManifestFinalizer } from "./manifest-finalizer"
import { scanKnowledgeBaseSources } from "./source-scan"
import { snapshotWikiMarkdown } from "./wiki-snapshot"
import {
  wikiIngestAppendixCopy,
  wikiInvalidManifestCopy,
  wikiNoIngestChangesCopy,
} from "./wiki-command-copy"

type ManifestFinalizerLike = Pick<ManifestFinalizer, "finalize">

type KnowledgeBaseIngestLogger = {
  warn(message: string, metadata?: Record<string, unknown>): void
}

export interface KnowledgeBaseIngestCoordinatorPrepareInput {
  readonly projectPath: string
  readonly turnId: string
  readonly originalContent: string
  readonly force: boolean
}

export interface KnowledgeBaseIngestCoordinatorFinalizeInput {
  readonly projectPath: string
  readonly conversationId: string
  readonly turnId: string
  readonly assistantText: string
}

export interface KnowledgeBaseIngestCoordinatorFinalizeResult {
  readonly status: "finalized" | "skipped"
  readonly warnings: readonly { readonly code: string; readonly message: string }[]
  readonly message?: string
}

export class KnowledgeBaseIngestCoordinator {
  readonly store: KnowledgeBaseIngestTurnStore
  private readonly readPrompt: (fileName: string) => Promise<string>
  private readonly manifestFinalizer: ManifestFinalizerLike
  private readonly logger: KnowledgeBaseIngestLogger | undefined

  constructor(deps: {
    readonly readPrompt: (fileName: string) => Promise<string>
    readonly manifestFinalizer?: ManifestFinalizerLike
    readonly store?: KnowledgeBaseIngestTurnStore
    readonly logger?: KnowledgeBaseIngestLogger
  }) {
    this.readPrompt = deps.readPrompt
    this.manifestFinalizer = deps.manifestFinalizer ?? new KnowledgeBaseManifestFinalizer()
    this.store = deps.store ?? new KnowledgeBaseIngestTurnStore()
    this.logger = deps.logger
  }

  async prepareTurn(input: KnowledgeBaseIngestCoordinatorPrepareInput): Promise<RegisteredPromptCommandOutput> {
    const scan = await scanKnowledgeBaseSources(input.projectPath, { force: input.force })
    if (scan.manifest.status === "invalid") {
      return { kind: "result", error: true, content: wikiInvalidManifestCopy(scan.manifest.error) }
    }

    const changedSources = scan.sources.filter((source) => source.state !== "unchanged")
    if (changedSources.length === 0) {
      return {
        kind: "result",
        content: wikiNoIngestChangesCopy({ sources: scan.sources.length, skipped: scan.skippedSources.length }),
      }
    }

    this.store.set(input.turnId, {
      projectPath: input.projectPath,
      generatedAt: new Date().toISOString(),
      force: input.force,
      changedSources,
      skippedSources: scan.skippedSources,
      wikiBefore: await snapshotWikiMarkdown(input.projectPath),
    })

    return {
      kind: "prompt",
      content: [
        await this.readPrompt("ingest.md"),
        "",
        wikiIngestAppendixCopy({
          projectPath: input.projectPath,
          changedSources,
          skippedSources: scan.skippedSources,
        }),
        "",
        reportContractCopy(),
      ].join("\n"),
    }
  }

  markTurnNoFinalize(turnId: string): void {
    this.store.setNoFinalize(turnId, "direct-result")
  }

  async finalizeTurn(input: KnowledgeBaseIngestCoordinatorFinalizeInput): Promise<KnowledgeBaseIngestCoordinatorFinalizeResult> {
    const record = this.store.consume(input.turnId)
    if (!record) {
      const result = finalizeSkipped("preflight-missing", "Knowledge Base ingest preflight was missing.")
      this.logger?.warn("Knowledge Base ingest report was not finalized.", {
        boundary: "knowledge-base.ingest-finalizer",
        projectPath: input.projectPath,
        conversationId: input.conversationId,
        turnId: input.turnId,
        warningCodes: result.warnings.map((warning) => warning.code),
      })
      return result
    }
    if (record.kind === "no-finalize") {
      return { status: "skipped", warnings: [] }
    }
    const preflight = record.state
    const parsed = parseKnowledgeBaseIngestReport(input.assistantText)
    if (parsed.status !== "valid") {
      const result: KnowledgeBaseIngestCoordinatorFinalizeResult = {
        status: "skipped",
        warnings: parsed.warnings,
        message: finalizationSkippedMessage(parsed.warnings.map((warning) => warning.code)),
      }
      this.logger?.warn("Knowledge Base ingest report was not finalized.", {
        boundary: "knowledge-base.ingest-finalizer",
        projectPath: input.projectPath,
        conversationId: input.conversationId,
        turnId: input.turnId,
        warningCodes: result.warnings.map((warning) => warning.code),
      })
      return result
    }
    const result = await this.manifestFinalizer.finalize({
      projectPath: input.projectPath,
      conversationId: input.conversationId,
      turnId: input.turnId,
      preflight,
      report: parsed.report,
    })
    if (result.warnings.length > 0) {
      this.logger?.warn("Knowledge Base ingest finalized with warnings.", {
        boundary: "knowledge-base.ingest-finalizer",
        projectPath: input.projectPath,
        conversationId: input.conversationId,
        turnId: input.turnId,
        warningCodes: result.warnings.map((warning) => warning.code),
      })
    }
    return {
      status: "finalized",
      warnings: result.warnings,
      ...(result.warnings.length > 0
        ? { message: finalizationWarningMessage(result.warnings.map((warning) => warning.code)) }
        : undefined),
    }
  }
}

function finalizeSkipped(code: string, message: string): KnowledgeBaseIngestCoordinatorFinalizeResult {
  return {
    status: "skipped",
    warnings: [{ code, message }],
    message: finalizationSkippedMessage([code]),
  }
}

function finalizationSkippedMessage(codes: readonly string[]): string {
  return `知识库后置写入未完成：${formatWarningCodes(codes)}。`
}

function finalizationWarningMessage(codes: readonly string[]): string {
  return `知识库后置写入完成，但存在警告：${formatWarningCodes(codes)}。`
}

function formatWarningCodes(codes: readonly string[]): string {
  if (codes.includes("report-missing")) return "缺少 synapse_kb_ingest_report"
  if (codes.includes("preflight-missing")) return "缺少本轮预检状态"
  if (codes.includes("report-multiple")) return "检测到多个 synapse_kb_ingest_report"
  if (codes.includes("report-json")) return "synapse_kb_ingest_report 不是有效 JSON"
  if (codes.includes("report-schema")) return "synapse_kb_ingest_report schema 不匹配"
  if (codes.includes("report-object")) return "synapse_kb_ingest_report 必须是 JSON object"
  return codes.length > 0 ? codes.join(", ") : "未知原因"
}

export function reportContractCopy(): string {
  return [
    "最后必须输出一个 `synapse_kb_ingest_report` fenced JSON block，Synapse 将只信任这个结构化报告来写 `.raw/.manifest.json`。",
    "```synapse_kb_ingest_report",
    JSON.stringify({
      schema: KNOWLEDGE_BASE_INGEST_REPORT_SCHEMA,
      processed_sources: [{
        source: ".raw/example.md",
        pages_created: ["wiki/sources/example.md"],
        pages_updated: ["wiki/index.md", "wiki/hot.md", "wiki/log.md"],
      }],
      skipped_sources: [{ source: ".raw/unchanged.md", reason: "unchanged" }],
    }, null, 2),
    "```",
  ].join("\n")
}
