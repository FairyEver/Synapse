import { cronTriggerConfigSchema } from "../../../automation-trigger-packages/builtin/cron/index.shared"
import { cronTriggerDefinition } from "../../../automation-trigger-packages/builtin/cron/index.main"
import { intervalTriggerConfigSchema } from "../../../automation-trigger-packages/builtin/interval/index.shared"
import { intervalTriggerDefinition } from "../../../automation-trigger-packages/builtin/interval/index.main"
import { AutomationTriggerRegistry } from "./trigger-registry"

const cronTriggerSchema = cronTriggerConfigSchema
const intervalTriggerSchema = intervalTriggerConfigSchema

export {
  cronTriggerConfigSchema,
  cronTriggerSchema,
  intervalTriggerConfigSchema,
  intervalTriggerSchema,
}

export function createBuiltinAutomationTriggerRegistry(): AutomationTriggerRegistry {
  const registry = new AutomationTriggerRegistry()
  registry.register(cronTriggerDefinition)
  registry.register(intervalTriggerDefinition)
  return registry
}
