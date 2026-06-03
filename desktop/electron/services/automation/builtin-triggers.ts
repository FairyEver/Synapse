import { z } from "zod"

import { computeNextRunAt } from "./schedule-calculator"
import { AutomationTriggerRegistry } from "./trigger-registry"

const activeDaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7)

export const cronTriggerSchema = z.object({
  expr: z.string().min(1),
  timezone: z.string().min(1).optional(),
  activeDays: activeDaysSchema,
})

export const intervalTriggerSchema = z.object({
  everyMinutes: z.number().int().positive(),
  anchor: z.enum(["created_at", "last_completed_at"]).default("created_at"),
  activeDays: activeDaysSchema,
})

export function createBuiltinAutomationTriggerRegistry(): AutomationTriggerRegistry {
  const registry = new AutomationTriggerRegistry()
  registry.register({
    manifest: {
      id: "builtin.cron",
      title: "Cron",
      defaultConfig: { expr: "0 9 * * *", activeDays: [0, 1, 2, 3, 4, 5, 6] },
      configSchema: cronTriggerSchema,
    },
    summarize: (config) => `Cron · ${config.expr}`,
    computeNextRunAt: (input) => computeNextRunAt({
      trigger: { type: "builtin.cron", config: input.config },
      from: input.from,
      createdAt: input.createdAt,
    }),
  })
  registry.register({
    manifest: {
      id: "builtin.interval",
      title: "固定间隔",
      defaultConfig: { everyMinutes: 60, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
      configSchema: intervalTriggerSchema,
    },
    summarize: (config) => config.anchor === "last_completed_at"
      ? `每 ${config.everyMinutes} 分钟 · 完成后`
      : `每 ${config.everyMinutes} 分钟`,
    computeNextRunAt: (input) => computeNextRunAt({
      trigger: { type: "builtin.interval", config: input.config },
      from: input.from,
      createdAt: input.createdAt,
    }),
  })
  return registry
}
