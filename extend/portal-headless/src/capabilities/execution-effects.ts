import type { CapabilityDefinition } from './types.js'

// These existing invoke bindings return WritePlan; submit(plan) is a separate public method.
// Keep the registered SDK read/write marker about the dispatched operation, not the whole UI workflow.
const PREPARE_ONLY = new Set([
  'ai-business-event-create', 'ai-business-event-update', 'ai-business-event-set-enabled',
  'ai-business-event-remove', 'ai-business-event-record-retry',
  'ai-open-api-registry-create', 'ai-open-api-registry-update', 'ai-open-api-registry-remove',
  'platform-open-interface-create', 'platform-open-interface-update', 'platform-open-interface-remove',
  'ai-prompt-template-binding-create', 'ai-prompt-template-binding-update', 'ai-prompt-template-binding-remove',
])

export function withExecutionEffect (definition: CapabilityDefinition): CapabilityDefinition {
  // The model-selection form selects published skills, not model configuration IDs.
  if (definition.id === 'ai-model-selection-save') return { ...definition, params: definition.params.map(param => param.name === 'skillIds' ? { ...param, lookup: { capabilityId: 'ai-prompt-skill-list', keywordParam: 'name' } } : param) }
  return PREPARE_ONLY.has(definition.id) ? { ...definition, write: false } : definition
}
