import type { AutomationTriggerDefinition } from "../../types.shared"
import {
  cronTriggerManifest,
  summarizeCronTriggerConfig,
  type CronTriggerConfig,
} from "./index.shared"
import { cronTriggerRuntime } from "./runtime.main"

export const cronTriggerDefinition = {
  manifest: cronTriggerManifest,
  summarize: summarizeCronTriggerConfig,
  runtime: cronTriggerRuntime,
} satisfies AutomationTriggerDefinition<CronTriggerConfig>
