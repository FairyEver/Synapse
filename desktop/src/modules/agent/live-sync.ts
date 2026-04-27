import type { SynapseAgentConversationUpdatedPayload } from "@/types/agent"

type SelectedConversation = {
  readonly conversationId?: string
  readonly sessionKey: string
}

type FollowDecisionInput = SynapseAgentConversationUpdatedPayload & {
  readonly conversationId: string
}

type FollowState = {
  readonly followFeishu: boolean
  readonly inputDirty: boolean
  readonly selectedConversationId?: string
  readonly selectedSessionKey: string
}

type UnreadState = Record<string, number>

type TimelineSnapshotState = {
  readonly capturedVersion: number
  readonly currentVersion: number
}

function isSelectedConversation(
  target: Pick<SynapseAgentConversationUpdatedPayload, "sessionKey"> & { readonly conversationId?: string },
  selected: SelectedConversation,
): boolean {
  if (selected.conversationId) {
    return target.conversationId === selected.conversationId
  }
  return target.sessionKey === selected.sessionKey
}

function incrementUnreadForConversation(
  current: UnreadState,
  target: Pick<SynapseAgentConversationUpdatedPayload, "sessionKey"> & { readonly conversationId?: string },
  selected: SelectedConversation,
): UnreadState {
  if (!target.conversationId || isSelectedConversation(target, selected)) {
    return current
  }
  return {
    ...current,
    [target.conversationId]: (current[target.conversationId] ?? 0) + 1,
  }
}

function clearConversationUnread(
  current: UnreadState,
  conversationId: string,
): UnreadState {
  if (current[conversationId] === undefined) return current
  const next = { ...current }
  delete next[conversationId]
  return next
}

function shouldAutoFollowConversation(
  target: FollowDecisionInput,
  state: FollowState,
): boolean {
  return state.followFeishu
    && !state.inputDirty
    && target.platform === "feishu"
    && !isSelectedConversation(target, {
      conversationId: state.selectedConversationId,
      sessionKey: state.selectedSessionKey,
    })
}

function shouldApplyTimelineSnapshot(
  target: Pick<SynapseAgentConversationUpdatedPayload, "sessionKey"> & { readonly conversationId?: string },
  selected: SelectedConversation,
  state: TimelineSnapshotState,
): boolean {
  return state.capturedVersion === state.currentVersion
    && isSelectedConversation(target, selected)
}

export {
  clearConversationUnread,
  incrementUnreadForConversation,
  isSelectedConversation,
  shouldApplyTimelineSnapshot,
  shouldAutoFollowConversation,
}
export type { UnreadState }
