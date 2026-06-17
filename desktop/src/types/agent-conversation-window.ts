export type AgentConversationTarget = {
  readonly projectId: string
  readonly conversationId: string
  readonly sessionKey: string
}

export type AgentConversationWindowRequest = AgentConversationTarget & {
  readonly title?: string
}

export type AgentDetachedConversation = AgentConversationTarget & {
  readonly title: string
  readonly windowId: number
  readonly openedAt: string
}

export type AgentConversationWindowOpenResult = {
  readonly opened: true
}

export type AgentConversationWindowFocusResult = {
  readonly focused: boolean
}

export type AgentConversationWindowReplaceRequest = {
  readonly from: AgentConversationTarget
  readonly to: AgentConversationWindowRequest
}

export type AgentConversationWindowReplaceResult = {
  readonly replaced: boolean
}
