import { z } from "zod"

export const httpRequestActionConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  bodyType: z.enum(["none", "json", "text"]),
  body: z.string().optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
})

export type HttpRequestActionConfig = z.infer<typeof httpRequestActionConfigSchema>
