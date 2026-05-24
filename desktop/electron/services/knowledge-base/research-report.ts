export const KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA = "synapse.kb.research.report.v1"

export interface KnowledgeBaseResearchReport {
  readonly schema: typeof KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA
  readonly topic: string
  readonly rounds: number
  readonly searches: number
  readonly pagesCreated: readonly string[]
  readonly pagesUpdated: readonly string[]
  readonly sources: readonly string[]
}

export type KnowledgeBaseResearchReportParseResult =
  | { readonly status: "valid"; readonly report: KnowledgeBaseResearchReport }
  | { readonly status: "invalid"; readonly warnings: readonly { readonly code: string; readonly message: string }[] }

const REPORT_RE = /```synapse_kb_research_report\s*([\s\S]*?)```/g

export function parseKnowledgeBaseResearchReport(text: string): KnowledgeBaseResearchReportParseResult {
  const matches = [...text.matchAll(REPORT_RE)]
  if (matches.length === 0) return invalid("report-missing", "Missing synapse_kb_research_report block.")
  if (matches.length > 1) return invalid("report-multiple", "Multiple synapse_kb_research_report blocks found.")
  let raw: unknown
  try {
    raw = JSON.parse(matches[0]?.[1] ?? "")
  } catch {
    return invalid("report-json", "Research report is not valid JSON.")
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("report-object", "Research report must be a JSON object.")
  }
  const record = raw as Record<string, unknown>
  if (record.schema !== KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA) {
    return invalid("report-schema", "Research report schema mismatch.")
  }
  if (typeof record.topic !== "string" || !record.topic.trim()) {
    return invalid("report-topic", "Research report topic is required.")
  }
  if (typeof record.rounds !== "number" || record.rounds < 1 || record.rounds > 3) {
    return invalid("report-rounds", "Research report rounds must be 1-3.")
  }
  if (typeof record.searches !== "number" || record.searches < 0) {
    return invalid("report-searches", "Research report searches must be non-negative.")
  }
  const pagesCreated = stringArray(record.pages_created)
  const pagesUpdated = stringArray(record.pages_updated)
  const sources = stringArray(record.sources)
  if (!pagesCreated || !pagesUpdated || !sources) {
    return invalid("report-arrays", "Research report page and source fields must be string arrays.")
  }
  return {
    status: "valid",
    report: {
      schema: KNOWLEDGE_BASE_RESEARCH_REPORT_SCHEMA,
      topic: record.topic,
      rounds: record.rounds,
      searches: record.searches,
      pagesCreated,
      pagesUpdated,
      sources,
    },
  }
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null
}

function invalid(code: string, message: string): KnowledgeBaseResearchReportParseResult {
  return { status: "invalid", warnings: [{ code, message }] }
}
