import type { AutomationTriggerManifest } from "../../../src/automation-triggers/action-registry"
import {
  intervalTriggerConfigSchema,
  type IntervalTriggerConfig,
} from "./schema"

export const intervalTriggerManifest = {
  id: "builtin.interval",
  title: "固定间隔",
  kind: "schedule",
  defaultConfig: {
    everyMinutes: 60,
    anchor: "created_at",
    activeDays: [0, 1, 2, 3, 4, 5, 6],
  },
  configSchema: intervalTriggerConfigSchema,
} satisfies AutomationTriggerManifest<IntervalTriggerConfig>
