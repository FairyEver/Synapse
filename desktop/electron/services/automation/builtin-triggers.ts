import { cronTriggerConfigSchema } from "../../../automation-trigger-packages/builtin/cron/index.shared"
import { cronTriggerDefinition } from "../../../automation-trigger-packages/builtin/cron/index.main"
import { intervalTriggerConfigSchema } from "../../../automation-trigger-packages/builtin/interval/index.shared"
import { intervalTriggerDefinition } from "../../../automation-trigger-packages/builtin/interval/index.main"
import { webhookTriggerConfigSchema } from "../../../automation-trigger-packages/builtin/webhook/index.shared"
import { webhookTriggerDefinition } from "../../../automation-trigger-packages/builtin/webhook/index.main"
import { AutomationTriggerRegistry } from "./trigger-registry"

const cronTriggerSchema = cronTriggerConfigSchema
const intervalTriggerSchema = intervalTriggerConfigSchema
const webhookTriggerSchema = webhookTriggerConfigSchema

export {
  cronTriggerConfigSchema,
  cronTriggerSchema,
  intervalTriggerConfigSchema,
  intervalTriggerSchema,
  webhookTriggerConfigSchema,
  webhookTriggerSchema,
}

export function createBuiltinAutomationTriggerRegistry(): AutomationTriggerRegistry {
  const registry = new AutomationTriggerRegistry()
  registry.register(cronTriggerDefinition)
  registry.register(intervalTriggerDefinition)
  registry.register(webhookTriggerDefinition)
  return registry
}
