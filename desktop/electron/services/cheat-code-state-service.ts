import type { SynapseCheatCodeStateMap, SynapseCheatCodeStateResult } from "../../src/types/cheat-code"
import type { DataNamespace } from "../runtime/data-repo"
import type { CheatCodeStatesEntryV1 } from "../runtime/data-repo/schemas"
import type { EventBus } from "../runtime/event-bus"
import { createMainLogger } from "./log-store"
import { sanitizeError } from "./error-sanitize"

export const CHEAT_CODE_STATE_SERVICE_ID = "core.cheat-code-state"

type CheatCodeStateServiceDeps = {
  readonly states: DataNamespace<CheatCodeStatesEntryV1>
  readonly eventBus?: Pick<EventBus, "emit">
  readonly logger?: CheatCodeStateLogger
  readonly now?: () => Date
}

type CheatCodeStateLogger = Pick<ReturnType<typeof createMainLogger>, "info" | "error">
const defaultLogger = createMainLogger("service.cheat-code-state")

export class CheatCodeStateService {
  private readonly states: DataNamespace<CheatCodeStatesEntryV1>
  private readonly eventBus?: Pick<EventBus, "emit">
  private readonly logger: CheatCodeStateLogger
  private readonly now: () => Date

  constructor(deps: CheatCodeStateServiceDeps) {
    this.states = deps.states
    this.eventBus = deps.eventBus
    this.logger = deps.logger ?? defaultLogger
    this.now = deps.now ?? (() => new Date())
  }

  async getStates(names?: readonly string[]): Promise<SynapseCheatCodeStateMap> {
    const entry = await this.load()
    this.logger.info("Cheat code states read.", {
      requestedCount: names?.length ?? 0,
      allStates: !names,
    })

    if (!names) {
      return { ...entry.states }
    }

    const result: SynapseCheatCodeStateMap = {}

    for (const name of names) {
      assertCheatCodeName(name)
      result[name] = entry.states[name] ?? false
    }

    return result
  }

  async setState(state: SynapseCheatCodeStateResult): Promise<SynapseCheatCodeStateResult> {
    assertCheatCodeName(state.name)

    const entry = await this.load()
    const previousActive = entry.states[state.name] ?? false

    if (previousActive === state.active) {
      this.logger.info("Cheat code state unchanged.", {
        name: state.name,
        active: state.active,
      })
      return state
    }

    try {
      await this.states.setSingleton({
        schemaVersion: 1,
        states: {
          ...entry.states,
          [state.name]: state.active,
        },
      })
    } catch (error) {
      this.logger.error("Cheat code state persist failed.", {
        name: state.name,
        active: state.active,
        previousActive,
        ...errorLogMeta(error),
      })
      throw error
    }
    this.logger.info("Cheat code state persisted.", {
      name: state.name,
      active: state.active,
      previousActive,
    })
    this.emitStateChanged(state)

    return state
  }

  async toggleState(name: string): Promise<SynapseCheatCodeStateResult> {
    assertCheatCodeName(name)

    const entry = await this.load()
    const active = !(entry.states[name] ?? false)

    return this.setState({ active, name })
  }

  private async load(): Promise<CheatCodeStatesEntryV1> {
    return await this.states.getSingleton() ?? {
      schemaVersion: 1,
      states: {},
    }
  }

  private emitStateChanged(state: SynapseCheatCodeStateResult): void {
    this.eventBus?.emit({
      domain: "cheat-code",
      type: "cheat-code.stateChanged",
      payload: state,
      timestamp: this.now().toISOString(),
    })
  }
}

function assertCheatCodeName(name: string): void {
  if (name.trim().length === 0 || name !== name.trim()) {
    throw new Error("Cheat code name is required.")
  }
}

function errorLogMeta(error: unknown): { errorName: string; errorMessage: string } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: sanitizeError(message),
  }
}
