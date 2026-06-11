type SynapseDiagnosticsStatus = "ok" | "degraded" | "failed" | "skipped"

type SynapseDiagnosticsSeverity = "info" | "warning" | "error"

type SynapseDiagnosticsCheck = {
  id: string
  group: string
  name: string
  status: SynapseDiagnosticsStatus
  severity: SynapseDiagnosticsSeverity
  message: string
  details?: Record<string, unknown>
  durationMs?: number
}

type SynapseKnowledgeBaseStorageDiagnostics = {
  mode: "default" | "custom"
  rootPath: string
  knowledgeBasesPath: string
  available: boolean
  runtimeCount: number
  missingRuntimeCount: number
  oldAbsoluteReferenceCount: number
}

type SynapseDiagnosticsReport = {
  schemaVersion: 1
  generatedAt: string
  overallStatus: Exclude<SynapseDiagnosticsStatus, "skipped">
  summary: {
    ok: number
    degraded: number
    failed: number
    skipped: number
  }
  system: Record<string, unknown>
  app: Record<string, unknown>
  knowledgeBaseStorage?: SynapseKnowledgeBaseStorageDiagnostics
  activeContext: {
    repositoryUuid?: string
    repositoryName?: string
    projectId?: string
    projectName?: string
  }
  checks: SynapseDiagnosticsCheck[]
  bundle?: {
    lastExportedAt?: string
    lastExportPath?: string
  }
}

type SynapseDiagnosticsBundleExportResult = {
  success: boolean
  filePath?: string
  fileCount?: number
}

export type {
  SynapseDiagnosticsBundleExportResult,
  SynapseDiagnosticsCheck,
  SynapseKnowledgeBaseStorageDiagnostics,
  SynapseDiagnosticsReport,
  SynapseDiagnosticsSeverity,
  SynapseDiagnosticsStatus,
}
