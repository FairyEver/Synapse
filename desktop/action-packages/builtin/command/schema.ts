import { z } from "zod"

export const commandActionConfigSchema = z.object({
  command: z.string().min(1),
  shell: z.enum(["posix", "cmd", "powershell"]),
  env: z.record(z.string(), z.string()).optional(),
  pathStrategy: z.enum(["merge", "replace"]).optional(),
  posixLogin: z.boolean().optional(),
  timeoutMins: z.number().int().positive().nullable().optional(),
})

export type CommandActionConfig = z.infer<typeof commandActionConfigSchema>
