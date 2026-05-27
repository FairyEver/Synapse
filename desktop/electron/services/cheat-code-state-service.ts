import type { SynapseCheatCodeStateMap, SynapseCheatCodeStateResult } from "../../src/types/cheat-code"
import type { DataNamespace } from "../runtime/data-repo"
import type { CheatCodeStatesEntryV1 } from "../runtime/data-repo/schemas"
import type { EventBus } from "../runtime/event-bus"

export const CHEAT_CODE_STATE_SERVICE_ID = "core.cheat-code-state"

type CheatCodeStateServiceDeps = {
  readonly states: DataNamespace<CheatCodeStatesEntryV1>
  readonly eventBus?: Pick<EventBus, "emit">
  readonly now?: () => Date
}

export class CheatCodeStateService {
  private readonly states: DataNamespace<CheatCodeStatesEntryV1>
  private readonly eventBus?: Pick<EventBus, "emit">
  private readonly now: () => Date

  constructor(deps: CheatCodeStateServiceDeps) {
    this.states = deps.states
    this.eventBus = deps.eventBus
    this.now = deps.now ?? (() => new Date())
  }

  async getStates(names?: readonly string[]): Promise<SynapseCheatCodeStateMap> {
    const entry = await this.load()

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
      return state
    }

    await this.states.setSingleton({
      schemaVersion: 1,
      states: {
        ...entry.states,
        [state.name]: state.active,
      },
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
