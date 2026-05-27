import type {
  CheatCodeRegistration,
  CheatCodeTriggerResult,
  SynapseCheatCodeStateMap,
  SynapseCheatCodeStateResult,
} from "@/types/cheat-code"

export type CheatCodeStateStore = {
  readonly getStates: (names?: readonly string[]) => Promise<SynapseCheatCodeStateMap>
  readonly setState: (state: SynapseCheatCodeStateResult) => Promise<SynapseCheatCodeStateResult>
  readonly toggleState: (name: string) => Promise<SynapseCheatCodeStateResult>
}

export type CheatCodeManager<TContext, TBinding> = {
  readonly registrations: readonly CheatCodeRegistration<TBinding, TContext>[]
  readonly trigger: (name: string, context: TContext) => Promise<CheatCodeTriggerResult>
}

export type CreateCheatCodeManagerOptions<TContext, TBinding> = {
  readonly registrations: readonly CheatCodeRegistration<TBinding, TContext>[]
  readonly stateStore?: CheatCodeStateStore
}

export function createCheatCodeManager<TContext, TBinding>({
  registrations,
  stateStore,
}: CreateCheatCodeManagerOptions<TContext, TBinding>): CheatCodeManager<TContext, TBinding> {
  const registrationByName = buildRegistrationMap(registrations)

  return {
    registrations,
    async trigger(name, context) {
      const registration = registrationByName.get(name)

      if (!registration) {
        throw new Error(`Unknown cheat code: ${name}`)
      }

      const { definition } = registration

      if (definition.kind === "action") {
        await definition.run(context)
        return {
          changed: true,
          kind: "action",
          name: definition.name,
        }
      }

      if (!stateStore) {
        throw new Error(`Cheat code state store is required for ${definition.name}.`)
      }

      const nextState = await stateStore.toggleState(definition.name)
      await definition.run(context, { active: nextState.active })

      return {
        active: nextState.active,
        changed: true,
        kind: "state",
        name: definition.name,
      }
    },
  }
}

function buildRegistrationMap<TContext, TBinding>(
  registrations: readonly CheatCodeRegistration<TBinding, TContext>[],
): ReadonlyMap<string, CheatCodeRegistration<TBinding, TContext>> {
  const result = new Map<string, CheatCodeRegistration<TBinding, TContext>>()

  for (const registration of registrations) {
    const name = registration.definition.name.trim()

    if (!name) {
      throw new Error("Cheat code name is required.")
    }

    if (name !== registration.definition.name) {
      throw new Error(`Cheat code name must not include leading or trailing whitespace: ${registration.definition.name}`)
    }

    if (result.has(name)) {
      throw new Error(`Duplicate cheat code name: ${name}`)
    }

    result.set(name, registration)
  }

  return result
}
