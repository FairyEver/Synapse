import { cronRendererTriggerDefinition } from "../../automation-trigger-packages/builtin/cron/index.renderer"
import { intervalRendererTriggerDefinition } from "../../automation-trigger-packages/builtin/interval/index.renderer"
import { RendererAutomationTriggerRegistry } from "./action-registry"

export const rendererAutomationTriggerRegistry = new RendererAutomationTriggerRegistry()
rendererAutomationTriggerRegistry.register(cronRendererTriggerDefinition)
rendererAutomationTriggerRegistry.register(intervalRendererTriggerDefinition)
