export const KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA = "synapse.kb.worker.report.v1"

export interface KnowledgeBaseWorkerReport {
  readonly taskId: string
  readonly source: string
  readonly targetPage: string
  readonly pagesCreated: readonly string[]
  readonly pagesUpdated: readonly string[]
  readonly candidateConcepts: readonly string[]
  readonly candidateEntities: readonly string[]
  readonly candidateQuestions: readonly string[]
  readonly skipped: { readonly reason: string } | null
}

export interface KnowledgeBaseWorkerReportWarning {
  readonly code: string
  readonly message: string
}

export type KnowledgeBaseWorkerReportParseResult =
  | {
    readonly status: "valid"
    readonly report: KnowledgeBaseWorkerReport
    readonly warnings: readonly KnowledgeBaseWorkerReportWarning[]
  }
  | { readonly status: "missing" | "invalid"; readonly warnings: readonly KnowledgeBaseWorkerReportWarning[] }

export interface KnowledgeBaseWorkerReportExpectedTask {
  readonly taskId: string
  readonly sourcePath: string
  readonly targetPage: string
}

export function parseKnowledgeBaseWorkerReport(
  content: string,
  expected: KnowledgeBaseWorkerReportExpectedTask,
): KnowledgeBaseWorkerReportParseResult {
  const blocks = [...content.matchAll(/```synapse_kb_worker_report\s*\n([\s\S]*?)\n```/g)]
  if (blocks.length === 0) {
    return {
      status: "missing",
      warnings: [{ code: "worker-report-missing", message: "Missing synapse_kb_worker_report block." }],
    }
  }
  if (blocks.length > 1) {
    return {
      status: "invalid",
      warnings: [{ code: "worker-report-multiple", message: "Multiple synapse_kb_worker_report blocks found." }],
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(blocks[0]?.[1] ?? "")
  } catch (error) {
    return {
      status: "invalid",
      warnings: [{ code: "worker-report-json", message: error instanceof Error ? error.message : String(error) }],
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      status: "invalid",
      warnings: [{ code: "worker-report-object", message: "Worker report must be an object." }],
    }
  }

  const record = parsed as Record<string, unknown>
  const warnings: KnowledgeBaseWorkerReportWarning[] = []
  if (record.schema !== KNOWLEDGE_BASE_WORKER_REPORT_SCHEMA) {
    warnings.push({ code: "worker-report-schema", message: "Unsupported worker report schema." })
  }
  if (record.task_id !== expected.taskId) {
    warnings.push({ code: "worker-report-task-mismatch", message: `Worker report task mismatch: ${String(record.task_id)}` })
  }
  if (record.source !== expected.sourcePath) {
    warnings.push({ code: "worker-report-source-mismatch", message: `Worker report source mismatch: ${String(record.source)}` })
  }
  if (record.target_page !== expected.targetPage) {
    warnings.push({ code: "worker-report-target-mismatch", message: `Worker report target mismatch: ${String(record.target_page)}` })
  }

  const pagesCreated = strings(record.pages_created)
  const pagesUpdated = strings(record.pages_updated)
  const outsidePages = [...pagesCreated, ...pagesUpdated]
    .filter((page) => normalize(page) !== normalize(expected.targetPage))
  if (outsidePages.length > 0) {
    warnings.push({
      code: "worker-report-page-outside-target",
      message: `Worker report claimed pages outside target: ${outsidePages.join(", ")}`,
    })
  }

  if (warnings.length > 0) return { status: "invalid", warnings }

  return {
    status: "valid",
    warnings: [],
    report: {
      taskId: expected.taskId,
      source: expected.sourcePath,
      targetPage: expected.targetPage,
      pagesCreated,
      pagesUpdated,
      candidateConcepts: strings(record.candidate_concepts),
      candidateEntities: strings(record.candidate_entities),
      candidateQuestions: strings(record.candidate_questions),
      skipped: parseSkipped(record.skipped),
    },
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function parseSkipped(value: unknown): { readonly reason: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const reason = (value as Record<string, unknown>).reason
  return typeof reason === "string" ? { reason } : null
}

function normalize(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.?\//, "")
}
