import type { RendererAutomationTriggerDefinition } from "../../types.shared"
import { CronTriggerConfigForm } from "./config.renderer"
import {
  cronTriggerManifest,
  summarizeCronTriggerConfig,
  type CronTriggerConfig,
} from "./index.shared"

export const cronRendererTriggerDefinition = {
  manifest: cronTriggerManifest,
  summarizeConfig: summarizeCronTriggerConfig,
  ConfigForm: CronTriggerConfigForm,
} satisfies RendererAutomationTriggerDefinition<CronTriggerConfig>
