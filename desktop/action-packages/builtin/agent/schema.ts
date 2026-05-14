import { z } from "zod"

const unattendedAgentModes = ["auto", "bypassPermissions", "dontAsk"] as const

export type AgentActionConfig = {
  projectId: string
  agentType: "claude-code"
  mode: string
  prompt: string
  sessionPolicy: "fresh" | "resume"
  timeoutMins?: number | null
}

export const agentActionConfigSchema: z.ZodType<AgentActionConfig> = z.object({
  projectId: z.string().min(1),
  agentType: z.enum(["claude-code"]),
  mode: z.enum(unattendedAgentModes),
  prompt: z.string().min(1),
  sessionPolicy: z.enum(["fresh", "resume"]),
  timeoutMins: z.number().int().min(1).max(120).nullable().optional(),
})
