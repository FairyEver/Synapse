import { SYNAPSE_AGENT_PERMISSION_MODES, type SynapseAgentPermissionMode } from "../../types/agent"

const permissionModes = SYNAPSE_AGENT_PERMISSION_MODES

const permissionModeLabels: Record<SynapseAgentPermissionMode, string> = {
  default: "默认",
  acceptEdits: "接受编辑",
  plan: "计划",
  auto: "自动",
  dontAsk: "不再询问",
  bypassPermissions: "跳过权限",
}

const permissionModeDescriptions: Record<SynapseAgentPermissionMode, string> = {
  default: "使用 Claude Code 默认权限策略。",
  acceptEdits: "自动接受文件编辑，其他工具仍按权限策略处理。",
  plan: "先制定计划，避免直接执行会修改环境的操作。",
  auto: "由 Claude Code 根据上下文自动判断工具权限。",
  dontAsk: "不再弹出权限询问，按当前会话策略继续执行。",
  bypassPermissions: "跳过所有权限确认。",
}

const providerAvailabilityNotes: Partial<Record<SynapseAgentPermissionMode, string>> = {
  auto: "部分服务不可用，切换失败时请换其他模式。",
}

function permissionModeConfirmationText(mode: SynapseAgentPermissionMode | null): string {
  if (mode === "auto") return "将由模型自动判断工具权限。"
  if (mode === "bypassPermissions") return "将跳过工具权限确认。"
  return ""
}

export {
  permissionModes,
  permissionModeLabels,
  permissionModeDescriptions,
  providerAvailabilityNotes,
  permissionModeConfirmationText,
}
