import { z } from "zod"

export const scriptActionConfigSchema = z.object({
  script: z.string().min(1),
  shell: z.enum(["posix", "cmd", "powershell"]),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
})

export type ScriptActionConfig = z.infer<typeof scriptActionConfigSchema>
