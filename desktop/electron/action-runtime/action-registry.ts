import type {
  ActionConfig,
  ActionManifest,
  ActionRunResult,
  ActionStoredConfigValidation,
} from "../../action-packages/types"
import type {
  ActorIdentity,
  PermissionRequest,
} from "../runtime/security"

export type ActionRuntimeContext = {
  readonly taskId: string
  readonly runId: string
  readonly triggeredBy: "schedule" | "manual" | "missed_run"
  readonly cwd: string
  readonly actor: ActorIdentity
  readonly abortSignal: AbortSignal
  readonly configVersion?: number
}

export type ActionPermissionInput<TConfig extends ActionConfig = ActionConfig> = {
  readonly config: TConfig
  readonly context: ActionRuntimeContext
}

export type ActionExecutionInput<TConfig extends ActionConfig = ActionConfig> = {
  readonly config: TConfig
  readonly context: ActionRuntimeContext
  readonly previousOutputs?: Record<string, unknown>
}

export type MainActionDefinition<TConfig extends ActionConfig = ActionConfig> = {
  readonly manifest: ActionManifest<TConfig>
  buildPermissionRequest(input: ActionPermissionInput<TConfig>): PermissionRequest
  execute(input: ActionExecutionInput<TConfig>): Promise<ActionRunResult>
}

export class MainActionRegistry {
  private readonly actions = new Map<string, MainActionDefinition>()

  register(action: MainActionDefinition): void {
    const { id } = action.manifest
    if (this.actions.has(id)) {
      throw new Error(`Task action "${id}" is already registered`)
    }
    this.actions.set(id, action)
  }

  get(id: string): MainActionDefinition {
    const action = this.actions.get(id)
    if (!action) {
      throw new Error(`Task action "${id}" is not registered`)
    }
    return action
  }

  list(): readonly MainActionDefinition[] {
    return [...this.actions.values()]
  }

  parseConfig(id: string, config: ActionConfig): ActionConfig {
    return this.get(id).manifest.configSchema.parse(config)
  }

  validateStoredConfig(id: string, config: ActionConfig): ActionStoredConfigValidation {
    const action = this.actions.get(id)
    if (!action) {
      return {
        status: "needs_update",
        issues: [{ field: "action.type", message: "选择执行动作" }],
      }
    }
    if (action.manifest.validateStoredConfig) {
      return action.manifest.validateStoredConfig(config)
    }

    const parsed = action.manifest.configSchema.safeParse(config)
    if (parsed.success) {
      return { status: "valid", issues: [] }
    }

    return {
      status: "needs_update",
      issues: [{ field: "action.config", message: "检查执行内容" }],
    }
  }
}
