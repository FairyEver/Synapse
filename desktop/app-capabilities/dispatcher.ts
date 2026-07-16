import type { DispatchContext, DispatchResult } from "../synapse-capabilities/shared/types"
import { DOCUMENT_TEMPLATE_CAPABILITY_ID } from "./document-template/shared/capability"
import { SECRETS_CAPABILITY_IDS } from "./secrets/shared/capability"
import { SOUND_NOTIFIER_PLAY_CAPABILITY_ID } from "./sound-notifier/shared/capability"

type AppCapabilitySubDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

const secretsCapabilityIds = new Set<string>(SECRETS_CAPABILITY_IDS)

export type AppCapabilityDispatcher = AppCapabilitySubDispatcher

export function createAppCapabilityDispatcher(deps: {
  readonly documentTemplate: AppCapabilitySubDispatcher
  readonly secrets?: AppCapabilitySubDispatcher
  readonly soundNotifier: AppCapabilitySubDispatcher
}): AppCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (action === DOCUMENT_TEMPLATE_CAPABILITY_ID) {
        return deps.documentTemplate.dispatch(action, params, context)
      }
      if (action === SOUND_NOTIFIER_PLAY_CAPABILITY_ID) {
        return deps.soundNotifier.dispatch(action, params, context)
      }
      if (deps.secrets && secretsCapabilityIds.has(action)) {
        return deps.secrets.dispatch(action, params, context)
      }
      throw new Error(`Unknown app action: ${action}`)
    },
  }
}
