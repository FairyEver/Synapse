export interface KnowledgeBaseIngestReportProcessedSource {
  readonly source: string
  readonly pagesCreated: readonly string[]
  readonly pagesUpdated: readonly string[]
}

export interface KnowledgeBaseIngestReportSkippedSource {
  readonly source: string
  readonly reason: string
}

export type ParseKnowledgeBaseIngestReportResult =
  | {
    readonly ok: true
    readonly schema: "synapse.kb.ingest.report.v1"
    readonly processedSources: readonly KnowledgeBaseIngestReportProcessedSource[]
    readonly skippedSources: readonly KnowledgeBaseIngestReportSkippedSource[]
    readonly warnings: readonly string[]
  }
  | {
    readonly ok: false
    readonly code: "missing-report" | "multiple-reports" | "invalid-json" | "invalid-schema"
    readonly message: string
  }

const INGEST_REPORT_SCHEMA = "synapse.kb.ingest.report.v1"
const INGEST_REPORT_BLOCK = /```(?:json)?\s+synapse_kb_ingest_report\s*\n([\s\S]*?)\n```/g

export function parseKnowledgeBaseIngestReport(text: string): ParseKnowledgeBaseIngestReportResult {
  const matches = [...text.matchAll(INGEST_REPORT_BLOCK)]
  if (matches.length === 0) {
    return { ok: false, code: "missing-report", message: "No synapse_kb_ingest_report block was found." }
  }
  if (matches.length > 1) {
    return { ok: false, code: "multiple-reports", message: "Multiple synapse_kb_ingest_report blocks were found." }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(matches[0]?.[1] ?? "")
  } catch (error) {
    return {
      ok: false,
      code: "invalid-json",
      message: error instanceof Error ? error.message : "Ingest report JSON could not be parsed.",
    }
  }

  if (!isRecord(parsed) || parsed.schema !== INGEST_REPORT_SCHEMA) {
    return { ok: false, code: "invalid-schema", message: "Ingest report schema is invalid." }
  }

  return {
    ok: true,
    schema: INGEST_REPORT_SCHEMA,
    processedSources: normalizeProcessedSources(parsed.processed_sources),
    skippedSources: normalizeSkippedSources(parsed.skipped_sources),
    warnings: [],
  }
}

function normalizeProcessedSources(value: unknown): KnowledgeBaseIngestReportProcessedSource[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const source = stringField(entry, "source")
    if (!source) return []
    return [{
      source,
      pagesCreated: stringArrayField(entry, "pages_created"),
      pagesUpdated: stringArrayField(entry, "pages_updated"),
    }]
  })
}

function normalizeSkippedSources(value: unknown): KnowledgeBaseIngestReportSkippedSource[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const source = stringField(entry, "source")
    const reason = stringField(entry, "reason")
    if (!source || !reason) return []
    return [{ source, reason }]
  })
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
