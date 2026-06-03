export { AutomationService } from "./automation-service"
export type { AutomationServiceDeps } from "./automation-service"
export {
  createBuiltinAutomationTriggerRegistry,
  cronTriggerSchema,
  intervalTriggerSchema,
} from "./builtin-triggers"
export {
  AutomationExecutionService,
} from "./execution-service"
export type {
  AutomationExecutionLogger,
  AutomationExecutionServiceDeps,
} from "./execution-service"
export { AutomationItemRepository } from "./item-repository"
export type { AutomationItemRepositoryDeps } from "./item-repository"
export { AutomationRunRepository } from "./run-repository"
export type { AutomationRunRepositoryDeps } from "./run-repository"
export { AutomationTriggerRegistry } from "./trigger-registry"
export type {
  AutomationTriggerDefinition,
  AutomationTriggerManifest,
  AutomationTriggerRuntimeInput,
} from "./trigger-registry"
export * from "./types"
