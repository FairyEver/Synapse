import { commonTriggerVariables } from "../common-variables"
import type { AutomationTriggerManifest } from "../../types.shared"
import {
  cronTriggerConfigSchema,
  type CronTriggerConfig,
} from "./schema"

const cronTriggerVariables = [
  ...commonTriggerVariables(true),
  { key: "trigger.cron", label: "Cron 表达式", group: "config", example: "0 9 * * *" },
] as const

export const cronTriggerManifest = {
  id: "builtin.cron",
  title: "Cron",
  kind: "schedule",
  defaultConfig: {
    expr: "0 9 * * *",
  },
  configSchema: cronTriggerConfigSchema,
  variables: cronTriggerVariables,
} satisfies AutomationTriggerManifest<CronTriggerConfig>
