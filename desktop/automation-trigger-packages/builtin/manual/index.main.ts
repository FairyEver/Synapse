import type { AutomationTriggerDefinition } from "../../types.shared"
import {
  manualTriggerManifest,
  summarizeManualTriggerConfig,
  type ManualTriggerConfig,
} from "./index.shared"

export const manualTriggerDefinition = {
  manifest: manualTriggerManifest,
  summarize: summarizeManualTriggerConfig,
  runtime: {},
} satisfies AutomationTriggerDefinition<ManualTriggerConfig>
