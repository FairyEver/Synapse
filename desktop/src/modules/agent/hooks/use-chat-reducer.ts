import type {
  SynapseAgentPendingPermission,
  SynapseAgentPublishedCommand,
  SynapseAgentProviderState,
  SynapseAgentSessionSummary,
  SynapseAgentStatus,
  SynapseAgentTimelineItem,
} from "@/types/agent"
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
  followFeishu: boolean
  unreadByConversationId: UnreadState
  selectedProjectId: string | undefined
  selectedConversationId: string | undefined
  selectedSessionKey: string
  loading: boolean
  sendingConversationIds: Set<string>
  error: string | null
}

type ChatAction =
  | { type: "SET_SESSIONS"; sessions: SynapseAgentSessionSummary[] }
  | { type: "UPDATE_SESSIONS"; updater: (current: SynapseAgentSessionSummary[]) => SynapseAgentSessionSummary[] }
  | { type: "SET_ARCHIVED_SESSIONS"; archivedSessions: SynapseAgentSessionSummary[] }
  | { type: "SET_TIMELINE"; timeline: SynapseAgentTimelineItem[] }
  | { type: "UPDATE_TIMELINE"; updater: (current: SynapseAgentTimelineItem[]) => SynapseAgentTimelineItem[] }
  | { type: "SET_PENDING_PERMISSIONS"; pendingPermissions: SynapseAgentPendingPermission[] }
  | { type: "UPDATE_PENDING_PERMISSIONS"; updater: (current: SynapseAgentPendingPermission[]) => SynapseAgentPendingPermission[] }
  | { type: "SET_STATUS"; status: SynapseAgentStatus | null }
  | { type: "SET_PROVIDERS"; providers: SynapseAgentProviderState | null }
  | { type: "SET_COMMANDS"; commands: SynapseAgentPublishedCommand[] }
  | { type: "SET_FOLLOW_FEISHU"; followFeishu: boolean }
  | { type: "SET_UNREAD"; unreadByConversationId: UnreadState }
  | { type: "UPDATE_UNREAD"; updater: (current: UnreadState) => UnreadState }
  | { type: "SET_SELECTED_PROJECT_ID"; selectedProjectId: string | undefined }
  | { type: "SET_SELECTED_CONVERSATION_ID"; selectedConversationId: string | undefined }
  | { type: "SET_SELECTED_SESSION_KEY"; selectedSessionKey: string }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "ADD_SENDING_CONVERSATION"; conversationId: string }
  | { type: "REMOVE_SENDING_CONVERSATION"; conversationId: string }
  | { type: "SET_SENDING_CONVERSATION_IDS"; sendingConversationIds: Set<string> }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "RESET" }

const initialChatState: ChatState = {
  sessions: [],
  archivedSessions: [],
  timeline: [],
  pendingPermissions: [],
  status: null,
  providers: null,
  commands: [],
  followFeishu: false,
  unreadByConversationId: {},
  selectedProjectId: undefined,
  selectedConversationId: undefined,
  selectedSessionKey: DEFAULT_LOCAL_SESSION_KEY,
  loading: false,
  sendingConversationIds: new Set(),
  error: null,
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "SET_SESSIONS":
      return { ...state, sessions: action.sessions }
    case "UPDATE_SESSIONS":
      return { ...state, sessions: action.updater(state.sessions) }
    case "SET_ARCHIVED_SESSIONS":
      return { ...state, archivedSessions: action.archivedSessions }
    case "SET_TIMELINE":
      return { ...state, timeline: action.timeline }
    case "UPDATE_TIMELINE":
      return { ...state, timeline: action.updater(state.timeline) }
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
    case "SET_FOLLOW_FEISHU":
      return { ...state, followFeishu: action.followFeishu }
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
    case "SET_SENDING_CONVERSATION_IDS":
      return { ...state, sendingConversationIds: action.sendingConversationIds }
    case "SET_ERROR":
      return { ...state, error: action.error }
    case "RESET":
      return { ...initialChatState }
  }
}

export { chatReducer, initialChatState }
export type { ChatState, ChatAction }
