import { DEFAULT_CLAUDE_SDK_MAX_TURNS } from "./turn-limits"

export const AGENT_CANCELLED_MESSAGE = "已停止本次执行。"
export const AGENT_SESSION_CLOSED_MESSAGE = "Agent 会话已关闭，无法继续执行。"
export const AGENT_SESSION_RESETTING_MESSAGE = "Agent 会话正在重置，请稍后再试。"
export const AGENT_SESSION_ENDED_MESSAGE = "Agent 会话已结束，任务尚未完成；请重新发送消息继续。"
export const AGENT_SESSION_ENDED_BEFORE_SEND_MESSAGE = "Agent 会话已结束，消息未发送成功；请重新发送消息继续。"
export const AGENT_SESSION_TIMED_OUT_MESSAGE = "Agent 会话响应超时，任务尚未完成；请稍后重试或发送“继续”。"
export const AGENT_RELAY_TIMED_OUT_MESSAGE = "Agent 中继执行超时，任务尚未完成；请稍后重试。"
export const AGENT_RELAY_BUSY_MESSAGE = "Agent 中继会话正在执行中，请稍后再试。"
export const AGENT_QUEUE_FULL_MESSAGE = "当前会话仍在执行，待发送队列已满；请稍后再试。"
export const AGENT_MESSAGE_BLOCKED_MESSAGE = "消息被策略拦截，未开始执行。"
export const AGENT_COMPRESSION_UNSUPPORTED_MESSAGE = "当前 Agent 会话暂不支持压缩上下文。"
export const AGENT_TURN_FAILED_MESSAGE = "Agent 本轮执行失败。"
export const AGENT_SPAWN_DENIED_MESSAGE = "Agent 启动被权限策略拒绝。"
export const AGENT_SPAWN_PERMISSION_CHECK_FAILED_MESSAGE = "Agent 启动权限检查失败。"
export const AGENT_ABORTED_BEFORE_EXECUTION_MESSAGE = "执行开始前已取消。"
export const AGENT_SCHEDULED_SPAWN_DENIED_MESSAGE = "定时执行没有 Agent 启动权限。"
export const AGENT_NO_ACTIVE_PROVIDER_MESSAGE = "未配置可用的模型供应商。"
export const AGENT_PROVIDER_REQUIRED_MESSAGE = "缺少模型供应商配置。"
export const AGENT_PROJECT_WORKSPACE_REQUIRED_MESSAGE = "项目工作目录未配置。"
export const AGENT_COMMAND_EXECUTION_UNAVAILABLE_MESSAGE = "当前环境不支持执行该命令。"
export const AGENT_COMMAND_EXEC_BODY_MISSING_MESSAGE = "命令缺少可执行内容。"
export const AGENT_COMMAND_PROMPT_REQUIRED_MESSAGE = "命令缺少提示词内容。"
export const AGENT_COMMAND_NAME_REQUIRED_MESSAGE = "命令缺少名称。"
export const AGENT_COMPRESSION_STATE_UNAVAILABLE_MESSAGE = "当前压缩状态不可用。"
export const AGENT_PERMISSION_CANCELLED_MESSAGE = "权限请求已取消。"
export const AGENT_TURN_PERMISSION_CANCELLED_MESSAGE = "本轮执行已停止，未继续等待权限确认。"
export const AGENT_QUERY_FINISHED_PERMISSION_MESSAGE = "Agent 会话已结束，未继续等待权限确认。"
export const AGENT_PERMISSION_TIMEOUT_MESSAGE = "等待用户确认超时，已停止本次操作。"
export const AGENT_USER_QUESTION_TIMEOUT_MESSAGE = "等待用户回复超时，已停止本次操作。"
export const AGENT_PERMISSION_NOT_PENDING_MESSAGE = "该权限请求已不在等待中。"
export const AGENT_PERMISSION_SESSION_MISMATCH_MESSAGE = "该权限请求不属于当前会话。"
export const AGENT_PERMISSION_UPDATED_INPUT_UNSUPPORTED_MESSAGE = "普通工具权限不支持修改入参后批准。"
export const AGENT_ASK_USER_QUESTION_ANSWERS_REQUIRED_MESSAGE = "继续前需要先提供用户回复。"
export const AGENT_ASK_USER_QUESTION_ALL_ANSWERS_REQUIRED_MESSAGE = "继续前需要回答所有问题。"
export const AGENT_ASK_USER_QUESTION_QUESTIONS_REQUIRED_MESSAGE = "继续前需要保留原始问题。"
export const AGENT_USER_QUESTION_PERSISTENCE_FAILED_MESSAGE = "用户回复保存失败，请重试。"
export const AGENT_INVALID_ASK_USER_QUESTION_INPUT_MESSAGE = "用户确认请求格式无效，已停止本次操作。"
export const AGENT_RELAY_PERMISSION_DENY_MESSAGE = "中继会话不能批准工具权限。"
export const AGENT_RELAY_QUESTION_DENY_MESSAGE = "中继会话不能代替用户回答问题。"
export const AGENT_RELAY_PERMISSION_ERROR_MESSAGE = "中继会话请求了工具权限，已停止本次操作。"
export const AGENT_RELAY_QUESTION_ERROR_MESSAGE = "中继会话请求了用户回复，已停止本次操作。"

