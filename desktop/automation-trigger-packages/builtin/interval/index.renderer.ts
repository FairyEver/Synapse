import { Repeat2 } from "lucide-react"
import type { RendererAutomationTriggerDefinition } from "../../types.shared"
import { IntervalTriggerConfigForm } from "./config.renderer"
import {
  intervalTriggerManifest,
  summarizeIntervalTriggerConfig,
  type IntervalTriggerConfig,
} from "./index.shared"

export const intervalRendererTriggerDefinition = {
  manifest: intervalTriggerManifest,
  icon: Repeat2,
  summarizeConfig: summarizeIntervalTriggerConfig,
  ConfigForm: IntervalTriggerConfigForm,
} satisfies RendererAutomationTriggerDefinition<IntervalTriggerConfig>
