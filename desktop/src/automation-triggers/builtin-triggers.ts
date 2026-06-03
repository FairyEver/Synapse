import {
  CronTriggerConfigForm,
  cronTriggerManifest,
  type CronTriggerConfig,
} from "../../automation-trigger-packages/builtin/cron"
import {
  IntervalTriggerConfigForm,
  intervalTriggerManifest,
  type IntervalTriggerConfig,
} from "../../automation-trigger-packages/builtin/interval"
import {
  RendererAutomationTriggerRegistry,
  type RendererAutomationTriggerDefinition,
} from "./action-registry"

const cronRendererTrigger: RendererAutomationTriggerDefinition<CronTriggerConfig> = {
  manifest: cronTriggerManifest,
  summarizeConfig: (config) => `Cron · ${config.expr}`,
  ConfigForm: CronTriggerConfigForm,
}

const intervalRendererTrigger: RendererAutomationTriggerDefinition<IntervalTriggerConfig> = {
  manifest: intervalTriggerManifest,
  summarizeConfig: (config) => config.anchor === "last_completed_at"
    ? `每 ${config.everyMinutes} 分钟 · 完成后`
    : `每 ${config.everyMinutes} 分钟`,
  ConfigForm: IntervalTriggerConfigForm,
}

export const rendererAutomationTriggerRegistry = new RendererAutomationTriggerRegistry()
rendererAutomationTriggerRegistry.register(cronRendererTrigger)
rendererAutomationTriggerRegistry.register(intervalRendererTrigger)
