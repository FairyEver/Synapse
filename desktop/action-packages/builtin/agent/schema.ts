import { z } from "zod"
import { SYNAPSE_AGENT_PERMISSION_MODES, type SynapseAgentPermissionMode } from "../../../src/types/agent"
import type { ModelTier } from "../../../src/types/provider-model"

const agentPermissionModes = SYNAPSE_AGENT_PERMISSION_MODES

export type AgentActionConfig = {
  projectId: string
  agentType: "claude-code"
  providerId: string
  modelTier: ModelTier
  providerName?: string
  modelName?: string
  mode: SynapseAgentPermissionMode
  prompt: string
  sessionPolicy: "fresh" | "resume"
  timeoutMins?: number | null
}

export const agentActionConfigSchema: z.ZodType<AgentActionConfig> = z.object({
  projectId: z.string().min(1),
  agentType: z.enum(["claude-code"]),
  providerId: z.string().min(1),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]),
  providerName: z.string().optional(),
  modelName: z.string().optional(),
  mode: z.enum(agentPermissionModes),
  prompt: z.string().min(1),
  sessionPolicy: z.enum(["fresh", "resume"]),
  timeoutMins: z.number().int().min(1).max(120).nullable().optional(),
})
