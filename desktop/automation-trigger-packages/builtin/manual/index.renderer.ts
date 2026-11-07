import { MousePointerClick } from "lucide-react"
import type { RendererAutomationTriggerDefinition } from "../../types.shared"
import {
  manualTriggerManifest,
  summarizeManualTriggerConfig,
  type ManualTriggerConfig,
} from "./index.shared"

export const manualRendererTriggerDefinition = {
  manifest: manualTriggerManifest,
  icon: MousePointerClick,
  summarizeConfig: summarizeManualTriggerConfig,
} satisfies RendererAutomationTriggerDefinition<ManualTriggerConfig>
