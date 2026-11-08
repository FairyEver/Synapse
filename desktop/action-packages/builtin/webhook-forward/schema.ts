import { z } from "zod"

export const webhookForwardActionConfigSchema = z.object({
  url: z.string().min(1).max(8192).refine(value => {
    if (/[\s{}]/u.test(value)) return false
    try {
      const url = new URL(value)
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !value.includes("#")
    } catch { return false }
  }, "填写有效的 HTTP 或 HTTPS URL"),
}).strict()
export type WebhookForwardActionConfig = z.infer<typeof webhookForwardActionConfigSchema>
