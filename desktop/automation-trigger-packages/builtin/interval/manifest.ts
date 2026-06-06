import type { AutomationTriggerManifest } from "../../types.shared"
import {
  intervalTriggerConfigSchema,
  type IntervalTriggerConfig,
} from "./schema"

const intervalTriggerVariables = [
  { key: "trigger.type", label: "触发器类型", group: "trigger" },
  { key: "trigger.triggeredBy", label: "运行来源", group: "trigger" },
  { key: "trigger.triggeredAt", label: "触发时间", group: "trigger" },
  { key: "trigger.scheduledAt", label: "计划时间", group: "trigger" },
  { key: "trigger.automationId", label: "自动化 ID", group: "trigger" },
  { key: "trigger.automationName", label: "自动化名称", group: "trigger" },
  { key: "trigger.everyMinutes", label: "间隔分钟", group: "config" },
  { key: "trigger.anchor", label: "间隔锚点", group: "config" },
] as const

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
  variables: intervalTriggerVariables,
} satisfies AutomationTriggerManifest<IntervalTriggerConfig>
