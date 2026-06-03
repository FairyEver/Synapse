import type { AutomationTriggerManifest } from "../../../src/automation-triggers/action-registry"
import {
  cronTriggerConfigSchema,
  type CronTriggerConfig,
} from "./schema"

export const cronTriggerManifest = {
  id: "builtin.cron",
  title: "Cron",
  defaultConfig: {
    expr: "0 9 * * *",
    activeDays: [0, 1, 2, 3, 4, 5, 6],
  },
  configSchema: cronTriggerConfigSchema,
} satisfies AutomationTriggerManifest<CronTriggerConfig>
