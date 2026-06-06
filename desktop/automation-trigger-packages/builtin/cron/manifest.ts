import type { AutomationTriggerManifest } from "../../types.shared"
import {
  cronTriggerConfigSchema,
  type CronTriggerConfig,
} from "./schema"

const cronTriggerVariables = [
  { key: "trigger.type", label: "触发器类型", group: "trigger" },
  { key: "trigger.triggeredBy", label: "运行来源", group: "trigger" },
  { key: "trigger.triggeredAt", label: "触发时间", group: "trigger" },
  { key: "trigger.scheduledAt", label: "计划时间", group: "trigger" },
  { key: "trigger.automationId", label: "自动化 ID", group: "trigger" },
  { key: "trigger.automationName", label: "自动化名称", group: "trigger" },
  { key: "trigger.cron", label: "Cron 表达式", group: "config" },
  { key: "trigger.timezone", label: "时区", group: "config" },
] as const

export const cronTriggerManifest = {
  id: "builtin.cron",
  title: "Cron",
  kind: "schedule",
  defaultConfig: {
    expr: "0 9 * * *",
    activeDays: [0, 1, 2, 3, 4, 5, 6],
  },
  configSchema: cronTriggerConfigSchema,
  variables: cronTriggerVariables,
} satisfies AutomationTriggerManifest<CronTriggerConfig>
