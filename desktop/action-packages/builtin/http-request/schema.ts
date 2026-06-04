import { z } from "zod"

export const httpRequestActionConfigSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  url: z.string().default(""),
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
}).superRefine((config, ctx) => {
  if (methodDisallowsBody(config.method) && config.bodyType !== "none") {
    ctx.addIssue({
      code: "custom",
      path: ["bodyType"],
      message: `${config.method} 请求不支持 Body`,
    })
  }
  if (config.auth?.type === "bearer" && !config.auth.bearerToken?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["auth", "bearerToken"],
      message: "Bearer Token 不能为空",
    })
  }
  if (config.auth?.type === "basic" && !config.auth.basicUsername?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["auth", "basicUsername"],
      message: "Basic Auth 用户名不能为空",
    })
  }
})

export type HttpRequestActionConfig = z.infer<typeof httpRequestActionConfigSchema>

function methodDisallowsBody(method: string): boolean {
  return method === "GET" || method === "HEAD"
}
