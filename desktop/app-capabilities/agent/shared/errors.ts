export const AGENT_CONVERSATION_NAVIGATION_ERROR_CODES = [
  "invalid_input",
  "invalid_link",
  "invalid_locator",
  "not_found",
  "open_failed",
] as const

export type AgentConversationNavigationErrorCode =
  (typeof AGENT_CONVERSATION_NAVIGATION_ERROR_CODES)[number]

const ERROR_MESSAGES: Record<AgentConversationNavigationErrorCode, string> = {
  invalid_input: "对话链接参数无效",
  invalid_link: "对话链接无效",
  invalid_locator: "对话定位符无效",
  not_found: "对话不存在或已删除",
  open_failed: "打开对话失败",
}

export class AgentConversationNavigationError extends Error {
  constructor(readonly code: AgentConversationNavigationErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = "AgentConversationNavigationError"
  }
}

export function serializeAgentConversationNavigationError(error: unknown): {
  code: AgentConversationNavigationErrorCode
  message: string
} {
  const normalized = error instanceof AgentConversationNavigationError
    ? error
    : new AgentConversationNavigationError("open_failed")
  return { code: normalized.code, message: normalized.message }
}

export const AGENT_CONVERSATION_CAPABILITY_ERROR_CODES = [
  "group_not_found",
  "group_ambiguous",
  "model_unavailable",
  "invalid_input",
  "invalid_link",
  "invalid_locator",
  "not_found",
  "project_unavailable",
  "control_not_supported",
  "no_active_turn",
  "turn_changed",
  "permission_not_pending",
  "permission_kind_mismatch",
  "idempotency_conflict",
  "watermark_ahead",
  "quota_exceeded",
  "operation_failed",
] as const

export type AgentConversationCapabilityErrorCode =
  (typeof AGENT_CONVERSATION_CAPABILITY_ERROR_CODES)[number]

const CAPABILITY_ERROR_MESSAGES: Record<AgentConversationCapabilityErrorCode, string> = {
  group_not_found: "对话分组不存在或已删除",
  group_ambiguous: "存在同名对话分组，请使用分组 ID 指定",
  model_unavailable: "所选或默认模型不可用，请查询可用模型或在 Synapse 中检查配置",
  invalid_input: "请求参数无效",
  invalid_link: "对话链接无效",
  invalid_locator: "对话定位符无效",
  not_found: "对话不存在或已删除",
  project_unavailable: "对话所属项目当前不可用",
  control_not_supported: "该来源的对话不支持控制",
  no_active_turn: "当前没有运行中的回合",
  turn_changed: "当前运行回合已变化",
  permission_not_pending: "权限请求不存在或已处理",
  permission_kind_mismatch: "权限请求类型不匹配",
  idempotency_conflict: "幂等键已用于不同请求",
  watermark_ahead: "观察游标超出当前状态",
  quota_exceeded: "请求过于频繁或观察数量已达上限",
  operation_failed: "Agent 对话操作失败",
}

export class AgentConversationCapabilityError extends Error {
  constructor(
    readonly code: AgentConversationCapabilityErrorCode,
    readonly data?: Record<string, unknown>,
  ) {
    super(CAPABILITY_ERROR_MESSAGES[code])
    this.name = "AgentConversationCapabilityError"
  }
}

export function serializeAgentConversationCapabilityError(error: unknown): {
  code: AgentConversationCapabilityErrorCode
  message: string
  data?: Record<string, unknown>
} {
  const normalized = error instanceof AgentConversationCapabilityError
    ? error
    : new AgentConversationCapabilityError("operation_failed")
  return {
    code: normalized.code,
    message: normalized.message,
    ...(normalized.data ? { data: normalized.data } : {}),
  }
}
