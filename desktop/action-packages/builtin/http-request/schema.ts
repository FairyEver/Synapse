import { z } from "zod"

export const httpRequestActionConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  url: z.string().url().or(z.literal("")).default(""),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  bodyType: z.enum(["none", "json", "text"]).default("none"),
  body: z.string().optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
  auth: z.object({
    type: z.enum(["none", "bearer", "basic"]),
    bearerToken: z.string().optional(),
    basicUsername: z.string().optional(),
    basicPassword: z.string().optional(),
  }).optional(),
})

export type HttpRequestActionConfig = z.infer<typeof httpRequestActionConfigSchema>
