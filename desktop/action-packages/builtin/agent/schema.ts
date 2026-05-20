import { z } from "zod"
import { SYNAPSE_AGENT_PERMISSION_MODES, type SynapseAgentPermissionMode } from "../../../src/types/agent"
import type { ModelTier } from "../../../src/types/provider-model"
import type { ActionStoredConfigValidation } from "../../types"

const agentPermissionModes = SYNAPSE_AGENT_PERMISSION_MODES
const agentPermissionModeSet = new Set<string>(agentPermissionModes)
const modelTierSet = new Set<string>(["default", "haiku", "sonnet", "opus"])

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

export function validateAgentStoredConfig(config: Record<string, unknown>): ActionStoredConfigValidation {
  const parsed = agentActionConfigSchema.safeParse(config)
  if (parsed.success) {
    return { status: "valid", issues: [] }
  }

  const issues: Array<{ field: string; message: string }> = []

  if (config.agentType !== "claude-code") {
    issues.push({ field: "action.config.agentType", message: "选择当前支持的 Agent" })
  }
  if (typeof config.providerId !== "string" || config.providerId.trim().length === 0) {
    issues.push({ field: "action.config.providerId", message: "选择供应商" })
  }
  if (typeof config.modelTier !== "string" || !modelTierSet.has(config.modelTier)) {
    issues.push({ field: "action.config.modelTier", message: "选择模型" })
  }
  if (typeof config.mode !== "string" || !agentPermissionModeSet.has(config.mode)) {
    issues.push({ field: "action.config.mode", message: "选择权限模式" })
  }

  return {
    status: "needs_update",
    issues: issues.length > 0
      ? issues
      : [{ field: "action.config", message: "检查执行内容" }],
  }
}