const AGENT_EXECUTION_FAILED_MESSAGE = "Agent 执行失败。"
const WEBFETCH_PREFLIGHT_FAILED_MESSAGE = "WebFetch 域名预检失败。当前供应商或网络拒绝了 Claude Code 的安全检查，已停止本轮执行。"
export const AGENT_TOOL_USE_INTERRUPTED_MESSAGE = "Agent 在工具调用后中断，发送“继续”可接着执行。"

export type AgentErrorKind =
  | "execution_failed"
  | "tool_use_interrupted"
  | "webfetch_preflight_failed"

export interface AgentErrorPresentation {
  readonly message: string
  readonly errorKind: AgentErrorKind
  readonly recoverable: boolean
}

export function sdkResultErrorMessage(subtype: string | undefined, errors: readonly string[]): string | undefined {
  return sdkResultErrorPresentation(subtype, errors)?.message
}

export function sdkResultErrorPresentation(subtype: string | undefined, errors: readonly string[]): AgentErrorPresentation | undefined {
  if (errors.length > 0) {
    const diagnostic = errors.join("\n")
    return agentDiagnosticPresentation(diagnostic)
  }
  if (subtype === "error_max_turns") {
    return {
      message: `已达到本轮执行上限（${DEFAULT_CLAUDE_SDK_MAX_TURNS}），任务尚未完成；发送“继续”可接着执行。`,
      errorKind: "execution_failed",
      recoverable: false,
    }
  }
  if (subtype === "error_max_budget_usd") {
    return {
      message: "已达到本轮费用上限，任务尚未完成；调整预算后可继续执行。",
      errorKind: "execution_failed",
      recoverable: false,
    }
  }
  if (subtype?.startsWith("error_")) {
    return {
      message: agentDiagnosticMessage("Agent 已停止，任务尚未完成。", subtype),
      errorKind: "execution_failed",
      recoverable: false,
    }
  }
  return undefined
}

export function sdkQueryErrorMessage(diagnostic: string | undefined): string {
  return sdkQueryErrorPresentation(diagnostic).message
}

export function sdkQueryErrorPresentation(diagnostic: string | undefined): AgentErrorPresentation {
  return agentDiagnosticPresentation(diagnostic)
}

export function agentDiagnosticPresentation(diagnostic: string | undefined): AgentErrorPresentation {
  if (isToolUseInterruptedDiagnostic(diagnostic)) {
    return {
      message: AGENT_TOOL_USE_INTERRUPTED_MESSAGE,
      errorKind: "tool_use_interrupted",
      recoverable: true,
    }
  }
  if (isWebFetchPreflightFailure(diagnostic)) {
    return {
      message: WEBFETCH_PREFLIGHT_FAILED_MESSAGE,
      errorKind: "webfetch_preflight_failed",
      recoverable: false,
    }
  }
  return {
    message: agentDiagnosticMessage(AGENT_EXECUTION_FAILED_MESSAGE, diagnostic),
    errorKind: "execution_failed",
    recoverable: false,
  }
}

export function webFetchPreflightFailureMeta(diagnostic: string | undefined): Record<string, unknown> {
  if (!isWebFetchPreflightFailure(diagnostic)) return {}
  return {
    webFetchPreflightFailure: true,
    webFetchDomain: webFetchPreflightDomain(diagnostic),
    httpStatus: diagnostic?.match(/\bstatus code\s+(\d{3})\b/i)?.[1],
  }
}

export function scheduledTimeoutMessage(timeoutMs: number | undefined): string {
  return `执行超过 ${timeoutMs ?? 0}ms，已超时停止。`
}

export function conversationNotFoundMessage(conversationId: string): string {
  return `找不到会话：${conversationId}`
}

export function isConversationNotFoundMessage(message: string): boolean {
  return message.startsWith("找不到会话：") || message.includes("not found")
}

export function commandExecutionStatusMessage(input: {
  readonly name: string
  readonly timedOut: boolean
  readonly exitCode?: number | null
  readonly signal?: string | null
}): string {
  if (input.timedOut) return `命令执行超时：/${input.name}`
  if (input.exitCode === 0) return `命令已完成：/${input.name}`
  return `命令执行失败：/${input.name}（${String(input.exitCode ?? input.signal ?? "unknown")}）`
}

export function agentDiagnosticMessage(message: string, diagnostic: string | undefined): string {
  const trimmed = diagnostic?.trim()
  return trimmed ? `${message}诊断信息：${trimmed}` : message
}

function isWebFetchPreflightFailure(diagnostic: string | undefined): boolean {
  if (!diagnostic) return false
  return /DomainCheckFailedError/i.test(diagnostic)
    || /Unable to verify if domain .+ is safe to fetch/i.test(diagnostic)
}

function isToolUseInterruptedDiagnostic(diagnostic: string | undefined): boolean {
  if (!diagnostic) return false
  return /\bstop_reason=tool_use\b/.test(diagnostic)
    && /\bresult_type=user\b/.test(diagnostic)
}

function webFetchPreflightDomain(diagnostic: string | undefined): string | undefined {
  const match = diagnostic?.match(/Unable to verify if domain\s+([^\s]+)\s+is safe to fetch/i)
  return match?.[1]
}
