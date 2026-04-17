import type { SynapseConfig, SynapseConfigPatch } from "@/types/config"
import type {
  SynapseLogAppendedEvent,
  SynapseLogExportResult,
  SynapseLogListQuery,
  SynapseLogListResult,
  SynapseLogSummary,
  SynapseRendererLogPayload,
} from "@/types/log"
import type {
  SynapseRepositoryLocalState,
  SynapseRepositoryOperationResult,
  SynapseRepositoryProgressEvent,
  SynapseRepositoryUpdatedEvent,
} from "@/types/repository"

declare global {
  interface Window {
    synapse?: {
      platform: string
      versions: {
        chrome: string
        electron: string
        node: string
      }
      config: {
        get: () => Promise<SynapseConfig>
        update: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
      }
      log?: {
        export: () => Promise<SynapseLogExportResult>
        list: (query: SynapseLogListQuery) => Promise<SynapseLogListResult>
        onAppended: (listener: (payload: SynapseLogAppendedEvent) => void) => () => void
        summary: () => Promise<SynapseLogSummary>
        write: (payload: SynapseRendererLogPayload) => Promise<void>
      }
      repository?: {
        chooseDirectory: () => Promise<string | null>
        getStates: () => Promise<SynapseRepositoryLocalState[]>
        sync: (repositoryUuid: string) => Promise<SynapseRepositoryOperationResult>
        onProgress: (listener: (payload: SynapseRepositoryProgressEvent) => void) => () => void
        onUpdated: (listener: (payload: SynapseRepositoryUpdatedEvent) => void) => () => void
      }
    }
  }
}

export {}
