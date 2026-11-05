import { z } from "zod"
import { validateCronExpression } from "../../cron-expression"

export const cronTriggerConfigSchema = z.object({
  expr: z.string().min(1).describe("Five-field Cron using decimal integers, aliases, lists, ranges and one optional /step per segment.").superRefine((expr, ctx) => {
    try { validateCronExpression(expr) } catch (error) {
      ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Cron 不合法" })
    }
  }),
  timezone: z.string().min(1).superRefine((timezone, ctx) => {
    try { new Intl.DateTimeFormat("zh-CN", { timeZone: timezone }) } catch {
      ctx.addIssue({ code: "custom", message: "请填写有效时区，例如 Asia/Shanghai" })
    }
  }).optional(),
})

export type CronTriggerConfig = z.infer<typeof cronTriggerConfigSchema>
