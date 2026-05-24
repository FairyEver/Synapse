export const KNOWLEDGE_BASE_INGEST_REPORT_SCHEMA = "synapse.kb.ingest.report.v1"

export interface KnowledgeBaseIngestReportSource {
  readonly source: string
  readonly pagesCreated: readonly string[]
  readonly pagesUpdated: readonly string[]
}

export interface KnowledgeBaseIngestReport {
  readonly processedSources: readonly KnowledgeBaseIngestReportSource[]
  readonly skippedSources: readonly { readonly source: string; readonly reason: string }[]
}

export interface KnowledgeBaseIngestReportWarning {
  readonly code: string
  readonly message: string
}

export type KnowledgeBaseIngestReportParseResult =
  | {
    readonly status: "valid"
    readonly report: KnowledgeBaseIngestReport
    readonly warnings: readonly KnowledgeBaseIngestReportWarning[]
  }
  | { readonly status: "missing" | "invalid"; readonly warnings: readonly KnowledgeBaseIngestReportWarning[] }

export function parseKnowledgeBaseIngestReport(content: string): KnowledgeBaseIngestReportParseResult {
  const blocks = [...content.matchAll(/```synapse_kb_ingest_report\s*\n([\s\S]*?)\n```/g)]
  if (blocks.length === 0) {
    return {
      status: "missing",
      warnings: [{ code: "report-missing", message: "Missing synapse_kb_ingest_report block." }],
    }
  }
  if (blocks.length > 1) {
    return {
      status: "invalid",
      warnings: [{ code: "report-multiple", message: "Multiple synapse_kb_ingest_report blocks found." }],
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(blocks[0]?.[1] ?? "")
  } catch (error) {
    return {
      status: "invalid",
      warnings: [{ code: "report-json", message: error instanceof Error ? error.message : String(error) }],
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "invalid", warnings: [{ code: "report-object", message: "Report must be an object." }] }
  }
  const record = parsed as Record<string, unknown>
  if (record.schema !== KNOWLEDGE_BASE_INGEST_REPORT_SCHEMA) {
    return { status: "invalid", warnings: [{ code: "report-schema", message: "Unsupported ingest report schema." }] }
  }

  const warnings: KnowledgeBaseIngestReportWarning[] = []
  const processedSources: KnowledgeBaseIngestReportSource[] = []
  const processed = Array.isArray(record.processed_sources) ? record.processed_sources : []
  for (const item of processed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      warnings.push({ code: "report-source-invalid", message: "Processed source entry must be an object." })
      continue
    }
    const source = item as Record<string, unknown>
    if (typeof source.source !== "string") {
      warnings.push({ code: "report-source-path", message: "Processed source is missing source path." })
      continue
    }
    processedSources.push({
      source: source.source,
      pagesCreated: Array.isArray(source.pages_created) ? source.pages_created.filter(isString) : [],
      pagesUpdated: Array.isArray(source.pages_updated) ? source.pages_updated.filter(isString) : [],
    })
  }

  return {
    status: "valid",
    report: {
      processedSources,
      skippedSources: (Array.isArray(record.skipped_sources) ? record.skipped_sources : []).flatMap(parseSkippedSource),
    },
    warnings,
  }
}

function parseSkippedSource(value: unknown): { readonly source: string; readonly reason: string }[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  if (typeof record.source !== "string" || typeof record.reason !== "string") return []
  return [{ source: record.source, reason: record.reason }]
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}
