import { z } from "zod"

export const claudeCodeActionConfigSchema = z.object({
  projectId: z.string().trim().min(1),
  prompt: z.string().refine(value => value.trim().length > 0, "填写提示词"),
  singleRun: z.boolean().optional(),
}).strict()

export type ClaudeCodeActionConfig = z.infer<typeof claudeCodeActionConfigSchema>
