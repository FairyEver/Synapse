import type { SynapseConfig } from "./config"
import type { SynapseLocalIdentity } from "./identity"

export type SynapseDataRepositoryBackupPayload = {
  readonly format: "synapse-backup-v1"
  readonly exportedAt: string
  readonly namespaces: readonly {
    readonly name: string
    readonly schemaVersion: number
    readonly encrypted: boolean
    readonly data: unknown
  }[]
}

export type SynapseConfigBackup = {
  schemaVersion: 1
  exportedAt: string
  config: SynapseConfig
  identity: SynapseLocalIdentity
  dataRepository?: SynapseDataRepositoryBackupPayload
}

export type SynapseConfigBackupExportResult = {
  filePath: string
}

export type SynapseConfigBackupImportResult = {
  filePath: string
}
