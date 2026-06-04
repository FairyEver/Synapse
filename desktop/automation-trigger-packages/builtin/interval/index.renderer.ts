import type { RendererAutomationTriggerDefinition } from "../../types.shared"
import { IntervalTriggerConfigForm } from "./config.renderer"
import {
  intervalTriggerManifest,
  summarizeIntervalTriggerConfig,
  type IntervalTriggerConfig,
} from "./index.shared"

export const intervalRendererTriggerDefinition = {
  manifest: intervalTriggerManifest,
  summarizeConfig: summarizeIntervalTriggerConfig,
  ConfigForm: IntervalTriggerConfigForm,
} satisfies RendererAutomationTriggerDefinition<IntervalTriggerConfig>
