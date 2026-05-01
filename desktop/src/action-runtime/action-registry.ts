import type { ReactElement } from "react"

import type {
  ActionConfig,
  ActionManifest,
  ActionRunResult,
} from "../../action-packages/types"

export type ActionConfigFormComponent<TConfig extends ActionConfig = ActionConfig> = (props: {
  readonly value: TConfig
  readonly onChange: (value: TConfig) => void
}) => ReactElement

export type ActionResultViewComponent = (props: {
  readonly result: ActionRunResult
}) => ReactElement

export type RendererActionDefinition<TConfig extends ActionConfig = ActionConfig> = {
  readonly manifest: ActionManifest<TConfig>
  summarizeConfig(config: TConfig): string
  ConfigForm?: ActionConfigFormComponent<TConfig>
  ResultView?: ActionResultViewComponent
}

export class RendererActionRegistry {
  private readonly actions = new Map<string, RendererActionDefinition>()

  register<TConfig extends ActionConfig>(action: RendererActionDefinition<TConfig>): void {
    const { id } = action.manifest
    if (this.actions.has(id)) {
      throw new Error(`Task action "${id}" is already registered`)
    }
    this.actions.set(id, action as RendererActionDefinition)
  }

  get(id: string): RendererActionDefinition {
    const action = this.actions.get(id)
    if (!action) {
      throw new Error(`Task action "${id}" is not registered`)
    }
    return action
  }

  list(): readonly RendererActionDefinition[] {
    return [...this.actions.values()]
  }

  getDefaultConfig(id: string): ActionConfig {
    return this.get(id).manifest.defaultConfig
  }

  parseConfig(id: string, config: ActionConfig): ActionConfig {
    return this.get(id).manifest.configSchema.parse(config)
  }

  summarize(id: string, config: ActionConfig): string {
    const action = this.get(id)
    return action.summarizeConfig(action.manifest.configSchema.parse(config))
  }
}
