import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import { SOUND_NOTIFIER_PLAY_CAPABILITY_ID } from "../shared/capability"
import { soundNotifierPlayInputSchema } from "../shared/schema"
import type { SoundNotifierService } from "./service"

export type SoundNotifierCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createSoundNotifierCapabilityDispatcher(deps: {
  readonly service: Pick<SoundNotifierService, "play">
}): SoundNotifierCapabilityDispatcher {
  return {
    async dispatch(action, params) {
      if (action !== SOUND_NOTIFIER_PLAY_CAPABILITY_ID) {
        throw new Error(`Unknown sound notifier action: ${action}`)
      }
      const result = await deps.service.play(soundNotifierPlayInputSchema.parse(params))
      return { ok: true, data: result, affected: result.played ? 1 : 0 }
    },
  }
}
