export type SynapseAppUpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error"

export type SynapseAppUpdateState = {
  currentVersion: string
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
  installRecovery: {
    phase: "repairing" | "retry-ready" | "manual-required"
    targetVersion: string
    manualInstallerUrl: string | null
  } | null
}

export type SynapseAppUpdateOpenRequest = {
  readonly id: number
  readonly automatic: boolean
}
