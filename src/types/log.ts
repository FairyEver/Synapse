export type SynapseLogLevel = "debug" | "info" | "warn" | "error"

export type SynapseLogSource = "main" | "renderer"

export type SynapseLogEntry = {
  id: number
  createdAt: string
  level: SynapseLogLevel
  source: SynapseLogSource
  category: string
  message: string
  details: string | null
}

export type SynapseRendererLogPayload = {
  level: SynapseLogLevel
  category: string
  message: string
  details?: unknown
}

export type SynapseLogExportResult = {
  entryCount: number
  filePath: string
}
