import type { ReactElement } from "react"
import type { z } from "zod"

import type { ActionStoredConfigValidation } from "../action-packages/types"

export type AutomationTriggerConfig = Record<string, unknown>

export type AutomationTriggerKind = "schedule" | "event" | "manual"

export type AutomationReschedulePolicy =
  | { readonly mode: "before_run" }
  | { readonly mode: "after_completion" }
  | { readonly mode: "none" }

export type AutomationTriggerVariableDescriptor = {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly example?: string
  readonly group?: "trigger" | "config" | "event"
  readonly dynamic?: boolean
}

export type AutomationTriggerManifest<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = {
  readonly id: string
  readonly title: string
  readonly kind: AutomationTriggerKind
  readonly defaultConfig: TConfig
  readonly configSchema: z.ZodType<TConfig>
  readonly variables?: readonly AutomationTriggerVariableDescriptor[]
}

export type AutomationScheduleInput<TConfig extends AutomationTriggerConfig> = {
  readonly config: TConfig
  readonly from: Date
  readonly createdAt: string
  readonly lastRunAt?: string
}

export type AutomationScheduleGuardInput<TConfig extends AutomationTriggerConfig> = {
  readonly config: TConfig
  readonly now: Date
}

export type AutomationTriggerEvent = {
  readonly source: string
  readonly type: string
  readonly payload: Record<string, unknown>
  readonly receivedAt: string
}

export type AutomationEventInput<TConfig extends AutomationTriggerConfig> = {
  readonly config: TConfig
  readonly event: AutomationTriggerEvent
}

export type AutomationTriggerRuntime<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = {
  computeNextRunAt?(input: AutomationScheduleInput<TConfig>): Date | null
  shouldRunNow?(input: AutomationScheduleGuardInput<TConfig>): boolean
  shouldAcceptEvent?(input: AutomationEventInput<TConfig>): boolean | Promise<boolean>
  getReschedulePolicy?(config: TConfig): AutomationReschedulePolicy
}

export type AutomationTriggerDefinition<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = {
  readonly manifest: AutomationTriggerManifest<TConfig>
  summarize(config: TConfig): string
  validateStoredConfig?(config: unknown): ActionStoredConfigValidation
  readonly runtime: AutomationTriggerRuntime<TConfig>
}

export type AutomationTriggerConfigFormComponent<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = (props: {
  readonly value: TConfig
  readonly onChange: (value: TConfig) => void
}) => ReactElement

export type RendererAutomationTriggerDefinition<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = {
  readonly manifest: AutomationTriggerManifest<TConfig>
  summarizeConfig(config: TConfig): string
  ConfigForm?: AutomationTriggerConfigFormComponent<TConfig>
}
