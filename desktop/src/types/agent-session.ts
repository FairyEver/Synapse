import type { SynapseInboundAttachment, SynapseInboundMessage } from "./connector"

export type SynapseSessionHistoryEntry = {
  role: string
  content: string
  timestamp: string
}

export type SynapseAgentSessionLastMessage = SynapseSessionHistoryEntry

export type SynapseAgentSessionSummary = {
  id: string
  projectId: string
  projectName: string
  sessionKey: string
  name: string
  platform: string
  agentType: string
  active: boolean
  live: boolean
  createdAt: string
  updatedAt: string
  historyCount: number
  lastMessage: SynapseAgentSessionLastMessage | null
  userName?: string
  chatName?: string
}

export type SynapseAgentSessionDetail = SynapseAgentSessionSummary & {
  agentSessionId: string
  history: SynapseSessionHistoryEntry[]
}

export type SynapseAgentSessionListResult = {
  sessions: SynapseAgentSessionSummary[]
  activeKeys: Record<string, string>
}

export type SynapseCreateAgentSessionPayload = {
  projectId: string
  sessionKey: string
  name?: string
}

export type SynapseGetAgentSessionPayload = {
  projectId: string
  sessionId: string
  historyLimit?: number
}

export type SynapseSwitchAgentSessionPayload = {
  projectId: string
  sessionKey: string
  sessionId: string
}

export type SynapseCommandGroup = "session" | "settings" | "info" | "advanced"

export type SynapseCommandSource = "builtin" | "custom"

export type SynapseCommandCatalogItem = {
  id: string
  command: string
  aliases: string[]
  title: string
  description: string
  group: SynapseCommandGroup
  source: SynapseCommandSource
  disabled: boolean
  highRisk: boolean
  argsMode: "none" | "text"
}

export type SynapseListCommandsPayload = {
  projectId: string
}

export type SynapseListCommandsResult = {
  commands: SynapseCommandCatalogItem[]
}

export type SynapseExecuteCommandPayload = {
  projectId: string
  sessionId: string
  sessionKey?: string
  command: string
  permissionDecision?: "allow" | "deny"
}

export type SynapseCommandExecutionResult = {
  status: "completed" | "error" | "permission_required" | "denied"
  command: string
  title: string
  content: string
  format: "text" | "markdown"
  error: string | null
  session: SynapseAgentSessionDetail | null
  requiresPermission: boolean
}

export type SynapseSendAgentMessagePayload = {
  projectId: string
  sessionId: string
  sessionKey?: string
  message: string
}

export type SynapseSendAgentMessageResult = {
  status: "idle" | "running" | "waiting_permission" | "completed" | "error" | "stopped" | "timed_out"
  response: string
  error: string | null
  session: SynapseAgentSessionDetail
  events: SynapseAgentSessionEventRecord[]
  pendingPermission: SynapsePendingPermission | null
}

export type SynapseAgentSessionEventType =
  | "text"
  | "thinking"
  | "tool_use"
  | "tool_result"
  | "permission_request"
  | "permission_response"
  | "result"
  | "error"

export type SynapseAgentSessionEventRecord = {
  sessionId: string
  seq: number
  type: SynapseAgentSessionEventType
  timestamp: string
  payload: Record<string, unknown>
}

export type SynapsePendingPermission = {
  requestId: string
  toolName: string
  toolInput: string
  toolInputRaw: Record<string, unknown>
  questions: Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
    multiSelect?: boolean
  }>
}

export type SynapseRespondPermissionPayload = {
  projectId: string
  sessionId: string
  requestId: string
  decision: "allow" | "deny"
  message?: string
}

export type SynapseRespondPermissionResult = {
  status: "accepted" | "denied"
  event: SynapseAgentSessionEventRecord
  pendingPermission: null
}

export type SynapseCardHeader = {
  title: string
  color?: string
}

export type SynapseCardButton = {
  text: string
  type?: "primary" | "default" | "danger" | string
  value: string
  extra?: Record<string, string>
}

export type SynapseCardActionLayout = "row" | "equal_columns"

export type SynapseCardElement =
  | { type: "markdown"; content: string }
  | { type: "divider" }
  | { type: "actions"; buttons: SynapseCardButton[]; layout?: SynapseCardActionLayout }
  | { type: "note"; text: string; tag?: string }
  | {
      type: "list_item"
      text: string
      buttonText: string
      buttonType?: "primary" | "default" | "danger" | string
      buttonValue: string
      extra?: Record<string, string>
    }
  | {
      type: "select"
      placeholder: string
      options: Array<{ text: string; value: string }>
      initValue?: string
    }

export type SynapseRichCard = {
  header?: SynapseCardHeader
  elements: SynapseCardElement[]
}

export type SynapseMessageInteraction =
  | {
      kind: "button"
      text: string
      value: string
      buttonType?: string
      row: number
      extra?: Record<string, string>
    }
  | {
      kind: "select"
      placeholder: string
      options: Array<{ text: string; value: string }>
      initValue?: string
      row: number
    }

export type SynapseSessionMessage = {
  id: string
  sessionId: string
  role: "user" | "assistant" | "system"
  content: string
  createdAt: string
  attachments?: SynapseInboundAttachment[]
  card?: SynapseRichCard
  interactions?: SynapseMessageInteraction[]
  fallbackText?: string
  status?: "sending" | "sent" | "error"
}

export type SynapseRenderableMessage = SynapseSessionMessage & {
  fallbackText: string
  interactions: SynapseMessageInteraction[]
  canRenderCard: boolean
}

export type SynapseInteractionDispatch =
  | { kind: "message"; content: string }
  | { kind: "navigation"; action: string }
  | { kind: "unsupported"; action: string }

export type SynapseConnectorSessionTurn = {
  inbound: SynapseInboundMessage
  sessionId: string
  prompt: string
  replyContext?: unknown
}
