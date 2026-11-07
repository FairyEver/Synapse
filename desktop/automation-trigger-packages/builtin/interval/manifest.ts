import { commonTriggerVariables } from "../common-variables"
import type { AutomationTriggerManifest } from "../../types.shared"
import {
  intervalTriggerConfigSchema,
  type IntervalTriggerConfig,
} from "./schema"

const intervalTriggerVariables = [
  ...commonTriggerVariables("schedule"),
  { key: "trigger.everyMinutes", label: "间隔分钟", group: "config", example: "60" },
  { key: "trigger.anchor", label: "间隔计算方式", group: "config", description: "created_at 按创建时间计算；last_completed_at 按上次完成时间计算。" },
] as const

export const intervalTriggerManifest = {
  id: "builtin.interval",
  title: "固定间隔",
  kind: "schedule",
  defaultConfig: {
    everyMinutes: 60,
    anchor: "created_at",
  },
  configSchema: intervalTriggerConfigSchema,
  variables: intervalTriggerVariables,
} satisfies AutomationTriggerManifest<IntervalTriggerConfig>
