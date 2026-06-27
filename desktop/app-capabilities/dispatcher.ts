import type { DispatchContext, DispatchResult } from "../synapse-capabilities/shared/types"
import { DOCUMENT_TEMPLATE_CAPABILITY_ID } from "./document-template/shared/capability"
import {
  SCREENSHOT_CAPTURE_CAPABILITY_ID,
  SCREENSHOT_FILE_SAVE_CAPABILITY_ID,
} from "./screenshot/shared/capability"
import { SOUND_NOTIFIER_PLAY_CAPABILITY_ID } from "./sound-notifier/shared/capability"

type AppCapabilitySubDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export type AppCapabilityDispatcher = AppCapabilitySubDispatcher

export function createAppCapabilityDispatcher(deps: {
  readonly documentTemplate: AppCapabilitySubDispatcher
  readonly screenshot: AppCapabilitySubDispatcher
  readonly soundNotifier: AppCapabilitySubDispatcher
}): AppCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (action === DOCUMENT_TEMPLATE_CAPABILITY_ID) {
        return deps.documentTemplate.dispatch(action, params, context)
      }
      if (action === SCREENSHOT_CAPTURE_CAPABILITY_ID || action === SCREENSHOT_FILE_SAVE_CAPABILITY_ID) {
        return deps.screenshot.dispatch(action, params, context)
      }
      if (action === SOUND_NOTIFIER_PLAY_CAPABILITY_ID) {
        return deps.soundNotifier.dispatch(action, params, context)
      }
      throw new Error(`Unknown app action: ${action}`)
    },
  }
}
