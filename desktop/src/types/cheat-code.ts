export type CheatCodeKind = "action" | "state"
export type CheatCodeScope = "global"

export type CheatCodeState = {
  readonly active: boolean
}

export type CheatCodeTriggerResult =
  | {
    readonly name: string
    readonly kind: "action"
    readonly changed: true
  }
  | {
    readonly name: string
    readonly kind: "state"
    readonly active: boolean
    readonly changed: true
  }

export type CheatCodeActionDefinition<TContext> = {
  readonly name: string
  readonly kind: "action"
  readonly run: (context: TContext) => void | Promise<void>
}

export type CheatCodeStateDefinition<TContext> = {
  readonly name: string
  readonly kind: "state"
  readonly scope?: CheatCodeScope
  readonly run: (context: TContext, state: CheatCodeState) => void | Promise<void>
}

export type CheatCodeDefinition<TContext> =
  | CheatCodeActionDefinition<TContext>
  | CheatCodeStateDefinition<TContext>

export type CheatCodeRegistration<TBinding, TContext> = {
  readonly definition: CheatCodeDefinition<TContext>
  readonly binding: TBinding
}

export type SynapseCheatCodeStateMap = Record<string, boolean>

export type SynapseCheatCodeStateResult = {
  readonly name: string
  readonly active: boolean
}

export type SynapseCheatCodeStateChangedEvent = SynapseCheatCodeStateResult
