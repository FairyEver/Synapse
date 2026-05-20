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

export type ActionStoredConfigIssue = {
  readonly field: string
  readonly message: string
}

export type ActionStoredConfigValidation =
  | {
      readonly status: "valid"
      readonly issues: readonly []
    }
  | {
      readonly status: "needs_update"
      readonly issues: readonly ActionStoredConfigIssue[]
    }

export type ActionPermissionName =
  | "shell.exec"
  | "network.connect"
  | string

export type ActionConfigFieldKind =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "record"

export type ActionConfigFieldDescriptor = {
  readonly name: string
  readonly kind: ActionConfigFieldKind
  readonly required: boolean
  readonly description?: string
  readonly choices?: readonly string[]
  readonly defaultValue?: unknown
}

export type ActionManifest<TConfig extends ActionConfig = ActionConfig> = {
  readonly id: string
  readonly title: string
  readonly permissions: readonly ActionPermissionName[]
  readonly defaultConfig: TConfig
  readonly configSchema: z.ZodType<TConfig>
  readonly validateStoredConfig?: (config: ActionConfig) => ActionStoredConfigValidation
  readonly configFields: readonly ActionConfigFieldDescriptor[]
}
