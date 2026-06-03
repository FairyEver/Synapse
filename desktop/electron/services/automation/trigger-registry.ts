import type { z } from "zod"

import type {
  ActionStoredConfigValidation,
} from "../../../action-packages/types"
import type { AutomationTriggerRef } from "./types"

export type AutomationTriggerManifest<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
  readonly id: string
  readonly title: string
  readonly defaultConfig: TConfig
  readonly configSchema: z.ZodType<TConfig>
}

export type AutomationTriggerRuntimeInput<TConfig extends Record<string, unknown>> = {
  readonly config: TConfig
  readonly from: Date
  readonly createdAt: string
  readonly lastRunAt?: string
}

export type AutomationTriggerDefinition<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
  readonly manifest: AutomationTriggerManifest<TConfig>
  summarize(config: TConfig): string
  computeNextRunAt?(input: AutomationTriggerRuntimeInput<TConfig>): Date
  shouldRunNow?(input: { readonly config: TConfig; readonly now: Date }): boolean
}

export class AutomationTriggerRegistry {
  private readonly triggers = new Map<string, AutomationTriggerDefinition>()

  register(trigger: AutomationTriggerDefinition): void {
    const id = trigger.manifest.id
    if (this.triggers.has(id)) {
      throw new Error(`Automation trigger "${id}" is already registered`)
    }
    this.triggers.set(id, trigger)
  }

  get(id: string): AutomationTriggerDefinition {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      throw new Error(`Automation trigger "${id}" is not registered`)
    }
    return trigger
  }

  list(): readonly AutomationTriggerDefinition[] {
    return [...this.triggers.values()]
  }

  parseConfig(id: string, config: Record<string, unknown>): Record<string, unknown> {
    return this.get(id).manifest.configSchema.parse(config)
  }

  normalize(ref: AutomationTriggerRef): AutomationTriggerRef {
    return {
      type: ref.type,
      config: this.parseConfig(ref.type, ref.config),
    }
  }

  validateStoredConfig(id: string, config: Record<string, unknown>): ActionStoredConfigValidation {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      return {
        status: "needs_update",
        issues: [{ field: "trigger.type", message: "选择触发器" }],
      }
    }
    const parsed = trigger.manifest.configSchema.safeParse(config)
    return parsed.success
      ? { status: "valid", issues: [] }
      : { status: "needs_update", issues: [{ field: "trigger.config", message: "检查触发器" }] }
  }

  summarize(id: string, config: Record<string, unknown>): string {
    const trigger = this.get(id)
    return trigger.summarize(trigger.manifest.configSchema.parse(config))
  }
}
