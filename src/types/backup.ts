import type { SynapseConfig } from "./config"
import type { SynapseUserIdentity } from "./identity"

export type SynapseConfigBackup = {
  schemaVersion: 1
  exportedAt: string
  config: SynapseConfig
  identity: SynapseUserIdentity
}

export type SynapseConfigBackupExportResult = {
  filePath: string
}

export type SynapseConfigBackupImportResult = {
  filePath: string
}
