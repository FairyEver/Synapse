import { z } from "zod"

export const terminalActionConfigSchema = z.object({
  command: z.string().max(256 * 1024).refine(value => value.trim().length > 0 && !value.includes("\0"), "填写命令"),
  autoClose: z.boolean().default(true),
  timeoutMins: z.number().min(1).max(1440).nullable().default(30),
}).strict()

export type TerminalActionConfig = z.infer<typeof terminalActionConfigSchema>
