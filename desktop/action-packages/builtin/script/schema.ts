import { z } from "zod"

export const scriptActionConfigSchema = z.object({
  script: z.string().min(1).default(""),
  shell: z.enum(["posix", "cmd", "powershell"]).optional(),
  env: z.record(z.string(), z.string()).optional(),
  pathStrategy: z.enum(["merge", "replace"]).optional(),
  posixLogin: z.boolean().optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
})

export type ScriptActionConfig = z.infer<typeof scriptActionConfigSchema>
