import { z } from "zod"

export const agentActionConfigSchema = z.object({
  projectId: z.string().min(1),
  agentType: z.enum(["claude-code"]),
  mode: z.string().min(1),
  prompt: z.string().min(1),
  sessionPolicy: z.enum(["fresh", "resume"]),
  timeoutMins: z.number().int().min(1).max(120).nullable().optional(),
})

export type AgentActionConfig = z.infer<typeof agentActionConfigSchema>
