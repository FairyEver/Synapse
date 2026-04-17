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

export type SynapseLogSummary = {
  total: number
}

export type SynapseLogListQuery = {
  offset: number
  limit: number
}

export type SynapseLogListResult = {
  total: number
  entries: SynapseLogEntry[]
}

export type SynapseRendererLogPayload = {
  level: SynapseLogLevel
  category: string
  message: string
  details?: unknown
}

export type SynapseLogAppendedEvent = {
  entry: SynapseLogEntry
  total: number
}

export type SynapseLogExportResult = {
  entryCount: number
  filePath: string
}
