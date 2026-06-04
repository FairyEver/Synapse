import { SYNAPSE_AGENT_PERMISSION_MODES, type SynapseAgentPermissionMode } from "../../types/agent"

const permissionModes = SYNAPSE_AGENT_PERMISSION_MODES

const permissionModeLabels: Record<SynapseAgentPermissionMode, string> = {
  default: "按需询问",
  acceptEdits: "自动接受编辑",
  plan: "只读计划",
  auto: "自动判定",
  dontAsk: "不询问并拒绝",
  bypassPermissions: "跳过权限确认",
}

const permissionModeDescriptions: Record<SynapseAgentPermissionMode, string> = {
  default: "遇到需要权限的工具时会向你确认。",
  acceptEdits: "文件编辑和常见文件系统操作会自动通过，其他工具仍可能询问。",
  plan: "只让 Agent 阅读和分析，先给计划，不直接改源文件。",
  auto: "由模型分类器逐个判断工具是否放行，减少人工确认。",
  dontAsk: "不再弹出权限询问；未预先允许的工具会被拒绝。",
  bypassPermissions: "跳过所有权限确认；所有到达权限层的工具都会直接执行。",
}

type PermissionModeRiskLevel = "低风险" | "中风险" | "受限" | "高风险"

type PermissionModeHelp = {
  readonly englishLabel: string
  readonly riskLevel: PermissionModeRiskLevel
  readonly bestFor: string
  readonly risk: string
  readonly note?: string
}

const permissionModeHelp: Record<SynapseAgentPermissionMode, PermissionModeHelp> = {
  default: {
    englishLabel: "Standard permission behavior",
    riskLevel: "低风险",
    bestFor: "第一次使用、任务风险不清楚，或希望自己确认每个关键操作。",
    risk: "最稳妥，但需要你及时处理权限确认。",
  },
  acceptEdits: {
    englishLabel: "Auto-accept file edits",
    riskLevel: "中风险",
    bestFor: "你信任当前代码修改任务，并希望减少文件编辑确认。",
    risk: "可能直接修改、移动或删除项目文件；运行命令和外部工具仍按权限策略处理。",
  },
  plan: {
    englishLabel: "Planning mode",
    riskLevel: "低风险",
    bestFor: "先审方案、拆任务、评估风险，暂时不希望 Agent 动代码。",
    risk: "执行真正修改前还需要切换到其他模式。",
  },
  auto: {
    englishLabel: "Model-classified approvals",
    riskLevel: "中风险",
    bestFor: "需要更少打断，同时仍希望保留自动安全判断。",
    risk: "判断来自模型分类器，不等于人工确认；部分服务可能不支持。",
  },
  dontAsk: {
    englishLabel: "Deny instead of prompting",
    riskLevel: "受限",
    bestFor: "无人值守但想收紧权限的任务。",
    risk: "未预先允许的工具会直接失败，Agent 可能因为拿不到权限而无法完成任务。",
  },
  bypassPermissions: {
    englishLabel: "Bypass all permission checks",
    riskLevel: "高风险",
    bestFor: "只建议在隔离环境或完全信任任务时使用。",
    risk: "可能直接写文件、运行命令或调用 MCP 工具，不再等待你确认。",
    note: "系统或管理员的明确拒绝规则仍可能拦截；如果环境允许无沙箱命令，风险会进一步扩大。",
  },
}

const providerAvailabilityNotes: Partial<Record<SynapseAgentPermissionMode, string>> = {
  auto: "部分服务不可用，切换失败时请换其他模式。",
}

function permissionModeConfirmationText(mode: SynapseAgentPermissionMode | null): string {
  if (mode === "auto") return "将由模型自动判断工具权限，不再由你逐项确认所有请求。"
  if (mode === "bypassPermissions") return "将跳过工具权限确认。工具可能直接写文件、运行命令或调用外部能力。"
  return ""
}

export {
  permissionModes,
  permissionModeLabels,
  permissionModeDescriptions,
  permissionModeHelp,
  providerAvailabilityNotes,
  permissionModeConfirmationText,
}
