import type {
  SynapseAgentPendingPermission,
  SynapseAgentPublishedCommand,
  SynapseAgentProviderState,
  SynapseAgentSessionSummary,
  SynapseAgentStatus,
  SynapseAgentTimelineItem,
} from "@/types/agent"
import type { SynapseAgentPersona } from "@/types/agent-persona"
import type { UnreadState } from "../live-sync"
import { DEFAULT_LOCAL_SESSION_KEY } from "../utils"

type ChatState = {
  sessions: SynapseAgentSessionSummary[]
  archivedSessions: SynapseAgentSessionSummary[]
  timeline: SynapseAgentTimelineItem[]
  pendingPermissions: SynapseAgentPendingPermission[]
  status: SynapseAgentStatus | null
  providers: SynapseAgentProviderState | null
  commands: SynapseAgentPublishedCommand[]
  personas: SynapseAgentPersona[]
  unreadByConversationId: UnreadState
  selectedProjectId: string | undefined
  selectedConversationId: string | undefined
  selectedSessionKey: string
  loading: boolean
  sendingConversationIds: Set<string>
  cancelPhase: "idle" | "cancel_pending" | "cancelled"
  error: string | null
  currentConversationModel: string | undefined
}

type ChatAction =
  | { type: "SET_SESSIONS"; sessions: SynapseAgentSessionSummary[] }
  | { type: "UPDATE_SESSIONS"; updater: (current: SynapseAgentSessionSummary[]) => SynapseAgentSessionSummary[] }
  | { type: "SET_ARCHIVED_SESSIONS"; archivedSessions: SynapseAgentSessionSummary[] }
  | { type: "UPDATE_ARCHIVED_SESSIONS"; updater: (current: SynapseAgentSessionSummary[]) => SynapseAgentSessionSummary[] }
  | { type: "SET_TIMELINE"; timeline: SynapseAgentTimelineItem[] }
  | { type: "UPDATE_TIMELINE"; updater: (current: SynapseAgentTimelineItem[]) => SynapseAgentTimelineItem[] }
  | { type: "SET_PENDING_PERMISSIONS"; pendingPermissions: SynapseAgentPendingPermission[] }
  | { type: "UPDATE_PENDING_PERMISSIONS"; updater: (current: SynapseAgentPendingPermission[]) => SynapseAgentPendingPermission[] }
  | { type: "SET_STATUS"; status: SynapseAgentStatus | null }
  | { type: "SET_PROVIDERS"; providers: SynapseAgentProviderState | null }
  | { type: "SET_COMMANDS"; commands: SynapseAgentPublishedCommand[] }
  | { type: "SET_PERSONAS"; personas: SynapseAgentPersona[] }
  | { type: "SET_UNREAD"; unreadByConversationId: UnreadState }
  | { type: "UPDATE_UNREAD"; updater: (current: UnreadState) => UnreadState }
  | { type: "SET_SELECTED_PROJECT_ID"; selectedProjectId: string | undefined }
  | { type: "SET_SELECTED_CONVERSATION_ID"; selectedConversationId: string | undefined }
  | { type: "SET_SELECTED_SESSION_KEY"; selectedSessionKey: string }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "ADD_SENDING_CONVERSATION"; conversationId: string }
  | { type: "REMOVE_SENDING_CONVERSATION"; conversationId: string }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_CANCEL_PHASE"; cancelPhase: ChatState["cancelPhase"] }
  | { type: "SET_CURRENT_CONVERSATION_MODEL"; model: string | undefined }
  | { type: "CANCEL_REQUESTED" }
  | { type: "CANCEL_RESET" }
  | { type: "RESET" }

const initialChatState: ChatState = {
  sessions: [],
  archivedSessions: [],
  timeline: [],
  pendingPermissions: [],
  status: null,
  providers: null,
  commands: [],
  personas: [],
  unreadByConversationId: {},
  selectedProjectId: undefined,
  selectedConversationId: undefined,
  selectedSessionKey: DEFAULT_LOCAL_SESSION_KEY,
  loading: false,
  sendingConversationIds: new Set(),
  cancelPhase: "idle",
  error: null,
  currentConversationModel: undefined,
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions }
    case "UPDATE_SESSIONS":
      return { ...state, sessions: action.updater(state.sessions) }
    case "SET_ARCHIVED_SESSIONS":
      return { ...state, archivedSessions: action.archivedSessions }
    case "UPDATE_ARCHIVED_SESSIONS":
      return { ...state, archivedSessions: action.updater(state.archivedSessions) }
    case "SET_TIMELINE":
      return {
        ...state,
        timeline: action.timeline,
        currentConversationModel: latestResultModel(action.timeline),
      }
    case "UPDATE_TIMELINE": {
      const timeline = action.updater(state.timeline)
      return {
        ...state,
        timeline,
        currentConversationModel: latestResultModel(timeline),
      }
    }
    case "SET_PENDING_PERMISSIONS":
      return { ...state, pendingPermissions: action.pendingPermissions }
    case "UPDATE_PENDING_PERMISSIONS":
      return { ...state, pendingPermissions: action.updater(state.pendingPermissions) }
    case "SET_STATUS":
      return { ...state, status: action.status }
    case "SET_PROVIDERS":
      return { ...state, providers: action.providers }
    case "SET_COMMANDS":
      return { ...state, commands: action.commands }
    case "SET_PERSONAS":
      return { ...state, personas: action.personas }
    case "SET_UNREAD":
      return { ...state, unreadByConversationId: action.unreadByConversationId }
    case "UPDATE_UNREAD":
      return { ...state, unreadByConversationId: action.updater(state.unreadByConversationId) }
    case "SET_SELECTED_PROJECT_ID":
      return { ...state, selectedProjectId: action.selectedProjectId }
    case "SET_SELECTED_CONVERSATION_ID":
      return { ...state, selectedConversationId: action.selectedConversationId }
    case "SET_SELECTED_SESSION_KEY":
      return { ...state, selectedSessionKey: action.selectedSessionKey }
    case "SET_LOADING":
      return { ...state, loading: action.loading }
    case "ADD_SENDING_CONVERSATION": {
      const next = new Set(state.sendingConversationIds)
      next.add(action.conversationId)
      return { ...state, sendingConversationIds: next }
    }
    case "REMOVE_SENDING_CONVERSATION": {
      const next = new Set(state.sendingConversationIds)
      next.delete(action.conversationId)
      return { ...state, sendingConversationIds: next }
    }
    case "SET_CURRENT_CONVERSATION_MODEL":
      return { ...state, currentConversationModel: action.model }
    case "SET_ERROR":
      return { ...state, error: action.error }
    case "SET_CANCEL_PHASE":
      return { ...state, cancelPhase: action.cancelPhase }
    case "CANCEL_REQUESTED":
      return { ...state, cancelPhase: "cancel_pending" }
    case "CANCEL_RESET":
      return { ...state, cancelPhase: "idle" }
    case "RESET":
      return { ...initialChatState }
  }
}

function latestResultModel(timeline: readonly SynapseAgentTimelineItem[]): string | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index]
    if (item?.kind !== "result" && !(item?.kind === "message" && item.role === "assistant")) continue
    const model = item.metadata?.model
    if (typeof model === "string" && model.length > 0) return model
  }
  return undefined
}

export { chatReducer, initialChatState }
export type { ChatState, ChatAction }
