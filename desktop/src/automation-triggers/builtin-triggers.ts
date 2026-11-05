import { cronRendererTriggerDefinition } from "../../automation-trigger-packages/builtin/cron/index.renderer"
import { intervalRendererTriggerDefinition } from "../../automation-trigger-packages/builtin/interval/index.renderer"
import { webhookRendererTriggerDefinition } from "../../automation-trigger-packages/builtin/webhook/index.renderer"
import { RendererAutomationTriggerRegistry } from "./action-registry"
import { mailInternalReceivedRendererDefinition } from "../../automation-trigger-packages/builtin/mail-internal-received/index.renderer"
import { mailReceivedRendererDefinition } from "../../automation-trigger-packages/builtin/mail-received/index.renderer"

export const rendererAutomationTriggerRegistry = new RendererAutomationTriggerRegistry()
rendererAutomationTriggerRegistry.register(cronRendererTriggerDefinition)
rendererAutomationTriggerRegistry.register(intervalRendererTriggerDefinition)
rendererAutomationTriggerRegistry.register(webhookRendererTriggerDefinition)
rendererAutomationTriggerRegistry.register(mailInternalReceivedRendererDefinition)
rendererAutomationTriggerRegistry.register(mailReceivedRendererDefinition)
