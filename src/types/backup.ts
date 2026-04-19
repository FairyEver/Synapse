import type { SynapseConfig } from "./config"
import type { SynapseLocalIdentity } from "./identity"

export type SynapseConfigBackup = {
  schemaVersion: 1
  exportedAt: string
  config: SynapseConfig
  identity: SynapseLocalIdentity
}

export type SynapseConfigBackupExportResult = {
  filePath: string
}

export type SynapseConfigBackupImportResult = {
  filePath: string
}
