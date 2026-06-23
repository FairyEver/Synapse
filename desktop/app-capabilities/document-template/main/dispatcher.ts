import type { DispatchContext, DispatchResult } from "../../../synapse-capabilities/shared/types"
import { DOCUMENT_TEMPLATE_CAPABILITY_ID } from "../shared/capability"
import type { DocumentTemplateService } from "./service"

export type DocumentTemplateCapabilityDispatcher = {
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult>
}

export function createDocumentTemplateCapabilityDispatcher(deps: {
  readonly service: DocumentTemplateService
}): DocumentTemplateCapabilityDispatcher {
  return {
    async dispatch(action, params) {
      if (action !== DOCUMENT_TEMPLATE_CAPABILITY_ID) {
        throw new Error(`Unknown document template action: ${action}`)
      }
      const result = await deps.service.generateDocx(params)
      return { ok: true, data: result, affected: 1 }
    },
  }
}
