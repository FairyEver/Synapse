import type { SynapseAgentConversationUpdatedPayload } from "@/types/agent"

type SelectedConversation = {
  readonly projectId?: string
  readonly conversationId?: string
  readonly sessionKey: string
}

type UnreadState = Record<string, number>

type TimelineSnapshotState = {
  readonly capturedVersion: number
  readonly currentVersion: number
}

type PhaseUpdateState = {
  readonly pendingConversationIds: ReadonlySet<string>
}

function isSelectedConversation(
  target: Pick<SynapseAgentConversationUpdatedPayload, "projectId" | "sessionKey"> & {
    readonly conversationId?: string
  },
  selected: SelectedConversation,
): boolean {
  if (selected.projectId && target.projectId !== selected.projectId) {
    return false
  }
  if (selected.conversationId) {
    return target.conversationId === selected.conversationId
  }
  return target.sessionKey === selected.sessionKey
}

function incrementUnreadForConversation(
  current: UnreadState,
  target: Pick<SynapseAgentConversationUpdatedPayload, "projectId" | "sessionKey"> & {
    readonly conversationId?: string
  },
  selected: SelectedConversation,
): UnreadState {
  if (!target.conversationId || isSelectedConversation(target, selected)) {
    return current
  }
  const key = conversationUnreadKey(target.projectId, target.conversationId)
  return {
    ...current,
    [key]: (current[key] ?? 0) + 1,
  }
}

function clearConversationUnread(
  current: UnreadState,
  projectId: string,
  conversationId: string,
): UnreadState {
  const key = conversationUnreadKey(projectId, conversationId)
  if (current[key] === undefined) return current
  const next = { ...current }
  delete next[key]
  return next
}

function shouldApplyTimelineSnapshot(
  target: Pick<SynapseAgentConversationUpdatedPayload, "projectId" | "sessionKey"> & {
    readonly conversationId?: string
  },
  selected: SelectedConversation,
  state: TimelineSnapshotState,
): boolean {
  return state.capturedVersion === state.currentVersion
    && isSelectedConversation(target, selected)
}

function shouldApplyPhaseUpdate(
  target: Pick<SynapseAgentConversationUpdatedPayload, "projectId" | "sessionKey"> & {
    readonly conversationId?: string
  },
  selected: SelectedConversation,
  state: PhaseUpdateState,
): boolean {
  const pendingBackground = selected.conversationId && target.conversationId
    ? state.pendingConversationIds.has(target.conversationId)
      && target.conversationId !== selected.conversationId
    : false
  return !pendingBackground && isSelectedConversation(target, selected)
}

function conversationUnreadKey(projectId: string, conversationId: string): string {
  return `${projectId}:${conversationId}`
}

export {
  clearConversationUnread,
  conversationUnreadKey,
  incrementUnreadForConversation,
  isSelectedConversation,
  shouldApplyPhaseUpdate,
  shouldApplyTimelineSnapshot,
}
export type { UnreadState }
