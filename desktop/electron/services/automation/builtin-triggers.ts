import { cronTriggerConfigSchema } from "../../../automation-trigger-packages/builtin/cron"
import { cronTriggerDefinition } from "../../../automation-trigger-packages/builtin/cron/index.main"
import { intervalTriggerConfigSchema } from "../../../automation-trigger-packages/builtin/interval"
import { intervalTriggerDefinition } from "../../../automation-trigger-packages/builtin/interval/index.main"
import { AutomationTriggerRegistry } from "./trigger-registry"

export { cronTriggerConfigSchema, intervalTriggerConfigSchema }

export function createBuiltinAutomationTriggerRegistry(): AutomationTriggerRegistry {
  const registry = new AutomationTriggerRegistry()
  registry.register(cronTriggerDefinition)
  registry.register(intervalTriggerDefinition)
  return registry
}
