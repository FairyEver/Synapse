import type { z } from "zod"

export type ActionRunStatus = "success" | "failed" | "timeout" | "cancelled"

export type ActionRunResult = {
  readonly status: ActionRunStatus
  readonly summary?: string
  readonly logs?: readonly ActionRunLog[]
  readonly outputs?: Record<string, unknown>
  readonly error?: string
  readonly metrics?: ActionRunMetrics
}

export type ActionRunLog = {
  readonly label: string
  readonly value: string
}

export type ActionRunMetrics = {
  readonly durationMs?: number
  readonly exitCode?: number | null
  readonly httpStatus?: number
}

export type ActionConfig = Record<string, unknown>

export type ActionPermissionName =
  | "shell.exec"
  | "network.connect"
  | string

export type ActionManifest<TConfig extends ActionConfig = ActionConfig> = {
  readonly id: string
  readonly title: string
  readonly permissions: readonly ActionPermissionName[]
  readonly defaultConfig: TConfig
  readonly configSchema: z.ZodType<TConfig>
}
