import type { DispatchContext, DispatchResult } from "../synapse-capabilities/shared/types"
import {
  TEXT_EXTRACTOR_CAPABILITY_ID,
  TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID,
} from "./text-extractor/shared/capability"
import { DOCUMENT_TEMPLATE_CAPABILITY_ID } from "./document-template/shared/capability"
import { SECRETS_CAPABILITY_IDS } from "./secrets/shared/capability"
import { SOUND_NOTIFIER_PLAY_CAPABILITY_ID } from "./sound-notifier/shared/capability"
import { FILE_OPENER_CAPABILITY_ID } from "./file-opener/shared/capability"
import { TEXT_FILE_WRITER_CAPABILITY_ID } from "./text-file-writer/shared/capability"

type AppCapabilitySubDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

const secretsCapabilityIds = new Set<string>(SECRETS_CAPABILITY_IDS)

export type AppCapabilityDispatcher = AppCapabilitySubDispatcher

export function createAppCapabilityDispatcher(deps: {
  readonly textExtractor: AppCapabilitySubDispatcher
  readonly documentTemplate: AppCapabilitySubDispatcher
  readonly secrets?: AppCapabilitySubDispatcher
  readonly soundNotifier: AppCapabilitySubDispatcher
  readonly fileOpener: AppCapabilitySubDispatcher
  readonly textFileWriter: AppCapabilitySubDispatcher
}): AppCapabilityDispatcher {
  return {
    async dispatch(action, params, context) {
      if (
        action === TEXT_EXTRACTOR_CAPABILITY_ID
        || action === TEXT_EXTRACTOR_TO_FILE_CAPABILITY_ID
      ) {
        return deps.textExtractor.dispatch(action, params, context)
      }
      if (action === DOCUMENT_TEMPLATE_CAPABILITY_ID) {
        return deps.documentTemplate.dispatch(action, params, context)
      }
      if (action === SOUND_NOTIFIER_PLAY_CAPABILITY_ID) {
        return deps.soundNotifier.dispatch(action, params, context)
      }
      if (action === FILE_OPENER_CAPABILITY_ID) {
        return deps.fileOpener.dispatch(action, params, context)
      }
      if (action === TEXT_FILE_WRITER_CAPABILITY_ID) {
        return deps.textFileWriter.dispatch(action, params, context)
      }
      if (deps.secrets && secretsCapabilityIds.has(action)) {
        return deps.secrets.dispatch(action, params, context)
      }
      throw new Error(`Unknown app action: ${action}`)
    },
  }
}
