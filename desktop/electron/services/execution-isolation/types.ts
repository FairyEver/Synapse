import type { ControlledProcessIsolationOptions } from "../../runtime/process"

export const EXECUTION_ISOLATION_SERVICE_ID = "core.execution-isolation"

export interface RunAsConfigView {
  readonly projectId: string
  readonly enabled: boolean
  readonly user?: string
  readonly envAllowlist: readonly string[]
  readonly requirePreflight: boolean
  readonly lastPreflightAt?: string
  readonly lastPreflightStatus?: "pass" | "fail" | "unsupported"
  readonly lastAuditProbeAt?: string
  readonly lastAuditProbeStatus?: "pass" | "fail" | "unsupported"
  readonly lastError?: string
  readonly serviceRestartRequired?: boolean
}

export interface RunAsConfigUpdate {
  readonly projectId: string
  readonly enabled?: boolean
  readonly user?: string
  readonly envAllowlist?: readonly string[]
  readonly requirePreflight?: boolean
}

export interface RunAsCheckResult {
  readonly projectId: string
  readonly user: string
  readonly status: "pass" | "fail" | "unsupported"
  readonly workspacePath?: string
  readonly checks?: Record<string, unknown>
  readonly warnings?: readonly string[]
  readonly error?: string
  readonly createdAt: string
}

export interface ProcessIsolationResolver {
  resolveProcessIsolation(
    projectId: string,
    extraEnvAllowlist?: readonly string[],
  ): Promise<ControlledProcessIsolationOptions | undefined>
}

