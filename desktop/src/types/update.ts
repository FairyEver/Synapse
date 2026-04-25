export type SynapseAppUpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error"

export type SynapseInstallSourceKind =
  | "development"
  | "packaged-app"
  | "npm-wrapper"
  | "unknown"

export type SynapseInstallVersionStatus =
  | "matching"
  | "newer-or-equal"
  | "outdated"
  | "missing"
  | "unknown"

export type SynapseInstallSourceMetadata = {
  source: SynapseInstallSourceKind
  packageName: string | null
  packageVersion: string | null
  binaryPath: string | null
  wrapperScriptPath: string | null
  expectedBinaryName: string | null
  versionStatus: SynapseInstallVersionStatus
  message: string
}

export type SynapseLegacyUpdateCompatibilityStatus =
  | "skipped"
  | "unknown"
  | "current"
  | "available"

export type SynapseLegacyUpdateCompatibility = {
  status: SynapseLegacyUpdateCompatibilityStatus
  currentVersion: string
  latestVersion: string | null
  commandHint: string | null
  message: string
}

export type SynapseAppUpdateState = {
  currentVersion: string
  installSource: SynapseInstallSourceMetadata
  legacyUpdateCompatibility: SynapseLegacyUpdateCompatibility
  releaseVersion: string | null
  status: SynapseAppUpdateStatus
  message: string
  error: string | null
  downloadPercent: number | null
  bytesPerSecond: number | null
  transferredBytes: number | null
  totalBytes: number | null
  lastCheckedAt: string | null
  canCheck: boolean
  downloadedFilePath: string | null
}
