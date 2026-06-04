import type {
  ActionStoredConfigValidation,
} from "../../../action-packages/types"
import type {
  AutomationTriggerConfig,
  AutomationTriggerDefinition,
} from "../../../automation-trigger-packages/types.shared"
import type { AutomationTriggerRef } from "./types"

export class AutomationTriggerRegistry {
  private readonly triggers = new Map<string, AutomationTriggerDefinition>()

  register<TConfig extends AutomationTriggerConfig>(trigger: AutomationTriggerDefinition<TConfig>): void {
    const id = trigger.manifest.id
    if (this.triggers.has(id)) {
      throw new Error(`Automation trigger "${id}" is already registered`)
    }
    this.triggers.set(id, trigger as AutomationTriggerDefinition)
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
    if (trigger.validateStoredConfig) {
      return trigger.validateStoredConfig(config)
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

export type {
  AutomationEventInput,
  AutomationReschedulePolicy,
  AutomationScheduleGuardInput,
  AutomationScheduleInput,
  AutomationScheduleInput as AutomationTriggerRuntimeInput,
  AutomationTriggerConfig,
  AutomationTriggerDefinition,
  AutomationTriggerEvent,
  AutomationTriggerKind,
  AutomationTriggerManifest,
  AutomationTriggerRuntime,
} from "../../../automation-trigger-packages/types.shared"
