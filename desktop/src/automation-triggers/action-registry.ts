import type { ReactElement } from "react"

export type AutomationTriggerConfig = Record<string, unknown>

export type AutomationTriggerConfigFormComponent<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = (props: {
  readonly value: TConfig
  readonly onChange: (value: TConfig) => void
}) => ReactElement

export type AutomationTriggerManifest<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = {
  readonly id: string
  readonly title: string
  readonly defaultConfig: TConfig
  readonly configSchema: { parse(config: unknown): TConfig }
}

export type RendererAutomationTriggerDefinition<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = {
  readonly manifest: AutomationTriggerManifest<TConfig>
  summarizeConfig(config: TConfig): string
  ConfigForm?: AutomationTriggerConfigFormComponent<TConfig>
}

export class RendererAutomationTriggerRegistry {
  private readonly triggers = new Map<string, RendererAutomationTriggerDefinition>()

  register<TConfig extends AutomationTriggerConfig>(
    trigger: RendererAutomationTriggerDefinition<TConfig>,
  ): void {
    const { id } = trigger.manifest
    if (this.triggers.has(id)) {
      throw new Error(`Automation trigger "${id}" is already registered`)
    }
    this.triggers.set(id, trigger as RendererAutomationTriggerDefinition)
  }

  get(id: string): RendererAutomationTriggerDefinition {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      throw new Error(`Automation trigger "${id}" is not registered`)
    }
    return trigger
  }

  list(): readonly RendererAutomationTriggerDefinition[] {
    return [...this.triggers.values()]
  }

  getDefaultConfig(id: string): AutomationTriggerConfig {
    return this.get(id).manifest.defaultConfig
  }

  parseConfig(id: string, config: AutomationTriggerConfig): AutomationTriggerConfig {
    return this.get(id).manifest.configSchema.parse(config)
  }

  summarize(id: string, config: AutomationTriggerConfig): string {
    const trigger = this.get(id)
    return trigger.summarizeConfig(trigger.manifest.configSchema.parse(config))
  }
}
