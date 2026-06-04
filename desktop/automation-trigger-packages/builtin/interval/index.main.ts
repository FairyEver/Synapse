import type { AutomationTriggerDefinition } from "../../types.shared"
import {
  intervalTriggerManifest,
  summarizeIntervalTriggerConfig,
  type IntervalTriggerConfig,
} from "./index.shared"
import { intervalTriggerRuntime } from "./runtime.main"

export const intervalTriggerDefinition = {
  manifest: intervalTriggerManifest,
  summarize: summarizeIntervalTriggerConfig,
  runtime: intervalTriggerRuntime,
} satisfies AutomationTriggerDefinition<IntervalTriggerConfig>
